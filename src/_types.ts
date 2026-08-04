/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

type percentType = number;
type Direction = "up" | "down" | "left" | "right";
type Position = "left" | "middle" | "right" | "upper" | "bottom" | "single";
function getOppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case "right":
      return "left";
    case "left":
      return "right";
    case "up":
      return "down";
    case "down":
      return "up";
  }
}

const ArrangeReason = {
  forcedArrangeScreen: "forcedArrangeScreen",
  moveWindowToOutput: "moveWindowToOutput",
  transferWindowToVDesktop: "transferWindowToVDesktop",
  sendToOutputProcessFinish: "sendToOutputProcessFinish",
  manageDock: "manageDock",
  outputChangedCB: "outputChangedCB",
  activitiesChangedCB: "activitiesChangedCB",
  screensChangedCB: "screensChangedCB",
  virtualScreenGeometryChangedCB: "virtualScreenGeometryChangedCB",
  currentDesktopChangedCB: "currentDesktopChangedCB",
  windowRemovedCB: "windowRemovedCB",
  currentActivityChangedCB: "currentActivityChangedCB",
  windowAdded: "windowAdded",
  windowDesktopsChangedCB: "windowDesktopsChangedCB",
  windowFullScreenChangedCB: "windowFullScreenChangedCB",
  windowMinimizedChangedCB: "windowMinimizedChangedCB",
  windowSkipPagerCB: "windowSkipPagerCB",
  windowInteractiveMoveResizeSteppedCB: "WindowInteractiveMoveResizeSteppedCB",
  windowMoveResizedChangedCB: "windowMoveResizedChangedCB",
  windowBufferGeometryChangedCB: "windowBufferGeometryChangedCB",
  windowMaximizeAboutChangeCB: "windowMaximizeAboutChangeCB",
  shortcutCB: "shortcutCB",
  shortcutLayoutCB: "shortcutLayoutCB",
  migrateGroup: "migrateGroup",
  stackBarCB: "stackBarCB",
};
type ArrangeReason = (typeof ArrangeReason)[keyof typeof ArrangeReason];

const WindowState = {
  /* initial value */
  Unmanaged: "Unmanaged",

  /* script-external state - overrides internal state */
  NativeFullscreen: "NativeFullscreen",
  NativeMaximized: "NativeMaximized",

  /* script-internal state */
  Floating: "Floating",
  Maximized: "Maximized",
  Tiled: "Tiled",
  TiledAfloat: "TiledAfloat",
  Undecided: "Undecided",
  Dragging: "Dragging",
  Docked: "Docked",
};
type WindowState = (typeof WindowState)[keyof typeof WindowState];

const Shortcut = {
  FocusNext: "FocusNext",
  FocusPrev: "FocusPrev",
  DWMLeft: "DWMLeft",
  DWMRight: "DWMRight",

  FocusUp: "FocusUp",
  FocusDown: "FocusDown",
  FocusLeft: "FocusLeft",
  FocusRight: "FocusRight",

  ShiftLeft: "ShiftLeft",
  ShiftRight: "ShiftRight",
  ShiftUp: "ShiftUp",
  ShiftDown: "ShiftDown",

  SwapUp: "SwapUp",
  SwapDown: "SwapDown",
  SwapLeft: "SwapLeft",
  SwapRight: "SwapRight",

  GrowWidth: "GrowWidth",
  GrowHeight: "GrowHeight",
  ShrinkWidth: "ShrinkWidth",
  ShrinkHeight: "ShrinkHeight",

  Increase: "Increase",
  Decrease: "Decrease",
  ShiftIncrease: "ShiftIncrease", //NOTE: unused shortcut
  ShiftDecrease: "ShiftDecrease", //NOTE: unused shortcut

  ToggleFloat: "ToggleFloat",
  ToggleFloatAll: "ToggleFloatAll",
  SetMaster: "SetMaster",
  NextLayout: "NextLayout",
  PreviousLayout: "PreviousLayout",
  SetLayout: "SetLayout",

  Rotate: "Rotate",
  RotatePart: "RotatePart",

  SplitHorizontal: "SplitHorizontal",
  SplitVertical: "SplitVertical",

  /* Manual tiling: widen/narrow the subtree the directional moves act on. */
  GroupGrow: "GroupGrow",
  GroupShrink: "GroupShrink",

  /* Manual tiling: tabbed panes. */
  ToggleStack: "ToggleStack",
  StackNext: "StackNext",
  StackPrev: "StackPrev",


  ToggleDock: "ToggleDock",

  RaiseSurfaceCapacity: "RaiseSurfaceCapacity",
  LowerSurfaceCapacity: "LowerSurfaceCapacity",

  KrohnkiteMeta: "KrohnkiteMeta",

  MetaResetSurfaceCapacity: "MetaResetSurfaceCapacity",
  MetaFocusLeft: "MetaFocusLeft",
  MetaFocusRight: "MetaFocusRight",
  MetaFocusUp: "MetaFocusUp",
  MetaFocusDown: "MetaFocusDown",
} as const;
type Shortcut = (typeof Shortcut)[keyof typeof Shortcut];

// Logging
const LogModules = {
  newWindowAdded: "newWindowAdded",
  newWindowFiltered: "newWindowFiltered",
  newWindowUnmanaged: "newWindowUnmanaged",

  screensChanged: "screensChanged",
  virtualScreenGeometryChanged: "virtualScreenGeometryChanged",
  currentActivityChanged: "currentActivityChanged",
  currentDesktopChanged: "currentDesktopChanged",
  windowAdded: "windowAdded",
  windowActivated: "windowActivated",
  windowRemoved: "windowRemoved",
  surfaceChanged: "surfaceChanged",

  activitiesChanged: "activitiesChanged",
  bufferGeometryChanged: "bufferGeometryChanged",
  desktopsChanged: "desktopsChanged",
  fullScreenChanged: "fullScreenChanged",
  interactiveMoveResizeStepped: "interactiveMoveResizeStepped",
  maximizedAboutToChange: "maximizedAboutToChange",
  minimizedChanged: "minimizedChanged",
  moveResizedChanged: "moveResizedChanged",
  outputChanged: "outputChanged",
  shortcut: "shortcut",
  arrangeScreen: "arrangeScreen",
  printConfig: "printConfig",
  setTimeout: "setTimeout",
  window: "window",
  dbus: "dbus",
};
type LogModule = (typeof LogModules)[keyof typeof LogModules];

const LogPartitions = {
  newWindow: {
    number: 100,
    name: "newWindow",
    modules: [
      LogModules.newWindowAdded,
      LogModules.newWindowFiltered,
      LogModules.newWindowUnmanaged,
    ],
  },
  workspaceSignals: {
    number: 200,
    name: "workspaceSignal",
    modules: [
      LogModules.screensChanged,
      LogModules.virtualScreenGeometryChanged,
      LogModules.currentActivityChanged,
      LogModules.currentDesktopChanged,
      LogModules.windowAdded,
      LogModules.windowActivated,
      LogModules.windowRemoved,
      LogModules.surfaceChanged,
    ],
  },
  windowSignals: {
    number: 300,
    name: "windowSignal",
    modules: [
      LogModules.activitiesChanged,
      LogModules.bufferGeometryChanged,
      LogModules.desktopsChanged,
      LogModules.fullScreenChanged,
      LogModules.interactiveMoveResizeStepped,
      LogModules.maximizedAboutToChange,
      LogModules.minimizedChanged,
      LogModules.moveResizedChanged,
      LogModules.outputChanged,
    ],
  },
  other: {
    number: 1000,
    name: "other",
    modules: [
      LogModules.shortcut,
      LogModules.arrangeScreen,
      LogModules.printConfig,
      LogModules.setTimeout,
      LogModules.window,
      LogModules.dbus,
    ],
  },
} as const;
type LogPartition = (typeof LogPartitions)[keyof typeof LogPartitions];
