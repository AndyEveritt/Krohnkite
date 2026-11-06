/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

/* KWin global objects */
// declare var workspace: Workspace;
declare var KWIN: KWin;
// declare var shortcuts: IShortcuts;
declare function print(s: string): void;
// declare function readConfig(params: any): void;

interface Api {
  workspace: Workspace;
  kwin: KWin;
  shortcuts: ShortcutsQml;
  dbus: IDBusQml;
}
declare var KWINCONFIG: KWinConfig;
/* QML objects */
declare var activityInfo: Plasma.TaskManager.ActivityInfo;
declare var mousePoller: Plasma.PlasmaCore.DataSource;
declare var scriptRoot: object;

interface LayoutOSDEntry {
  id: string;
  name: string;
  icon: string;
}

interface PopupDialog {
  showNotification(text: string, duration: number): void;
  showLayouts(
    entries: LayoutOSDEntry[],
    selected: string,
    duration: number,
  ): void;
  showLayoutShortcut(entry: LayoutOSDEntry, duration: number): void;
}
declare var popupDialog: PopupDialog;

interface LayoutChooserDialog {
  showLayouts(
    entries: LayoutOSDEntry[],
    selected: string,
    duration: number,
  ): void;
  isOpen(): boolean;
  hide(): void;
  navigate(dx: number, dy: number): void;
}
declare var layoutChooserDialog: LayoutChooserDialog;

interface DragPreview {
  showRect(
    areaX: number,
    areaY: number,
    areaWidth: number,
    areaHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
    frameColor: string,
    borderColor: string,
  ): void;
  hide(): void;
}
declare var dragPreview: DragPreview;

/* Manual tiling overlays, declared in main.qml. */
interface Highlight {
  /**
   * @param duration milliseconds to stay up; 0 until `hideOverlay`.
   * @param filled false for a hollow outline.
   */
  showAt(
    x: number,
    y: number,
    width: number,
    height: number,
    duration: number,
    filled: boolean,
    frameColor: string,
    borderColor: string,
  ): void;
  hideOverlay(): void;
}
/** Outline around the manual tiling layout's selected group. */
declare var selectionOutline: Highlight;
/** Flashed over the group a window has just been moved into. */
declare var flashIndicator: Highlight;

interface StackBars {
  /** Draw exactly these strips, reusing the ones already on screen. */
  render(
    bars: IStackBar[],
    onTabClicked: (windowId: string) => void,
    activeColor: string,
  ): void;
}
declare var stackBars: StackBars;

/* Common Javascript globals */
declare let console: any;
declare let setTimeout: any;
