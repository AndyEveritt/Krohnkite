/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import QtQuick.Controls 2.15
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

/*
 * Interactive layout chooser.
 *
 * This is a separate dialog from popup.qml on purpose: the notification popup
 * is an input-transparent on-screen display, while the chooser must receive
 * mouse clicks without triggering KWin's own window-drag action.
 */
PlasmaCore.Dialog {
    id: chooserDialog
    type: PlasmaCore.Dialog.Normal
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
    location: PlasmaCore.Types.Floating
    outputOnly: false

    visible: false
    property var layouts: []
    property string selectedLayout: ""
    readonly property int layoutCardWidth: 150
    readonly property int layoutCardHeight: 96
    readonly property int layoutSpacing: 10
    property int layoutColumns: 1

    signal layoutSelected(string id)

    mainItem: FocusScope {
        id: chooserItem
        width: layoutGrid.width + 24
        height: layoutGrid.height + 24
        focus: true

        Keys.onEscapePressed: chooserDialog.visible = false

        Shortcut {
            sequence: "Escape"
            onActivated: chooserDialog.visible = false
        }

        /* Clicking the padding around the grid dismisses the chooser. */
        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.LeftButton
            onClicked: chooserDialog.visible = false
        }

        Grid {
            id: layoutGrid
            anchors.centerIn: parent
            z: 1
            columns: chooserDialog.layoutColumns
            spacing: chooserDialog.layoutSpacing
            width: columns * chooserDialog.layoutCardWidth + (columns - 1) * spacing
            height: Math.max(0, Math.ceil(chooserDialog.layouts.length / Math.max(1, columns)) * chooserDialog.layoutCardHeight
                + (Math.max(1, Math.ceil(chooserDialog.layouts.length / Math.max(1, columns))) - 1) * spacing)

            Repeater {
                model: chooserDialog.layouts

                delegate: Rectangle {
                    id: layoutCard
                    required property var modelData

                    objectName: "layoutCard-" + modelData.id
                    width: chooserDialog.layoutCardWidth
                    height: chooserDialog.layoutCardHeight
                    radius: 8
                    color: modelData.id === chooserDialog.selectedLayout
                        ? Kirigami.Theme.highlightColor
                        : Kirigami.Theme.alternateBackgroundColor
                    border.width: modelData.id === chooserDialog.selectedLayout ? 2 : 1
                    border.color: modelData.id === chooserDialog.selectedLayout
                        ? Kirigami.Theme.highlightColor
                        : Kirigami.Theme.disabledTextColor

                    Column {
                        anchors.centerIn: parent
                        width: parent.width - 16
                        spacing: 6

                        Image {
                            anchors.horizontalCenter: parent.horizontalCenter
                            source: Qt.resolvedUrl("layouts/" + layoutCard.modelData.icon + ".svg")
                            width: 64
                            height: 38
                            fillMode: Image.PreserveAspectFit
                            sourceSize.width: 128
                            sourceSize.height: 76
                        }

                        Label {
                            width: parent.width
                            text: layoutCard.modelData.name
                            horizontalAlignment: Text.AlignHCenter
                            elide: Text.ElideRight
                            font.bold: layoutCard.modelData.id === chooserDialog.selectedLayout
                            color: layoutCard.modelData.id === chooserDialog.selectedLayout
                                ? Kirigami.Theme.highlightedTextColor
                                : Kirigami.Theme.textColor
                        }
                    }

                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            chooserDialog.layoutSelected(layoutCard.modelData.id);
                            chooserDialog.visible = false;
                        }
                    }
                }
            }
        }
    }

    function layoutColumnsFor(count, area) {
        const maxByWidth = Math.min(4, Math.floor((area.width - 32) / (layoutCardWidth + layoutSpacing)));
        return Math.max(1, Math.min(Math.max(1, count), maxByWidth));
    }

    function center(area) {
        const width = mainItem.width;
        const height = mainItem.height;
        this.x = area.x + (area.width - width) / 2;
        this.y = area.y + (area.height - height) / 2;
        Qt.callLater(function() {
            chooserDialog.x = area.x + (area.width - chooserDialog.width) / 2;
            chooserDialog.y = area.y + (area.height - chooserDialog.height) / 2;
        });
    }

    function showLayouts(entries, selected, area) {
        layouts = entries;
        selectedLayout = selected;
        layoutColumns = layoutColumnsFor(entries.length, area);

        center(area);
        visible = true;
        chooserItem.forceActiveFocus();
    }
}
