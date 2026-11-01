/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

/**
 * Abstracts KDE implementation specific details.
 *
 * Driver is responsible for initializing the tiling logic, connecting
 * signals(Qt/KDE term for binding events), and providing specific utility
 * functions.
 */
var KWIN: KWin;

const LayoutOSDNames: { [id: string]: { name: string; icon: string } } = {
  TileLayout: { name: "Tile", icon: "tile" },
  MonocleLayout: { name: "Monocle", icon: "monocle" },
  ThreeColumnLayout: { name: "Three Column", icon: "threecolumn" },
  SpiralLayout: { name: "Spiral", icon: "spiral" },
  QuarterLayout: { name: "Quarter", icon: "quarter" },
  StackedLayout: { name: "Stacked", icon: "stacked" },
  ColumnsLayout: { name: "Columns", icon: "columns" },
  SpreadLayout: { name: "Spread", icon: "spread" },
  FloatingLayout: { name: "Floating", icon: "floating" },
  StairLayout: { name: "Stair", icon: "stair" },
  BinaryTreeLayout: { name: "Binary Tree", icon: "binarytree" },
  CascadeLayout: { name: "Cascade", icon: "cascade" },
};

type RunningShortcutSeq = {
  pressTime: number;
  seq: ShortcutSequence[];
  finishAction: KrohnkiteAction | null | "empty";
  actionCandidate: KrohnkiteAction | null;
};

function logProtectedError(e: any) {
  const line = e && e.lineNumber !== undefined ? e.lineNumber : "unknown";
  warning(`ProtectFunc: Error raised line: ${line}. Error: ${String(e)}`);
}

/**
 * Prevents a single event callback from re-entering itself.
 *
 * KWin emits signals synchronously, including for state this script changes
 * itself. Each connection owns a guard so feedback loops are still broken,
 * while unrelated events (e.g. a desktop change triggered by a shortcut) are
 * delivered instead of being dropped by a driver-wide guard.
 */
class ReentrancyGuard {
  private _entered = false;

  public run(callback: () => void) {
    if (this._entered) return;
    this._entered = true;
    try {
      callback();
    } catch (e: any) {
      logProtectedError(e);
    } finally {
      this._entered = false;
    }
  }
}

class KWinDriver implements IDriverContext {
  public static backendName: string = "kwin";
  public get backend(): string {
    return KWinDriver.backendName;
  }
  public get currentDesktop(): VirtualDesktop {
    return this.workspace.currentDesktop;
  }
  public get currentSurface(): ISurface {
    /* The active window can already be deleted (and its output destroyed)
     * while events from a hotplug/resume flurry are still being handled;
     * fall back to the active screen rather than touch a dead wrapper. */
    const output = resolveWindowOutput(
      this.workspace,
      this.workspace.activeWindow,
    );
    return this._surfaceStore.getSurface(
      output,
      this.workspace.currentActivity,
      this.workspace.currentDesktop,
    );
  }
  public set currentSurface(value: ISurface) {
    const ksrf = value as KWinSurface;

    /* NOTE: only supports switching desktops */
    // TODO: fousing window on other screen?
    // TODO: find a way to change activity

    if (this.workspace.currentDesktop.id !== ksrf.vDesktop.id)
      this.workspace.currentDesktop = ksrf.vDesktop;
    if (this.workspace.currentActivity !== ksrf.activity)
      this.workspace.currentActivity = ksrf.activity;
  }
  public get currentWindow(): WindowClass | null {
    const client = this.workspace.activeWindow;
    return client ? this.windowMap.get(client) : null;
  }
  public set currentWindow(window: WindowClass | null) {
    if (window !== null) {
      window.focusTime = getTime();
      this.workspace.activeWindow = (window.window as DriverWindow).window;
    }
  }
  public get currentSurfaces(): ISurface[] {
    const currentSurfaces: ISurface[] = [];
    this.workspace.screens.forEach((output) => {
      // Each output can show a different virtual desktop (per-screen virtual
      // desktops), so resolve the desktop per output rather than using the
      // global currentDesktop — otherwise every non-active output gets tiled
      // against the wrong desktop (e.g. the source output isn't re-tiled after
      // a window moves away). Falls back to the global desktop on pre-6.7 KWin.
      currentSurfaces.push(
        this._surfaceStore.getSurface(
          output,
          this.workspace.currentActivity,
          this._outputCurrentDesktop(output),
        ),
      );
    });
    return currentSurfaces;
  }
  public get cursorPosition(): QPoint | null {
    const workspacePos = this.workspace.cursorPos;
    return workspacePos !== null
      ? { x: workspacePos.x, y: workspacePos.y }
      : null;
  }
  public get isRegister(): boolean {
    return this._isRegister.state;
  }

  public workspace: Workspace;
  private _shortcuts: Map<ShortcutName, Shortcut>;
  private _shortcutSequences: Map<ShortcutName, IShortcutConfEntry[]>;
  private _shortcutPressTime: number;
  /* this token doesn't reset ever and ~9 quadrillion presses need to overflow it and broke. This is dangerous programming, programming on the edge. */
  private _shortcutFinishToken: number;
  private _runningShortcutSequence: RunningShortcutSeq | null;
  private engine: TilingEngine;
  private control: TilingController;
  private windowMap: WrapperMap<KwinWindow, WindowClass>;
  private _surfaceStore: KWinSurfaceStore;
  private _isRegister: IRegister;
  private _connections: Array<{
    signal: Signal<(...args: any[]) => void>;
    callback: (...args: any[]) => void;
  }>;
  private _started: boolean;
  private _disposed: boolean;
  /* Last time any window was moved/resized with the mouse; see
   * _onWindowSizeChanged. */
  private _lastInteractiveMoveResize: number;
  private _centerPointerPending: boolean;

  constructor(api: Api, config?: KWinConfig) {
    KWIN = api.kwin;
    CONFIG = KWINCONFIG = config ?? new KWinConfig();
    LOG = KWINCONFIG.createLogger();
    this.workspace = api.workspace;
    this._shortcuts = new Map(
      api.shortcuts.map((entry) => [entry.name, new Shortcut(entry)]),
    );
    this._shortcutSequences = new Map();
    this._shortcutPressTime = 0;
    this._shortcutFinishToken = 0;
    this._runningShortcutSequence = null;
    this.engine = new TilingEngine();
    this.control = new TilingController(this.engine);
    this.windowMap = new WrapperMap(
      (client: KwinWindow) => DriverWindow.generateID(client),
      (client: KwinWindow) =>
        new WindowClass(
          new DriverWindow(client, this.workspace, this._surfaceStore),
        ),
    );
    this._connections = [];
    this._started = false;
    this._disposed = false;
    this._lastInteractiveMoveResize = 0;
    this._centerPointerPending = false;
    this._surfaceStore = new KWinSurfaceStore(this.workspace);
    this._isRegister = {
      state: false,
      lastPushed: 0,
      toggleMode: CONFIG.altRegisterIsToggle,
      alterActionID: 0,
    };
    // Create the signal-owning dependency last. If any of the data-only
    // setup above fails, the constructor has not connected external callbacks.
    DBUS = new DBusManager(api.dbus);
  }
  /*
   * Main
   */
  public main() {
    if (this._started || this._disposed) return;
    this._started = true;
    LOG?.send(LogModules.printConfig, undefined, `Config: ${CONFIG}`);
    this._bindEvents();
    this._bindShortcut();

    const clients: KwinWindow[] = this.workspace.stackingOrder;
    for (let i = 0; i < clients.length; i++) {
      this.addWindow(clients[i], false);
    }
    this.control.onSurfaceUpdate(this, "forcedArrangeScreen");
  }
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    for (const { signal, callback } of this._connections.splice(0)) {
      try {
        signal.disconnect(callback);
      } catch (_) {
        /* A window or QML shortcut object may already have been destroyed. */
      }
    }
    for (const window of this.windowMap) window.window.dispose();
    this.engine.relocationWindows.clear();
    this.engine.windows.list = [];
    this.windowMap.clear();
    this.hideDragPreview();
    this._shortcutSequences.clear();
    this._shortcuts.clear();
    this._runningShortcutSequence = null;
    DBUS.dispose();
  }
  private addWindow(
    client: KwinWindow,
    arrange: boolean = true,
  ): WindowClass | null {
    if (client.dock) {
      // Docks reserve screen space but aren't tiled. Handle that reservation
      // separately and skip the normal window management path.
      this.manageDock(client, arrange);
      return null;
    }
    if (
      !client.deleted &&
      client.pid >= 0 &&
      !client.popupWindow &&
      client.normalWindow &&
      !client.hidden &&
      client.width * client.height > 10
    ) {
      const window = this.windowMap.add(client);
      if (client.maximizeMode > 0) {
        (window.window as DriverWindow).maximized = true;
        // it can set maximized to false when window start already with maximized flag
        // client.setMaximize(false, false);
      }
      if (arrange) this.control.onWindowAdded(this, window, "windowAdded");
      else this.engine.manage(window);
      if (window.state !== WindowState.Unmanaged) {
        this._bindWindowEvents(window, client);
        LOG?.send(LogModules.newWindowAdded, "", debugWin(client), {
          winClass: [`${client.resourceClass}`],
        });
        return window;
      } else {
        this.windowMap.remove(client);
        LOG?.send(LogModules.newWindowUnmanaged, "", debugWin(client), {
          winClass: [`${client.resourceClass}`],
        });
      }
    } else {
      LOG?.send(LogModules.newWindowFiltered, "", debugWin(client), {
        winClass: [`${client.resourceClass}`],
      });
    }
    return null;
  }
  private manageDock(client: KwinWindow, arrange: boolean = true): void {
    const placementArea = () =>
      toRect(
        this.workspace.clientArea(
          ClientAreaOption.PlacementArea,
          client.output,
          this.workspace.currentDesktop,
        ),
      );
    let prevPlacement = {
      desktop: this.workspace.currentDesktop,
      area: placementArea(),
    };
    // Re-tile now to account for a dock whose area reservation already exists.
    if (arrange) this.control.onSurfaceUpdate(this, "manageDock");
    // Subscribe to future area changes of each dock to make sure tiled
    // windows aren't overlapped by the dock or have an excessive gap.
    this._connect(client.frameGeometryChanged, () => {
      if (!client || client.deleted) {
        return;
      }
      const desktop = this.workspace.currentDesktop;
      const area = placementArea();
      if (
        desktop.id === prevPlacement.desktop.id &&
        area.equals(prevPlacement.area)
      ) {
        // NOP if the area didn't actually change. This prevents auto-hiding
        // docks from causing re-tiles.
        return;
      }
      prevPlacement = { desktop, area };
      this.control.onSurfaceUpdate(this, "manageDock");
    });
  }
  public focusNeighborWindow(
    direction: Direction,
    winTypes: WinTypes,
  ): boolean {
    let window = this.workspace.activeWindow;
    if (!window) return false;
    let windows = this._getWindowsByDirection(
      winTypes,
      this.currentSurface,
      toRect(window.frameGeometry),
      direction,
    );
    if (windows.length === 0) return false;
    return this._setFocusOnSurface(
      window,
      this.currentSurface,
      direction,
      winTypes,
      windows,
    );
  }
  public focusOutput(
    window: KwinWindow | null,
    direction: Direction,
    winTypes: WinTypes,
  ): boolean {
    let neighbor = this.getNeighborOutput(
      direction,
      this.workspace.activeScreen,
    );
    if (neighbor === null) return false;
    // Make the neighbor output active, then resolve its surface against the
    // desktop that output is actually showing (per-screen virtual desktops).
    // Activating focuses the desktop, which also serves as the fallback when the
    // neighbor has no window to focus.
    this._makeActiveScreen(neighbor, false);
    let neighbor_surface = this._surfaceStore.getSurface(
      neighbor,
      this.workspace.currentActivity,
      this._outputCurrentDesktop(neighbor),
    );
    if (
      !this._setFocusOnSurface(window, neighbor_surface, direction, winTypes)
    ) {
      // Neighbor screen has no focusable window; we already switched to its
      // desktop, so just announce the screen change like before.
      this.showNotification("Active screen");
    }
    return true;
  }
  public focusSpecial(direction: Direction): boolean {
    switch (direction) {
      case "up": {
        let screens = this.workspace.screens;
        if (screens.length === 1) return true;
        let output = this.workspace.activeScreen;
        let idx = screens.indexOf(output);
        if (idx < 0) {
          warning(`kwindriver: focusNeighborWindow: screen doesn't found.`);
          return false;
        }
        idx = idx < screens.length - 1 ? idx + 1 : 0;
        this._makeActiveScreen(screens[idx]);
        if (CONFIG.movePointerOnFocus) {
          DBUS.moveMouseToCenter();
        }
        return false;
      }
      case "down": {
        let window = this.workspace.activeWindow;
        if (!window) return false;
        let windows = this._getWindowsByDirection(
          WinTypes.special,
          this.currentSurface,
          toRect(window.frameGeometry),
          direction,
        );
        let idx = windows.indexOf(window);
        if (idx < 0) {
          this.workspace.activeWindow = windows[0];
          if (CONFIG.movePointerOnFocus) {
            DBUS.moveMouseToFocus();
          }
          return false;
        }
        if (windows.length === 1) return false;
        idx = idx < windows.length - 1 ? idx + 1 : 0;
        this.workspace.activeWindow = windows[idx];
        if (CONFIG.movePointerOnFocus) {
          DBUS.moveMouseToFocus();
        }
        return false;
      }
      case "right":
      case "left": {
        let desktops = this.workspace.desktops;
        if (desktops.length === 1) return true;
        let currentDesktop = this.workspace.currentDesktop;
        let idx = desktops.indexOf(currentDesktop);
        if (idx < 0) {
          warning(`kwindriver: focusNeighborWindow: vDesktop doesn't found.`);
          return false;
        }
        if (direction === "left") {
          idx = idx > 0 ? idx - 1 : desktops.length - 1;
        } else {
          idx = idx < desktops.length - 1 ? idx + 1 : 0;
        }
        this.workspace.currentDesktop = desktops[idx];
        return true;
      }
    }
  }
  public focusVDesktop(
    window: KwinWindow | null,
    direction: Direction,
    winTypes: WinTypes,
  ): boolean {
    let neighbor = this.getNeighborVDesktop(direction);
    if (neighbor === null) return false;
    // Keep the same monitor when change virtual desktop.
    // TODO: delete next two strings
    // let output = this._getOutputByDirection(direction);
    // let targetOutput = output !== null ? output : this.workspace.activeScreen;
    let targetOutput = this.workspace.activeScreen;
    // Switch THIS output to the neighbor desktop via the per-output API. Setting
    // the global workspace.currentDesktop instead would jump focus to whichever
    // output already shows that desktop (per-screen virtual desktops).
    this._setOutputDesktop(targetOutput, neighbor);
    // Make the intended output active after the switch so focus lands there.
    this._makeActiveScreen(targetOutput, false);
    let neighbor_surface = this._surfaceStore.getSurface(
      targetOutput,
      this.workspace.currentActivity,
      neighbor,
    );
    let result = this._setFocusOnSurface(
      window,
      neighbor_surface,
      direction,
      winTypes,
    );
    if (CONFIG.movePointerOnFocus) {
      DBUS.moveMouseToCenter();
    }
    return result;
  }
  public getNeighborOutput(
    direction: Direction,
    source: Output,
  ): Output | null {
    let retOutput = null;
    let intersection = 0;
    let sourceRect = toRect(source.geometry);
    function isOutputCandidate(
      targetRect: Rect,
      coordinate: "x" | "y",
    ): boolean {
      let currentIntersection = sourceRect.intersection(targetRect, coordinate);
      if (currentIntersection > intersection) {
        intersection = currentIntersection;
        return true;
      }
      return false;
    }
    for (let target of this.workspace.screens) {
      if (target === source) continue;
      let targetRect = toRect(target.geometry);
      switch (direction) {
        case "left": {
          if (sourceRect.x === targetRect.maxX) {
            if (isOutputCandidate(targetRect, "y")) retOutput = target;
          }
          break;
        }
        case "right": {
          if (sourceRect.maxX === targetRect.x) {
            if (isOutputCandidate(targetRect, "y")) retOutput = target;
          }
          break;
        }
        case "up": {
          if (sourceRect.y === targetRect.maxY) {
            if (isOutputCandidate(targetRect, "x")) retOutput = target;
          }
          break;
        }
        case "down": {
          if (sourceRect.maxY === targetRect.y) {
            if (isOutputCandidate(targetRect, "x")) retOutput = target;
          }
          break;
        }
        default: {
          break;
        }
      }
    }
    return retOutput;
  }
  public getNeighborVDesktop(
    direction: Direction,
    sourceVDesktop?: VirtualDesktop,
  ): VirtualDesktop | null {
    const currentVDesktop =
      sourceVDesktop != null ? sourceVDesktop : this.workspace.currentDesktop;
    const vDesktops = this.workspace.desktops;
    const netSize = this.workspace.desktopGridSize;

    if (!currentVDesktop) return null;

    const total = vDesktops.length;
    const width = netSize.width;
    const height = netSize.height;

    // Find index of current desktop (0-based)
    const idx = vDesktops.indexOf(currentVDesktop);
    if (idx < 0) return null;

    // If width or height is 1, that axis has no neighbors.
    if ((direction === "left" || direction === "right") && width === 1)
      return null;
    if ((direction === "up" || direction === "down") && height === 1)
      return null;

    if (direction === "left" || direction === "right") {
      // column: 1..width
      const col = (idx % width) + 1;
      if (direction === "left") {
        // already at leftmost column?
        if (col === 1) return null;
        // neighbor is previous desktop in array
        return vDesktops[idx - 1] ?? null;
      } else {
        // right
        if (col === width) return null;
        // neighbor is next desktop in array (ensure within total)
        return idx + 1 < total ? vDesktops[idx + 1] : null;
      }
    } else {
      // up / down: compute row (1..height)
      const row = Math.ceil((idx + 1) / width);
      if (direction === "up") {
        if (row === 1) return null;
        const neighborIdx = idx - width;
        return neighborIdx >= 0 ? vDesktops[neighborIdx] : null;
      } else {
        // down
        if (row === height) return null;
        const neighborIdx = idx + width;
        return neighborIdx < total ? vDesktops[neighborIdx] : null;
      }
    }
  }
  public getSurface(
    output: Output,
    vDesktop?: VirtualDesktop,
  ): ISurface | null {
    if (!vDesktop) {
      vDesktop = this._outputCurrentDesktop(output);
    }
    return this._surfaceStore.getSurface(
      output,
      this.workspace.currentActivity,
      vDesktop,
    );
  }
  public setTimeout(func: () => void, timeout: number) {
    KWinSetTimeout(() => this._runProtected(func), timeout);
  }
  public showNotification(text: string) {
    if (CONFIG.notificationDuration > 0)
      popupDialog.showNotification(text, CONFIG.notificationDuration);
  }
  public showLayoutOSD() {
    if (CONFIG.notificationDuration <= 0) return;
    const entries = CONFIG.layoutOrder
      .filter((id) => LayoutOSDNames[id] !== undefined)
      .map((id) => ({
        id,
        name: LayoutOSDNames[id].name,
        icon: LayoutOSDNames[id].icon,
      }));
    if (entries.length === 0) return;
    const selected = this.engine.layouts.getCurrentLayout(
      this.currentSurface,
    ).classID;
    popupDialog.showLayouts(entries, selected, CONFIG.notificationDuration);
  }
  public showLayoutShortcut(id: string) {
    const entry = LayoutOSDNames[id];
    if (!entry || CONFIG.notificationDuration <= 0) return;
    popupDialog.showLayoutShortcut(
      { id, name: entry.name, icon: entry.icon },
      CONFIG.notificationDuration,
    );
  }
  public showLayoutChooser(): void {
    const entries = CONFIG.layoutOrder
      .filter((id) => LayoutOSDNames[id] !== undefined)
      .map((id) => ({
        id,
        name: LayoutOSDNames[id].name,
        icon: LayoutOSDNames[id].icon,
      }));
    if (entries.length === 0) return;
    const selected = this.engine.layouts.getCurrentLayout(
      this.currentSurface,
    ).classID;
    layoutChooserDialog.showLayouts(entries, selected);
  }
  public selectLayoutFromOSD(id: string): void {
    if (CONFIG.layoutOrder.indexOf(id) === -1) return;
    this._runProtected(() => {
      if (
        this.engine.layouts.getCurrentLayout(this.currentSurface).classID === id
      )
        return;
      this.engine.setLayout(this, id, false);
      this.engine.arrange(this, "shortcutLayoutCB");
    });
  }
  public showDragPreview(area: Rect, rect: Rect) {
    if (!CONFIG.dragPreview) return;
    dragPreview.showRect(
      area.x,
      area.y,
      area.width,
      area.height,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      CONFIG.dockFrameColor,
      CONFIG.dockBorderColor,
    );
  }
  public hideDragPreview() {
    dragPreview.hide();
  }
  public shortcutSequencesArrange() {}
  private _setRegisterTimeout(timeId: number, timeout?: number) {
    this.setTimeout(
      () => {
        if (
          timeId === this._isRegister.alterActionID &&
          this._isRegister.state !== this._isRegister.toggleMode
        ) {
          const timeNow = getTime();
          const timeSinceLastPressShortcut = timeNow - this._shortcutPressTime;
          if (timeSinceLastPressShortcut < CONFIG.altRegisterTimeout) {
            this._setRegisterTimeout(
              timeId,
              CONFIG.altRegisterTimeout - timeSinceLastPressShortcut,
            );
          } else {
            this._isRegister.state = this._isRegister.toggleMode;
            this.showNotification(
              `Register ${this._isRegister.state ? "on" : "off"}`,
            );
          }
        }
      },
      timeout ?? CONFIG.notificationDuration + 5,
    );
  }
  public alterRegisterHdl(action: KrohnkiteAction) {
    switch (action) {
      case "AlterRegister": {
        this._isRegister.state = !this._isRegister.state;
        this._isRegister.alterActionID = getTime();
        // const id = this._isRegister.alterActionID;
        this.showNotification(
          `Register ${this._isRegister.state ? "on" : "off"}`,
        );
        if (this._isRegister.state !== this._isRegister.toggleMode) {
          this._setRegisterTimeout(this._isRegister.alterActionID);
        }
        break;
      }
      case "ToggleRegister": {
        this._isRegister.alterActionID = 0;
        this._isRegister.toggleMode = !this._isRegister.toggleMode;
        this._isRegister.state = this._isRegister.toggleMode;
        this.showNotification(
          `Register toggled ${this._isRegister.state ? "on" : "off"}`,
        );
        break;
      }
    }
  }
  public relocateWindows(): boolean {
    const relocationWindows = this.engine.relocationWindows;
    if (relocationWindows.totalNumWinsPrepareToOutput === 0) {
      this._transferWindowsToVDesktops();
      return true;
    }
    let totalWindowsSentToOutput = 0;
    for (const [output, windows] of relocationWindows.toOutputs.entries()) {
      for (const window of windows) {
        if (this._moveWindowToOutput(window, output!)) {
          if (relocationWindows.isSending === false)
            relocationWindows.isSending = true;
          totalWindowsSentToOutput++;
        }
      }
    }

    if (totalWindowsSentToOutput === 0) {
      relocationWindows.clear();
      return false;
    }
    if (this._sendingWindowsProcessCall("quickRelocationWindows")) return true;

    const time = getTime();
    relocationWindows.startTime = time;

    const forcedArrangeScreen = () => {
      if (relocationWindows.isSending && relocationWindows.startTime <= time) {
        warning(
          `${getMethodName()}. Forced Arrange. Start time: ${time}, Number of prepared Windows: ${relocationWindows.totalNumWinsPrepareToOutput}, sent:${totalWindowsSentToOutput}, sending to Output: ${relocationWindows.getWinsSendingToOutput}, prepare to transfer to VDesktop: ${relocationWindows.totalNumWinsPrepareToVDesktop}`,
        );
        relocationWindows.clear();
        try {
          this.control.engine.arrange(this, "forcedArrangeScreen");
        } catch (e) {
          warning(`${getMethodName()}: ${e}`);
        }
      }
    };

    this.setTimeout(
      forcedArrangeScreen,
      TilingEngine.SENDING_WINDOWS_MAX_WAIT_TIME,
    );
    return true;
  }
  private _moveWindowToOutput(
    window: WindowClass,
    targetOutput: Output,
  ): boolean {
    const client = (window.window as DriverWindow).window;
    if (client == null) return false;

    window.isSendingToOutput = true;
    window.relocationTargetOutput = targetOutput;
    try {
      this.workspace.sendClientToScreen(client, targetOutput);
    } catch (e) {
      window.isSendingToOutput = false;
      window.relocationTargetOutput = null;
      warning(`${getMethodName()}: sendClientToScreen() failed. ${e}`);
      return false;
    }
    /* Do not rely on outputChanged alone: KWin's Window::sendToOutput()
     * returns early when its move-resize output is already the target, and
     * then emits no signal at all. Verify the result after KWin's call has
     * fully unwound; the 100 ms watchdog remains the last resort. */
    /* 0 ms is a next-event-loop turn, not "no delay and therefore useless":
     * it runs after sendClientToScreen() returns, so we do not re-enter KWin
     * while Window::sendToOutput() is still on the stack. The outputChanged
     * handler may schedule the same check; the first one completes the
     * relocation and the second becomes a no-op. */
    this.setTimeout(
      () => this._finishOutputRelocation(window, targetOutput),
      0,
    );
    return true;
  }
  private _finishOutputRelocation(
    window: WindowClass,
    targetOutput: Output,
  ): void {
    if (!window.isAlive() || !window.isSendingToOutput) return;
    const client = (window.window as DriverWindow).window;
    if (!outputIsAlive(client.output)) return;
    if (client.output.name !== targetOutput.name) return;

    window.isSendingToOutput = false;
    window.relocationTargetOutput = null;
    this._sendingWindowsProcessCall("relocationCompletionCB");
  }
  /**
   * Defer a surface-change arrange to the next event-loop turn.
   *
   * KWin emits outputChanged from inside Window::sendToOutput() and may emit
   * desktopsChanged from finishInteractiveOutputChange() before that call
   * returns. Committing geometry from those callbacks re-enters KWin while it
   * is still relocating the window. Deferring lets KWin finish first, while
   * the relocation-pending flag keeps enforceSize() from reverting the move
   * in the meantime.
   */
  private _scheduleSurfaceArrange(
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
    mayBeOverviewDrop: boolean = false,
  ): void {
    const token = ++window.surfaceArrangeToken;
    const overviewWasActive =
      mayBeOverviewDrop &&
      typeof this.workspace.isEffectActive === "function" &&
      this.workspace.isEffectActive("overview");
    window.isRelocationPending = true;
    this.setTimeout(() => {
      if (window.surfaceArrangeToken !== token) return;
      if (!window.isAlive()) {
        window.isRelocationPending = false;
        return;
      }
      window.isRelocationPending = false;

      if (overviewWasActive && this._moveOverviewDropToCursorOutput(window)) {
        /* The direct geometry write fires output/desktop signals
         * synchronously. If it did, a newer token owns the next arrange;
         * otherwise fall through and lay out the window at its new surface. */
        if (window.surfaceArrangeToken !== token) return;
      }

      this.control.onWindowChanged(
        this,
        window,
        reason,
        "deferred surface change",
        [window.surface],
      );
    }, 0);
  }
  /**
   * Work around KWin's Grid View drop path.
   *
   * When a window drag is accepted by a virtual-desktop DropArea, KWin only
   * assigns window.desktops and never calls sendClientToScreen(), so the
   * window stays on the source output. If Overview is active and the drop
   * targeted the desktop currently shown on the output under the cursor,
   * move the window there explicitly.
   *
   * Returns true when a move was attempted.
   */
  private _moveOverviewDropToCursorOutput(window: WindowClass): boolean {
    if (
      typeof this.workspace.isEffectActive !== "function" ||
      !this.workspace.isEffectActive("overview")
    )
      return false;

    const client = (window.window as DriverWindow).window;
    if (!client || client.deleted) return false;
    if (client.desktops.length !== 1) return false;

    let cursorOutput: Output | null = null;
    try {
      cursorOutput = this.workspace.screenAt(this.workspace.cursorPos);
    } catch (e) {
      return false;
    }
    if (
      !outputIsAlive(cursorOutput) ||
      !outputIsAlive(client.output) ||
      cursorOutput!.name === client.output.name
    )
      return false;

    const targetDesktop = client.desktops[0];
    const sourceDesktop = this._outputCurrentDesktop(client.output);
    const cursorDesktop = this._outputCurrentDesktop(cursorOutput!);

    /* Only treat this as a Grid View cross-screen drop when the dropped
     * desktop is either the one shown on the target output, or is not the one
     * shown on the source output (so the window disappeared from the source).
     * Plain desktop changes while Overview is open are left alone. */
    if (
      targetDesktop.id !== cursorDesktop.id &&
      targetDesktop.id === sourceDesktop.id
    )
      return false;

    LOG?.send(
      LogModules.outputChanged,
      "overviewCrossScreenDrop",
      `window: caption:${client.caption} internalID:${client.internalId}, ` +
        `output: ${client.output.name} -> ${cursorOutput!.name}, ` +
        `desktop: ${targetDesktop.name}`,
    );

    /* Move the window with a direct frame-geometry write.
     *
     * Window::sendToOutput() returns early when its internal move-resize
     * output already points at the target, even if the real frame geometry
     * and output are still on the source, so sendClientToScreen() can be a
     * no-op. It also retargets the desktop to the target output's current
     * desktop, which loses the virtual desktop the user dropped on.
     *
     * Keep the current size: changing it makes KWin schedule an asynchronous
     * configure instead of applying the move immediately, which lets the
     * following arrange overwrite the pending move before the client acks. */
    const targetGeom = toRect(cursorOutput!.geometry);
    const actual = window.actualGeometry;
    const targetRect = new Rect(
      targetGeom.x + Math.floor((targetGeom.width - actual.width) / 2),
      targetGeom.y + Math.floor((targetGeom.height - actual.height) / 2),
      actual.width,
      actual.height,
    );
    client.frameGeometry = toQRect(targetRect);
    return true;
  }
  private _transferWindowsToVDesktops() {
    const overCapacityWindows = this.engine.relocationWindows;
    if (overCapacityWindows.totalNumWinsPrepareToVDesktop <= 0) return;
    let totalWindowsTransferToVDesktop = 0;
    for (const [
      vDesktop,
      windows,
    ] of overCapacityWindows.toVDesktops.entries()) {
      for (const window of windows) {
        this._moveWinToVDesktop(window, vDesktop!);
        totalWindowsTransferToVDesktop++;
      }
    }
    this._relocateWindowsProcessFinish("transferWindowToVDesktop");
  }
  private _relocateWindowsProcessFinish(reason: keyof typeof ArrangeReason) {
    if (this.engine.relocationWindows.activeWindow !== null)
      this.currentWindow = this.engine.relocationWindows.activeWindow;
    /*move float window to the edge of the new screen*/
    if (this.engine.relocationWindows.direction !== null) {
      let win: WindowClass;
      if (this.engine.relocationWindows.totalNumWinsPrepareToOutput === 1) {
        win = this.engine.relocationWindows.toOutputs.entries()[0]?.[1]?.[0];
      } else if (
        this.engine.relocationWindows.totalNumWinsPrepareToVDesktop === 1
      ) {
        win = this.engine.relocationWindows.toVDesktops.entries()[0]?.[1]?.[0];
      } else {
        warning(
          `${getMethodName()}. there is Direction assign but toOutputs or toVDesktops arrays length not equals one`,
        );
        return;
      }
      if (win) {
        const srfRect = win.surface.workingArea;
        const winGeom = win.actualGeometry;
        let newX = winGeom.x;
        let newY = winGeom.y;
        switch (this.engine.relocationWindows.direction) {
          case "left":
            newX = srfRect.maxX - winGeom.width;
            break;
          case "right":
            newX = srfRect.x;
            break;
          case "up":
            newY = srfRect.maxY - winGeom.height;
            break;
          case "down":
            newY = srfRect.y;
            break;
        }
        win.forceSetGeometry(
          this,
          new Rect(newX, newY, winGeom.width, winGeom.height),
        );
      }
      this.engine.relocationWindows.clear();
      return;
    }
    this.engine.relocationWindows.clear();
    try {
      this.control.engine.arrange(this, reason);
    } catch (e) {
      warning(`${getMethodName()}: ${e}`);
    }
  }
  private _sendingWindowsProcessCall(
    reason: keyof typeof ArrangeReason,
  ): boolean {
    if (
      this.engine.relocationWindows.isSending &&
      !this.engine.relocationWindows.isExistSendingWindowsToOutput
    ) {
      if (this.engine.relocationWindows.isExistTransferWindowsToVDesktop) {
        this._transferWindowsToVDesktops();
        return true;
      }

      this._relocateWindowsProcessFinish(reason);
      return true;
    }
    return false;
  }
  public moveWinToVDesktopByDirection(
    window: WindowClass,
    direction: Direction,
  ): boolean {
    let targetVDesktop = this.getNeighborVDesktop(direction);
    if (targetVDesktop === null) return false;
    let client = (window.window as DriverWindow).window;
    /* Capture the surface while the window is still on it. */
    const sourceSurface = window.surface;
    /* currentDesktopChanged fires before the window leaves the source
     * surface, and desktopsChanged fires after the switch, when the source
     * desktop is no longer current. Batch both so they only record their
     * arrange requests, then lay out once, after the window has moved, with
     * the captured source surface. Returning false tells the caller that no
     * additional arrange is needed. */
    this.engine.beginArrangeBatch();
    try {
      this.workspace.currentDesktop = targetVDesktop;
      this._moveWinToVDesktop(window, targetVDesktop);
      this.workspace.activeWindow = client;
    } finally {
      this.engine.endArrangeBatch(
        this,
        "shortcutCB",
        `${getMethodName()}:moveToVDesktop`,
        [sourceSurface],
      );
    }
    return false;
  }
  private _moveWinToVDesktop(
    window: WindowClass,
    virtualDesktop: VirtualDesktop,
  ): void {
    let client = (window.window as DriverWindow).window;
    const desktops = client.desktops;
    if (desktops.length !== 0 && !desktops.find((d) => d === virtualDesktop)) {
      client.desktops = [virtualDesktop];
    }
  }
  private _getWindowsByDirection(
    wType: WinTypes,
    surface: ISurface,
    rect: Rect,
    direction: Direction,
    window?: KwinWindow,
  ): KwinWindow[] {
    let windows: KwinWindow[] = [];
    function mapWinClassToKWinWindow(
      winClassWindows: WindowClass[],
    ): KwinWindow[] {
      return winClassWindows.map(
        (winClassWin) => (winClassWin.window as DriverWindow).window,
      );
    }
    switch (wType) {
      case WinTypes.tiled | WinTypes.docked | WinTypes.float: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleWindows(surface),
        );
        break;
      }
      case WinTypes.surfaces: {
        windows = [];
        break;
      }
      case WinTypes.tiled: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleTiles(surface),
        );
        break;
      }
      case WinTypes.float: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleFloat(surface),
        );
        break;
      }
      case WinTypes.docked: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleDocked(surface),
        );
        break;
      }
      case WinTypes.tiled | WinTypes.float: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleTilesOrFloat(surface),
        );
        break;
      }
      case WinTypes.tiled | WinTypes.docked: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleTilesOrDocked(surface),
        );
        break;
      }
      case WinTypes.float | WinTypes.docked: {
        windows = mapWinClassToKWinWindow(
          this.engine.windows.getVisibleFloatOrDocked(surface),
        );
        break;
      }
      case WinTypes.special: {
        windows = this.workspace.stackingOrder.filter(
          (win) =>
            win.output === surface.output &&
            (win.desktops.length === 0 ||
              win.desktops.indexOf(surface.vDesktop) > -1) &&
            !win.minimized &&
            !win.hidden &&
            !win.deleted &&
            win.resourceClass !== "plasmashell",
        );
        return windows;
      }
    }
    let filterFunc: (r: Rect) => boolean;
    switch (direction) {
      case "left":
        filterFunc = (r) => {
          return r.x < rect.x && rect.intersection(r, "y") > 0;
        };
        break;
      case "right":
        filterFunc = (r) => {
          return r.x > rect.x && rect.intersection(r, "y") > 0;
        };
        break;
      case "up":
        filterFunc = (r) => {
          return r.y < rect.y && rect.intersection(r, "x") > 0;
        };
        break;
      case "down":
        filterFunc = (r) => {
          return r.y > rect.y && rect.intersection(r, "x") > 0;
        };
        break;
    }
    windows = windows.filter((win) => {
      if (window && window === win) return false;
      let r = toRect(win.frameGeometry);
      return filterFunc(r);
    });
    return windows;
  }
  private _makeActiveScreen(output: Output, notify: boolean = true) {
    for (let win of this.workspace.stackingOrder) {
      if (win.resourceClass === "plasmashell" && win.output === output) {
        this.workspace.activeWindow = win;
        if (notify) this.showNotification("Active screen");
        break;
      }
    }
  }
  private _computeCrossScreenSourceRect(
    window: KwinWindow,
    surface: ISurface,
    direction: Direction,
  ): Rect {
    const tG = toRect(surface.output.geometry);
    const sG = window.output.geometry;
    const winRect = toRect(window.frameGeometry);

    if (direction === "left" || direction === "right") {
      const y_ratio = (winRect.y - sG.y) / sG.height;
      const y = tG.y + tG.height * y_ratio;
      const h = Math.min(winRect.height, tG.height - (y - tG.y));
      if (direction === "left") {
        return new Rect(tG.maxX - 5, y, 5, h);
      } else {
        return new Rect(tG.x, y, 5, h);
      }
    } else {
      const x_ratio = (winRect.x - sG.x) / sG.width;
      const x = tG.x + tG.width * x_ratio;
      const w = Math.min(winRect.width, tG.width - (x - tG.x));
      if (direction === "up") {
        return new Rect(x, tG.maxY - 5, w, 5);
      } else {
        return new Rect(x, tG.y, w, 5);
      }
    }
  }
  private _computeSurfaceEdgeSourceRect(
    surface: ISurface,
    direction: Direction,
  ): Rect {
    const g = toRect(surface.output.geometry);
    switch (direction) {
      case "left":
        return new Rect(g.maxX - 5, g.y, 5, g.height);
      case "right":
        return new Rect(g.x, g.y, 5, g.height);
      case "up":
        return new Rect(g.x, g.maxY - 5, g.width, 5);
      case "down":
        return new Rect(g.x, g.y, g.width, 5);
    }
  }
  private _setFocusOnSurface(
    window: KwinWindow | null,
    surface: ISurface,
    direction: Direction,
    winTypes: WinTypes,
    localWindows: KwinWindow[] | null = null,
  ): boolean {
    let sourceRect: Rect;
    if (localWindows !== null && window !== null) {
      sourceRect = toRect(window.frameGeometry);
    } else if (window !== null) {
      sourceRect = this._computeCrossScreenSourceRect(
        window,
        surface,
        direction,
      );
    } else {
      sourceRect = this._computeSurfaceEdgeSourceRect(surface, direction);
    }
    let windows: KwinWindow[];
    if (localWindows !== null) {
      windows = localWindows;
    } else {
      windows = this._getWindowsByDirection(
        winTypes,
        surface,
        sourceRect,
        direction,
      );
    }
    let focusCandidate: KwinWindow | null = null;
    let fCTimeStamp: number | null | undefined = null;
    let distance: number | null = null;
    for (const win of windows) {
      if (window !== null && win === window) continue;
      let winRect = toRect(win.frameGeometry);
      const d =
        direction === "left"
          ? sourceRect.x - winRect.maxX
          : direction === "right"
            ? winRect.x - sourceRect.maxX
            : direction === "up"
              ? sourceRect.y - winRect.maxY
              : winRect.y - sourceRect.maxY;
      if (focusCandidate === null || distance === null || d < distance) {
        distance = d;
        focusCandidate = win;
        fCTimeStamp = null;
      } else if (d === distance) {
        if (fCTimeStamp === null) {
          fCTimeStamp = this.engine.windows.getWindowById(
            String(focusCandidate.internalId),
          )?.focusTime;
        }
        let timestamp = this.engine.windows.getWindowById(
          String(win.internalId),
        )?.focusTime;
        if (
          (timestamp && fCTimeStamp && timestamp > fCTimeStamp) ||
          (timestamp && !fCTimeStamp)
        ) {
          fCTimeStamp = timestamp;
          focusCandidate = win;
        }
      }
    }
    if (focusCandidate !== null) {
      const focusWindow = this.windowMap.get(focusCandidate);
      this.currentWindow = focusWindow;
    }
    return focusCandidate !== null;
  }
  /* Read the virtual desktop currently shown on a specific output. Uses KWin
  6.7's per-output API (workspace.currentDesktopForScreen) and falls back to
  the global currentDesktop on older KWin, where every output shares it. */
  private _outputCurrentDesktop(output: Output): VirtualDesktop {
    if (typeof this.workspace.currentDesktopForScreen === "function") {
      try {
        const d = this.workspace.currentDesktopForScreen(output);
        if (d) return d;
      } catch (e) {
        /* fall through to the global desktop */
      }
    }
    return this.workspace.currentDesktop;
  }
  /* Switch a specific output to a virtual desktop via KWin 6.7's per-output API.
  Signature per KWin's src/scripting/workspace_wrapper.cpp:
    setCurrentDesktopForScreen(VirtualDesktop *desktop, LogicalOutput *output)
  Falls back to the global currentDesktop setter on older KWin (which on a
  per-screen setup would jump to the output already showing the desktop, but
  older KWin has no per-screen desktops so the global setter is correct there). */
  private _setOutputDesktop(output: Output, desktop: VirtualDesktop): void {
    if (typeof this.workspace.setCurrentDesktopForScreen === "function") {
      try {
        this.workspace.setCurrentDesktopForScreen(desktop, output);
        return;
      } catch (e) {
        /* fall through to the global setter */
      }
    }
    this.workspace.currentDesktop = desktop;
  }
  /* Build the surfaces of the desktop a switch just left. KWin 6.0-6.6 emits
   * only the previous desktop, shared by every output; 6.7+ also passes the
   * output whose desktop changed (per-output virtual desktops). Arranging
   * these surfaces re-tiles the windows left behind when a window is moved to
   * another desktop with a shortcut that switches at the same time. */
  private _previousDesktopSurfaces(
    previousDesktop: VirtualDesktop | undefined,
    output: Output | undefined,
  ): ISurface[] {
    if (previousDesktop === undefined || previousDesktop === null) return [];
    const outputs: Output[] =
      output !== undefined && output !== null
        ? [output]
        : this.workspace.screens;
    return outputs.map((out) =>
      this._surfaceStore.getSurface(
        out,
        this.workspace.currentActivity,
        previousDesktop,
      ),
    );
  }
  private _onShortcut(shortcut: Shortcut) {
    this._shortcutPressTime = getTime();
    const token = ++this._shortcutFinishToken;
    const control = (action: KrohnkiteAction | null) => {
      if (shortcut.name) {
        LOG?.send("shortcut", "ControlFuncCall", `action:${action}`);
        this.control.onShortcut(this, action, "shortcutCB");
      }
    };
    const runSeq = (runningShortcutSequences: RunningShortcutSeq): boolean => {
      let maxSeqInProcess: number | null = null;
      for (let i = runningShortcutSequences.seq.length - 1; i >= 0; i--) {
        const seq = runningShortcutSequences.seq[i];
        if (seq.state === "inProcess") {
          switch (seq.next(shortcut)) {
            case "inProcess": {
              maxSeqInProcess =
                maxSeqInProcess !== null
                  ? Math.max(maxSeqInProcess, seq.sequence.length)
                  : seq.sequence.length;
              break;
            }
            case "finish": {
              if (
                maxSeqInProcess === null ||
                maxSeqInProcess <= seq.sequence.length
              ) {
                runningShortcutSequences.finishAction = seq.resolve(
                  this.isRegister,
                );
              } else {
                runningShortcutSequences.actionCandidate = seq.resolve(
                  this.isRegister,
                );
              }
              break;
            }
          }
        }
      }
      const notFinished = runningShortcutSequences.finishAction === "empty";
      if (maxSeqInProcess === null && notFinished) return false;
      else if (notFinished) {
        runningShortcutSequences.pressTime = this._shortcutPressTime;
        this.setTimeout(
          () => this.onShortcutFinish(token),
          runningShortcutSequences.seq[0].timeout + 5,
        );
      }
      return true;
    };
    if (this._runningShortcutSequence !== null) {
      if (runSeq(this._runningShortcutSequence)) {
        if (this._runningShortcutSequence.finishAction !== "empty") {
          let a = this._runningShortcutSequence.finishAction;
          this._runningShortcutSequence = null;
          control(a);
        }
        return;
      } else {
        this._runningShortcutSequence = null;
        return;
      }
    }
    const shortcutSequences = this._shortcutSequences.get(shortcut.name);
    if (
      this._runningShortcutSequence === null &&
      shortcutSequences !== undefined
    ) {
      const seq = shortcutSequences.map((s) => new ShortcutSequence(s));
      this._runningShortcutSequence = {
        pressTime: this._shortcutPressTime,
        seq,
        finishAction: "empty",
        actionCandidate: shortcut.resolve(this.isRegister),
      };
      this.setTimeout(() => this.onShortcutFinish(token), seq[0].timeout + 5);
      return;
    }
    control(shortcut.resolve(this.isRegister));
  }
  public onShortcutFinish(token: number) {
    if (
      this._runningShortcutSequence !== null &&
      token === this._shortcutFinishToken &&
      this._runningShortcutSequence.pressTime === this._shortcutPressTime
    ) {
      this.control.onShortcut(
        this,
        this._runningShortcutSequence.actionCandidate,
        "shortcutCB",
      );
      this._runningShortcutSequence = null;
    }
  }
  private _bindShortcut() {
    if (CONFIG.altRegisterIsPushedTwice) {
      const conf = {
        shortcuts: ["AlterRegisterSC", "AlterRegisterSC"],
        mainAction: "ToggleRegister",
        registerAction: "ToggleRegister",
        sequenceTime: null,
      } as IShortcutConfEntry;
      const list = this._shortcutSequences.get("AlterRegisterSC");
      if (list === undefined)
        this._shortcutSequences.set("AlterRegisterSC", [conf]);
      else list.push(conf);
    }
    for (const conf of CONFIG.shortcutConf) {
      if (conf.shortcuts.length === 1) {
        const shortcut = this._shortcuts.get(conf.shortcuts[0]);
        if (shortcut === undefined) continue;
        if (conf.mainAction !== undefined) shortcut.action = conf.mainAction;
        if (conf.registerAction !== undefined)
          shortcut.registerAction = conf.registerAction;
      } else {
        const first = conf.shortcuts[0];
        const list = this._shortcutSequences.get(first);
        if (list === undefined) this._shortcutSequences.set(first, [conf]);
        else list.push(conf);
      }
    }
    /* check register shortcuts */
    for (const shortcut of this._shortcuts.values()) {
      const action = shortcut.action;
      const registerAction = shortcut.registerAction;
      const isRegisterAction = (a: KrohnkiteAction | null) =>
        a === KrohnkiteAction.AlterRegister ||
        a === KrohnkiteAction.ToggleRegister;
      if (isRegisterAction(action) || isRegisterAction(registerAction)) {
        if (action !== registerAction) {
          warning(
            `${getMethodName()}. Shortcut "${shortcut.name}": action and registerAction must be equal to AlterRegister or ToggleRegister; fixing.`,
          );
          if (isRegisterAction(action)) shortcut.registerAction = action;
          else shortcut.action = registerAction;
        }
      }
    }
    for (const list of this._shortcutSequences.values()) {
      list.sort((a, b) => a.shortcuts.length - b.shortcuts.length);
      const maxTime = list.reduce(
        (max, conf) =>
          Math.max(max, conf.sequenceTime ?? CONFIG.shortcutSequenceTime),
        0,
      );
      for (const conf of list) conf.sequenceTime = maxTime;
    }
    for (const shortcut of this._shortcuts.values()) {
      this._connect(shortcut.hdl.activated, () => {
        LOG?.send(LogModules.shortcut, `Shortcut pressed:`, `${shortcut.name}`);
        this._onShortcut(shortcut);
      });
    }
  }
  /**
   * Binds callback to the signal w/ extra fail-safe measures, like re-entry
   * prevention and auto-disconnect on termination.
   *
   * Each connection gets its own ReentrancyGuard: only the same callback is
   * blocked from re-entering, so a handler may still observe events caused by
   * its own action (e.g. a shortcut moving a window to another desktop).
   */
  private _connect(
    signal: Signal<(...args: any[]) => void>,
    handler: (..._: any[]) => void,
  ): () => void {
    const guard = new ReentrancyGuard();
    const wrapper = (...args: any[]) => {
      /* HACK: `workspace` become undefined when the script is disabled. */
      if (this._disposed || typeof this.workspace === "undefined")
        signal.disconnect(wrapper);
      else guard.run(() => handler.apply(this, args));
    };
    signal.connect(wrapper);
    this._connections.push({ signal, callback: wrapper });

    return wrapper;
  }
  /**
   * Run the given function in a protected context, logging script errors.
   * Re-entrancy is handled by the per-connection guards; timers run after the
   * originating callback has returned, so they need only the error boundary.
   */
  private _runProtected(callback: () => void) {
    if (this._disposed) return;
    try {
      callback();
    } catch (e: any) {
      logProtectedError(e);
    }
  }
  //TODO: add signal Vdesktop.aboutToBeDestroyed
  //add signal workspace.activity.removed
  private _bindEvents() {
    this._connect(this.workspace.screensChanged, () => {
      LOG?.send(LogModules.screensChanged, "eventFired");
      /* Outputs may have been destroyed (unplug, resume from sleep):
       * drop surfaces that reference them before arranging, so nothing
       * downstream feeds a dangling Output back into KWin. */
      this._surfaceStore.onOutputsChanged();
      this.control.onSurfaceUpdate(this, "screensChangedCB");
    });

    this._connect(this.workspace.virtualScreenGeometryChanged, () => {
      LOG?.send(LogModules.virtualScreenGeometryChanged, "eventFired");
      this.control.onSurfaceUpdate(this, "virtualScreenGeometryChangedCB");
    });

    this._connect(
      this.workspace.currentActivityChanged,
      (activityId: string) => {
        LOG?.send(
          LogModules.currentActivityChanged,
          "eventFired",
          `Activity ID:${activityId}`,
        );
        this.control.onCurrentActivityChanged(this, "currentActivityChangedCB");
      },
    );

    this._connect(
      this.workspace.currentDesktopChanged,
      (
        previousDesktop?: VirtualDesktop,
        _currentDesktop?: VirtualDesktop,
        output?: Output,
      ) => {
        LOG?.send(
          LogModules.currentDesktopChanged,
          "eventFired",
          `Virtual Desktop. previous name:${previousDesktop?.name}, id:${previousDesktop?.id}`,
        );
        this.control.onSurfaceUpdate(
          this,
          "currentDesktopChangedCB",
          this._previousDesktopSurfaces(previousDesktop, output),
        );
      },
    );

    this._connect(this.workspace.windowAdded, (client: KwinWindow) => {
      if (!client) return;
      LOG?.send(
        LogModules.windowAdded,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId}`,
        { winClass: [`${client.resourceClass}`] },
      );
      const window = this.addWindow(client);
      if (client.active && window !== null) {
        this.control.onWindowFocused(this, window);
        /* A new window takes focus without any Krohnkite shortcut. */
        if (
          CONFIG.movePointerOnFocus &&
          !CONFIG.movePointerOnFocusShortcutsOnly
        ) {
          DBUS.moveMouseToCenter(20);
        }
      }
    });

    this._connect(this.workspace.windowActivated, (client: KwinWindow) => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.windowActivated,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId}`,
        { winClass: [`${client.resourceClass}`] },
      );
      const window = this.windowMap.get(client);
      if (client.active && window !== null) {
        this.control.onWindowFocused(this, window);
      }
    });

    this._connect(this.workspace.windowRemoved, (client: KwinWindow) => {
      if (!client) return;
      LOG?.send(
        LogModules.windowRemoved,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId}`,
        { winClass: [`${client.resourceClass}`] },
      );
      if (client.dock) {
        // A dock is never added to windowMap, so the removal handling below
        // ignores it. Re-tile here instead so that windows expand into the area
        // previously reserved for the dock.
        this.control.onSurfaceUpdate(this, "windowRemovedCB");
        return;
      }
      const window = this.windowMap.get(client);
      if (window) {
        this.control.onWindowRemoved(this, window, "windowRemovedCB");
        this.windowMap.remove(client);
      }
    });
    this._connect(this.workspace.activityRemoved, (id: string) => {
      LOG?.send(
        LogModules.surfaceChanged,
        "eventFired",
        `Activity: id: ${id} has been removed.`,
      );
      this._surfaceStore.removeByActivity(id);
    });
    this._connect(this.workspace.desktopsChanged, () => {
      LOG?.send(
        LogModules.surfaceChanged,
        "eventFired",
        `Virtual Desktops Changed`,
      );
      this._surfaceStore.checkVirtualDesktops();
    });

    /* NOTE: Configuration reload is owned by KWinRuntime. KWin's generic
     * script settings KCM does not emit Options.configChanged when Apply is
     * clicked; an explicit KWin reconfigure does. Workaround:
     * qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
     * This is tracked upstream:
     * https://bugs.kde.org/show_bug.cgi?id=463292
     */
  }
  /* Grace period after a mouse move/resize during which size changes are
   * treated as its aftermath (drop re-tile, final snap), not a reason to warp
   * the pointer away from where the user just released it. */
  private static readonly INTERACTIVE_POINTER_GRACE_MS = 500;

  private _onWindowSizeChanged(client: KwinWindow) {
    if (!CONFIG.movePointerOnResize) return;
    if (!client.active || client.move || client.resize) return;
    if (
      getTime() - this._lastInteractiveMoveResize <
      KWinDriver.INTERACTIVE_POINTER_GRACE_MS
    )
      return;
    /* One arrange commits several geometries in a row (and may hand focus to
     * a new window); coalesce them and center on whatever is active once the
     * layout has settled. */
    if (this._centerPointerPending) return;
    this._centerPointerPending = true;
    this.setTimeout(() => {
      this._centerPointerPending = false;
      DBUS.moveMouseToFocus();
    }, 30);
  }

  private _bindWindowEvents(window: WindowClass, client: KwinWindow) {
    let moving = false;
    let resizing = false;
    let lastSize = {
      width: client.frameGeometry.width,
      height: client.frameGeometry.height,
    };
    this._connect(client.frameGeometryChanged, () => {
      if (!client || client.deleted) return;
      const geometry = client.frameGeometry;
      if (
        geometry.width === lastSize.width &&
        geometry.height === lastSize.height
      )
        return;
      lastSize = { width: geometry.width, height: geometry.height };
      this._onWindowSizeChanged(client);
    });
    this._connect(client.activitiesChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.activitiesChanged,
        "eventFired",
        `window: caption:${client.caption} internalID:${
          client.internalId
        }, activities: ${client.activities.join(",")}`,
        { winClass: [`${client.resourceClass}`] },
      );
      this.control.onWindowChanged(
        this,
        window,
        "activitiesChangedCB",
        "activity=" + client.activities.join(","),
      );
    });
    this._connect(client.bufferGeometryChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.bufferGeometryChanged,
        "eventFired",
        `Window: caption:${client.caption} internalId:${client.internalId}, moving:${moving}, resizing:${resizing}, actualGeometry: ${window.actualGeometry}, commitGeometry:${window.geometry}`,
        { winClass: [`${client.resourceClass}`] },
      );
      if (moving) this.control.onWindowMove(window);
      else if (resizing)
        this.control.onWindowResize(
          this,
          window,
          "windowBufferGeometryChangedCB",
        );
      else {
        if (!window.actualGeometry.equals(window.geometry))
          if (CONFIG.optVKeyboardSupport) {
            DBUS.checkVirtualKeyboardVisible((isVkVisible) => {
              if (
                !isVkVisible &&
                !window.actualGeometry.equals(window.geometry)
              )
                this.control.onWindowGeometryChanged(this, window);
            });
          } else {
            this.control.onWindowGeometryChanged(this, window);
          }
      }
    });

    this._connect(client.desktopsChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.desktopsChanged,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId}, desktops: ${client.desktops}`,
        { winClass: [`${client.resourceClass}`] },
      );
      if (window.isSendingToOutput) {
        const target = window.relocationTargetOutput;
        if (target !== null)
          this.setTimeout(
            () => this._finishOutputRelocation(window, target),
            0,
          );
        return;
      }
      this._scheduleSurfaceArrange(window, "windowDesktopsChangedCB", true);
    });

    this._connect(client.fullScreenChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.fullScreenChanged,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId}, fullscreen: ${client.fullScreen}`,
        { winClass: [`${client.resourceClass}`] },
      );
      this.control.onWindowChanged(
        this,
        window,
        "windowFullScreenChangedCB",
        "fullscreen=" + client.fullScreen,
      );
    });

    this._connect(client.interactiveMoveResizeStepped, (geometry) => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.interactiveMoveResizeStepped,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId},interactiveMoveResizeStepped:${geometry}`,
        { winClass: [`${client.resourceClass}`] },
      );
      this._lastInteractiveMoveResize = getTime();
      if (client.resize) return;
      this.control.onWindowDragging(
        this,
        window,
        geometry,
        "windowInteractiveMoveResizeSteppedCB",
      );
    });

    this._connect(client.maximizedAboutToChange, (mode: MaximizeMode) => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.maximizedAboutToChange,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId},maximizedAboutToChange:${mode}`,
        { winClass: [`${client.resourceClass}`] },
      );
      // const maximized = mode === MaximizeMode.MaximizeFull;
      (window.window as DriverWindow).maximized = (mode as number) > 0;
      this.control.onWindowMaximizeChanged(
        this,
        window,
        "windowMaximizeAboutChangeCB",
      );
    });

    this._connect(client.minimizedChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.minimizedChanged,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId},minimized:${client.minimized}`,
        { winClass: [`${client.resourceClass}`] },
      );
      if (KWINCONFIG.preventMinimize) {
        client.minimized = false;
        this.workspace.activeWindow = client;
      } else {
        let comment = client.minimized ? "minimized" : "unminimized";
        this.control.onWindowChanged(
          this,
          window,
          "windowMinimizedChangedCB",
          comment,
        );
      }
    });

    this._connect(client.moveResizedChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.moveResizedChanged,
        "eventFired",
        `Window: caption:${client.caption} internalId:${client.internalId}, moving:${moving}, resizing:${resizing}`,
        { winClass: [`${client.resourceClass}`] },
      );
      this._lastInteractiveMoveResize = getTime();
      if (moving !== client.move) {
        moving = client.move;
        if (moving) {
          this.control.onWindowMoveStart(window);
        } else {
          this.control.onWindowMoveOver(
            this,
            window,
            "windowMoveResizedChangedCB",
          );
        }
      }
      if (resizing !== client.resize) {
        resizing = client.resize;
        if (resizing) this.control.onWindowResizeStart(window);
        else
          this.control.onWindowResizeOver(
            this,
            window,
            "windowMoveResizedChangedCB",
          );
      }
    });

    this._connect(client.outputChanged, () => {
      if (!client || client.deleted) return;
      LOG?.send(
        LogModules.outputChanged,
        "eventFired",
        `window: caption:${client.caption} internalID:${client.internalId} output: ${client.output.name}`,
        { winClass: [`${client.resourceClass}`] },
      );
      if (window.isSendingToOutput) {
        const target = window.relocationTargetOutput;
        if (target !== null)
          this.setTimeout(
            () => this._finishOutputRelocation(window, target),
            0,
          );
        else {
          window.isSendingToOutput = false;
          this._sendingWindowsProcessCall("relocationOutputChangedCB");
        }
        return;
      }
      this._scheduleSurfaceArrange(window, "outputChangedCB");
    });
    this._connect(client.stackingOrderChanged, () => {
      if (!client || client.deleted) return;
      if (this.currentWindow === window) {
        LOG?.send(
          LogModules.stackingOrderChanged,
          "eventFired",
          `window: caption:${client.caption} internalID:${client.internalId} stackingOrder:${client.stackingOrder}`,
          { winClass: [`${client.resourceClass}`] },
        );
        this.control.onStackingOrderChanged(
          this,
          window,
          "stackingOrderChanged",
        );
      }
    });

    if (CONFIG.floatSkipPager) {
      this._connect(client.skipPagerChanged, () => {
        this.control.onWindowSkipPagerChanged(
          this,
          window,
          client.skipPager,
          "windowSkipPagerCB",
        );
      });
    }
  }
}
