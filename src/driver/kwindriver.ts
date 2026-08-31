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

type RunningShortcutSeq = {
  pressTime: number;
  seq: ShortcutSequence[];
  finishAction: KrohnkiteAction | null | "empty";
  actionCandidate: KrohnkiteAction | null;
};

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
  public get cursorPosition(): [number, number] | null {
    const workspacePos = this.workspace.cursorPos;
    return workspacePos !== null ? [workspacePos.x, workspacePos.y] : null;
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
  private entered: boolean;
  private _surfaceStore: KWinSurfaceStore;
  private _isRegister: IRegister;

  constructor(api: Api) {
    KWIN = api.kwin;
    CONFIG = KWINCONFIG = new KWinConfig();
    DBUS = new DBusManager(api.dbus);
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
    this.entered = false;
    this._surfaceStore = new KWinSurfaceStore(this.workspace);
    this._isRegister = {
      state: false,
      lastPushed: 0,
      toggleMode: CONFIG.altRegisterIsToggle,
      alterActionID: 0,
    };
  }
  /*
   * Main
   */
  public main() {
    LOG?.send(LogModules.printConfig, undefined, `Config: ${CONFIG}`);
    this._bindEvents();
    this._bindShortcut();

    const clients: KwinWindow[] = this.workspace.stackingOrder;
    for (let i = 0; i < clients.length; i++) {
      this.addWindow(clients[i]);
    }
  }
  private addWindow(client: KwinWindow): WindowClass | null {
    if (client.dock) {
      // Docks reserve screen space but aren't tiled. Handle that reservation
      // separately and skip the normal window management path.
      this.manageDock(client);
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
      this.control.onWindowAdded(this, window, "windowAdded");
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
  private manageDock(client: KwinWindow): void {
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
    this.control.onSurfaceUpdate(this, "manageDock");
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
  ): KwinWindow | null | boolean {
    let window = this.workspace.activeWindow;
    if (!window) return null;
    let windows = this._getWindowsByDirection(
      winTypes,
      this.currentSurface,
      toRect(window.frameGeometry),
      direction,
    );
    if (windows.length === 0) return null;

    if (
      this._setFocusOnSurface(
        window,
        this.currentSurface,
        direction,
        winTypes,
        windows,
      )
    )
      return true;

    return window;
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
    KWinSetTimeout(() => this._enter(func), timeout);
  }
  public showNotification(text: string) {
    if (CONFIG.notificationDuration > 0)
      popupDialog.showNotification(text, CONFIG.notificationDuration);
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
    try {
      this.workspace.sendClientToScreen(client, targetOutput);
    } catch (e) {
      window.isSendingToOutput = false;
      warning(`${getMethodName()}: sendClientToScreen() failed. ${e}`);
      return false;
    }
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
    this.workspace.currentDesktop = targetVDesktop;
    this._moveWinToVDesktop(window, targetVDesktop);
    this.workspace.activeWindow = client;
    return true;
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
        direction === "left" ? sourceRect.x - winRect.maxX : direction === "right" ? winRect.x - sourceRect.maxX : direction === "up" ? sourceRect.y - winRect.maxY : winRect.y - sourceRect.maxY;
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
      if (focusWindow !== null) {
        this.currentWindow = focusWindow;
      }
    }
    return true;
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
        if (conf.mainAction !== null) shortcut.action = conf.mainAction;
        if (conf.registerAction !== null)
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
      shortcut.hdl.activated.connect(() => {
        LOG?.send(LogModules.shortcut, `Shortcut pressed:`, `${shortcut.name}`);
        this._enter(() => this._onShortcut(shortcut));
      });
    }
  }
  /**
   * Binds callback to the signal w/ extra fail-safe measures, like re-entry
   * prevention and auto-disconnect on termination.
   */
  private _connect(
    signal: Signal<(...args: any[]) => void>,
    handler: (..._: any[]) => void,
  ): () => void {
    const wrapper = (...args: any[]) => {
      /* HACK: `workspace` become undefined when the script is disabled. */
      if (typeof this.workspace === "undefined") signal.disconnect(wrapper);
      else this._enter(() => handler.apply(this, args));
    };
    signal.connect(wrapper);

    return wrapper;
  }
  /**
   * Run the given function in a protected(?) context to prevent nested event
   * handling.
   *
   * KWin emits signals as soon as window states are changed, even when
   * those states are modified by the script. This causes multiple re-entry
   * during event handling, resulting in performance degradation and harder
   * debugging.
   */
  private _enter(callback: () => void) {
    if (this.entered) return;

    this.entered = true;
    try {
      callback();
    } catch (e: any) {
      const line = e && e.lineNumber !== undefined ? e.lineNumber : "unknown";
      warning(`ProtectFunc: Error raised line: ${line}. Error: ${String(e)}`);
    } finally {
      this.entered = false;
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
      (virtualDesktop: VirtualDesktop) => {
        LOG?.send(
          LogModules.currentDesktopChanged,
          "eventFired",
          `Virtual Desktop. name:${virtualDesktop.name}, id:${virtualDesktop.id}`,
        );
        this.control.onSurfaceUpdate(this, "currentDesktopChangedCB");
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
        if (CONFIG.movePointerOnFocus) {
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

    // TODO: options.configChanged.connect(this.onConfigChanged);
    /* NOTE: How disappointing. This doesn't work at all. Even an official kwin script tries this.
     *       https://github.com/KDE/kwin/blob/master/scripts/minimizeall/contents/code/main.js */
  }
  private _bindWindowEvents(window: WindowClass, client: KwinWindow) {
    let moving = false;
    let resizing = false;
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
        return;
      }
      this.control.onWindowChanged(
        this,
        window,
        "windowDesktopsChangedCB",
        "Window's desktop changed.",
      );
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
        window.isSendingToOutput = false;
        this._sendingWindowsProcessCall("relocationOutputChangedCB");
        return;
      }
      this.control.onWindowChanged(
        this,
        window,
        "outputChangedCB",
        "screen=" + client.output.name,
      );
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
