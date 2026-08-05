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
  shortcuts: IShortcuts;
  dbus: IDBusQml;
}
declare var KWINCONFIG: KWinConfig;
/* QML objects */
declare var activityInfo: Plasma.TaskManager.ActivityInfo;
declare var mousePoller: Plasma.PlasmaCore.DataSource;
declare var scriptRoot: object;

interface PopupDialog {
  showNotification(text: string, duration: number): void;
}
declare var popupDialog: PopupDialog;

interface DropIndicator {
  /**
   * @param duration 0 leaves it up until `hide`.
   * @param filled true for a landing area, false for an outline around
   * something that is already on screen.
   */
  showAt(
    x: number,
    y: number,
    width: number,
    height: number,
    duration: number,
    filled: boolean,
    accentColor: string,
  ): void;
  hideOverlay(): void;
}
declare var dropIndicator: DropIndicator;
/** A second DropIndicator: the outline around the current group selection. */
declare var selectionOutline: DropIndicator;
/** A third DropIndicator: flashed around the group a move just landed in. */
declare var groupIndicator: DropIndicator;

interface StackBars {
  /** Draw exactly these strips, reusing what is already on screen. */
  render(
    bars: IStackBar[],
    onTabClicked: (windowId: string) => void,
    accentColor: string,
  ): void;
}
declare var stackBars: StackBars;

/* Common Javascript globals */
declare let console: any;
declare let setTimeout: any;
