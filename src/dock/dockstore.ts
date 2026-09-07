/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface DockSurfaceCfg {
  srfLabel: string;
  cfg: IDockCfg;
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
    if (!this.store[srf.id]) {
      this.store[srf.id] = new DockEntry(this.getSurfaceCfg(srf), srf.id);
    }
    let dockedWindows = visibles.filter((w) => {
      if (w.state === WindowState.Docked) {
        if (w.dock === null && w.windowClassName in this.windowClassesCfg) {
          w.dock = this.windowClassesCfg[w.windowClassName].clone();
        }
        return true;
      }
    });
    if (dockedWindows.length === 0) return workingArea;

    return this.store[srf.id].arrange(dockedWindows, workingArea);
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
      case KrohnkiteAction.ShrinkWidth:
        if (window.dock !== null) {
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
        }
        break;
      case KrohnkiteAction.GrowHeight:
      case KrohnkiteAction.ShrinkHeight:
        if (window.dock !== null) {
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
        }
        break;
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
