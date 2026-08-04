/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import QtQuick.Controls 2.15
import org.kde.plasma.core as PlasmaCore

/*
 * The tab strip above one stacked pane.
 *
 * A PlasmaCore.Dialog for the same reason as the drop indicator - it is the
 * window kind KWin shows for a script - and it fights the same automatic
 * re-placement, since it has to sit exactly along the top of its pane.
 *
 * Unlike the indicator this one takes clicks, so it is not outputOnly. It
 * stays an OnScreenDisplay all the same: that is what keeps KWin from
 * reporting it as a normal window, which would have Krohnkite try to tile its
 * own chrome.
 */
PlasmaCore.Dialog {
    id: stackBar

    type: PlasmaCore.Dialog.OnScreenDisplay
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus
    location: PlasmaCore.Types.Floating
    outputOnly: false
    backgroundHints: PlasmaCore.Types.NoBackground

    visible: false

    /* Called with the window id of the tab that was clicked. */
    signal tabClicked(string windowId)

    property int wantX: 0
    property int wantY: 0

    onXChanged: if (visible && x !== wantX) x = wantX;
    onYChanged: if (visible && y !== wantY) y = wantY;

    mainItem: Item {
        id: content

        Rectangle {
            anchors.fill: parent
            color: Qt.rgba(0, 0, 0, 0.55)

            Row {
                id: tabRow
                anchors.fill: parent
                spacing: 1

                Repeater {
                    id: tabRepeater
                    model: []

                    delegate: Rectangle {
                        height: tabRow.height
                        width: tabRepeater.count > 0
                            ? Math.floor((tabRow.width - (tabRepeater.count - 1)) / tabRepeater.count)
                            : tabRow.width

                        color: modelData.active
                            ? Qt.rgba(0.35, 0.6, 0.95, 0.95)
                            : Qt.rgba(0.16, 0.16, 0.16, 0.95)

                        Label {
                            anchors.fill: parent
                            anchors.leftMargin: 8
                            anchors.rightMargin: 8

                            text: modelData.title
                            elide: Text.ElideRight
                            verticalAlignment: Text.AlignVCenter
                            font.pointSize: 9
                            font.weight: modelData.active ? Font.Bold : Font.Normal
                            color: "white"
                        }

                        MouseArea {
                            anchors.fill: parent
                            onClicked: stackBar.tabClicked(modelData.id)
                        }
                    }
                }
            }
        }
    }

    function render(bar) {
        tabRepeater.model = bar.tabs;

        stackBar.wantX = bar.x;
        stackBar.wantY = bar.y;

        content.implicitWidth = bar.width;
        content.implicitHeight = bar.height;
        content.width = bar.width;
        content.height = bar.height;

        stackBar.visible = true;
        stackBar.x = bar.x;
        stackBar.y = bar.y;

        if (stackBar.x !== bar.x || stackBar.y !== bar.y
            || stackBar.width !== bar.width || stackBar.height !== bar.height)
            console.log("KROHNKITE: stack bar misplaced - wanted "
                + bar.width + "x" + bar.height + "+" + bar.x + "+" + bar.y
                + ", got " + stackBar.width + "x" + stackBar.height
                + "+" + stackBar.x + "+" + stackBar.y);
    }

    function hideOverlay() {
        stackBar.visible = false;
    }
}
