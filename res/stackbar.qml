/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import QtQuick.Controls 2.15
import org.kde.plasma.core as PlasmaCore

/*
 * The tab strip across the top of one stacked pane.
 *
 * A PlasmaCore.Dialog, like highlight.qml, because that is the window kind
 * KWin reliably shows for a script - a plain QtQuick Window is never mapped -
 * and it fights the same automatic re-placement, since it has to sit exactly
 * along the top of its pane.
 *
 * Unlike the highlight it takes clicks, so it is not outputOnly. It stays an
 * OnScreenDisplay all the same: that keeps KWin from reporting it as a normal
 * window, which would have Krohnkite try to tile its own chrome.
 */
PlasmaCore.Dialog {
    id: stackBar

    type: PlasmaCore.Dialog.OnScreenDisplay
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus
    location: PlasmaCore.Types.Floating
    outputOnly: false
    backgroundHints: PlasmaCore.Types.NoBackground
    hideOnWindowDeactivate: false

    visible: false

    /* Emitted with the window id of the tab that was clicked. */
    signal tabClicked(string windowId)

    property int wantX: 0
    property int wantY: 0
    property color activeColor: Qt.rgba(0.24, 0.53, 0.94, 0.90)

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
                        width: Math.floor((tabRow.width - (tabRepeater.count - 1)) / Math.max(1, tabRepeater.count))
                        color: modelData.active ? stackBar.activeColor : Qt.rgba(0.16, 0.16, 0.16, 0.95)

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

    function render(bar, color) {
        if (color !== undefined && color !== "")
            activeColor = color;
        tabRepeater.model = bar.tabs;

        wantX = bar.x;
        wantY = bar.y;
        content.implicitWidth = bar.width;
        content.implicitHeight = bar.height;
        content.width = bar.width;
        content.height = bar.height;

        visible = true;
        x = bar.x;
        y = bar.y;

        if (x !== bar.x || y !== bar.y || width !== bar.width || height !== bar.height)
            console.log("KROHNKITE: stack bar misplaced - wanted " + bar.width + "x" + bar.height
                + "+" + bar.x + "+" + bar.y + ", got " + width + "x" + height + "+" + x + "+" + y);
    }

    function hideOverlay() {
        visible = false;
    }
}
