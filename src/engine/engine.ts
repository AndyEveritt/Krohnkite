/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/
type ScreenData = {
  visibles: WindowClass[];
  tileables: WindowClass[];
  layout: ILayout;
  workingArea: Rect;
  srf: ISurface;
  capacity: number | null;
  overCapacity: WindowClass[];
  awaitToMove: WindowClass[];
};
interface IRelocationWindows {
  readonly totalNumWinsPrepareToOutput: number;
  readonly totalNumWinsPrepareToVDesktop: number;
  isSending: boolean;
  startTime: number;
  toOutputs: WrapperMap<Output, WindowClass[]>;
  toVDesktops: WrapperMap<VirtualDesktop, WindowClass[]>;
  activeWindow: WindowClass | null;
  direction: Direction | null;

  clear(): void;
}
class RelocationWindows implements IRelocationWindows {
  public get totalNumWinsPrepareToOutput() {
    let total = 0;
    for (const windows of this.toOutputs) {
      total += windows.length;
    }
    return total;
  }
  public get totalNumWinsPrepareToVDesktop() {
    let total = 0;
    for (const windows of this.toVDesktops) {
      total += windows.length;
    }
    return total;
  }
  public get getWinsSendingToOutput() {
    let total = 0;
    for (const [output, windows] of this.toOutputs.entries()) {
      for (const w of windows) {
        if (output.name === w.surface.output.name && w.isSendingToOutput)
          total++;
      }
    }
    return total;
  }
  public get isExistSendingWindowsToOutput(): boolean {
    for (const [output, windows] of this.toOutputs.entries()) {
      for (const w of windows) {
        if (output.name !== w.surface.output.name && w.isSendingToOutput)
          return true;
      }
    }
    return false;
  }
  public get isExistTransferWindowsToVDesktop(): boolean {
    for (const windows of this.toVDesktops) {
      for (const w of windows) {
        if (w instanceof WindowClass) return true;
      }
    }
    return false;
  }
  public isSending: boolean;
  public startTime: number;
  public toOutputs: WrapperMap<Output, WindowClass[]>;
  public toVDesktops: WrapperMap<VirtualDesktop, WindowClass[]>;
  public activeWindow: WindowClass | null;
  public direction: Direction | null;

  constructor() {
    this.isSending = false;
    this.startTime = 0;
    this.toOutputs = new WrapperMap(
      (client: Output) => client.name,
      (_: Output) => new Array(),
    );
    this.toVDesktops = new WrapperMap(
      (client: VirtualDesktop) => client.id,
      (_: VirtualDesktop) => new Array(),
    );

    this.activeWindow = null;
    this.direction = null;
  }
  public clear() {
    for (const windows of this.toOutputs) {
      windows.forEach((w) => {
        w.isSendingToOutput = false;
        w.relocationTargetOutput = null;
      });
    }
    this.isSending = false;
    this.startTime = 0;
    this.toOutputs.clear();
    this.toVDesktops.clear();
    this.activeWindow = null;
    this.direction = null;
  }
}
/**
 * Maintains tiling context and performs various tiling actions.
 */
class TilingEngine {
  // max time for waiting KWin to move relocated windows to outputs calling KWin func sendClientToScreen() and to Virtual Desktops
  static SENDING_WINDOWS_MAX_WAIT_TIME = 100;
  // upper bound for coalesced arrange passes to stop a genuine layout loop
  static MAX_ARRANGE_PASSES = 10;

  public layouts: LayoutStore;
  public windows: WindowStore;
  public docks: DockStore;
  public relocationWindows: RelocationWindows;
  public makeWinActive: WindowClass | null;
  public arrangeProcessId: number | null;
  private _defaultGaps: DefaultGapsCfg | null;
  private _gapsSurfacesCfg: SurfaceCfg<IGaps>[];
  private _arranging: boolean;
  private _arrangePending: boolean;
  private _pendingExtraSurfaces: Map<string, ISurface>;
  private _batchDepth: number;

  constructor() {
    this.layouts = new LayoutStore();
    this.windows = new WindowStore();
    this.docks = new DockStore();
    this.relocationWindows = new RelocationWindows();
    this.arrangeProcessId = null;
    this.makeWinActive = null;
    this._defaultGaps = null;
    this._gapsSurfacesCfg = [];
    this._arranging = false;
    this._arrangePending = false;
    this._pendingExtraSurfaces = new Map();
    this._batchDepth = 0;
  }

  /**
   * Adjust layout based on the change in size of a tile.
   *
   * This operation is completely layout-dependent, and no general implementation is
   * provided.
   *
   * Used when tile is resized using mouse.
   */
  public adjustLayout(basis: WindowClass) {
    let delta = basis.geometryDelta;
    if (delta === null) return;
    const srf = basis.surface;
    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const gaps = this.getGaps(srf);
      const area = srf.workingArea.gap(
        gaps.left,
        gaps.right,
        gaps.top,
        gaps.bottom,
      );
      const tiles = this.windows.getVisibleTiles(srf);
      layout.adjust(area, tiles, basis, delta, gaps.between);
    }
  }

  public adjustDock(basis: WindowClass) {
    if (basis.actualGeometry === basis.geometry) return;
    const widthDiff = basis.actualGeometry.width - basis.geometry.width;
    const heightDiff = basis.actualGeometry.height - basis.geometry.height;
    this.docks.adjust(basis, widthDiff, heightDiff);
  }

  /**
   * Resize the current floating window.
   *
   * @param window a floating window
   */
  public resizeFloat(
    ctx: IDriverContext,
    window: WindowClass,
    dir: "east" | "west" | "south" | "north",
    step: -1 | 1,
  ) {
    const srf = window.surface;

    const hStepSize =
      (srf.workingArea.width * window.window.floatConfig.stepWidth) / 100;
    const vStepSize =
      (srf.workingArea.height * window.window.floatConfig.stepHeight) / 100;

    let hStep, vStep;
    switch (dir) {
      case "east":
        ((hStep = step), (vStep = 0));
        break;
      case "west":
        ((hStep = -step), (vStep = 0));
        break;
      case "south":
        ((hStep = 0), (vStep = step));
        break;
      case "north":
        ((hStep = 0), (vStep = -step));
        break;
    }

    const geometry = window.actualGeometry;
    const width = geometry.width + hStepSize * hStep;
    const height = geometry.height + vStepSize * vStep;

    window.forceSetGeometry(
      ctx,
      new Rect(geometry.x, geometry.y, width, height),
    );
  }

  /**
   * Resize the current tile by adjusting the layout.
   *
   * Used by grow/shrink shortcuts.
   */
  public resizeTile(
    basis: WindowClass,
    dir: "east" | "west" | "south" | "north",
    step: -1 | 1,
  ) {
    const srf = basis.surface;
    const gaps = this.getGaps(srf);

    if (dir === "east") {
      const maxX = basis.geometry.maxX;
      const easternNeighbor = this.windows
        .getVisibleTiles(srf)
        .filter((tile) => tile.geometry.x >= maxX);
      if (easternNeighbor.length === 0) {
        dir = "west";
        step *= -1;
      }
    } else if (dir === "south") {
      const maxY = basis.geometry.maxY;
      const southernNeighbor = this.windows
        .getVisibleTiles(srf)
        .filter((tile) => tile.geometry.y >= maxY);
      if (southernNeighbor.length === 0) {
        dir = "north";
        step *= -1;
      }
    }

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.03;
    const vStepSize = srf.workingArea.height * 0.03;
    let delta: RectDelta;
    switch (dir) {
      case "east":
        delta = new RectDelta(hStepSize * step, 0, 0, 0);
        break;
      case "west":
        delta = new RectDelta(0, hStepSize * step, 0, 0);
        break;
      case "south":
        delta = new RectDelta(0, 0, vStepSize * step, 0);
        break;
      case "north": /* passthru */
      default:
        delta = new RectDelta(0, 0, 0, vStepSize * step);
        break;
    }

    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const area = srf.workingArea.gap(
        gaps.left,
        gaps.right,
        gaps.top,
        gaps.bottom,
      );
      layout.adjust(
        area,
        this.windows.getVisibleTileables(srf),
        basis,
        delta,
        gaps.between,
      );
    }
  }
  /**
   * Defer arrange requests until endArrangeBatch().
   *
   * Used for multi-step actions (e.g. moving a window to another virtual
   * desktop) where the intermediate state is not worth laying out and only
   * the final state matters. Requests made by the events fired inside the
   * batch are coalesced, and any extra surfaces are kept for the final pass.
   * Batches can be nested; the outermost endArrangeBatch() flushes.
   */
  public beginArrangeBatch(): void {
    this._batchDepth++;
  }

  public endArrangeBatch(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    message?: string,
    extraSurfaces?: ISurface[],
  ): void {
    if (this._batchDepth === 0) return;
    this._batchDepth--;
    this._addPendingExtraSurfaces(extraSurfaces);
    if (this._batchDepth > 0) return;
    this.arrange(ctx, reason, message);
  }

  /**
   * Arrange tiles on all screens.
   *
   * Arranging is not re-entrant: KWin emits signals synchronously while
   * windows are committed, and some of those handlers request another
   * arrange. Running one inside another would interleave layout passes and
   * commit stale geometries over the inner pass, so nested requests are
   * coalesced into another pass of the current arrange instead.
   */
  public arrange(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    message?: string,
    extraSurfaces?: ISurface[],
  ) {
    this._addPendingExtraSurfaces(extraSurfaces);
    if (this._arranging || this._batchDepth > 0) {
      this._arrangePending = true;
      return;
    }

    this._arranging = true;
    ctx.onLayoutStart();
    try {
      let passes = 0;
      do {
        this._arrangePending = false;
        const extras = [...this._pendingExtraSurfaces.values()];
        this._pendingExtraSurfaces.clear();
        this._arrangeOnce(ctx, reason, message, extras);
      } while (
        this._arrangePending &&
        ++passes < TilingEngine.MAX_ARRANGE_PASSES
      );
      if (this._arrangePending) {
        warning(
          `${getMethodName()}: arrange did not settle after ${TilingEngine.MAX_ARRANGE_PASSES} passes.`,
        );
      }
    } finally {
      this._arranging = false;
      this._arrangePending = false;
      this._pendingExtraSurfaces.clear();
      /* Runs even when a pass throws, so a half-applied layout cannot leave a
       * pointer-move request behind for the next arrange. */
      ctx.onLayoutSettled();
    }
  }

  private _addPendingExtraSurfaces(extraSurfaces?: ISurface[]) {
    if (extraSurfaces === undefined) return;
    for (const srf of extraSurfaces) this._pendingExtraSurfaces.set(srf.id, srf);
  }

  private _arrangeOnce(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    message: string | undefined,
    extraSurfaces: ISurface[],
  ) {
    this.arrangeProcessId = getRandomInt(1000000);
    if (LOG?.isModuleOn(LogModules.arrangeScreen)) {
      LOG.send(
        LogModules.arrangeScreen,
        "ArrangeScreens",
        `#######Reason: ${reason}:${message} arrangeProcessID:${this.arrangeProcessId}########`,
      );
    }
    const surfaces = ctx.currentSurfaces;
    /* Surfaces vacated by a window that moved to another desktop as part of
     * a desktop switch (e.g. KWin's "Window One Desktop to the ..."). By the
     * time the event reaches us, the source desktop is no longer current, so
     * it is not part of ctx.currentSurfaces and the windows left behind keep
     * the old layout. Arrange the vacated surfaces explicitly and first: a
     * window on all desktops is visible on both surfaces and must finish with
     * the layout of the surface that is actually current now. */
    const extraScreensData: ScreenData[] = [];
    const knownSrfIds = new Set(surfaces.map((srf) => srf.id));
    for (const srf of extraSurfaces) {
      if (knownSrfIds.has(srf.id)) continue;
      knownSrfIds.add(srf.id);
      extraScreensData.push(this.getTileables(srf));
    }
    extraScreensData.forEach((screenData: ScreenData) => {
      this.arrangeScreen(ctx, screenData, reason, this.arrangeProcessId!);
    });
    let screensData: ScreenData[] = [];
    surfaces.forEach((srf) => {
      screensData.push(this.getTileables(srf));
    });
    if (
      this._isCheckCapacity(reason) &&
      (CONFIG.srfExceededToScreen || CONFIG.srfExceededToVDesktop)
    ) {
      if (this.relocationWindows.isSending) {
        const time = getTime();
        if (
          time - this.relocationWindows.startTime <
          TilingEngine.SENDING_WINDOWS_MAX_WAIT_TIME
        ) {
          warning(
            `Method: ${getMethodName()}.Attempt to Check OverCapacityWindows during sending Process.`,
          );
          return;
        }
        warning(
          `Method: ${getMethodName()}. OverCapacityWindows sending process is: enabled but SENDING_WINDOWS_MAX_WAIT_TIME is up.`,
        );
      }
      this.relocationWindows.clear();
      screensData.forEach((screenData: ScreenData) => {
        if (screenData.overCapacity.length > 0) {
          CONFIG.srfExceededToScreen &&
            this._prepareWindowsMoveToOutput(ctx, screenData);
          CONFIG.srfExceededToVDesktop &&
            this._prepareOverCapacityWindowsTranferToVDesktop(ctx, screenData);
        }
      });
      if (
        !this.relocationWindows.isSending &&
        (this.relocationWindows.totalNumWinsPrepareToOutput > 0 ||
          this.relocationWindows.totalNumWinsPrepareToVDesktop > 0)
      ) {
        this.relocationWindows.activeWindow = ctx.currentWindow;
        ctx.relocateWindows();
        this.arrangeProcessId = null;
        return;
      }
    }

    screensData.forEach((screenData: ScreenData) => {
      this.arrangeScreen(ctx, screenData, reason, this.arrangeProcessId!);
    });
    this.arrangeProcessId = null;
  }

  private _isCheckCapacity(reason: keyof typeof ArrangeReason) {
    /* These reasons are part of the relocation process itself; checking
     * capacity again while they run would re-enter the relocation logic. */
    const reasons: string[] = [
      "forcedArrangeScreen",
      "moveWindowToOutput",
      "transferWindowToVDesktop",
      "sendToOutputProcessFinish",
    ];
    return reasons.indexOf(reason) < 0;
  }

  private _searchAvailableSlotsForOvercapacity(
    ctx: IDriverContext,
    sourceScreenData: ScreenData,
    output: Output,
    screenDataStore: Map<string, ScreenData>,
    vDesktop?: VirtualDesktop,
  ): WindowClass[] {
    const overCapacity = sourceScreenData.overCapacity.length;
    if (overCapacity <= 0) return [];
    let targetSrf = ctx.getSurface(output, vDesktop);
    if (targetSrf == null || !targetSrf.isOvercapacityCandidate) return [];
    if (!screenDataStore.has(targetSrf.id)) {
      screenDataStore.set(targetSrf.id, this.getTileables(targetSrf));
    }
    const sd = screenDataStore.get(targetSrf.id)!;
    if (sd.capacity === null || sd.capacity - sd.awaitToMove.length > 0) {
      const availableSlots =
        sd.capacity === null
          ? overCapacity
          : Math.min(sd.capacity - sd.awaitToMove.length, overCapacity);
      const windowsToAvailableSlots = sourceScreenData.overCapacity.splice(
        0,
        availableSlots,
      );
      sd.awaitToMove.push(...windowsToAvailableSlots);
      return windowsToAvailableSlots;
    } else return [];
  }

  private _prepareWindowsMoveToOutput(
    ctx: IDriverContext,
    sourceScreenData: ScreenData,
    direction?: Direction,
  ) {
    let alreadyDone = new Set<Output>();
    const screenDataStore = new Map<string, ScreenData>();
    const sourceOutput = sourceScreenData.srf.output;
    alreadyDone.add(sourceOutput);
    let outputQueue = new UniqueLifoFifo<Output>();
    this._getPossibleOutputs(
      ctx,
      sourceOutput,
      outputQueue,
      alreadyDone,
      direction,
    );
    while (sourceScreenData.overCapacity.length > 0 && outputQueue.size !== 0) {
      let neighborOutput = outputQueue.shift();
      if (!neighborOutput) return false;
      const windowsToMove = this._searchAvailableSlotsForOvercapacity(
        ctx,
        sourceScreenData,
        neighborOutput,
        screenDataStore,
      );
      const windowsArr = this.relocationWindows.toOutputs.add(neighborOutput);
      windowsArr.push(...windowsToMove);
      if (sourceScreenData.overCapacity.length === 0) break;
      alreadyDone.add(neighborOutput);
      this._getPossibleOutputs(
        ctx,
        neighborOutput,
        outputQueue,
        alreadyDone,
        direction,
      );
    }
  }

  private _getPossibleOutputs(
    ctx: IDriverContext,
    sourceOutput: Output,
    outputQueue: UniqueLifoFifo<Output>,
    alreadyDone: Set<Output>,
    direction?: Direction,
  ) {
    let order: Direction[];
    if (direction) order = [direction];
    else order = CONFIG.srfToScreenOrder;
    for (let i = 0; i < order.length; i++) {
      const direction = order[i];
      const output = ctx.getNeighborOutput(direction, sourceOutput);
      if (output && !alreadyDone.has(output)) outputQueue.push(output);
    }
  }

  private _getPossibleVDesktops(
    ctx: IDriverContext,
    sourceVDesktop: VirtualDesktop,
    vDesktopsQueue: UniqueLifoFifo<VirtualDesktop>,
    alreadyDone: Set<VirtualDesktop>,
  ) {
    for (let i = 0; i < CONFIG.srfToVDesktopOrder.length; i++) {
      const direction = CONFIG.srfToScreenOrder[i];
      const vDesktop = ctx.getNeighborVDesktop(direction, sourceVDesktop);
      if (vDesktop && !alreadyDone.has(vDesktop)) vDesktopsQueue.push(vDesktop);
    }
  }

  private _prepareOverCapacityWindowsTranferToVDesktop(
    ctx: IDriverContext,
    sourceScreenData: ScreenData,
  ) {
    let alreadyDone = new Set<VirtualDesktop>();
    const screenDataStore = new Map<string, ScreenData>();
    alreadyDone.add(ctx.currentDesktop);
    let vDesktopsQueue = new UniqueLifoFifo<VirtualDesktop>();
    this._getPossibleVDesktops(
      ctx,
      ctx.currentDesktop,
      vDesktopsQueue,
      alreadyDone,
    );
    while (
      sourceScreenData.overCapacity.length > 0 &&
      vDesktopsQueue.size !== 0
    ) {
      let neighborVDesktop = vDesktopsQueue.shift();
      if (!neighborVDesktop) return;
      const windowsToTransfer = this._searchAvailableSlotsForOvercapacity(
        ctx,
        sourceScreenData,
        sourceScreenData.srf.output,
        screenDataStore,
        neighborVDesktop,
      );
      if (windowsToTransfer.length !== 0) {
        const windowsArr =
          this.relocationWindows.toVDesktops.add(neighborVDesktop);
        windowsArr.push(...windowsToTransfer);
      }
      if (sourceScreenData.overCapacity.length === 0) break;
      alreadyDone.add(neighborVDesktop);
      this._getPossibleVDesktops(
        ctx,
        neighborVDesktop,
        vDesktopsQueue,
        alreadyDone,
      );
    }
  }

  private getTileables(srf: ISurface): ScreenData {
    let visibles = this.windows.getVisibleWindows(srf);
    visibles.forEach((window) => {
      window.window.updateSrfTime(srf.id);
      if (!window.window.isCommittedEver && window.window.floatConfig.auto) {
        window.state = WindowState.Floating;
      } else if (window.state === WindowState.Undecided) {
        window.state = window.shouldFloat
          ? WindowState.Floating
          : WindowState.Tiled;
      }
    });
    if (LOG?.isModuleOn(LogModules.arrangeScreen)) {
      let mes = "";
      visibles.forEach((tile) => {
        mes += `${tile}\n`;
      });
      LOG.print(LogModules.arrangeScreen, "visibles", mes);
    }
    let tileables = this.windows.getVisibleTileables(srf);
    const newWins = tileables.filter((t) => !t.window.isCommittedEver);
    if (
      CONFIG.newWindowPosition !== "last" &&
      newWins.length > 0 &&
      tileables.length > 1
    ) {
      const anchor = tileables.find((t) => t.window.isCommittedEver);
      if (anchor) {
        this.windows.moveGroup(
          newWins,
          anchor,
          CONFIG.newWindowPosition === "second",
        );
      } else {
        // A batched startup has no committed anchor. Reproduce the order that
        // sequential windowAdded arrangements would have produced without
        // arranging the whole workspace once per existing window.
        let bootstrapAnchor = newWins[0];
        for (const window of newWins.slice(1)) {
          const insertAfter = CONFIG.newWindowPosition === "second";
          this.windows.move(window, bootstrapAnchor, insertAfter);
          if (!insertAfter) bootstrapAnchor = window;
        }
      }
      tileables = this.windows.getVisibleTileables(srf);
    }
    let layout = this.layouts.getCurrentLayout(srf);

    let capacity: number | null;
    let layoutCap = layout.capacity === undefined ? null : layout.capacity;
    if (layoutCap === null && srf.capacity === null) {
      capacity = null;
    } else if (layoutCap === null || srf.capacity === null) {
      capacity = layoutCap || srf.capacity;
    } else {
      capacity = Math.min(layoutCap, srf.capacity);
    }
    let overCapacity: WindowClass[];
    if (capacity !== null && tileables.length > capacity) {
      const excess = tileables.length - capacity;
      const sorted = [...tileables].sort(
        (a, b) => a.window.srfTime - b.window.srfTime,
      );

      if (!CONFIG.srfIsMoveOldestWindows) {
        // Move newest: last `excess` from sorted copy
        overCapacity = sorted.slice(-excess);
      } else {
        // Move oldest: first `excess` from sorted copy
        overCapacity = sorted.slice(0, excess);
      }
      // Remove overCapacity from original tileables in-place
      const toRemove = new Set(overCapacity);
      for (let i = tileables.length - 1; i >= 0; i--) {
        if (toRemove.has(tileables[i])) tileables.splice(i, 1);
      }
      capacity = 0;
    } else {
      overCapacity = [];
      capacity = capacity === null ? null : capacity - tileables.length;
    }
    let screenData = {
      visibles: visibles,
      tileables: tileables,
      layout: layout,
      workingArea: this.docks.render(srf, visibles, srf.workingArea.clone()),
      srf: srf,
      overCapacity: overCapacity,
      capacity: capacity,
      awaitToMove: [],
    };

    LOG?.send(
      LogModules.arrangeScreen,
      "getTileablesReturn",
      `output: ${srf.output.name}\n visibles number: ${
        visibles.length
      }\n tileables.length: ${screenData.tileables.length}, workingArea: ${
        screenData.workingArea
      }, layout: ${
        screenData.layout
      },capacity: ${capacity}, overCapacity: ${screenData.overCapacity.map(
        (win) => win.window.windowClassName,
      )}`,
    );
    return screenData;
  }

  /**
   * Arrange tiles on a screen.
   */
  public arrangeScreen(
    ctx: IDriverContext,
    screenData: ScreenData,
    reason: string,
    processID?: number,
  ) {
    const outputName = screenData.srf.output.name;
    LOG?.send(
      LogModules.arrangeScreen,
      "arrangeScreen",
      `output:processID: ${outputName}:${processID}`,
    );
    screenData.overCapacity.forEach((win) => {
      win.floatInPlace();
    });
    const gaps = this.getGaps(screenData.srf);

    let tilingArea: Rect;
    let tileablesLen = screenData.tileables.length;
    const soleWindowProps =
      CONFIG.soleWindowOutputOverride[outputName] ||
      CONFIG.soleWindowDefaultProps;
    if (
      (CONFIG.monocleMaximize && screenData.layout instanceof MonocleLayout) ||
      (tileablesLen === 1 && soleWindowProps.noGaps)
    ) {
      tilingArea = screenData.workingArea;
    } else if (
      tileablesLen === 1 &&
      (soleWindowProps.width < 100 || soleWindowProps.height < 100)
    ) {
      const h_gap =
        (screenData.workingArea.height -
          screenData.workingArea.height * (soleWindowProps.height / 100)) /
        2;
      const v_gap =
        (screenData.workingArea.width -
          screenData.workingArea.width * (soleWindowProps.width / 100)) /
        2;
      tilingArea = screenData.workingArea.gap(v_gap, v_gap, h_gap, h_gap);
    } else
      tilingArea = screenData.workingArea.gap(
        gaps.left,
        gaps.right,
        gaps.top,
        gaps.bottom,
      );

    if (tileablesLen > 0) {
      let engineCtx = new EngineContext(ctx, this);
      function layoutApply() {
        screenData.layout.apply(
          engineCtx,
          screenData.tileables,
          tilingArea,
          gaps.between,
        );
        if (LOG?.isModuleOn(LogModules.arrangeScreen)) {
          let mes = "";
          screenData.tileables.forEach((tile) => {
            mes += `${tile.id}, state:${tile.state}, commitGeometry:${tile.geometry}\n`;
          });
          LOG?.send(LogModules.arrangeScreen, "LayoutApply", mes);
        }
      }
      function getNumberTileablesGreaterThenMin(
        tileables: WindowClass[],
      ): number {
        let numberOfTiles = 0;
        tileables.forEach((tile) => {
          if (
            tile.minSize.height > tile.geometry.height ||
            tile.minSize.width > tile.geometry.width
          ) {
            numberOfTiles++;
          }
        });
        return numberOfTiles;
      }
      layoutApply();
      if (
        (CONFIG.unfitGreater || CONFIG.unfitLess) &&
        ["onWindowResize", "onWindowResizeOver"].indexOf(reason) < 0
      ) {
        let unfitGreaterQuantity = 0;
        screenData.tileables = screenData.tileables.filter((tile) => {
          if (
            CONFIG.unfitLess &&
            (tile.maxSize.height < tile.geometry.height ||
              tile.maxSize.width < tile.geometry.width)
          ) {
            LOG?.send(
              LogModules.arrangeScreen,
              "unfitLess",
              `id: ${tile.id} commitGeometry:${tile.geometry}. minSize:${
                tile.minSize.width
              }:${tile.minSize.height} - heightUnfit:${
                tile.minSize.height > tile.geometry.height
              } widthUnfit: ${
                tile.minSize.width > tile.geometry.width
              }, tile.maxSize:${tile.maxSize.width}:${
                tile.maxSize.height
              } heightUnfit: ${
                tile.maxSize.height < tile.geometry.height
              }, widthUnfit: ${tile.maxSize.width < tile.geometry.width}`,
            );
            tile.floatInPlace();
            return false;
          } else if (
            CONFIG.unfitGreater &&
            (tile.minSize.height > tile.geometry.height ||
              tile.minSize.width > tile.geometry.width)
          ) {
            unfitGreaterQuantity += 1;
            return true;
          } else {
            return true;
          }
        });
        if (screenData.tileables.length !== tileablesLen) {
          layoutApply();
        }
        if (unfitGreaterQuantity > 0) {
          LOG?.send(
            LogModules.arrangeScreen,
            "UnfitGreater",
            `unfitGreaterQuantity: ${unfitGreaterQuantity}`,
          );
          if (screenData.tileables.length !== tileablesLen) {
            unfitGreaterQuantity = getNumberTileablesGreaterThenMin(
              screenData.tileables,
            );
          }
          while (screenData.tileables.length > 0 && unfitGreaterQuantity > 0) {
            let tile = screenData.tileables.shift();
            tile!.floatInPlace();
            layoutApply();
            unfitGreaterQuantity = getNumberTileablesGreaterThenMin(
              screenData.tileables,
            );
          }
        }
      }
    }

    if (
      CONFIG.limitTileWidthRatio > 0 &&
      !(screenData.layout instanceof MonocleLayout)
    ) {
      const maxWidth = Math.floor(
        screenData.workingArea.height * CONFIG.limitTileWidthRatio,
      );
      screenData.tileables
        .filter((tile) => tile.isTiled && tile.geometry.width > maxWidth)
        .forEach((tile) => {
          const g = tile.geometry;
          tile.geometry = new Rect(
            g.x + Math.floor((g.width - maxWidth) / 2),
            g.y,
            maxWidth,
            g.height,
          );
        });
    }

    if (soleWindowProps.noBorders && tileablesLen === 1) {
      screenData.visibles.forEach((window) => {
        if (window.state === WindowState.Tiled)
          window.commit(ctx, soleWindowProps.noBorders);
        else window.commit(ctx);
      });
    } else {
      screenData.visibles.forEach((window) => window.commit(ctx));
    }
    LOG?.send(
      LogModules.arrangeScreen,
      "#######################################################Finished",
      `${screenData.srf}`,
    );
  }

  /**
   * Re-apply window geometry, computed by layout algorithm.
   *
   * Sometimes applications move or resize windows without user intervention,
   * which is straigh against the purpose of tiling WM. This operation
   * move/resize such windows back to where/how they should be.
   */
  public enforceSize(ctx: IDriverContext, window: WindowClass) {
    /* While a window is being relocated between outputs or desktops, its
     * geometry legitimately differs from the last layout rect. Enforcing the
     * old rect here would undo the relocation. */
    if (window.isRelocationPending || window.isSendingToOutput) return;
    if (window.isTiled && !window.actualGeometry.equals(window.geometry)) {
      /* The deferred commit is meant to undo application-driven geometry
       * changes on the current surface. If the window moves to another
       * surface in the meantime (e.g. KWin's Grid View drag), the remembered
       * geometry belongs to the old output/desktop; committing it would move
       * the window back and undo the relocation. */
      const srfId = window.surface.id;
      ctx.setTimeout(() => {
        if (
          window.isAlive() &&
          !window.isRelocationPending &&
          !window.isSendingToOutput &&
          window.isTiled &&
          window.surface.id === srfId
        )
          window.commit(ctx);
      }, 10);
    }
  }

  /**
   * Register the given window to WM.
   */
  public manage(window: WindowClass) {
    if (!window.shouldIgnore) {
      this.docks.attachWindow(window);
      if (this.docks.isNewWindowHaveDocked(window)) {
        window.state = WindowState.Docked;
      } else window.state = WindowState.Undecided;
      /* engine#arrange will update the state when required. */
      this.windows.push(window);
    }
  }

  /**
   * Unregister the given window from WM.
   */
  public unmanage(window: WindowClass) {
    if (window.state === WindowState.Docked) {
      this.docks.remove(window);
    }
    this.windows.remove(window);
  }

  /**
   * Focus the next or previous window.
   */
  public focusOrder(ctx: IDriverContext, step: -1 | 1) {
    const window = ctx.currentWindow;

    /* if no current window, select the first tile. */
    if (window === null) {
      const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
      if (tiles.length > 1) ctx.currentWindow = tiles[0];
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return;
    }

    const visibles = this.windows.getVisibleWindows(ctx.currentSurface);
    if (visibles.length === 0) /* nothing to focus */ return;

    const idx = visibles.indexOf(window);
    if (!window || idx < 0) {
      /* unmanaged window -> focus master */
      ctx.currentWindow = visibles[0];
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return;
    }

    const num = visibles.length;
    const newIndex = (idx + (step % num) + num) % num;

    ctx.currentWindow = visibles[newIndex];
    if (CONFIG.movePointerOnFocus) {
      DBUS.moveMouseToFocus();
    }
  }

  /**
   * Focus a neighbor at the given direction.
   */
  public focusDir(ctx: IDriverContext, dir: Direction): boolean {
    let winTypes = ctx.isRegister ? CONFIG.focusMetaCfg : CONFIG.focusNormalCfg;
    if (winTypes === WinTypes.special) {
      return ctx.focusSpecial(dir);
    }
    if (ctx.focusNeighborWindow(dir, winTypes)) {
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return false;
    }
    if (
      (!ctx.isRegister && CONFIG.focusMoveScreensNormal) ||
      (ctx.isRegister && CONFIG.focusMoveScreensMeta)
    ) {
      const result = ctx.focusOutput(null, dir, winTypes);
      if (result) {
        if (CONFIG.movePointerOnFocus) {
          DBUS.moveMouseToCenter();
        }
        return false;
      }
    }

    if (
      (!ctx.isRegister && CONFIG.focusMoveVDesktopsNormal) ||
      (ctx.isRegister && CONFIG.focusMoveVDesktopsMeta)
    ) {
      return ctx.focusVDesktop(null, dir, winTypes);
    }
    return false;
  }

  /**
   * Swap the position of the current window with the next or previous window.
   */
  public swapOrder(window: WindowClass, step: -1 | 1) {
    const srf = window.surface;
    const visibles = this.windows.getVisibleWindows(srf);
    if (visibles.length < 2) return;

    const vsrc = visibles.indexOf(window);
    const vdst = wrapIndex(vsrc + step, visibles.length);
    const dstWin = visibles[vdst];

    this.windows.move(window, dstWin);
  }

  /**
   * Swap the position of the current window with a neighbor at the given direction.
   */
  private _moveTiled(
    ctx: IDriverContext,
    direction: Direction,
    window: WindowClass,
  ): boolean {
    const neighbor = this.getNeighborByDirection(ctx, window, direction);
    if (neighbor) {
      this.windows.swap(window, neighbor);
      return true;
    }
    if (
      ctx.isRegister
        ? CONFIG.focusMoveScreensMeta
        : CONFIG.focusMoveScreensNormal
    ) {
      const sd = this.getTileables(window.surface);
      const idx = sd.tileables.indexOf(window);
      if (idx < 0) {
        warning(`${getMethodName()}: there is not windows among tileables.`);
        return false;
      }
      sd.overCapacity.push(...sd.tileables.splice(idx, 1));
      this._prepareWindowsMoveToOutput(ctx, sd, direction);
      if (
        !this.relocationWindows.isSending &&
        this.relocationWindows.totalNumWinsPrepareToOutput > 0
      ) {
        if (!ctx.relocateWindows())
          warning(
            `${getMethodName()}: window cannot send to direction ${direction}`,
          );
        return false; // sendClientToScreen() run arrange after output was Changed
      }
    }
    if (
      ctx.isRegister
        ? CONFIG.focusMoveVDesktopsMeta
        : CONFIG.focusMoveVDesktopsNormal
    )
      return ctx.moveWinToVDesktopByDirection(window, direction);
    return false;
  }

  /**
   * Move the given window towards the given direction by one step.
   * @param window a floating window
   * @param dir which direction
   */
  private _moveFloat(ctx: IDriverContext, window: WindowClass, dir: Direction) {
    /* Declare these before the helpers: the helpers close over them and
     * QJSEngine warns about the temporal-dead-zone ordering at load time. */
    const relocation = this.relocationWindows;
    const srcOutput = window.surface.output;

    function isRelocationReady(): boolean {
      if (relocation.isSending) {
        if (
          getTime() - relocation.startTime <=
          TilingEngine.SENDING_WINDOWS_MAX_WAIT_TIME
        ) {
          warning(
            `${getMethodName()} Relocation windows in process. relocationWindows.isSending=${relocation.isSending}`,
          );
          return false;
        } else {
          warning(
            `${getMethodName()} Relocation windows with startTime:${relocation.startTime} was canceled.`,
          );
          relocation.clear();
        }
      }
      return true;
    }
    function floatRelocation(target: "toOutput" | "toVDesktop"): boolean {
      const neighbor =
        target === "toOutput"
          ? ctx.getNeighborOutput(dir, srcOutput)
          : ctx.getNeighborVDesktop(dir);
      if (neighbor === null) return false;
      if (!isRelocationReady()) return false;
      const winArr =
        target === "toOutput"
          ? relocation.toOutputs.add(neighbor as Output)
          : relocation.toVDesktops.add(neighbor as VirtualDesktop);
      winArr.push(window);
      return true;
    }
    const srf = window.surface;
    const srfRect = srf.workingArea;

    const geometry = window.actualGeometry;
    let x = geometry.x;
    let y = geometry.y;
    if (
      (x === srfRect.x && dir === "left") ||
      (x === srfRect.maxX - geometry.width && dir === "right") ||
      (y === srfRect.y && dir === "up") ||
      (y === srfRect.maxY - geometry.height && dir === "down")
    ) {
      if (
        (ctx.isRegister
          ? CONFIG.focusMoveScreensMeta
          : CONFIG.focusMoveScreensNormal) &&
        floatRelocation("toOutput")
      ) {
        this.relocationWindows.activeWindow = window;
        this.relocationWindows.direction = dir;
        ctx.relocateWindows();
        return;
      }
      if (
        (ctx.isRegister
          ? CONFIG.focusMoveVDesktopsMeta
          : CONFIG.focusMoveVDesktopsNormal) &&
        floatRelocation("toVDesktop")
      ) {
        this.relocationWindows.activeWindow = window;
        this.relocationWindows.direction = dir;
        ctx.relocateWindows();
      }
      return;
    }

    const hStepSize =
      (srfRect.width * window.window.floatConfig.stepWidth) / 100;
    const vStepSize =
      (srfRect.height * window.window.floatConfig.stepHeight) / 100;

    let hStep, vStep;
    switch (dir) {
      case "up":
        ((hStep = 0), (vStep = -1));
        break;
      case "down":
        ((hStep = 0), (vStep = 1));
        break;
      case "left":
        ((hStep = -1), (vStep = 0));
        break;
      case "right":
        ((hStep = 1), (vStep = 0));
        break;
    }

    x = geometry.x + hStepSize * hStep;
    y = geometry.y + vStepSize * vStep;

    if (x < srfRect.x) x = srfRect.x;
    else if (x + geometry.width > srfRect.maxX)
      x = srfRect.maxX - geometry.width;
    if (y < srfRect.y) y = srfRect.y;
    else if (y + geometry.height > srfRect.maxY)
      y = srfRect.maxY - geometry.height;
    if (CONFIG.movePointerOnFocus) {
      window.moveMouseToFocus();
    }
    window.forceSetGeometry(
      ctx,
      new Rect(x, y, geometry.width, geometry.height),
    );
  }

  public moveTiledWindow(ctx: IDriverContext, dir: Direction): boolean {
    const window = ctx.currentWindow;
    if (window === null) {
      /* if no current window, select the first tile. */
      const tiles = this.windows.getVisibleTiles(ctx.currentSurface);
      if (tiles.length > 0) ctx.currentWindow = tiles[0];
      if (CONFIG.movePointerOnFocus) {
        DBUS.moveMouseToFocus();
      }
      return false;
    }

    if (window.isTiled) {
      return this._moveTiled(ctx, dir, window);
    }
    return false;
  }

  public toggleDock(window: WindowClass) {
    if (WindowClass.isToggleableState(window.state)) {
      if (window.isDocked) window.state = window.previousState;
      else window.state = WindowState.Docked;
    }
  }

  public raiseSurfaceCapacity(ctx: IDriverContext): number | null {
    const currentSurface = ctx.currentSurface;
    if (currentSurface.capacity !== null) {
      currentSurface.capacity =
        currentSurface.capacity < 98 ? currentSurface.capacity + 1 : null;
    } else {
      let tileables = this.windows.getVisibleTileables(currentSurface);
      currentSurface.capacity =
        tileables.length < 98 ? tileables.length + 1 : null;
    }
    return currentSurface.capacity;
  }

  public lowerSurfaceCapacity(ctx: IDriverContext): number | null {
    const currentSurface = ctx.currentSurface;
    if (currentSurface.capacity !== null) {
      currentSurface.capacity =
        currentSurface.capacity > 0 ? currentSurface.capacity - 1 : 0;
    } else {
      let tileables = this.windows.getVisibleTileables(currentSurface);
      currentSurface.capacity = tileables.length > 0 ? tileables.length - 1 : 0;
    }
    return currentSurface.capacity;
  }

  public ResetSurfaceCapacity(ctx: IDriverContext): number | null {
    return (ctx.currentSurface.capacity = null);
  }

  /**
   * Toggle float mode of window.
   */
  public toggleFloat(window: WindowClass) {
    if (WindowClass.isToggleableState(window.state)) {
      if (window.isFloating) window.state = window.previousState;
      else window.state = WindowState.Floating;
    }
  }

  /**
   * Toggle float on all windows on the given surface.
   *
   * The behaviours of this operation depends on the number of floating
   * windows: windows will be tiled if more than half are floating, and will
   * be floated otherwise.
   */
  public floatAll(ctx: IDriverContext, srf: ISurface) {
    const windows = this.windows.getVisibleWindows(srf);
    const numFloats = windows.reduce<number>((count, window) => {
      return window.state === WindowState.Floating ? count + 1 : count;
    }, 0);

    if (numFloats === 0) {
      windows.forEach((window) => {
        if (WindowClass.isToggleableState(window.state))
          window.state = WindowState.Floating;
      });
      ctx.showNotification("Float All");
    } else {
      windows.forEach((window) => {
        if (WindowClass.isToggleableState(window.state))
          window.state = window.previousState;
      });
      ctx.showNotification("Tile All");
    }
  }

  /**
   * Set the current window as the "master".
   *
   * The "master" window is simply the first window in the window list.
   * Some layouts depend on this assumption, and will make such windows more
   * visible than others.
   *
   * The target is swapped with the current master of its surface. Calling
   * this on the window that is already master toggles back to the previous
   * master.
   */
  public setMaster(ctx: IDriverContext, window: WindowClass) {
    this.windows.setMaster(window);
    const master = this.windows.surfaceMaster(window);
    if (master === null) return;
    ctx.currentWindow = master;
    if (CONFIG.movePointerOnFocus) DBUS.moveMouseToFocus();
  }

  /**
   * Change the layout of the current surface to the next.
   */
  public cycleLayout(ctx: IDriverContext, step: 1 | -1) {
    const layout = this.layouts.cycleLayout(ctx.currentSurface, step);
    if (layout) ctx.showLayoutOSD();
  }

  /**
   * Set the layout of the current surface to the specified layout.
   */
  public setLayout(
    ctx: IDriverContext,
    layoutClassID: string,
    showOSD: boolean = true,
  ) {
    const layout = this.layouts.setLayout(ctx.currentSurface, layoutClassID);
    if (layout && showOSD) ctx.showLayoutShortcut(layout.classID);
  }

  /**
   * Let the docked window override shortcut.
   *
   * @returns True if the docked window overrides the shortcut. False, otherwise.
   */
  public handleDockWinShortcut(
    ctx: IDriverContext,
    window: WindowClass | null,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ): boolean {
    if (window === null || !window.isDocked) return false;
    const isHandled = this.docks.handleShortcut(ctx, window, action);
    if (isHandled) {
      this.arrange(ctx, reason, `${getMethodName()}:action=${action}`);
    }
    return isHandled;
  }
  public handleFloatWinShortcut(
    ctx: IDriverContext,
    window: WindowClass | null,
    action: KrohnkiteAction,
  ): boolean {
    if (window === null || !window.isFloating) return false;
    switch (action) {
      case KrohnkiteAction.Increase:
      case KrohnkiteAction.Decrease:
        break;
      case KrohnkiteAction.GrowWidth:
        this.resizeFloat(ctx, window, "east", 1);
        break;
      case KrohnkiteAction.ShrinkWidth:
        this.resizeFloat(ctx, window, "east", -1);
        break;
      case KrohnkiteAction.GrowHeight:
        this.resizeFloat(ctx, window, "south", 1);
        break;
      case KrohnkiteAction.ShrinkHeight:
        this.resizeFloat(ctx, window, "south", -1);
        break;
      case KrohnkiteAction.MoveLeft:
        this._moveFloat(ctx, window, "left");
        break;
      case KrohnkiteAction.MoveUp:
        this._moveFloat(ctx, window, "up");
        break;
      case KrohnkiteAction.MoveRight:
        this._moveFloat(ctx, window, "right");
        break;
      case KrohnkiteAction.MoveDown:
        this._moveFloat(ctx, window, "down");
        break;
      default:
        return false;
    }
    return true;
  }
  /**
   * Let the current layout override shortcut.
   *
   * @returns True if the layout overrides the shortcut. False, otherwise.
   */
  public handleLayoutShortcut(
    ctx: IDriverContext,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ): boolean {
    const layout = this.layouts.getCurrentLayout(ctx.currentSurface);
    if (layout.handleShortcut) {
      const isHandled = layout.handleShortcut(
        new EngineContext(ctx, this),
        action,
      );
      if (isHandled) {
        this.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
        return true;
      }
    }
    return false;
  }
  public handleTiledWinShortcut(
    ctx: IDriverContext,
    window: WindowClass | null,
    action: KrohnkiteAction,
    reason: keyof typeof ArrangeReason,
  ): boolean {
    if (window === null || !window.isTiled) return false;
    let isArrangeNeeded = true;
    switch (action) {
      case KrohnkiteAction.GrowWidth:
        this.resizeTile(window, "east", 1);
        break;
      case KrohnkiteAction.ShrinkWidth:
        this.resizeTile(window, "east", -1);
        break;
      case KrohnkiteAction.GrowHeight:
        this.resizeTile(window, "south", 1);
        break;
      case KrohnkiteAction.ShrinkHeight:
        this.resizeTile(window, "south", -1);
        break;

      case KrohnkiteAction.SwapUp:
        this.swapOrder(window, -1);
        break;
      case KrohnkiteAction.SwapDown:
        this.swapOrder(window, +1);
        break;

      case KrohnkiteAction.MoveUp:
        isArrangeNeeded = this.moveTiledWindow(ctx, "up");
        break;
      case KrohnkiteAction.MoveDown:
        isArrangeNeeded = this.moveTiledWindow(ctx, "down");
        break;
      case KrohnkiteAction.MoveLeft:
        isArrangeNeeded = this.moveTiledWindow(ctx, "left");
        break;
      case KrohnkiteAction.MoveRight:
        isArrangeNeeded = this.moveTiledWindow(ctx, "right");
        break;
      default:
        return false;
    }
    if (isArrangeNeeded) {
      this.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
    }
    return true;
  }

  private getNeighborByDirection(
    ctx: IDriverContext,
    basis: WindowClass,
    dir: Direction,
  ): WindowClass | null {
    let vertical: boolean;
    let sign: -1 | 1;
    switch (dir) {
      case "up":
        vertical = true;
        sign = -1;
        break;
      case "down":
        vertical = true;
        sign = 1;
        break;
      case "left":
        vertical = false;
        sign = -1;
        break;
      case "right":
        vertical = false;
        sign = 1;
        break;
      default:
        return null;
    }
    let windows = this.windows.getVisibleTileables(ctx.currentSurface);

    const candidates = windows
      .filter(
        vertical
          ? (tile) => tile.geometry.y * sign > basis.geometry.y * sign
          : (tile) => tile.geometry.x * sign > basis.geometry.x * sign,
      )
      .filter(
        vertical
          ? (tile) =>
              overlap(
                basis.geometry.x,
                basis.geometry.maxX,
                tile.geometry.x,
                tile.geometry.maxX,
              )
          : (tile) =>
              overlap(
                basis.geometry.y,
                basis.geometry.maxY,
                tile.geometry.y,
                tile.geometry.maxY,
              ),
      );
    if (candidates.length === 0) return null;

    const min =
      sign *
      candidates.reduce(
        vertical
          ? (prevMin, tile): number => Math.min(tile.geometry.y * sign, prevMin)
          : (prevMin, tile): number =>
              Math.min(tile.geometry.x * sign, prevMin),
        Infinity,
      );

    const closest = candidates.filter(
      vertical
        ? (tile) => tile.geometry.y === min
        : (tile) => tile.geometry.x === min,
    );

    return closest.sort((a, b) => b.focusTime - a.focusTime)[0];
  }

  private getGaps(srf: ISurface): IGaps {
    if (this._defaultGaps === null) {
      this._defaultGaps = DefaultGapsCfg.instance;
      this._gapsSurfacesCfg = gapsSurfaceCfg.parseGapsUserSurfacesCfg();
    }
    const surfaceCfg = this._gapsSurfacesCfg.find((surfaceCfg) =>
      srf.isFit(surfaceCfg.userLabel),
    );
    if (surfaceCfg === undefined) return this._defaultGaps;
    return surfaceCfg.cfg;
  }
}
