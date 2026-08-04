/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import org.kde.plasma.core as PlasmaCore

/*
 * Outlines an area of the screen: where a dragged window would land, or which
 * panes a group selection covers.
 *
 * A PlasmaCore.Dialog, like the OSD in popup.qml, because that is the window
 * kind KWin reliably shows for a script - a plain QtQuick Window is never
 * mapped. The catch is that a Dialog with no visualParent places *itself*,
 * centred on the screen, whenever it is shown or resized, and these have to
 * sit exactly over a pane. Hence wantX/wantY and the handlers that put it
 * back: assigning x/y once is not enough, because the re-placement can happen
 * after the assignment.
 */
PlasmaCore.Dialog {
    id: indicator

    type: PlasmaCore.Dialog.OnScreenDisplay
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowTransparentForInput
    location: PlasmaCore.Types.Floating
    outputOnly: true
    backgroundHints: PlasmaCore.Types.NoBackground

    visible: false

    /* Filled marks a landing area; hollow outlines something that is already
     * there, so it must not wash out the windows underneath it. */
    property bool filled: true

    /* Set from CONFIG.overlayColor on every call, so a config change takes
     * effect on the next overlay rather than the next session. */
    property color accent: "#5999f2"

    /* Where this was last asked to be. */
    property int wantX: 0
    property int wantY: 0
    property int wantWidth: 0
    property int wantHeight: 0

    onXChanged: if (visible && x !== wantX) x = wantX;
    onYChanged: if (visible && y !== wantY) y = wantY;

    mainItem: Item {
        id: content

        Rectangle {
            anchors.fill: parent

            color: indicator.filled
                ? Qt.rgba(indicator.accent.r, indicator.accent.g, indicator.accent.b, 0.25)
                : "transparent"
            border.color: Qt.rgba(indicator.accent.r, indicator.accent.g, indicator.accent.b, 0.9)
            border.width: indicator.filled ? 2 : 3
            radius: 4
        }

        Timer {
            id: hideTimer
            repeat: false

            onTriggered: indicator.visible = false
        }

        /* Says so in the log if the overlay did not end up where it was put.
         * Silent when everything is where it should be. */
        Timer {
            id: verifyTimer
            interval: 0
            repeat: false

            onTriggered: {
                if (!indicator.visible) return;
                if (indicator.x === indicator.wantX
                    && indicator.y === indicator.wantY
                    && indicator.width === indicator.wantWidth
                    && indicator.height === indicator.wantHeight)
                    return;
                console.log("KROHNKITE: overlay misplaced - wanted "
                    + indicator.wantWidth + "x" + indicator.wantHeight + "+"
                    + indicator.wantX + "+" + indicator.wantY + ", got "
                    + indicator.width + "x" + indicator.height + "+"
                    + indicator.x + "+" + indicator.y);
            }
        }
    }

    /* Named showAt/hideOverlay rather than show/hide: those are the window's
     * own methods, and shadowing them from QML is asking for trouble.
     *
     * A duration of 0 leaves it up until hideOverlay - that is the drag case,
     * where the indicator tracks the cursor for as long as the drag lasts. */
    function showAt(px, py, pw, ph, duration, isFilled, accentColor) {
        hideTimer.stop();

        indicator.filled = isFilled === undefined ? true : isFilled;
        if (accentColor !== undefined && accentColor !== "")
            indicator.accent = accentColor;
        indicator.wantX = px;
        indicator.wantY = py;
        indicator.wantWidth = pw;
        indicator.wantHeight = ph;

        /* The dialog takes its size from mainItem, so this is what resizes the
         * window - assigning indicator.width would just be overwritten. */
        content.implicitWidth = pw;
        content.implicitHeight = ph;
        content.width = pw;
        content.height = ph;

        indicator.visible = true;
        indicator.x = px;
        indicator.y = py;

        verifyTimer.restart();

        if (duration > 0) {
            hideTimer.interval = duration;
            hideTimer.start();
        }
    }

    function hideOverlay() {
        hideTimer.stop();
        indicator.visible = false;
    }
}
