/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface IShortcutEntry {
  name: ShortcutName;
  hdl: ShortcutHandler;
}

type ShortcutsQml = IShortcutEntry[];

interface IDBusQml {
  getDBusExists(): DBusCall;
  getDBusMoveMouseToFocus(): DBusCall;
  getDBusMoveMouseToCenter(): DBusCall;
  getDBusMoveMouseToScreenCenter(): DBusCall;
  getDBusVirtualKeyboardVisible(): DBusCall;
}

interface IDBus {
  moveMouseToFocus(timeout?: number): void;
  moveMouseToCenter(timeout?: number): void;
  moveMouseToScreenCenter(timeout?: number): void;
  checkVirtualKeyboardVisible(callback: (isVisible: boolean) => void): void;
  dispose(): void;
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
  columnsApplyConfOnNewColumns: boolean;
  columnsLimitColumns: boolean;
  stairReverse: boolean;
  spreadLayoutSpace: number;
  layoutOrder: string[];
  layoutFactories: { [key: string]: () => ILayout };

  //Surfaces
  srfExceededToScreen: boolean;
  srfToScreenOrder: Direction[];
  srfExceededToVDesktop: boolean;
  srfToVDesktopOrder: Direction[];
  srfOvercapacityEviction: OvercapacityEvictionPolicy;
  srfOvercapacityMode: OvercapacityMode;
  srfAllowShortcutMoveToFullSurface: boolean;
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

  //Shortcuts
  altRegisterTimeout: number;
  altRegisterIsToggle: boolean;
  altRegisterIsPushedTwice: boolean;
  shortcutSequenceTime: number;
  shortcutConf: IShortcutConfEntry[];

  //Behavior
  adjustLayout: boolean;
  adjustLayoutLive: boolean;
  focusNormalCfg: WinTypes;
  focusMoveScreensNormal: boolean;
  focusMoveVDesktopsNormal: boolean;
  movePointerOnFocus: boolean;
  movePointerOnFocusShortcutsOnly: boolean;
  movePointerOnResize: boolean;
  focusMetaCfg: WinTypes;
  focusMoveScreensMeta: boolean;
  focusMoveVDesktopsMeta: boolean;
  newWindowPosition: "last" | "first" | "second";

  //Rules
  ignoreClass: string[];
  ignoreTitle: string[];
  ignoreRole: string[];
  ignoreActivity: string[];
  ignoreScreen: string[];
  ignoreVDesktop: string[];
  tileNothing: boolean;
  tilingClass: string[];
  screenDefaultLayout: string[];

  //Float
  floatAsDefault: boolean;
  floatUtility: boolean;
  floatConfig: IFloatWindowsConfig;

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
  dockFrameColor: string;
  dockBorderColor: string;
  dockTopDragZone: number;
  dockBottomDragZone: number;
  dockLeftDragZone: number;
  dockRightDragZone: number;

  //Options
  tiledWindowsLayer: WindowLayer;
  floatedWindowsLayer: WindowLayer;

  soleWindowDefaultProps: ISoleWindowProps;
  soleWindowOutputOverride: { [outputName: string]: ISoleWindowProps };

  unfitLess: boolean;
  unfitGreater: boolean;

  notificationDuration: number;

  layoutPerActivity: boolean;
  layoutPerDesktop: boolean;
  noTileBorder: boolean;
  optVKeyboardSupport: boolean;
  keepTilingOnDrag: boolean;
  dragPreview: boolean;
  preventMinimize: boolean;
  preventProtrusion: boolean;
  floatSkipPager: boolean;

  //log
}

interface IRegister {
  state: boolean;
  lastPushed: number;
  toggleMode: boolean;
  alterActionID: number;
}

interface IDriverWindow {
  readonly fullScreen: boolean;
  floatGeometry: Rect;
  readonly geometry: Readonly<Rect>;
  readonly id: string;
  readonly windowClassName: string;
  readonly windowCaption: string;
  readonly stackingOrder: number;
  readonly nativeFloatGeometry: Rect;
  readonly maximized: boolean;
  readonly minimized: boolean;
  readonly shouldIgnore: boolean;
  readonly shouldFloat: boolean;
  readonly minSize: ISize;
  readonly maxSize: ISize;
  readonly srfTime: number;
  surface: ISurface;
  floatConfig: DriverFloatConfig;
  isCommittedEver: boolean;

  commit(
    ctx: IDriverContext,
    geometry?: Rect,
    noBorder?: boolean,
    windowLayer?: WindowLayer,
  ): void;
  updateSrfTime(srfId: string): void;
  visible(srf: ISurface): boolean;
  dispose(): void;
  setMinimizedByScript(minimized: boolean): void;
  isAlive(): boolean;
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
  state: WindowState;
  surface: ISurface;
  weight: number;
  floatGeometry: Rect;
  readonly dock: Dock;
  geometry: Rect;
  focusTime: number;
  floatInPlace(): void;
  isSendingToOutput: boolean;
  isDragging: boolean;
  previousState: ToggleableState;

  setTransientState(state: WindowState): void;
  setDockTemplate(template: Dock): void;
  commit(ctx: IDriverContext, noBorders?: boolean): void;
  forceSetGeometry(ctx: IDriverContext, geometry: Rect): void;
  visible(srf: ISurface): boolean;
  isAlive(): boolean;
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
  readonly cursorPosition: QPoint | null;

  currentDesktop: VirtualDesktop;
  currentSurface: ISurface;
  currentWindow: WindowClass | null;
  isRegister: boolean;

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
  alterRegisterHdl(action: KrohnkiteAction): void;
  moveWinToVDesktopByDirection(
    window: WindowClass,
    direction: Direction,
  ): boolean;
  relocateWindows(): boolean;
  /* Layout pass bracketing, used to move the pointer once per settled
   * layout instead of once per geometry change. */
  onLayoutStart(): void;
  onLayoutSettled(): void;
  /* The driver wrote a new frame geometry for this window. */
  onWindowSizeCommitted(client: KwinWindow): void;
  /* Focus moved as part of a Krohnkite action; the move happens once the
   * layout settles, and `byShortcut` tells a shortcut apart from focus KWin
   * granted on its own (mouse, newly opened window). */
  requestPointerOnFocus(target: PointerTarget, byShortcut: boolean): void;
  setTimeout(func: () => void, timeout: number): void;
  showNotification(text: string): void;
  showLayoutOSD(): void;
  showLayoutChooser(): void;
  showLayoutShortcut(id: string): void;
  showDragPreview(area: Rect, rect: Rect): void;
  hideDragPreview(): void;
  shortcutSequencesArrange(): void;
}

interface ILayoutClass {
  readonly id: string;
  new (capacity?: number | null): ILayout;
}

interface ILayout {
  /* read-only */
  readonly capacity?: number | null;
  readonly description: string;
  readonly classID: string;

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
  handleShortcut?(ctx: EngineContext, action: KrohnkiteAction): boolean;
  drag?(ctx: EngineContext, dragAction: DragAction): void;

  toString(): string;
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

// Globals
let CONFIG: IConfig;
let LOG: ILogModules | undefined;
let DBUS: IDBus;
