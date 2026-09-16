/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/
type DriverFloatConfig = NonNullableProps<
  PartialWithRequired<
    IFloatWindow,
    | "shouldFloat"
    | "auto"
    | "width"
    | "height"
    | "leftIndent"
    | "topIndent"
    | "stepWidth"
    | "stepHeight"
  >
>;

class DriverWindow implements IDriverWindow {
  public static generateID(w: KwinWindow) {
    return w.internalId.toString();
  }

  public get isActive(): boolean {
    return this.window.active;
  }
  public get fullScreen(): boolean {
    return this.window.fullScreen;
  }
  public get floatGeometry(): Rect {
    if (this._floatGeometry === null) {
      this._floatGeometry = this._getInitFloatGeometry();
    }
    return this._floatGeometry;
  }
  public set floatGeometry(value: Rect) {
    this._floatGeometry = value;
  }
  public get geometry(): Rect {
    return toRect(this.window.frameGeometry);
  }
  public get windowClassName(): string {
    return this.window.resourceClass;
  }
  public get windowCaption(): string {
    return this.window.caption;
  }
  public get shouldIgnore(): boolean {
    if (this.window.deleted) return true;
    return (
      this.window.specialWindow ||
      this.window.resourceClass === "plasmashell" ||
      this.isIgnoredByConfig
    );
  }
  public get shouldFloat(): boolean {
    return (
      this.floatConfig.shouldFloat ||
      (CONFIG.floatSkipPager && this.window.skipPager) ||
      this.window.modal ||
      this.window.transient ||
      !this.window.resizeable ||
      (KWINCONFIG.floatUtility &&
        (this.window.dialog || this.window.splash || this.window.utility))
    );
  }
  public maximized: boolean;
  public get minimized(): boolean {
    return this.window.minimized;
  }
  public get nativeFloatGeometry(): Rect {
    return this._nativeFloatGeometry;
  }
  public get surface(): ISurface {
    let activity;
    let vDesktop;
    if (this.window.activities.length === 0)
      activity = this.workspace.currentActivity;
    else if (
      this.window.activities.indexOf(this.workspace.currentActivity) >= 0
    )
      activity = this.workspace.currentActivity;
    else activity = this.window.activities[0];

    if (this.window.desktops.length === 1) {
      vDesktop = this.window.desktops[0];
    } else if (this.window.desktops.length === 0) {
      vDesktop = this.workspace.currentDesktop;
    } else {
      if (this.window.desktops.indexOf(this.workspace.currentDesktop) >= 0)
        vDesktop = this.workspace.currentDesktop;
      else vDesktop = this.window.desktops[0];
    }

    return this._surfaceStore.getSurface(
      this.resolvedOutput,
      activity,
      vDesktop,
    );
  }
  /* The window's live output, or the active screen when that output is an
   * already-destroyed wrapper. During a hotplug/resume flurry a still-alive
   * window can briefly reference a destroyed output before KWin reassigns
   * it to a live one; surface ids derive from output.name, so resolving
   * against the dead wrapper would throw mid-arrange. surface(), visible()
   * and commit() all go through this so a window whose output just died is
   * tiled on the fallback screen instead of vanishing from arrange. */
  private get resolvedOutput(): Output {
    return resolveWindowOutput(this.workspace, this.window);
  }
  public set surface(srf: ISurface) {
    const ksrf = srf as KWinSurface;

    // TODO: setting activity?
    // TODO: setting screen = move to the screen
    if (this.window.desktops[0] !== ksrf.vDesktop)
      this.window.desktops = [ksrf.vDesktop];
    if (this.window.activities[0] !== ksrf.activity)
      this.window.activities = [ksrf.activity];
  }
  public get minSize(): ISize {
    return {
      width: this.window.minSize.width,
      height: this.window.minSize.height,
    };
  }
  public get maxSize(): ISize {
    return {
      width: this.window.maxSize.width,
      height: this.window.maxSize.height,
    };
  }
  public get srfTime() {
    if (this._srfTime.time === null) this._srfTime.time = getTime();
    return this._srfTime.time;
  }

  public readonly window: KwinWindow;
  public readonly id: string;
  public isCommittedEver: boolean;
  public floatConfig: DriverFloatConfig;
  private _srfTime: { time: number | null; srfId: string | null };
  private readonly workspace: Workspace;
  private readonly isIgnoredByConfig: boolean;
  private readonly _surfaceStore: KWinSurfaceStore;
  private _floatGeometry: Rect | null;
  private _movePointerToCenter: { isMove: boolean; time: number };
  private _nativeFloatGeometry: Rect;
  /* A runtime reload replaces DriverWindow instances but keeps the native
   * KWin windows alive. Remember properties Krohnkite overrides so dispose()
   * can remove this runtime's effects before the replacement snapshots them. */
  private noBorderManaged: boolean;
  private noBorderOriginal: boolean;
  private layerManaged: boolean;
  private keepAboveOriginal: boolean;
  private keepBelowOriginal: boolean;
  private minimizedManaged: boolean;
  private minimizedOriginal: boolean;

  constructor(
    window: KwinWindow,
    workspace: Workspace,
    surfaceStore: KWinSurfaceStore,
  ) {
    this.workspace = workspace;
    this._surfaceStore = surfaceStore;
    this._srfTime = { time: null, srfId: null };
    this._movePointerToCenter = {
      isMove: false,
      time: 0,
    };
    this.window = window;
    this.isCommittedEver = false;
    this._nativeFloatGeometry = toRect(window.frameGeometry);
    this._floatGeometry = null;
    this.id = DriverWindow.generateID(window);
    this.maximized = false;
    this.noBorderManaged = false;
    this.noBorderOriginal = window.noBorder;
    this.layerManaged = false;
    this.keepAboveOriginal = window.keepAbove;
    this.keepBelowOriginal = window.keepBelow;
    this.minimizedManaged = false;
    this.minimizedOriginal = window.minimized;
    this.floatConfig = this._getFloatConfig(window);
    this.isIgnoredByConfig =
      DriverWindow.isContain(KWINCONFIG.ignoreClass, window.resourceClass) ||
      DriverWindow.isContain(KWINCONFIG.ignoreClass, window.resourceName) ||
      matchWords(this.window.caption, KWINCONFIG.ignoreTitle) >= 0 ||
      DriverWindow.isContain(KWINCONFIG.ignoreRole, window.windowRole) ||
      (KWINCONFIG.tileNothing &&
        !DriverWindow.isContain(KWINCONFIG.tilingClass, window.resourceClass));
  }
  public moveMouseToFocus() {
    const time = getTime();
    this._movePointerToCenter.isMove = this.isActive;
    this._movePointerToCenter.time = time;
  }
  public commit(
    ctx: IDriverContext,
    geometry?: Rect,
    noBorder?: boolean,
    windowLayer?: WindowLayer,
  ) {
    if (!this.window || this.window.deleted) return;
    LOG?.send(
      LogModules.window,
      "KwinWindow#commit",
      `geometry:${geometry}, noBorder:${noBorder}, windowLayer:${windowLayer}`,
    );
    if (this.window.resize) return;

    if (noBorder !== undefined) {
      if (!this.noBorderManaged && noBorder)
        /* Backup border state when transitioning from unmanaged to managed */
        this.noBorderOriginal = this.window.noBorder;
      else if (this.noBorderManaged && !this.window.noBorder)
        /* If border is enabled while in managed mode, remember it.
         * Note that there's no way to know if border is re-disabled in managed mode. */
        this.noBorderOriginal = false;

      if (noBorder)
        /* (Re)entering managed mode: remove border. */
        this.window.noBorder = true;
      else if (this.noBorderManaged)
        /* Exiting managed mode: restore original value. */
        this.window.noBorder = this.noBorderOriginal;

      /* update mode */
      this.noBorderManaged = noBorder;
    }

    if (windowLayer !== undefined) {
      this.layerManaged = true;
      if (windowLayer === WindowLayer.Above) this.window.keepAbove = true;
      else if (windowLayer === WindowLayer.Below) this.window.keepBelow = true;
      else if (windowLayer === WindowLayer.Normal) {
        this.window.keepAbove = false;
        this.window.keepBelow = false;
      }
    }

    if (geometry !== undefined) {
      geometry = this.adjustGeometry(geometry);
      if (KWINCONFIG.preventProtrusion) {
        /* Resolve to a live output first: on the hotplug/resume path the
         * window can still point at a destroyed output, and handing that
         * to workspace.clientArea()/getNeighborOutput() can crash KWin --
         * the very path this fallback exists to avoid. */
        const winOutput = this.resolvedOutput;
        const area = toRect(
          this.workspace.clientArea(
            ClientAreaOption.PlacementArea,
            winOutput,
            this.workspace.currentDesktop,
          ),
        );
        if (
          geometry.x < area.x &&
          ctx.getNeighborOutput("left", winOutput) === null
        ) {
          geometry.x = area.x;
        }
        if (
          geometry.y < area.y &&
          ctx.getNeighborOutput("up", winOutput) === null
        ) {
          geometry.y = area.y;
        }
        if (
          geometry.maxX > area.maxX &&
          ctx.getNeighborOutput("right", winOutput) === null
        ) {
          if (geometry.width > area.width) {
            geometry.x = area.x;
            geometry.width = area.width;
          } else {
            geometry.x = area.maxX - geometry.width;
          }
        }
        if (
          geometry.maxY > area.maxY &&
          ctx.getNeighborOutput("down", winOutput) === null
        ) {
          if (geometry.height > area.height) {
            geometry.y = area.y;
            geometry.height = area.height;
          } else {
            geometry.y = area.maxY - geometry.height;
          }
        }
        geometry = this.adjustGeometry(geometry);
      }
      if (this.window.deleted) return;
      this.window.frameGeometry = toQRect(geometry);
      if (this._movePointerToCenter.isMove) {
        this._movePointerToCenter.isMove = false;
        if (CONFIG.movePointerOnFocus) {
          if (getTime() - this._movePointerToCenter.time < 100) {
            DBUS.moveMouseToFocus(20);
          }
        }
      }
    }
  }
  public toString(): string {
    return `${debugWin(this.window)}`;
  }
  public setMinimizedByScript(minimized: boolean): void {
    if (this.window.deleted) return;
    if (!this.minimizedManaged) {
      // Capture on first write, not construction: the user or application may
      // have changed this state before Monocle first takes control of it.
      this.minimizedOriginal = this.window.minimized;
      this.minimizedManaged = true;
    }
    this.window.minimized = minimized;
  }

  /** Restore only window properties that this driver instance managed. */
  public dispose(): void {
    if (!this.window || this.window.deleted) return;
    try {
      if (this.noBorderManaged) this.window.noBorder = this.noBorderOriginal;
      if (this.layerManaged) {
        this.window.keepAbove = this.keepAboveOriginal;
        this.window.keepBelow = this.keepBelowOriginal;
      }
      if (this.minimizedManaged) this.window.minimized = this.minimizedOriginal;
    } catch (_) {
      /* The KWin window may be destroyed while the runtime is reloading. */
    }
    this.noBorderManaged = false;
    this.layerManaged = false;
    this.minimizedManaged = false;
  }
  public visible(srf: ISurface): boolean {
    const ksrf = srf as KWinSurface;
    return (
      !this.window.deleted &&
      !this.window.minimized &&
      (this.window.onAllDesktops ||
        this.window.desktops.indexOf(ksrf.vDesktop) !== -1) &&
      (this.window.activities.length === 0 /* on all activities */ ||
        this.window.activities.indexOf(ksrf.activity) !== -1) &&
      this.resolvedOutput === ksrf.output
    );
  }
  public updateSrfTime(srfId: string): void {
    if (srfId !== this._srfTime.srfId) {
      this._srfTime.srfId = srfId;
      this._srfTime.time = getTime();
    }
  }
  private _getFloatConfig(window: KwinWindow): DriverFloatConfig {
    const configs = CONFIG.floatConfig.config;
    const defaults: DriverFloatConfig = {
      shouldFloat: false,
      auto: CONFIG.floatAsDefault,
      width: this._nativeFloatGeometry.width,
      height: this._nativeFloatGeometry.height,
      leftIndent: { value: this._nativeFloatGeometry.x, unit: "px" },
      topIndent: { value: this._nativeFloatGeometry.y, unit: "px" },
      stepWidth: CONFIG.floatConfig.sizeStepWidth,
      stepHeight: CONFIG.floatConfig.sizeStepHeight,
    };
    if (!configs || configs.length === 0) return defaults;

    for (const cfg of configs) {
      if (cfg.class) {
        const classes = cfg.class
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c !== "");
        if (classes.length > 0) {
          if (
            !DriverWindow.isContain(classes, window.resourceClass) &&
            !DriverWindow.isContain(classes, window.resourceName)
          )
            continue;
        }
      }

      if (cfg.title) {
        if (!DriverWindow.isContain([cfg.title], window.caption)) continue;
      }

      return {
        shouldFloat: cfg.shouldFloat,
        auto: cfg.auto,
        width: cfg.width ?? this._nativeFloatGeometry.width,
        height: cfg.height ?? this._nativeFloatGeometry.height,
        leftIndent: cfg.leftIndent ?? {
          value: this._nativeFloatGeometry.x,
          unit: "px",
        },
        topIndent: cfg.topIndent ?? {
          value: this._nativeFloatGeometry.y,
          unit: "px",
        },
        stepWidth: cfg.stepWidth ?? CONFIG.floatConfig.sizeStepWidth,
        stepHeight: cfg.stepHeight ?? CONFIG.floatConfig.sizeStepHeight,
      };
    }

    return defaults;
  }
  public static isContain(filterList: string[], s: string): boolean {
    for (let filterWord of filterList) {
      if (
        filterWord.startsWith("[") &&
        filterWord[filterWord.length - 1] === "]"
      ) {
        if (
          s
            .toLowerCase()
            .includes(filterWord.toLowerCase().slice(1, filterWord.length - 1))
        )
          return true;
      } else if (s.toLowerCase() === filterWord.toLowerCase()) return true;
    }
    return false;
  }
  /** apply various resize hints to the given geometry */
  private adjustGeometry(geometry: Rect): Rect {
    let width = geometry.width;
    let height = geometry.height;

    /* do not resize fixed-size windows */
    if (!this.window.resizeable) {
      width = this.window.width;
      height = this.window.height;
    } else {
      width = clip(width, this.window.minSize.width, this.window.maxSize.width);
      height = clip(
        height,
        this.window.minSize.height,
        this.window.maxSize.height,
      );
    }

    return new Rect(geometry.x, geometry.y, width, height);
  }
  public _getInitFloatGeometry(): Rect {
    /* resolvedOutput, not window.output: this runs from the arrange path
     * (floatGeometry), where a fallback window may still hold a destroyed
     * output whose .geometry read would throw and abort the arrange. */
    let outputGeometry = this.resolvedOutput.geometry;
    if (CONFIG.floatConfig === null) {
      return toRect(outputGeometry);
    }

    const cfg = this.floatConfig;
    const nativeW = this._nativeFloatGeometry.width;
    const nativeH = this._nativeFloatGeometry.height;
    const nativeX = this._nativeFloatGeometry.x;
    const nativeY = this._nativeFloatGeometry.y;

    const cfgWidth = cfg.width ?? nativeW;
    const cfgHeight = cfg.height ?? nativeH;
    const defaultLeft: IndentValue = { value: nativeX, unit: "px" };
    const defaultTop: IndentValue = { value: nativeY, unit: "px" };
    const cfgLeft = cfg.leftIndent ?? defaultLeft;
    const cfgTop = cfg.topIndent ?? defaultTop;

    const hasCustomWidth = cfg.width !== null && cfg.width !== nativeW;
    const hasCustomHeight = cfg.height !== null && cfg.height !== nativeH;
    const hasCustomLeft =
      cfg.leftIndent !== null &&
      (cfg.leftIndent.value !== nativeX || cfg.leftIndent.unit !== "px");
    const hasCustomTop =
      cfg.topIndent !== null &&
      (cfg.topIndent.value !== nativeY || cfg.topIndent.unit !== "px");

    let width = hasCustomWidth
      ? cfgWidth
      : CONFIG.floatConfig.isNativeSizeOverride
        ? outputGeometry.width * (CONFIG.floatConfig.floatWidth / 100)
        : nativeW;
    let height = hasCustomHeight
      ? cfgHeight
      : CONFIG.floatConfig.isNativeSizeOverride
        ? outputGeometry.height * (CONFIG.floatConfig.floatHeight / 100)
        : nativeH;

    let x: number;
    let y: number;

    if (hasCustomLeft) {
      if (cfgLeft.unit === "%") {
        x = outputGeometry.x + outputGeometry.width * (cfgLeft.value / 100);
      } else {
        x = cfgLeft.value;
      }
    } else if (hasCustomWidth) {
      x = outputGeometry.x + outputGeometry.width / 2 - width / 2;
    } else {
      x = outputGeometry.x + outputGeometry.width / 2 - width / 2;
    }

    if (hasCustomTop) {
      if (cfgTop.unit === "%") {
        y = outputGeometry.y + outputGeometry.height * (cfgTop.value / 100);
      } else {
        y = cfgTop.value;
      }
    } else if (hasCustomHeight) {
      y = outputGeometry.y + outputGeometry.height / 2 - height / 2;
    } else {
      y = outputGeometry.y + outputGeometry.height / 2 - height / 2;
    }

    if (!this.window.resizeable) {
      if (this.window.maxSize.width < width) {
        x = x + (width - this.window.maxSize.width) / 2;
        width = this.window.maxSize.width;
      }

      if (this.window.maxSize.height < height) {
        y = y + (height - this.window.maxSize.height) / 2;
        height = this.window.maxSize.height;
      }
    } else {
      if (this.window.minSize.width > outputGeometry.width) {
        width = this.window.minSize.width;
        x = outputGeometry.x;
      }
      if (this.window.minSize.height > outputGeometry.height) {
        height = this.window.minSize.height;
        y = outputGeometry.y;
      }
      if (CONFIG.floatConfig.randomize) {
        x =
          x +
          getRandomInt(
            (x - outputGeometry.x) * (CONFIG.floatConfig.randomWidth / 100),
            true,
          );
        y =
          y +
          getRandomInt(
            (y - outputGeometry.y) * (CONFIG.floatConfig.randomHeight / 100),
            true,
          );
      }
    }

    return new Rect(x, y, width, height);
  }
}
