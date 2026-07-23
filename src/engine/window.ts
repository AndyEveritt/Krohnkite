/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class WindowClass implements IWindowClass {
  public static isTileableState(state: WindowState): boolean {
    return (
      state === WindowState.Dragging ||
      state === WindowState.Tiled ||
      state === WindowState.Maximized ||
      state === WindowState.TiledAfloat
    );
  }

  public static isTiledState(state: WindowState): boolean {
    return state === WindowState.Tiled || state === WindowState.Maximized;
  }

  public static isFloatingState(state: WindowState): boolean {
    return state === WindowState.Floating || state === WindowState.TiledAfloat;
  }

  public static isDockedState(state: WindowState): boolean {
    return state === WindowState.Docked;
  }

  public readonly id: string;
  public readonly window: IDriverWindow;

  public get actualGeometry(): Readonly<Rect> {
    return this.window.geometry;
  }
  public get shouldFloat(): boolean {
    return this.window.shouldFloat;
  }
  public get shouldIgnore(): boolean {
    return this.window.shouldIgnore;
  }

  /** If this window ***can be*** tiled by layout. */
  public get isTileable(): boolean {
    return WindowClass.isTileableState(this.state);
  }
  /** If this window is ***already*** tiled, thus a part of the current layout. */
  public get isTiled(): boolean {
    return WindowClass.isTiledState(this.state);
  }
  /** If this window is floating, thus its geometry is not tightly managed. */
  public get isFloating(): boolean {
    return WindowClass.isFloatingState(this.state);
  }

  public get isDocked(): boolean {
    return WindowClass.isDockedState(this.state);
  }

  public get geometryDelta(): RectDelta | null {
    if (this.geometry === this.actualGeometry) return null;

    return RectDelta.fromRects(this.geometry, this.actualGeometry);
  }

  public get minSize(): ISize {
    return this._minSize;
  }
  public get maxSize(): ISize {
    return this._maxSize;
  }

  /**
   * The current state of the window.
   *
   * This value affects what and how properties gets commited to the backend.
   *
   * Avoid comparing this value directly, and use `tileable`, `tiled`,
   * `floating` as much as possible.
   */
  public get state(): WindowState {
    /* external states override the internal state. */
    if (this.window.fullScreen) return WindowState.NativeFullscreen;
    if (this.window.maximized) return WindowState.NativeMaximized;

    return this.internalState;
  }

  public set state(value: WindowState) {
    const state = this.state;

    /* cannot transit to the current state */
    if (state === value || state === WindowState.Dragging) return;

    if (
      (state === WindowState.Unmanaged || WindowClass.isTileableState(state)) &&
      WindowClass.isFloatingState(value)
    )
      this.shouldCommitFloat = true;
    else if (
      WindowClass.isFloatingState(state) &&
      WindowClass.isTileableState(value)
    )
      /* save the current geometry before leaving floating state */
      this._floatGeometry = this.actualGeometry;

    this.internalState = value;
  }
  public setDraggingState() {
    this.internalState = WindowState.Dragging;
  }
  public setState(value: WindowState) {
    this.internalState = value;
  }

  public get surface(): ISurface {
    return this.window.surface;
  }

  public set surface(srf: ISurface) {
    this.window.surface = srf;
  }

  public get weight(): number {
    const srfID = this.window.surface.id;
    const weight: number | undefined = this.weightMap[srfID];
    if (weight === undefined) {
      this.weightMap[srfID] = 1.0;
      return 1.0;
    }
    return weight;
  }

  public set weight(value: number) {
    const srfID = this.window.surface.id;
    this.weightMap[srfID] = value;
  }

  public get windowClassName(): string {
    return this.window.windowClassName;
  }

  public get windowCaption(): string {
    return this.window.windowCaption;
  }

  public get floatGeometry(): Rect {
    if (this._floatGeometry === null) {
      this._floatGeometry = this.window.getInitFloatGeometry();
    }
    return this._floatGeometry;
  }
  public set floatGeometry(value: Rect) {
    this._floatGeometry = value;
  }

  public get srfTime() {
    if (this._srfTime.time === null) this._srfTime.time = getTime();
    return this._srfTime.time;
  }

  public dock: Dock | null;
  public geometry: Rect;
  public focusTime: number;
  public isSendingToOutput: boolean;

  private _srfTime: { time: number | null; srfId: string | null };
  private internalState: WindowState;
  private shouldCommitFloat: boolean;
  private weightMap: { [key: string]: number };
  private _minSize: ISize;
  private _maxSize: ISize;
  private _nativeFloatGeometry: Readonly<Rect>;
  private _floatGeometry: Rect | null;

  constructor(window: IDriverWindow) {
    this.id = window.id;
    this.window = window;

    this.geometry = window.geometry;
    this._nativeFloatGeometry = this.geometry.clone();
    this.focusTime = 0;
    this.isSendingToOutput = false;
    this.internalState = WindowState.Unmanaged;
    this.shouldCommitFloat = this.shouldFloat;
    this._floatGeometry =
      this.shouldCommitFloat || CONFIG.floatInit === null
        ? this.geometry
        : null;
    this.weightMap = {};
    this.dock = null;

    this._minSize = window.minSize;
    this._maxSize = window.maxSize;
    this._srfTime = { time: null, srfId: null };
  }

  public toString(): string {
    return `Window: id=${this.id}, state: ${this.state}. ${this.window}`;
  }

  public commit(ctx: IDriverContext, noBorders?: boolean) {
    const state = this.state;
    LOG?.send(
      LogModules.arrangeScreen,
      "commit",
      `id: ${this.id}, state: ${state}, floatGeometry: ${
        this.floatGeometry
      }, commitGeometry: ${this.geometry}, noBorders: ${noBorders}`,
    );
    switch (state) {
      case WindowState.Dragging:
        break;
      case WindowState.NativeMaximized:
        this.window.commit(ctx, undefined, undefined, undefined);
        break;

      case WindowState.NativeFullscreen:
        this.window.commit(ctx, undefined, undefined, WindowLayer.Normal);
        break;

      case WindowState.Floating:
        if (!this.shouldCommitFloat) break;
        this.window.commit(
          ctx,
          this.floatGeometry,
          false,
          CONFIG.floatedWindowsLayer,
        );
        this.shouldCommitFloat = false;
        break;

      case WindowState.Maximized:
        this.window.commit(ctx, this.geometry, true, WindowLayer.Normal);
        break;

      case WindowState.Tiled:
        this.window.commit(
          ctx,
          this.geometry,
          CONFIG.noTileBorder || Boolean(noBorders),
          CONFIG.tiledWindowsLayer,
        );
        break;

      case WindowState.TiledAfloat:
        if (!this.shouldCommitFloat) break;
        this.window.commit(
          ctx,
          this.floatGeometry,
          false,
          CONFIG.floatedWindowsLayer,
        );
        this.shouldCommitFloat = false;
        break;
      case WindowState.Floating:
        this.window.commit(
          ctx,
          this.geometry,
          CONFIG.noTileBorder || Boolean(noBorders),
          CONFIG.floatedWindowsLayer,
        );
        break;
      case WindowState.Docked:
        this.window.commit(
          ctx,
          this.geometry,
          CONFIG.noTileBorder,
          CONFIG.tiledWindowsLayer,
        );
        break;
    }
  }

  public updateSrfTime(srfId: string): void {
    if (this._srfTime.time !== null && srfId === null)
      this._srfTime.srfId = srfId;
    else if (srfId !== this._srfTime.srfId) {
      this._srfTime.srfId = srfId;
      this._srfTime.time = getTime();
    }
  }

  /**
   * Force apply the geometry *immediately*.
   *
   * This method is a quick hack created for engine#resizeFloat, thus should
   * not be used in other places.
   */
  public forceSetGeometry(ctx: IDriverContext, geometry: Rect) {
    this.window.commit(ctx, geometry);
  }

  public moveMouseToFocus() {
    this.window.moveMouseToFocus();
  }

  public visible(srf: ISurface): boolean {
    return this.window.visible(srf);
  }
  public get minimized(): boolean {
    return this.window.minimized;
  }
}
