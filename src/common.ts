/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface IShortcuts {
  getToggleDock(): ShortcutHandler;

  getFocusNext(): ShortcutHandler;
  getFocusPrev(): ShortcutHandler;

  getFocusUp(): ShortcutHandler;
  getFocusDown(): ShortcutHandler;
  getFocusLeft(): ShortcutHandler;
  getFocusRight(): ShortcutHandler;

  getShiftDown(): ShortcutHandler;
  getShiftUp(): ShortcutHandler;
  getShiftLeft(): ShortcutHandler;
  getShiftRight(): ShortcutHandler;

  getGrowHeight(): ShortcutHandler;
  getShrinkHeight(): ShortcutHandler;
  getShrinkWidth(): ShortcutHandler;
  getGrowWidth(): ShortcutHandler;

  getIncrease(): ShortcutHandler;
  getDecrease(): ShortcutHandler;

  getToggleFloat(): ShortcutHandler;
  getFloatAll(): ShortcutHandler;
  getNextLayout(): ShortcutHandler;
  getPreviousLayout(): ShortcutHandler;

  getRotate(): ShortcutHandler;
  getRotatePart(): ShortcutHandler;

  getSplitHorizontal(): ShortcutHandler;
  getSplitVertical(): ShortcutHandler;

  getGroupGrow(): ShortcutHandler;
  getGroupShrink(): ShortcutHandler;

  getToggleStack(): ShortcutHandler;
  getStackNext(): ShortcutHandler;
  getStackPrev(): ShortcutHandler;
  getStackMoveNext(): ShortcutHandler;
  getStackMovePrev(): ShortcutHandler;

  getSetMaster(): ShortcutHandler;

  getTileLayout(): ShortcutHandler;
  getMonocleLayout(): ShortcutHandler;
  getThreeColumnLayout(): ShortcutHandler;
  getSpreadLayout(): ShortcutHandler;
  getStairLayout(): ShortcutHandler;
  getFloatingLayout(): ShortcutHandler;
  getQuarterLayout(): ShortcutHandler;
  getStackedLayout(): ShortcutHandler;
  getColumnsLayout(): ShortcutHandler;
  getSpiralLayout(): ShortcutHandler;
  getBTreeLayout(): ShortcutHandler;
  getCascadeLayout(): ShortcutHandler;
  getManualTilingLayout(): ShortcutHandler;

  getRaiseSurfaceCapacity(): ShortcutHandler;
  getLowerSurfaceCapacity(): ShortcutHandler;

  getKrohnkiteMeta(): ShortcutHandler;
}

interface IDBusQml {
  getDBusExists(): DBusCall;
  getDBusMoveMouseToFocus(): DBusCall;
  getDBusMoveMouseToCenter(): DBusCall;
  getDBusVirtualKeyboardVisible(): DBusCall;
}

interface IDBus {
  moveMouseToFocus(timeout?: number): void;
  moveMouseToCenter(timeout?: number): void;
  checkVirtualKeyboardVisible(callback: (isVisible: boolean) => void): void;
}

interface IConfig {
  //Layouts
  tileLayoutInitialAngle: string;
  monocleMaximize: boolean;
  monocleMinimizeRest: boolean;
  quarterLayoutReset: boolean;
  columnsLayoutInitialAngle: string;
  columnsBalanced: boolean;
  columnsLayerConf: string[];
  stairReverse: boolean;
  layoutOrder: string[];
  layoutFactories: { [key: string]: () => ILayout };

  //Surfaces
  srfExceededToScreen: boolean;
  srfToScreenOrder: Direction[];
  srfExceededToVDesktop: boolean;
  srfToVDesktopOrder: Direction[];
  srfIsMoveOldestWindows: boolean;
  srfDefineCfg: string[];
  srfDefaultConfig: string[];

  //Geometry
  screenGapTop: number;
  screenGapLeft: number;
  screenGapBetween: number;
  screenGapRight: number;
  screenGapBottom: number;
  gapsOverrideConfig: string[];
  limitTileWidthRatio: number;

  //Behavior
  adjustLayout: boolean;
  adjustLayoutLive: boolean;
  directionalKeyMode: "dwm" | "focus";
  focusNormalCfg: WinTypes;
  focusMoveScreensNormal: boolean;
  focusMoveVDesktopsNormal: boolean;
  movePointerOnFocus: boolean;
  focusMetaCfg: WinTypes;
  focusMoveScreensMeta: boolean;
  focusMoveVDesktopsMeta: boolean;
  defaultMetaConfig: { [key: string]: Shortcut };
  metaConf: string[];
  metaTimeout: number;
  metaIsToggle: boolean;
  metaIsPushedTwice: boolean;
  newWindowPosition: number;

  //Rules
  ignoreClass: string[];
  ignoreTitle: string[];
  ignoreRole: string[];

  floatingClass: string[];
  floatingTitle: string[];
  floatDefault: boolean;
  floatUtility: boolean;

  ignoreActivity: string[];
  ignoreScreen: string[];
  ignoreVDesktop: string[];
  tileNothing: boolean;
  tilingClass: string[];

  screenDefaultLayout: string[];

  //Dock
  dockOrder: [number, number, number, number];
  dockHHeight: number;
  dockHWide: number;
  dockHGap: number;
  dockHEdgeGap: number;
  dockHAlignment: number;
  dockHEdgeAlignment: number;
  dockVHeight: number;
  dockVWide: number;
  dockVGap: number;
  dockVEdgeGap: number;
  dockVAlignment: number;
  dockVEdgeAlignment: number;
  dockSurfacesConfig: string[];
  dockWindowClassConfig: string[];

  //Options
  tiledWindowsLayer: WindowLayer;
  floatedWindowsLayer: WindowLayer;

  floatInit: IFloatInit | null;

  soleWindowDefaultProps: ISoleWindowProps;
  soleWindowOutputOverride: { [outputName: string]: ISoleWindowProps };

  unfitGreater: boolean;
  unfitLess: boolean;

  notificationDuration: number;
  overlayColor: string;

  layoutPerActivity: boolean;
  layoutPerDesktop: boolean;
  noTileBorder: boolean;
  optVKeyboardSupport: boolean;
  keepTilingOnDrag: boolean;
  preventMinimize: boolean;
  preventProtrusion: boolean;
  floatSkipPager: boolean;

  //log
}

interface IKrohnkiteMeta {
  state: boolean;
  lastPushed: number;
  toggleMode: boolean;
}

interface IDriverWindow {
  readonly fullScreen: boolean;
  readonly geometry: Readonly<Rect>;
  readonly id: string;
  readonly windowClassName: string;
  readonly windowCaption: string;
  readonly maximized: boolean;
  readonly minimized: boolean;
  readonly shouldIgnore: boolean;
  readonly shouldFloat: boolean;
  readonly minSize: ISize;
  readonly maxSize: ISize;

  surface: ISurface;

  commit(
    ctx: IDriverContext,
    geometry?: Rect,
    noBorder?: boolean,
    windowLayer?: WindowLayer,
  ): void;
  getInitFloatGeometry(): Rect;
  moveMouseToFocus(): void;
  visible(srf: ISurface): boolean;
}

interface IWindowClass {
  readonly id: string;
  readonly window: IDriverWindow;
  readonly actualGeometry: Readonly<Rect>;
  readonly shouldFloat: boolean;
  readonly shouldIgnore: boolean;
  readonly isTileable: boolean;
  readonly isTiled: boolean;
  readonly isFloating: boolean;
  readonly isDocked: boolean;
  readonly geometryDelta: RectDelta | null;
  readonly minSize: ISize;
  readonly maxSize: ISize;
  readonly windowClassName: string;
  readonly windowCaption: string;
  readonly minimized: boolean;
  readonly srfTime: number;
  state: WindowState;
  surface: ISurface;
  weight: number;
  floatGeometry: Rect;
  dock: Dock | null;
  geometry: Rect;
  focusTime: number;
  isSendingToOutput: boolean;

  setDraggingState(): void;
  setState(value: WindowState): void;

  commit(ctx: IDriverContext, noBorders?: boolean): void;
  forceSetGeometry(ctx: IDriverContext, geometry: Rect): void;
  moveMouseToFocus(): void;
  visible(srf: ISurface): boolean;
}

interface ISurfaceStore {
  getSurface(
    output: Output,
    activity: string,
    vDesktop: VirtualDesktop,
  ): ISurface;
}

interface ISurface {
  capacity: number | null;
  output: Output;
  readonly id: string;
  readonly layoutId: string;
  readonly ignore: boolean;
  readonly workingArea: Readonly<Rect>;
  readonly activity: string;
  readonly vDesktop: VirtualDesktop;
  readonly isOvercapacityCandidate: boolean;

  next(): ISurface | null;
  getParams(): [string, string, string];
  isFit(label: string): boolean;
}

interface IDriverContext {
  readonly backend: string;
  readonly currentSurfaces: ISurface[];
  readonly cursorPosition: [number, number] | null;

  currentDesktop: VirtualDesktop;
  currentSurface: ISurface;
  currentWindow: WindowClass | null;
  isMetaMode: boolean;

  getNeighborOutput(direction: Direction, source: Output): Output | null;
  getNeighborVDesktop(
    direction: Direction,
    sourceVDesktop?: VirtualDesktop,
  ): VirtualDesktop | null;
  getSurface(output: Output, vDesktop?: VirtualDesktop): ISurface | null;
  focusSpecial(direction: Direction): boolean;
  focusNeighborWindow(
    direction: Direction,
    winTypes: WinTypes,
  ): KwinWindow | null | boolean;
  focusOutput(
    window: KwinWindow | null,
    direction: Direction,
    winTypes: WinTypes,
  ): boolean;
  focusVDesktop(
    window: KwinWindow | null,
    direction: Direction,
    winTypes: WinTypes,
  ): boolean;
  metaPushed(): void;
  moveWindowToOutputDirection(
    window: WindowClass,
    direction: Direction,
    retargetDesktop?: boolean,
    arrangeScreens?: boolean,
  ): boolean;
  moveWinToVDesktopByDirection(
    window: WindowClass,
    direction: Direction,
  ): boolean;
  /* Group moves. The destination is resolved once and every window is sent to
   * it, unlike the by-direction calls above: those recompute the neighbour
   * from the current desktop, which walks further away with each window. */
  moveWindowsToOutput(windows: WindowClass[], output: Output): boolean;
  moveWindowsToVDesktop(
    windows: WindowClass[],
    vDesktop: VirtualDesktop,
  ): boolean;
  positioningOverCapacityWindows(): void;
  setTimeout(func: () => void, timeout: number): void;
  showNotification(text: string): void;

  /* Overlays that persist between arranges are collected per arrange:
   * `beginOverlays` drops every registration, each applying layout re-registers
   * under its own key, and `flushOverlays` draws whatever survived. A layout
   * that stops being applied therefore stops being drawn, with no teardown of
   * its own. The drop indicator is not part of that cycle: it belongs to a drag
   * or a one-off flash, neither of which lines up with an arrange. */
  beginOverlays(): void;
  setStackBars(key: string, bars: IStackBar[]): void;
  setSelectionOutline(key: string, rect: Rect | null): void;
  flushOverlays(): void;
  showDropIndicator(rect: Rect, duration?: number): void;
  hideDropIndicator(): void;
  showGroupIndicator(rect: Rect, duration?: number): void;
}

interface ILayoutClass {
  readonly id: string;
  new (capacity?: number | null): ILayout;
}

interface ILayout {
  /* read-only */
  readonly capacity?: number | null;
  readonly description: string;

  /* methods */
  adjust?(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ): void;
  apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void;
  handleShortcut?(ctx: EngineContext, input: Shortcut, data?: any): boolean;
  /**
   * Drop whatever the layout's commands are currently aimed at, because the
   * user is about to look somewhere else. Called by the controller on the
   * focus shortcuts, ahead of the focus change itself.
   *
   * @returns true if that changed anything the user can see, so the caller
   * knows an arrange is worth it.
   */
  clearSelection?(): boolean;
  drag?(
    ctx: EngineContext,
    draggingRect: Rect,
    window: WindowClass,
    workingArea: Rect,
  ): boolean;
  /**
   * Called once when a drag finishes, before the engine's own drop handling.
   *
   * A layout that only previews during `drag` - drawing a drop indicator
   * rather than re-tiling under the cursor - does the actual move here.
   *
   * @returns true if the layout consumed the drop, which suppresses the
   * engine's default swap-or-float behaviour.
   */
  dragOver?(ctx: EngineContext, window: WindowClass): boolean;

  toString(): string;
}

/** One stacked pane's tab strip, in screen coordinates. */
interface IStackBar {
  x: number;
  y: number;
  width: number;
  height: number;
  tabs: { id: string; title: string; active: boolean }[];
}

interface IGaps {
  left: number;
  right: number;
  top: number;
  bottom: number;
  between: number;
}

interface ISize {
  width: number;
  height: number;
}

interface ILogModules {
  send(
    module?: LogModule,
    action?: string,
    message?: string,
    filters?: ILogFilters,
  ): void;
  print(module?: LogModule, action?: string, message?: string): void;
  isModuleOn(module: LogModule): boolean;
}

interface ILogFilters {
  winClass?: string[] | null;
}

interface IFloatInit {
  windowWidth: number;
  windowHeight: number;
  randomize: boolean;
  randomWidth: number;
  randomHeight: number;
}

// Globals
let CONFIG: IConfig;
let LOG: ILogModules | undefined;
let DBUS: IDBus;
