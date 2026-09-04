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

class TilingController {
  public engine: TilingEngine;
  private isDragging: boolean;
  private dragCompleteTime: number | null;

  public constructor(engine: TilingEngine) {
    this.engine = engine;
    this.isDragging = false;
    this.dragCompleteTime = null;
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
    if (this.isDragging) return;
    // 100 milliseconds - min interval between run this function
    if (
      this.dragCompleteTime !== null &&
      Date.now() - this.dragCompleteTime < 100
    )
      return;
    const srf = ctx.currentSurface;
    const layout = this.engine.layouts.getCurrentLayout(srf);
    if (!layout.drag) return;
    if (window.state === WindowState.Tiled) {
      window.isDragging = true;
    }
    if (window.isDragging) {
      if (
        layout.drag(
          new EngineContext(ctx, this.engine),
          toRect(windowRect),
          window,
          srf.workingArea as Rect,
        )
      ) {
        this.engine.arrange(ctx, reason, getMethodName());
      }

      this.dragCompleteTime = Date.now();
    }
    this.isDragging = false;
  }

  public onWindowMoveOver(
    ctx: IDriverContext,
    window: WindowClass,
    reason: keyof typeof ArrangeReason,
  ): void {
    /* swap window by dragging */
    if (window.isDragging) {
      window.isDragging = false;
      window.setState(WindowState.Tiled);
      this.engine.arrange(
        ctx,
        reason,
        `${getMethodName()}:windowState=${window.state}`,
      );
      return;
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
