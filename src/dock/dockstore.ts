/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface DockSurfaceCfg {
  srfLabel: string;
  cfg: IDockCfg;
}

interface DockHit {
  position: DockPosition | null;
  window: WindowClass | null;
}

class DockStore implements IDockStore {
  private store: { [SurfaceId: string]: DockEntry };
  private defaultCfg: DefaultDockCfg | null;
  private surfacesCfg: DockSurfaceCfg[];
  private windowClassesCfg: { [windowClassName: string]: IDock };

  constructor() {
    this.store = {};
    this.defaultCfg = DefaultDockCfg.instance;
    this.surfacesCfg = parseDockUserSurfacesCfg();
    this.windowClassesCfg = parseDockUserWindowClassesCfg();
  }

  public render(
    srf: ISurface,
    visibles: WindowClass[],
    workingArea: Rect,
  ): Rect {
    const entry = this.getOrCreateEntry(srf);
    const dockedWindows = visibles.filter(
      (w) => w.state === WindowState.Docked,
    );
    if (dockedWindows.length === 0) {
      entry.clearSlots();
      entry.tilesArea = workingArea;
    } else {
      entry.tilesArea = entry.arrange(dockedWindows, workingArea);
    }
    return entry.tilesArea;
  }

  private getOrCreateEntry(srf: ISurface): DockEntry {
    let entry = this.store[srf.id];
    if (!entry) {
      entry = new DockEntry(this.getSurfaceCfg(srf), srf.id);
      this.store[srf.id] = entry;
    }
    return entry;
  }

  /**
   * Attach the configured dock template to the window, so that its `dock`
   * property can be instantiated lazily when it is actually docked.
   */
  public attachWindow(window: WindowClass): void {
    const cfg = this.windowClassesCfg[window.windowClassName];
    window.setDockTemplate(cfg ?? new Dock(this.getSurfaceCfg(window.surface)));
  }

  public drag(dragAction: DragAction): void {
    const window = dragAction.window;
    const swapping = dragAction.swapping;
    const result = dragAction.result;
    const wasDocked = dragAction.initialState === WindowState.Docked;
    const entry = this.getOrCreateEntry(dragAction.srf);
    const tilesArea = entry.tilesArea;
    dragAction.tilesArea = tilesArea;
    const dockHit = this.getDockPosition(dragAction, entry);
    // Undo the active swap. The partner temporarily holds the dragged window's
    // original dock position, so restoring both is symmetric.
    const restoreSwapping = () => {
      if (swapping.window === null) return;
      if (wasDocked) window.dock.position = swapping.window.dock.position;
      swapping.window.setTransientState(WindowState.Docked);
      swapping.window.dock.position = swapping.position;
      swapping.window = null;
      swapping.position = null;
    };

    // Pointer left the dock area: undock the dragged window if currently docked.
    if (dockHit.position === null) {
      if (!window.isDocked) return;
      restoreSwapping();
      window.setTransientState(WindowState.Tiled);
      result.isProcessed = true;
      result.isArrangeNeeded = true;
      return;
    }

    // Pointer over an empty slot (or the window's own slot).
    if (dockHit.window === null) {
      dragAction.dockTarget = dockHit.position;
      if (window.isDocked && window.dock.position === dockHit.position) {
        result.isProcessed = true;
        return;
      }
      restoreSwapping();
      window.setTransientState(WindowState.Docked);
      window.dock.position = dockHit.position;
      result.isProcessed = true;
      result.isArrangeNeeded = true;
      return;
    }

    // Pointer over a slot occupied by another window.
    if (swapping.window === dockHit.window) {
      // Back on the current partner: undo the swap.
      restoreSwapping();
      dragAction.dockTarget = window.dock.position;
      result.isProcessed = true;
      result.isArrangeNeeded = true;
      return;
    }

    // New partner: restore the previous swap first, then swap with this one.
    restoreSwapping();
    dragAction.dockTarget = dockHit.position;
    swapping.window = dockHit.window;
    swapping.position = dockHit.position;
    window.setTransientState(WindowState.Docked);
    if (wasDocked) {
      dockHit.window.setTransientState(WindowState.Docked);
      dockHit.window.dock.position = window.dock.position;
    } else {
      dockHit.window.setTransientState(WindowState.Tiled);
    }
    window.dock.position = dockHit.position;
    result.isProcessed = true;
    result.isArrangeNeeded = true;
  }

  private getDockPosition(dragAction: DragAction, entry: DockEntry): DockHit {
    const {
      mousePointer,
      middlePointer,
      neighbors,
      workingArea,
      tilesArea,
      window,
      swapping,
    } = dragAction;
    /* On a side with a neighboring output the window's middle is tested and
     * the zone is not mirrored: the window can change outputs before the
     * cursor does. Without a neighbor the cursor plus the mirrored zone keeps
     * the usual edge/panel behavior. */
    const isEmptySlotHit = (
      position: DockPosition,
      dragZone: number,
    ): boolean => {
      if (dragZone <= 0) return false;
      switch (position) {
        case DockPosition.top:
          return workingArea.isTopZone(
            neighbors.up ? middlePointer : mousePointer,
            dragZone,
            "pixels",
            !neighbors.up,
          );
        case DockPosition.left:
          return workingArea.isLeftZone(
            neighbors.left ? middlePointer : mousePointer,
            dragZone,
            "pixels",
            !neighbors.left,
          );
        case DockPosition.right:
          return workingArea.isRightZone(
            neighbors.right ? middlePointer : mousePointer,
            dragZone,
            "pixels",
            !neighbors.right,
          );
        case DockPosition.bottom:
          return workingArea.isBottomZone(
            neighbors.down ? middlePointer : mousePointer,
            dragZone,
            "pixels",
            !neighbors.down,
          );
      }
    };
    let ownDockPosition = null;
    for (let i = 0; i < entry.slots.length; i++) {
      const dockSlot = entry.slots[i];
      const occupied =
        dockSlot.window !== null &&
        dockSlot.window.state === WindowState.Docked;
      const ownSlot = occupied && dockSlot.window === window;
      if (
        ownSlot &&
        (window.dock.position === dragAction.initialDockPosition ||
          swapping.window !== null)
      ) {
        if (dockSlot.position === DockPosition.bottom) {
          if (!tilesArea?.includesPoint(middlePointer))
            ownDockPosition = dockSlot.position;
        } else {
          if (!tilesArea?.includesPoint(mousePointer))
            ownDockPosition = dockSlot.position;
        }
        continue;
      }
      if (!occupied || ownSlot) {
        switch (dockSlot.position) {
          case DockPosition.top: {
            if (isEmptySlotHit(DockPosition.top, CONFIG.dockTopDragZone))
              return { position: DockPosition.top, window: null };
            continue;
          }
          case DockPosition.left: {
            if (isEmptySlotHit(DockPosition.left, CONFIG.dockLeftDragZone))
              return { position: DockPosition.left, window: null };
            continue;
          }
          case DockPosition.right: {
            if (isEmptySlotHit(DockPosition.right, CONFIG.dockRightDragZone))
              return { position: DockPosition.right, window: null };
            continue;
          }
          case DockPosition.bottom: {
            if (isEmptySlotHit(DockPosition.bottom, CONFIG.dockBottomDragZone))
              return { position: DockPosition.bottom, window: null };
            continue;
          }
          default: {
            warning(`${getMethodName()}: Unknown DockPosition`);
            continue;
          }
        }
      } else if (dockSlot.window !== null) {
        // Only empty slots are valid drop targets on a different surface than
        // the one the drag started on; swapping across monitors isn't supported.
        if (entry.id !== dragAction.initialSrfId) continue;
        if (
          dockSlot.window.geometry.includesPoint(mousePointer) ||
          dockSlot.window.geometry.includesPoint(middlePointer)
        )
          return { position: dockSlot.position, window: dockSlot.window };
      }
    }

    return { position: ownDockPosition, window: null };
  }

  public remove(window: WindowClass) {
    for (let key in this.store) {
      this.store[key].remove(window);
    }
  }

  public handleShortcut(
    ctx: IDriverContext,
    window: WindowClass,
    action: KrohnkiteAction,
  ): boolean {
    let result = false;
    switch (action) {
      case KrohnkiteAction.GrowWidth:
      case KrohnkiteAction.ShrinkWidth: {
        const increment = action === KrohnkiteAction.GrowWidth ? 1 : -1;
        if (
          window.dock.position === DockPosition.left ||
          window.dock.position === DockPosition.right
        ) {
          window.dock.cfg.vWide += increment;
        } else {
          window.dock.cfg.hWide += increment;
        }
        result = true;
        break;
      }
      case KrohnkiteAction.GrowHeight:
      case KrohnkiteAction.ShrinkHeight: {
        const increment = action === KrohnkiteAction.GrowHeight ? 1 : -1;
        if (
          window.dock.position === DockPosition.left ||
          window.dock.position === DockPosition.right
        ) {
          window.dock.cfg.vHeight += increment;
        } else {
          window.dock.cfg.hHeight += increment;
        }
        result = true;
        break;
      }
      case KrohnkiteAction.MoveLeft:
      case KrohnkiteAction.MoveUp:
      case KrohnkiteAction.MoveRight:
      case KrohnkiteAction.MoveDown:
        const srf = ctx.currentSurface;
        if (this.store[srf.id]) {
          result = this.store[srf.id].handleShortcut(window, action);
        }
        break;
    }
    if (CONFIG.movePointerOnFocus && result) {
      window.moveMouseToFocus();
    }
    return result;
  }

  public isNewWindowHaveDocked(window: WindowClass): boolean {
    if (
      window.windowClassName in this.windowClassesCfg &&
      (this.windowClassesCfg[window.windowClassName].caption === null ||
        DriverWindow.isContain(
          [this.windowClassesCfg[window.windowClassName].caption!],
          window.window.windowCaption,
        )) &&
      this.windowClassesCfg[window.windowClassName].autoDock === true
    )
      return true;
    return false;
  }

  private getSurfaceCfg(srf: ISurface): IDockCfg {
    let dockCfg: IDockCfg | null = null;
    for (let surfaceCfg of this.surfacesCfg) {
      if (srf.isFit(surfaceCfg.srfLabel)) {
        dockCfg = { ...surfaceCfg.cfg };
        break;
      }
    }
    if (dockCfg === null) dockCfg = this.defaultCfg!.cloneAndUpdate({});

    return dockCfg;
  }
}
