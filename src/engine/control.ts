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
};

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
  mousePointer: QPoint;
  middlePointer: QPoint;
  swapping: {
    window: WindowClass | null;
    position: DockPosition | null;
  };
  initialState: ToggleableState;
  initialDockPosition: DockPosition | null;
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
  ): void {
    this.engine.arrange(ctx, reason, getMethodName());
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
    const middlePointer: QPoint = ctx.cursorPosition || draggingRect.center;
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
        mousePointer,
        middlePointer,
        swapping: { window: null, position: null },
        initialState,
        initialDockPosition:
          initialState === WindowState.Docked ? window.dock.position : null,
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
   * Draw (or clear) the dock-slot preview rectangle for the active drag. The
   * dragged window's geometry has already been computed by the engine but is
   * not committed while `isDragging` is set, so it is the exact drop target.
   */
  private updateDragPreview(ctx: IDriverContext): void {
    const dragAction = this.dragAction;
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
    if (this.dragAction !== null && this.dragAction.window === window) {
      const isLayoutHasDragStep = this.dragAction.isLayoutHasDragStep;
      this.finishDrag(ctx);
      if (isLayoutHasDragStep) {
        this.engine.arrange(
          ctx,
          reason,
          `${getMethodName()}:windowState=${window.state}`,
        );
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
    const { window, initialState, swapping } = dragAction;
    this.dragAction = null;
    if (window.isAlive()) {
      window.isDragging = false;
      // previousState is unchanged during drag (setTransientState), so it
      // still holds the pre-drag value; only overwrite it if the state changed.
      if (window.state !== initialState) window.previousState = initialState;
    }
    if (
      swapping.window !== null &&
      swapping.window.isAlive() &&
      swapping.window.state !== WindowState.Docked
    )
      swapping.window.previousState = WindowState.Docked;
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
  ): void {
    if (window) {
      // TODO: delete one string bellow if the future caresses you with its grace
      // if (comment === "unminimized") ctx.currentWindow = window;
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
      );
    }
  }

  public onWindowFocused(ctx: IDriverContext, window: WindowClass) {
    window.focusTime = getTime();
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

    let isArrangeNeeded = true;
    let currentCapacity: number | null;
    const window = ctx.currentWindow;

    if (
      this.engine.handleDockWinShortcut(ctx, window, action, reason) ||
      this.engine.handleFloatWinShortcut(ctx, window, action) ||
      this.engine.handleLayoutShortcut(ctx, action, reason) ||
      this.engine.handleTiledWinShortcut(ctx, window, action, reason)
    ) {
      if (CONFIG.movePointerOnFocus) {
        window?.moveMouseToFocus();
      }
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
        if (window) this.engine.setMaster(window);
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
    }
    if (isArrangeNeeded) {
      this.engine.arrange(ctx, reason, `${getMethodName()}:shortcut=${action}`);
    }
    if (CONFIG.movePointerOnFocus) {
      window?.moveMouseToFocus();
    }
  }
}
