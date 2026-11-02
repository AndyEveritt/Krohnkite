/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import org.kde.plasma.core as PlasmaCore

/*
 * Highlights one area of the screen: the group a manual tiling selection
 * covers (hollow, until taken down), or the group a window was just moved
 * into (filled, for a moment).
 *
 * Sized to the area itself rather than to the whole output like
 * dragpreview.qml: the selection outline stays up for as long as the group is
 * selected, and wherever KWin fails to honour WindowTransparentForInput a
 * mapped dialog swallows clicks - better over one group than a whole screen.
 *
 * The cost is that KWin re-places an OSD dialog, centred on the screen,
 * whenever it is mapped or resized, and that can happen after x/y have been
 * assigned. Hence wantX/wantY and the handlers that put it back, and the
 * sizing through mainItem's implicit size: assigning the dialog's own
 * width/height would just be overwritten.
 */
PlasmaCore.Dialog {
    id: highlight

    type: PlasmaCore.Dialog.OnScreenDisplay
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowTransparentForInput | Qt.WindowDoesNotAcceptFocus
    location: PlasmaCore.Types.Floating
    outputOnly: true
    backgroundHints: PlasmaCore.Types.NoBackground
    hideOnWindowDeactivate: false

    visible: false

    /* Hollow outlines something already on screen, so it must not wash out
     * the windows underneath it. */
    property bool filled: true
    property color frameColor: Qt.rgba(0.24, 0.53, 0.94, 0.30)
    property color borderColor: Qt.rgba(0.24, 0.53, 0.94, 0.90)

    property int wantX: 0
    property int wantY: 0

    onXChanged: if (visible && x !== wantX) x = wantX;
    onYChanged: if (visible && y !== wantY) y = wantY;

    mainItem: Item {
        id: content

        Rectangle {
            anchors.fill: parent
            color: highlight.filled ? highlight.frameColor : "transparent"
            border.color: highlight.borderColor
            border.width: highlight.filled ? 2 : 3
            radius: 4
        }

        Timer {
            id: hideTimer
            repeat: false
            onTriggered: highlight.visible = false
        }
    }

    /* Named showAt/hideOverlay rather than show/hide, which are the window's
     * own methods. A duration of 0 leaves it up until hideOverlay. */
    function showAt(px, py, pw, ph, duration, isFilled, frame, border) {
        hideTimer.stop();
        if (pw <= 0 || ph <= 0) {
            hideOverlay();
            return;
        }

        filled = isFilled;
        if (frame !== undefined && frame !== "")
            frameColor = frame;
        if (border !== undefined && border !== "")
            borderColor = border;
        wantX = px;
        wantY = py;

        content.implicitWidth = pw;
        content.implicitHeight = ph;
        content.width = pw;
        content.height = ph;

        visible = true;
        x = px;
        y = py;

        if (x !== px || y !== py || width !== pw || height !== ph)
            console.log("KROHNKITE: highlight misplaced - wanted " + pw + "x" + ph
                + "+" + px + "+" + py + ", got " + width + "x" + height
                + "+" + x + "+" + y);

        if (duration > 0) {
            hideTimer.interval = duration;
            hideTimer.start();
        }
    }

    function hideOverlay() {
        hideTimer.stop();
        visible = false;
    }
}
