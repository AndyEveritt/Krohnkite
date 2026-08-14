/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/
enum WinTypes {
  tiled = 1,
  docked = 2,
  float = 4,
  surfaces = 8,
  special = 16,
}
const winTypesCfg = [
  WinTypes.docked | WinTypes.float | WinTypes.tiled,
  WinTypes.surfaces,
  WinTypes.tiled,
  WinTypes.float,
  WinTypes.docked,
  WinTypes.tiled | WinTypes.float,
  WinTypes.tiled | WinTypes.docked,
  WinTypes.float | WinTypes.docked,
  WinTypes.special,
];
interface ISortedLayouts {
  order: number;
  layoutClass: ILayoutClass;
  isCapacity: boolean;
}
interface ISoleWindowProps {
  width: number;
  height: number;
  noGaps: boolean;
  noBorders: boolean;
}
interface IFloatWindowsConfig {
  isNativeSizeOverride: boolean;
  floatWidth: number;
  floatHeight: number;
  randomize: boolean;
  randomWidth: number;
  randomHeight: number;
  sizeStepWidth: number;
  sizeStepHeight: number;
  config: IFloatWindow[];
}
type IndentValue = {
  value: number;
  unit: "px" | "%";
};
interface IFloatWindow {
  class: string;
  title: string;
  shouldFloat: boolean;
  auto: boolean;
  width: number | null;
  height: number | null;
  leftIndent: IndentValue | null;
  topIndent: IndentValue | null;
  stepWidth: number | null;
  stepHeight: number | null;
}

function isValidConfigKey(key: string): key is ConfigVariables {
  return key in ConfigVariables;
}

function parseFloatConfig(lines: string[]): IFloatWindow[] {
  const result: IFloatWindow[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    const parts = trimmed.split(":");
    const classList = parts[0].trim();
    if (classList) {
      const rawParts = classList.split(",");
      const classes = rawParts.map((c) => c.trim()).filter((c) => c !== "");
      if (classes.length < rawParts.length) {
        warning(`parseFloatConfig: empty class name in list "${classList}"`);
        continue;
      }
    }

    let title = "";
    let paramsStr = "";
    if (parts.length === 2) {
      paramsStr = parts[1];
    } else if (parts.length === 3) {
      title = parts[1];
      paramsStr = parts[2];
    } else if (parts.length > 3) {
      warning(`parseFloatConfig: invalid format in "${trimmed}"`);
      continue;
    }

    const entry: IFloatWindow = {
      class: classList,
      title,
      shouldFloat: true,
      auto: false,
      width: null,
      height: null,
      leftIndent: null,
      topIndent: null,
      stepWidth: null,
      stepHeight: null,
    };

    if (paramsStr) {
      const params = separate(paramsStr, ",");
      for (const param of params) {
        const eqIdx = param.indexOf("=");
        const key =
          eqIdx >= 0
            ? param.slice(0, eqIdx).trim().toLowerCase()
            : param.trim().toLowerCase();
        const rawVal =
          eqIdx >= 0
            ? param
                .slice(eqIdx + 1)
                .trim()
                .toLowerCase()
            : "";
        switch (key) {
          case "shouldfloat":
          case "f":
            entry.shouldFloat = rawVal === "true" || rawVal === "1";
            break;
          case "auto":
          case "a":
            entry.auto = rawVal === "true" || rawVal === "1";
            break;
          case "width":
          case "w": {
            const w = parseNumber(rawVal, false);
            if (w instanceof Err) {
              warning(`parseFloatConfig: invalid width "${rawVal}"`);
            } else {
              const vw = validateNumber(w, 1, 100);
              if (vw instanceof Err) {
                warning(`parseFloatConfig: width out of range: ${rawVal}`);
              } else {
                entry.width = vw;
              }
            }
            break;
          }
          case "height":
          case "h": {
            const h = parseNumber(rawVal, false);
            if (h instanceof Err) {
              warning(`parseFloatConfig: invalid height "${rawVal}"`);
            } else {
              const vh = validateNumber(h, 1, 100);
              if (vh instanceof Err) {
                warning(`parseFloatConfig: height out of range: ${rawVal}`);
              } else {
                entry.height = vh;
              }
            }
            break;
          }
          case "leftindent":
          case "li":
          case "left": {
            let unit: "px" | "%" = "px";
            let numStr = rawVal;
            if (rawVal.endsWith("%")) {
              unit = "%";
              numStr = rawVal.slice(0, -1);
            } else if (rawVal.endsWith("px")) {
              numStr = rawVal.slice(0, -2);
            }
            const l = parseNumber(numStr, true);
            if (l instanceof Err) {
              warning(`parseFloatConfig: invalid left indent "${rawVal}"`);
            } else {
              entry.leftIndent = { value: l, unit };
            }
            break;
          }
          case "topindent":
          case "ti":
          case "top": {
            let unit: "px" | "%" = "px";
            let numStr = rawVal;
            if (rawVal.endsWith("%")) {
              unit = "%";
              numStr = rawVal.slice(0, -1);
            } else if (rawVal.endsWith("px")) {
              numStr = rawVal.slice(0, -2);
            }
            const t = parseNumber(numStr, true);
            if (t instanceof Err) {
              warning(`parseFloatConfig: invalid top indent "${rawVal}"`);
            } else {
              entry.topIndent = { value: t, unit };
            }
            break;
          }
          case "stepwidth":
          case "sw": {
            const sw = parseNumber(rawVal, false);
            if (sw instanceof Err) {
              warning(`parseFloatConfig: invalid step width "${rawVal}"`);
            } else {
              const vsw = validateNumber(sw, 0, 100);
              if (vsw instanceof Err) {
                warning(`parseFloatConfig: step width out of range: ${rawVal}`);
              } else {
                entry.stepWidth = vsw;
              }
            }
            break;
          }
          case "stepheight":
          case "sh": {
            const sh = parseNumber(rawVal, false);
            if (sh instanceof Err) {
              warning(`parseFloatConfig: invalid step height "${rawVal}"`);
            } else {
              const vsh = validateNumber(sh, 0, 100);
              if (vsh instanceof Err) {
                warning(
                  `parseFloatConfig: step height out of range: ${rawVal}`,
                );
              } else {
                entry.stepHeight = vsh;
              }
            }
            break;
          }
          default:
            warning(`parseFloatConfig: unknown param "${key}"`);
        }
      }
    }
    result.push(entry);
  }
  return result;
}

class KWinConfig implements IConfig {
  /*
   * Layouts
   * */
  public tileLayoutInitialAngle: string;
  public monocleMaximize: boolean;
  public monocleMinimizeRest: boolean;
  public quarterLayoutReset: boolean;
  public columnsLayoutInitialAngle: string;
  public columnsBalanced: boolean;
  public columnsLayerConf: string[];
  public columnsApplyConfOnNewColumns: boolean;
  public columnsLimitColumns: boolean;
  public stairReverse: boolean;
  public layoutOrder: string[];
  public layoutFactories: { [key: string]: () => ILayout };
  /*
   * Surfaces
   * */
  public srfExceededToScreen: boolean;
  public srfToScreenOrder: Direction[];
  public srfExceededToVDesktop: boolean;
  public srfToVDesktopOrder: Direction[];
  public srfIsMoveOldestWindows: boolean;
  public srfDefineCfg: string[];
  public srfDefaultConfig: string[];
  /*
   * Geometry
   * */
  public screenGapTop: number;
  public screenGapLeft: number;
  public screenGapBetween: number;
  public screenGapRight: number;
  public screenGapBottom: number;
  public gapsOverrideConfig: string[];
  public limitTileWidthRatio: number;
  /*
   * Behavior
   * */
  public adjustLayout: boolean;
  public adjustLayoutLive: boolean;
  public directionalKeyMode: "dwm" | "focus";
  public focusNormalCfg: WinTypes;
  public focusMetaCfg: WinTypes;
  public focusMoveScreensNormal: boolean;
  public focusMoveVDesktopsNormal: boolean;
  public focusMoveScreensMeta: boolean;
  public focusMoveVDesktopsMeta: boolean;
  public movePointerOnFocus: boolean;
  public defaultMetaConfig: { [key: string]: Shortcut };
  public metaConf: string[];
  public metaTimeout: number;
  public metaIsToggle: boolean;
  public metaIsPushedTwice: boolean;
  public newWindowPosition: "last" | "first" | "second";
  /*
   * Rules
   * */
  public ignoreClass: string[];
  public ignoreTitle: string[];
  public ignoreRole: string[];
  public ignoreActivity: string[];
  public ignoreScreen: string[];
  public ignoreVDesktop: string[];
  public tileNothing: boolean;
  public tilingClass: string[];
  public screenDefaultLayout: string[];
  /*
   * Float
   * */
  // public floatingClass: string[];
  // public floatingTitle: string[];
  public floatAsDefault: boolean;
  public floatUtility: boolean;
  public floatConfig: IFloatWindowsConfig;

  /*
   * Dock
   * */
  public dockOrder: [number, number, number, number];
  public dockHHeight: number;
  public dockHWide: number;
  public dockHGap: number;
  public dockHEdgeGap: number;
  public dockHAlignment: number;
  public dockHEdgeAlignment: number;
  public dockVHeight: number;
  public dockVWide: number;
  public dockVGap: number;
  public dockVEdgeGap: number;
  public dockVAlignment: number;
  public dockVEdgeAlignment: number;
  public dockSurfacesConfig: string[];
  public dockWindowClassConfig: string[];
  /*
   * Options
   * */
  public tiledWindowsLayer: number;
  public floatedWindowsLayer: number;

  public soleWindowDefaultProps: ISoleWindowProps;
  public soleWindowOutputOverride: { [outputName: string]: ISoleWindowProps };

  public unfitGreater: boolean;
  public unfitLess: boolean;

  public notificationDuration: number;

  public layoutPerActivity: boolean;
  public layoutPerDesktop: boolean;
  public noTileBorder: boolean;
  public optVKeyboardSupport: boolean;
  public keepTilingOnDrag: boolean;
  public preventMinimize: boolean;
  public preventProtrusion: boolean;
  public floatSkipPager: boolean;
  /*
   * Log
   * */

  constructor() {
    /***************************
     ****************** Layouts
     **************************/
    this.tileLayoutInitialAngle = KWIN.readConfig(
      "tileLayoutInitialRotationAngle",
      "0",
    );
    this.monocleMaximize = KWIN.readConfig("monocleMaximize", true);
    this.monocleMinimizeRest = KWIN.readConfig("monocleMinimizeRest", false);
    this.quarterLayoutReset = KWIN.readConfig("quarterLayoutReset", false);
    this.columnsLayoutInitialAngle = KWIN.readConfig(
      "columnsLayoutInitialRotationAngle",
      "0",
    );
    this.columnsBalanced = KWIN.readConfig("columnsBalanced", false);
    this.columnsLayerConf = separate(
      KWIN.readConfig("columnsLayerConf", ""),
      ",",
    );
    this.columnsApplyConfOnNewColumns = KWIN.readConfig(
      "columnsApplyConfOnNewColumns",
      false,
    );
    this.columnsLimitColumns = KWIN.readConfig("columnsLimitColumns", false);
    this.stairReverse = KWIN.readConfig("stairReverse", false);

    const layoutsList = [
      [TileLayout, true],
      [MonocleLayout, false],
      [ThreeColumnLayout, true],
      [SpiralLayout, true],
      [QuarterLayout, false],
      [StackedLayout, true],
      [ColumnsLayout, true],
      [SpreadLayout, true],
      [FloatingLayout, true],
      [StairLayout, true],
      [BinaryTreeLayout, true],
      [CascadeLayout, true],
    ] as Array<[ILayoutClass, boolean]>;
    const sortedLayouts: ISortedLayouts[] =
      KWinConfig.getSortedLayouts(layoutsList);
    this.layoutOrder = KWinConfig.getLayoutOrder(sortedLayouts);
    this.layoutFactories = KWinConfig.getLayoutFactories(sortedLayouts);
    sortedLayouts.forEach(({ layoutClass, isCapacity }) => {
      this.layoutOrder.push(layoutClass.id);
    });

    //***************************
    //****************** Surfaces
    //***************************
    this.srfExceededToScreen = KWIN.readConfig("srfExceededToScreen", true);
    // Define the config mapping (cleaner and easier to maintain)
    const directionConfigs: {
      direction: Direction;
      screenKey: keyof typeof ConfigVariables;
      vDesktopKey: keyof typeof ConfigVariables;
      defaultOrder: number;
    }[] = [
      {
        direction: "left",
        screenKey: "srfToScreenOrderLeft",
        vDesktopKey: "srfToVDesktopOrderLeft",
        defaultOrder: 1,
      },
      {
        direction: "up",
        screenKey: "srfToScreenOrderTop",
        vDesktopKey: "srfToVDesktopOrderTop",
        defaultOrder: 2,
      },
      {
        direction: "right",
        screenKey: "srfToScreenOrderRight",
        vDesktopKey: "srfToVDesktopOrderRight",
        defaultOrder: 3,
      },
      {
        direction: "down",
        screenKey: "srfToScreenOrderBottom",
        vDesktopKey: "srfToVDesktopOrderBottom",
        defaultOrder: 4,
      },
    ];
    // Build the sorted array of directions
    this.srfToScreenOrder = directionConfigs
      .map(({ direction, screenKey: key, defaultOrder }) => ({
        direction,
        order: Number(KWIN.readConfig(key, defaultOrder)), // ensure number
      }))
      .filter((el) => el.order !== 0) // exclude if order is 0
      .sort((a, b) => a.order - b.order) // ascending order
      .map((el) => el.direction); // extract direction strings

    this.srfExceededToVDesktop = KWIN.readConfig("srfExceededToVDesktop", true);
    this.srfToVDesktopOrder = directionConfigs
      .map(({ direction, vDesktopKey: key, defaultOrder }) => ({
        direction,
        order: Number(KWIN.readConfig(key, defaultOrder)), // ensure number
      }))
      .filter((el) => el.order !== 0) // exclude if order is 0
      .sort((a, b) => a.order - b.order) // ascending order
      .map((el) => el.direction); // extract direction strings
    this.srfIsMoveOldestWindows = KWIN.readConfig(
      "srfIsMoveOldestWindows",
      false,
    );
    this.srfDefineCfg = separate(KWIN.readConfig("srfDefineCfg", ""), "\n");
    this.srfDefaultConfig = separate(
      KWIN.readConfig("srfDefaultConfig", ""),
      "\n",
    );

    //***************************
    //****************** Geometry
    //***************************
    this.screenGapTop = KWIN.readConfig("screenGapTop", 0);
    this.screenGapLeft = KWIN.readConfig("screenGapLeft", 0);
    this.screenGapBetween = KWIN.readConfig("screenGapBetween", 0);
    this.screenGapRight = KWIN.readConfig("screenGapRight", 0);
    this.screenGapBottom = KWIN.readConfig("screenGapBottom", 0);
    this.gapsOverrideConfig = separate(
      KWIN.readConfig("gapsOverrideConfig", ""),
      "\n",
    );
    this.limitTileWidthRatio = 0;
    if (KWIN.readConfig("limitTileWidth", false))
      this.limitTileWidthRatio = KWIN.readConfig("limitTileWidthRatio", 1.6);

    //***************************
    //****************** Behavior
    //***************************
    this.adjustLayout = KWIN.readConfig("adjustLayout", true);
    this.adjustLayoutLive = KWIN.readConfig("adjustLayoutLive", true);
    this.directionalKeyMode =
      validateNumberWithDefault(
        KWIN.readConfig("directionalKeyMode", 0),
        0,
        "directionalKeyMode",
      ) === 0
        ? "focus"
        : "dwm";

    this.focusNormalCfg =
      winTypesCfg[
        validateNumberWithDefault(
          KWIN.readConfig("focusNormal", 0),
          0,
          "focusNormal",
          0,
          winTypesCfg.length,
        )
      ];
    this.focusMetaCfg =
      winTypesCfg[
        validateNumberWithDefault(
          KWIN.readConfig("focusMeta", 1),
          1,
          "focusMeta",
          0,
          winTypesCfg.length,
        )
      ];

    this.focusMoveScreensNormal = KWIN.readConfig(
      "focusMoveScreensNormal",
      true,
    );
    this.focusMoveVDesktopsNormal = KWIN.readConfig(
      "focusMoveVDesktopsNormal",
      true,
    );
    this.focusMoveScreensMeta = KWIN.readConfig("focusMoveScreensMeta", false);
    this.focusMoveVDesktopsMeta = KWIN.readConfig(
      "focusMoveVDesktopsMeta",
      true,
    );
    this.movePointerOnFocus = KWIN.readConfig("movePointerOnFocus", false);
    this.defaultMetaConfig = {
      RaiseSurfaceCapacity: Shortcut.MetaResetSurfaceCapacity,
      FocusLeft: Shortcut.MetaFocusLeft,
      FocusRight: Shortcut.MetaFocusRight,
      FocusUp: Shortcut.MetaFocusUp,
      FocusDown: Shortcut.MetaFocusDown,
    };
    this.metaConf = separate(KWIN.readConfig("metaConf", ""), "\n");
    this.metaTimeout = validateNumberWithDefault(
      KWIN.readConfig("metaTimeout", 3000),
      3000,
      "metaTimeout",
      100,
      9999,
    );
    this.metaIsToggle = KWIN.readConfig("metaIsToggle", false);
    this.metaIsPushedTwice = KWIN.readConfig("metaIsPushedTwice", false);

    this.newWindowPosition =
      (["last", "first", "second"] as const)[
        validateNumberWithDefault(
          KWIN.readConfig("newWindowPosition", 0),
          0,
          "newWindowPosition",
          0,
          2,
        )
      ] ?? "last";

    //***************************
    //****************** Rules
    //***************************
    this.ignoreClass = separate(
      KWIN.readConfig(
        "ignoreClass",
        "krunner,yakuake,spectacle,kded5,xwaylandvideobridge,plasmashell,ksplashqml,org.kde.plasmashell,org.kde.polkit-kde-authentication-agent-1,org.kde.kruler,kruler,kwin_wayland,ksmserver-logout-greeter",
      ),
      ",",
    );
    this.ignoreTitle = separate(KWIN.readConfig("ignoreTitle", ""), ",");
    this.ignoreRole = separate(KWIN.readConfig("ignoreRole", "quake"), ",");
    this.ignoreActivity = separate(KWIN.readConfig("ignoreActivity", ""), ",");
    this.ignoreScreen = separate(KWIN.readConfig("ignoreScreen", ""), ",");
    this.ignoreVDesktop = separate(KWIN.readConfig("ignoreVDesktop", ""), ",");
    this.tileNothing = KWIN.readConfig("tileNothing", false);
    this.tilingClass = separate(KWIN.readConfig("tilingClass", ""), ",");

    this.screenDefaultLayout = separate(
      KWIN.readConfig("screenDefaultLayout", ""),
      ",",
    );
    //***************************
    //****************** Float
    //***************************
    // this.floatingClass = separate(KWIN.readConfig("floatingClass", ""), ",");
    // this.floatingTitle = separate(KWIN.readConfig("floatingTitle", ""), ",");
    this.floatConfig = {
      isNativeSizeOverride: KWIN.readConfig("floatDefaultSizeEnable", false),
      floatWidth: validateNumberWithDefault(
        KWIN.readConfig("floatDefaultWidth", 50),
        50,
        "floatInitWindowWidth",
        1,
        100,
      ),
      floatHeight: validateNumberWithDefault(
        KWIN.readConfig("floatDefaultHeight", 50),
        50,
        "floatInitWindowHeight",
        1,
        100,
      ),
      randomize: KWIN.readConfig("floatRandomEnable", true),
      randomWidth: validateNumberWithDefault(
        KWIN.readConfig("floatRandomWidth", 15),
        15,
        "floatRandomWidth",
        1,
        100,
      ),
      randomHeight: validateNumberWithDefault(
        KWIN.readConfig("floatRandomHeight", 15),
        15,
        "floatRandomHeight",
        1,
        100,
      ),
      sizeStepWidth: validateNumberWithDefault(
        KWIN.readConfig("floatSizeStepWidth", 6),
        6,
        "floatSizeStepWidth",
        0,
        100,
      ),
      sizeStepHeight: validateNumberWithDefault(
        KWIN.readConfig("floatSizeStepHeight", 4),
        4,
        "floatSizeStepHeight",
        0,
        100,
      ),
      config: parseFloatConfig(
        separate(KWIN.readConfig("floatConfig", ""), "\n"),
      ),
    };
    this.floatAsDefault = KWIN.readConfig("floatAsDefault", false);
    this.floatUtility = KWIN.readConfig("floatUtility", true);
    //***************************
    //****************** Dock
    //***************************
    this.dockOrder = [
      KWIN.readConfig("dockOrderLeft", 1),
      KWIN.readConfig("dockOrderTop", 2),
      KWIN.readConfig("dockOrderRight", 3),
      KWIN.readConfig("dockOrderBottom", 4),
    ];
    this.dockHHeight = KWIN.readConfig("dockHHeight", 15);
    this.dockHWide = KWIN.readConfig("dockHWide", 100);
    this.dockHGap = KWIN.readConfig("dockHGap", 0);
    this.dockHEdgeGap = KWIN.readConfig("dockHEdgeGap", 0);
    this.dockHAlignment = KWIN.readConfig("dockHAlignment", 0);
    this.dockHEdgeAlignment = KWIN.readConfig("dockHEdgeAlignment", 0);
    this.dockVHeight = KWIN.readConfig("dockVHeight", 100);
    this.dockVWide = KWIN.readConfig("dockVWide", 15);
    this.dockVEdgeGap = KWIN.readConfig("dockVEdgeGap", 0);
    this.dockVGap = KWIN.readConfig("dockVGap", 0);
    this.dockVAlignment = KWIN.readConfig("dockVAlignment", 0);
    this.dockVEdgeAlignment = KWIN.readConfig("dockVEdgeAlignment", 0);
    this.dockSurfacesConfig = separate(
      KWIN.readConfig("dockSurfacesConfig", ""),
      "\n",
    );
    this.dockWindowClassConfig = separate(
      KWIN.readConfig("dockWindowClassConfig", ""),
      "\n",
    );

    //***************************
    //****************** Options
    //***************************
    this.tiledWindowsLayer = getWindowLayer(
      KWIN.readConfig("tiledWindowsLayer", 0),
    );
    this.floatedWindowsLayer = getWindowLayer(
      KWIN.readConfig("floatedWindowsLayer", 1),
    );

    this.soleWindowDefaultProps = {
      width: validateNumberWithDefault(
        KWIN.readConfig("soleWindowWidth", 100),
        100,
        "soleWindowDefault.Width",
        1,
        100,
        true,
      ),
      height: validateNumberWithDefault(
        KWIN.readConfig("soleWindowHeight", 100),
        100,
        "soleWindowDefault.Height",
        1,
        100,
        true,
      ),

      noBorders: Boolean(KWIN.readConfig("soleWindowNoBorders", false)),
      noGaps: Boolean(KWIN.readConfig("soleWindowNoGaps", false)),
    };

    this.soleWindowOutputOverride = KWinConfig.getSoleWindowsOverriddenProps(
      KWIN.readConfig("soleWindowOutputOverride", ""),
      this.soleWindowDefaultProps,
    );

    this.unfitGreater = KWIN.readConfig("unfitGreater", true);
    this.unfitLess = KWIN.readConfig("unfitLess", true);

    this.notificationDuration = KWIN.readConfig("notificationDuration", 1000);

    this.layoutPerActivity = KWIN.readConfig("layoutPerActivity", true);
    this.layoutPerDesktop = KWIN.readConfig("layoutPerDesktop", true);
    this.noTileBorder = KWIN.readConfig("noTileBorder", false);

    this.optVKeyboardSupport = KWIN.readConfig("optVKeyboardSupport", false);

    this.keepTilingOnDrag = KWIN.readConfig("keepTilingOnDrag", true);
    this.preventMinimize = KWIN.readConfig("preventMinimize", false);
    if (this.preventMinimize && this.monocleMinimizeRest) {
      this.preventMinimize = false;
    }
    this.preventProtrusion = KWIN.readConfig("preventProtrusion", true);
    this.floatSkipPager = KWIN.readConfig("floatSkipPagerWindows", false);

    //***************************
    //****************** Log
    //***************************
    if (KWIN.readConfig("logging", false)) {
      let logParts: [LogPartition, string[]][] = [];
      let newWindowSubmodules: string[] = [];
      if (KWIN.readConfig("logNewWindows", false))
        newWindowSubmodules.push("1");
      if (KWIN.readConfig("logFilteredWindows", false))
        newWindowSubmodules.push("2");
      if (KWIN.readConfig("logUnmanagedWindows", false))
        newWindowSubmodules.push("3");
      if (newWindowSubmodules.length > 0)
        logParts.push([LogPartitions.newWindow, newWindowSubmodules]);

      if (KWIN.readConfig("logWorkspaceSignals", false)) {
        let workspaceSignalsSubmodules = separate(
          KWIN.readConfig("logWorkspaceSignalsSubmodules", ""),
          ",",
        );
        logParts.push([
          LogPartitions.workspaceSignals,
          workspaceSignalsSubmodules,
        ]);
      }
      if (KWIN.readConfig("logWindowSignals", false)) {
        let windowSignalsSubmodules = separate(
          KWIN.readConfig("logWindowSignalsSubmodules", ""),
          ",",
        );
        logParts.push([LogPartitions.windowSignals, windowSignalsSubmodules]);
      }
      if (KWIN.readConfig("logOther", false)) {
        let otherSubmodules = separate(
          KWIN.readConfig("logOtherSubmodules", ""),
          ",",
        );
        logParts.push([LogPartitions.other, otherSubmodules]);
      }
      const logFilters = KWIN.readConfig("logFilter", false)
        ? separate(KWIN.readConfig("logFilterStr", ""), ",")
        : [];
      LOG = new Logging(logParts, logFilters);
    } else LOG = undefined;
    //***************************
    //***************************
    //***************************
  }

  private static getSoleWindowsOverriddenProps(
    props: string,
    defaultProps: ISoleWindowProps,
  ): {
    [outputName: string]: ISoleWindowProps;
  } {
    let outputProps: { [outputName: string]: ISoleWindowProps } = {};
    if (props.trim() === "") {
      return outputProps;
    }
    const warn_mess = "The sole window properties cannot be overridden.";
    separate(props, ",").forEach((userOutputStr) => {
      const outputRawProps = separate(userOutputStr, ":");
      if (outputRawProps.length < 2 || outputRawProps.length > 5) {
        warning(
          `${warn_mess} Number of parts separated by colon:${outputRawProps.length} in ${outputRawProps} but have to be 2-5`,
        );
        return;
      }
      let outputParams = { ...defaultProps } as ISoleWindowProps;
      let validatedResult: number | Err;
      for (let i = 1; i < outputRawProps.length; i++) {
        if (i < 3) {
          validatedResult = validateNumber(outputRawProps[i], 1, 100, true);
        } else {
          validatedResult = validateNumber(outputRawProps[i], 0, 1);
        }
        if (validatedResult instanceof Err) {
          warning(`${warn_mess} in ${outputRawProps}. ${validatedResult}`);
          return;
        }
        switch (i) {
          case 1:
            outputParams.width = validatedResult;
            break;
          case 2: {
            outputParams.height = validatedResult;
            break;
          }
          case 3:
            outputParams.noBorders = Boolean(validatedResult);
            break;
          case 4:
            outputParams.noGaps = Boolean(validatedResult);
            break;
        }
      }
      outputProps[outputRawProps[0].trim()] = outputParams;
    });
    return outputProps;
  }

  private static getSortedLayouts(
    layoutsList: [ILayoutClass, boolean][],
  ): ISortedLayouts[] {
    let sortedLayouts: ISortedLayouts[] = [];
    for (const [idx, [layoutClass, isCapacity]] of layoutsList.entries()) {
      const orderConfigKey = `${unCapitalize(layoutClass.id)}Order`;
      if (!isValidConfigKey(orderConfigKey)) {
        warning(
          `kwinconfig: unrecognized config key "${orderConfigKey}" for layout ${layoutClass.id}, skipping layout order`,
        );
        continue;
      }
      let validatedOrder = validateNumber(
        KWIN.readConfig(orderConfigKey, idx + 1),
        0,
        12,
      );
      if (validatedOrder instanceof Err) {
        validatedOrder = idx + 1;
        warning(
          `kwinconfig: layout order for ${layoutClass.id} is invalid, using default value ${validatedOrder}`,
        );
      }
      if (validatedOrder === 0) continue;
      sortedLayouts.push({
        order: validatedOrder as number,
        layoutClass: layoutClass,
        isCapacity: isCapacity,
      });
    }
    sortedLayouts.sort((a, b) => a.order - b.order);
    if (sortedLayouts.length === 0) {
      sortedLayouts.push({
        order: 1,
        layoutClass: TileLayout,
        isCapacity: false,
      });
    }
    return sortedLayouts;
  }
  private static getLayoutOrder(sortedLayouts: ISortedLayouts[]): string[] {
    let layoutOrder: string[] = [];
    sortedLayouts.forEach(({ layoutClass }) => {
      layoutOrder.push(layoutClass.id);
    });
    return layoutOrder;
  }

  private static getLayoutFactories(sortedLayouts: ISortedLayouts[]): {
    [key: string]: () => ILayout;
  } {
    let layoutFactories: { [key: string]: () => ILayout } = {};
    for (const { layoutClass, isCapacity } of sortedLayouts) {
      if (isCapacity) {
        const capacityConfigKey = `${unCapitalize(layoutClass.id)}Capacity`;
        if (!isValidConfigKey(capacityConfigKey)) {
          warning(
            `kwinconfig: unrecognized config key "${capacityConfigKey}" for layout ${layoutClass.id}, skipping capacity config`,
          );
          layoutFactories[layoutClass.id] = () => new layoutClass(null);
          continue;
        }
        let capacity = validateNumber(
          KWIN.readConfig(capacityConfigKey, 99),
          0,
          99,
        );
        if (capacity instanceof Err) {
          warning(
            `kwinconfig: layout capacity for ${layoutClass.id} is invalid: ${capacity}`,
          );
          layoutFactories[layoutClass.id] = () => new layoutClass(null);
        } else if (capacity === 0 || capacity > 98) {
          layoutFactories[layoutClass.id] = () => new layoutClass(null);
        } else {
          layoutFactories[layoutClass.id] = () => new layoutClass(capacity);
        }
      } else {
        layoutFactories[layoutClass.id] = () => new layoutClass();
      }
    }
    return layoutFactories;
  }

  public toString(): string {
    return "Config(" + JSON.stringify(this, undefined, 2) + ")";
  }
}

// /* HACK: save casting */
var KWINCONFIG: KWinConfig;
