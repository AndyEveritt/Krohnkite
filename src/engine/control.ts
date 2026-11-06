/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

/**
 * TilingController translates events to actions, implementing high-level
 * window management logic.
 *
 * In short, this class is just a bunch of event handling methods.
 */

const LayoutShortcutIds: Partial<Record<KrohnkiteAction, string>> = {
  ["SetTileLayout"]: "TileLayout",
  ["SetMonocleLayout"]: "MonocleLayout",
  ["SetThreeColumnLayout"]: "ThreeColumnLayout",
  ["SetSpreadLayout"]: "SpreadLayout",
  ["SetStairLayout"]: "StairLayout",
  ["SetFloatingLayout"]: "FloatingLayout",
  ["SetQuarterLayout"]: "QuarterLayout",
  ["SetStackedLayout"]: "StackedLayout",
  ["SetColumnsLayout"]: "ColumnsLayout",
  ["SetSpiralLayout"]: "SpiralLayout",
  ["SetBinaryTreeLayout"]: "BinaryTreeLayout",
  ["SetCascadeLayout"]: "CascadeLayout",
  ["SetManualTilingLayout"]: "ManualTilingLayout",
};

/** Actions that move a tiled window; CONFIG.moveFlash shows where it lands. */
const MOVE_ACTIONS: KrohnkiteAction[] = [
  KrohnkiteAction.MoveLeft,
  KrohnkiteAction.MoveRight,
  KrohnkiteAction.MoveUp,
  KrohnkiteAction.MoveDown,
  KrohnkiteAction.SwapUp,
  KrohnkiteAction.SwapDown,
];

interface DragAction {
  result: {
    isProcessed: boolean;
    isArrangeNeeded: boolean;
  };
  actionTime: number;
  srf: ISurface;
  initialSrfId: string;
  workingArea: Rect;
  tilesArea: Rect | null;
  window: WindowClass;
  dockTarget: DockPosition | null;
  /* Where a layout that previews rather than re-tiles would put the window
   * if it were dropped now; reset on every step. */
  previewRect: Rect | null;
  mousePointer: QPoint;
  middlePointer: QPoint;
  /* Physically adjacent outputs per side. Decides whether a dock zone is
   * tested against the cursor or the window's middle (see dockstore). */
  neighbors: { left: boolean; right: boolean; up: boolean; down: boolean };
  /* Surface id the neighbors were resolved for; the set is recalculated only
   * when the window crosses to another surface. */
  neighborsSrfId: string | null;
  dockSnapshots: { [srfId: string]: DockDragSnapshot };
  initialState: ToggleableState;
  /* The window's tile when the drag began, before any layout re-tiled. */
  initialGeometry: Rect;
  isLayoutHasDragStep: boolean;
}

class TilingController {
  public engine: TilingEngine;
  private dragAction: DragAction | null;

  public constructor(engine: TilingEngine) {
    this.engine = engine;
    this.dragAction = null;
  }

  public onSurfaceUpdate(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
    extraSurfaces?: ISurface[],
  ): void {
    this.engine.arrange(ctx, reason, getMethodName(), extraSurfaces);
  }

  public onCurrentActivityChanged(
    ctx: IDriverContext,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onStackingOrderChanged(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    const layout = this.engine.layouts.getCurrentLayout(window.surface);
    if (layout instanceof SpreadLayout) {
      this.engine.arrange(ctx, reason, getMethodName());
    }
  }

  public onWindowAdded(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.manage(window);

    /* move window to next surface if the current surface is "full" */
    if (window.isTileable) {
      const srf = ctx.currentSurface;
      const tiles = this.engine.windows.getVisibleTiles(srf);
    }
    if (
      window.state !== WindowState.NativeMaximized &&
      window.state !== WindowState.NativeFullscreen
    )
      this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowSkipPagerChanged(
    ctx: IDriverContext,
    window: WindowClass,
    skipPager: boolean,
    reason: keyof typeof ArrangeReason,
  ) {
    if (skipPager) window.state = WindowState.Floating;
    else window.state = WindowState.Undecided;
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowRemoved(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (this.dragAction !== null && this.dragAction.window === window)
      this.finishDrag(ctx);
    this.engine.unmanage(window);
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowMoveStart(window: WindowClass): void {
    /* do nothing */
  }

  public onWindowMove(window: WindowClass): void {
    /* do nothing */
  }

  public onWindowDragging(
    ctx: IDriverContext,
    window: WindowClass,
    windowRect: Rect,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (!(window.isTiled || window.isDocked)) return;
    const srf = window.surface;
    const workingArea = srf.workingArea.clone();
    const draggingRect = toRect(windowRect);
    const mousePointer: QPoint =
      ctx.cursorPosition || draggingRect.activationPoint;
    /* The middle of the dragged window horizontally, the cursor vertically.
     * A window can cross to an adjacent output before the cursor does, so on
     * a side with a neighboring monitor the dock zone must be tested against
     * the window rather than the pointer. */
    const middlePointer: QPoint = {
      x: draggingRect.center.x,
      y: mousePointer.y,
    };
    const getNeighbors = (srf: ISurface) => ({
      left: ctx.getNeighborOutput("left", srf.output) !== null,
      right: ctx.getNeighborOutput("right", srf.output) !== null,
      up: ctx.getNeighborOutput("up", srf.output) !== null,
      down: ctx.getNeighborOutput("down", srf.output) !== null,
    });
    const markActionTime = () => {
      if (this.dragAction === null) return;
      this.dragAction.actionTime = getTime();
    };
    const getDragAction = () => {
      window.isDragging = true;
      const initialState = window.state as ToggleableState;
      return {
        result: { isProcessed: false, isArrangeNeeded: false },
        actionTime: getTime(),
        srf,
        initialSrfId: srf.id,
        workingArea,
        tilesArea: null,
        window,
        dockTarget: null,
        previewRect: null,
        mousePointer,
        middlePointer,
        neighbors: getNeighbors(srf),
        neighborsSrfId: srf.id,
        dockSnapshots: {},
        initialState,
        initialGeometry: window.geometry.clone(),
        isLayoutHasDragStep: false,
      };
    };
    if (this.dragAction === null) {
      window.window.commit(
        ctx,
        new Rect(
          window.actualGeometry.x,
          window.actualGeometry.y,
          Math.max(window.minSize.width, workingArea.width * 0.25),
          Math.max(window.minSize.height, workingArea.height * 0.25),
        ),
      );
      this.dragAction = getDragAction();
    }
    // 100 milliseconds - min interval between run this function
    // else if (getTime() - this.dragAction.actionTime < 100) return;
    else {
      if (window === this.dragAction.window) {
        this.dragAction.actionTime = getTime();
        this.dragAction.mousePointer = mousePointer;
        this.dragAction.middlePointer = middlePointer;
        this.dragAction.srf = srf;
        this.dragAction.workingArea = workingArea;
      } else {
        this.finishDrag(ctx);
        this.dragAction = getDragAction();
      }
    }
    this.dragAction.result = { isProcessed: false, isArrangeNeeded: false };
    this.dragAction.dockTarget = null;
    this.dragAction.previewRect = null;
    if (this.dragAction.neighborsSrfId !== srf.id) {
      this.dragAction.neighbors = getNeighbors(srf);
      this.dragAction.neighborsSrfId = srf.id;
    }

    this.engine.docks.drag(this.dragAction);
    if (this.dragAction.result.isProcessed) {
      if (this.dragAction.result.isArrangeNeeded)
        this.engine.arrange(ctx, reason, getMethodName());
      this.updateDragPreview(ctx);
      return markActionTime();
    }

    const layout = this.engine.layouts.getCurrentLayout(srf);
    if (!layout.drag) {
      this.updateDragPreview(ctx);
      return markActionTime();
    }
    this.dragAction.isLayoutHasDragStep = true;
    layout.drag(new EngineContext(ctx, this.engine), this.dragAction);
    if (this.dragAction.result.isArrangeNeeded)
      this.engine.arrange(ctx, reason, getMethodName());
    this.updateDragPreview(ctx);
    return markActionTime();
  }

  /**
   * Draw (or clear) the preview rectangle for the active drag: the slot a
   * layout says the window would drop into, or else the dock slot. A docked
   * window's geometry has already been computed by the engine but is not
   * committed while `isDragging` is set, so it is the exact drop target.
   */
  private updateDragPreview(ctx: IDriverContext): void {
    const dragAction = this.dragAction;
    if (dragAction !== null && dragAction.previewRect !== null) {
      ctx.showDragPreview(
        toRect(dragAction.srf.output.geometry),
        dragAction.previewRect,
      );
      return;
    }
    if (
      dragAction === null ||
      dragAction.dockTarget === null ||
      dragAction.window.state !== WindowState.Docked
    ) {
      ctx.hideDragPreview();
      return;
    }
    ctx.showDragPreview(
      toRect(dragAction.srf.output.geometry),
      dragAction.window.geometry,
    );
  }

  public onWindowMoveOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    /* swap window by dragging */
    window.isDragging = false;
    const before =
      this.dragAction !== null && this.dragAction.window === window
        ? this.dragAction.initialGeometry
        : window.geometry.clone();
    if (this.dragAction !== null && this.dragAction.window === window) {
      const isLayoutHasDragStep = this.dragAction.isLayoutHasDragStep;
      if (isLayoutHasDragStep) {
        const layout = this.engine.layouts.getCurrentLayout(
          this.dragAction.srf,
        );
        if (layout.drop)
          layout.drop(new EngineContext(ctx, this.engine), this.dragAction);
      }
      this.finishDrag(ctx);
      if (isLayoutHasDragStep) {
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}`,
        );
        this.engine.flashMove(ctx, window, before);
        return;
      }
    }

    if (window.state === WindowState.Tiled) {
      const tiles = this.engine.windows.getVisibleTiles(ctx.currentSurface);
      const cursorPos = ctx.cursorPosition || window.actualGeometry.center;

      const targets = tiles.filter(
        (tile) =>
          tile !== window && tile.actualGeometry.includesPoint(cursorPos),
      );

      if (targets.length === 1) {
        this.engine.windows.swap(window, targets[0]);
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}`,
        );
        this.engine.flashMove(ctx, window, before);
        return;
      }
    }

    /* ... or float window by dragging */
    if (!CONFIG.keepTilingOnDrag && window.state === WindowState.Tiled) {
      const diff = window.actualGeometry.subtract(window.geometry);
      const distance = Math.sqrt(diff.x ** 2 + diff.y ** 2);
      // TODO: arbitrary constant
      if (distance > 30) {
        window.floatGeometry = window.actualGeometry;
        window.state = WindowState.Floating;
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}:keepTilingOnDrag=${CONFIG.keepTilingOnDrag}`,
        );
        return;
      }
    }

    /* ... or return to the previous position */
    window.commit(ctx);
  }

  /**
   * Finalize the active drag: restore the pre-drag state of the dragged and
   * swapped windows, then clear the drag context. Safe to call when no drag
   * is active or when the dragged window is already gone.
   */
  private finishDrag(ctx: IDriverContext): void {
    const dragAction = this.dragAction;
    if (dragAction === null) return;
    ctx.hideDragPreview();
    const { window, initialState } = dragAction;
    this.engine.docks.finishDrag(dragAction);
    this.dragAction = null;
    if (window.isAlive()) {
      window.isDragging = false;
      // previousState is unchanged during drag (setTransientState), so it
      // still holds the pre-drag value; only overwrite it if the state changed.
      if (window.state !== initialState) window.previousState = initialState;
    }
  }

  public onWindowResizeStart(window: WindowClass): void {
    /* do nothing */
  }

  public onWindowResize(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (
      CONFIG.adjustLayout &&
      CONFIG.adjustLayoutLive &&
      window.state === WindowState.Tiled
    ) {
      this.engine.adjustLayout(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    } else if (window.state === WindowState.Docked) {
      this.engine.adjustDock(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    }
  }

  public onWindowResizeOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    if (CONFIG.adjustLayout && window.isTiled) {
      this.engine.adjustLayout(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    } else if (window.state === WindowState.Docked) {
      this.engine.adjustDock(window);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
    } else if (!CONFIG.adjustLayout) this.engine.enforceSize(ctx, window);
  }

  public onWindowMaximizeChanged(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    this.engine.arrange(ctx, reason, getMethodName());
  }

  public onWindowGeometryChanged(
    ctx: IDriverContext,
    window: WindowClass,
  ): void {
    LOG?.send(
      LogModules.bufferGeometryChanged,
      "enforceSize",
      `Window: id:${window.id} actualGeometry: ${window.actualGeometry}, commitGeometry:${window.geometry}`,
      { winClass: [`${(window.window as DriverWindow).window.resourceClass}`] },
    );
    this.engine.enforceSize(ctx, window);
  }

  // NOTE: accepts `null` to simplify caller. This event is a catch-all hack
  // by itself anyway.
  public onWindowChanged(
    ctx: IDriverContext,
    window: WindowClass | null,
    reason: keyof typeof ArrangeReason,
    comment?: string,
    extraSurfaces?: ISurface[],
  ): void {
    if (window) {
      // TODO: delete one string bellow if the future caresses you with its grace
      // if (comment === "unminimized") ctx.currentWindow = window;
      /* KWin's own "window to next screen/desktop" lands here. When the window
       * was in a selected group, the rest of the group follows it, and the
       * surface it left has to be re-tiled too. */
      if (
        reason === "outputChangedCB" ||
        reason === "windowDesktopsChangedCB"
      ) {
        const vacated = this.engine.followGroupMove(ctx, window);
        if (vacated !== null)
          extraSurfaces = (extraSurfaces ?? []).concat([vacated]);
      }
      const workingArea = window.surface.workingArea;
      if (window.floatGeometry.width > workingArea.width) {
        window.floatGeometry.width = workingArea.width;
      }
      if (window.floatGeometry.height > workingArea.height) {
        window.floatGeometry.height = workingArea.height;
      }
      window.floatGeometry.x =
        workingArea.x + (workingArea.width - window.floatGeometry.width) / 2;
      window.floatGeometry.y =
        workingArea.y + (workingArea.height - window.floatGeometry.height) / 2;
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
        extraSurfaces,
      );
    }
  }

  public onWindowFocused(ctx: IDriverContext, window: WindowClass) {
    window.focusTime = getTime();
    this.engine.layoutsFocusChanged(window);
    /* Focus decides which stack tab is on top and whether a group selection
     * still stands. Nothing re-tiles on a bare focus change, so redraw the
     * overlays on their own: an arrange would commit every window's geometry
     * again, which is visible as a flicker even when nothing moves. */
    this.engine.renderOverlays(ctx);
  }

  public onDesktopsChanged(ctx: IDriverContext, window: WindowClass) {
    if (window.state !== WindowState.Docked)
      window.state = WindowState.Undecided;
  }

  public onShortcut(
    ctx: IDriverContext,
    action: KrohnkiteAction | null,
    reason: keyof typeof ArrangeReason,
  ) {
    if (action === null) return;
    if (ctx.handleLayoutChooserShortcut(action)) return;

    let isArrangeNeeded = true;
    let currentCapacity: number | null;
    const window = ctx.currentWindow;
    /* Where a window about to be moved is now, to tell whether it moved. */
    const before =
      window !== null && MOVE_ACTIONS.indexOf(action) >= 0
        ? window.geometry.clone()
        : null;

    if (
      this.engine.handleDockWinShortcut(ctx, window, action, reason) ||
      this.engine.handleFloatWinShortcut(ctx, window, action) ||
      this.engine.handleLayoutShortcut(ctx, action, reason) ||
      this.engine.handleTiledWinShortcut(ctx, window, action, reason)
    ) {
      if (window !== null && before !== null)
        this.engine.flashMove(ctx, window, before);
      if (window) ctx.requestPointerOnFocus("window", true);
      return;
    }
    switch (action) {
      case KrohnkiteAction.AlterRegister:
      case KrohnkiteAction.ToggleRegister:
        ctx.alterRegisterHdl(action);
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.FocusNext:
        this.engine.focusOrder(ctx, +1);
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.FocusPrev:
        this.engine.focusOrder(ctx, -1);
        isArrangeNeeded = false;
        break;

      case KrohnkiteAction.FocusUp:
        isArrangeNeeded = this.engine.focusDir(ctx, "up");
        break;
      case KrohnkiteAction.FocusDown:
        isArrangeNeeded = this.engine.focusDir(ctx, "down");
        break;
      case KrohnkiteAction.DWMLeft:
      case KrohnkiteAction.FocusLeft:
        isArrangeNeeded = this.engine.focusDir(ctx, "left");
        break;
      case KrohnkiteAction.DWMRight:
      case KrohnkiteAction.FocusRight:
        isArrangeNeeded = this.engine.focusDir(ctx, "right");
        break;

      case KrohnkiteAction.SetMaster:
        if (window) this.engine.setMaster(ctx, window);
        break;
      case KrohnkiteAction.ToggleFloat:
        if (window) this.engine.toggleFloat(window);
        break;
      case KrohnkiteAction.ToggleFloatAll:
        this.engine.floatAll(ctx, ctx.currentSurface);
        break;

      case KrohnkiteAction.NextLayout:
        this.engine.cycleLayout(ctx, 1);
        break;
      case KrohnkiteAction.PreviousLayout:
        this.engine.cycleLayout(ctx, -1);
        break;
      case KrohnkiteAction.LayoutChooser:
        ctx.showLayoutChooser();
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.SetTileLayout:
      case KrohnkiteAction.SetMonocleLayout:
      case KrohnkiteAction.SetThreeColumnLayout:
      case KrohnkiteAction.SetSpreadLayout:
      case KrohnkiteAction.SetStairLayout:
      case KrohnkiteAction.SetFloatingLayout:
      case KrohnkiteAction.SetQuarterLayout:
      case KrohnkiteAction.SetStackedLayout:
      case KrohnkiteAction.SetColumnsLayout:
      case KrohnkiteAction.SetSpiralLayout:
      case KrohnkiteAction.SetBinaryTreeLayout:
      case KrohnkiteAction.SetCascadeLayout:
      case KrohnkiteAction.SetManualTilingLayout:
        this.engine.setLayout(ctx, LayoutShortcutIds[action]!);
        break;

      case KrohnkiteAction.ToggleDock:
        if (window) this.engine.toggleDock(window);
        break;

      case KrohnkiteAction.RaiseSurfaceCapacity:
        currentCapacity = this.engine.raiseSurfaceCapacity(ctx);
        ctx.showNotification(
          `Surface capacity: ${currentCapacity !== null ? currentCapacity : "unlimited"}`,
        );
        break;
      case KrohnkiteAction.LowerSurfaceCapacity:
        currentCapacity = this.engine.lowerSurfaceCapacity(ctx);
        ctx.showNotification(`Surface capacity: ${currentCapacity}`);
        break;
      case KrohnkiteAction.ResetSurfaceCapacity:
        currentCapacity = this.engine.ResetSurfaceCapacity(ctx);
        ctx.showNotification(
          `Surface capacity: ${currentCapacity !== null ? currentCapacity : "unlimited"}`,
        );
        isArrangeNeeded = false;
        break;
      case KrohnkiteAction.ShowCurrentCapacity:
        currentCapacity = this.engine.getCurrentSurfaceCapacity(ctx);
        ctx.showNotification(
          `Surface capacity: ${currentCapacity !== null ? currentCapacity : "unlimited"}`,
        );
        isArrangeNeeded = false;
        break;
    }
    if (isArrangeNeeded) {
      this.engine.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
    }
  }
}
