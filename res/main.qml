/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import org.kde.plasma.core as PlasmaCore;
import org.kde.plasma.components as Plasma;
import org.kde.plasma.plasma5support as Plasma5Support
import org.kde.kwin 3.0;
import org.kde.taskmanager as TaskManager
import "../code/script.js" as K

Item {
    id: scriptRoot

    TaskManager.ActivityInfo {
        id: activityInfo
    }

    Loader {
        id: popupDialog
        source: "popup.qml"

        function showNotification(text, duration) {
            var area = Workspace.clientArea(KWin.FullScreenArea, Workspace.activeScreen, Workspace.currentDesktop);
            this.item.show(text, area, duration);
        }
    }

    Loader {
        id: dropIndicator
        source: "dropindicator.qml"

        /* A component that fails to load leaves item null and the overlay
         * simply never appears, with nothing to say why. Say why. */
        onStatusChanged: {
            if (status === Loader.Error)
                console.log("KROHNKITE: dropindicator.qml failed to load");
        }

        function showAt(x, y, width, height, duration, filled, accentColor) {
            if (this.item) this.item.showAt(x, y, width, height, duration, filled, accentColor);
            else console.log("KROHNKITE: drop indicator not loaded");
        }

        function hideOverlay() {
            if (this.item) this.item.hideOverlay();
        }
    }

    /* Same component as the drop indicator, but hollow and long-lived: it
     * outlines the group the manual layout's commands are aimed at. */
    Loader {
        id: selectionOutline
        source: "dropindicator.qml"

        onStatusChanged: {
            if (status === Loader.Error)
                console.log("KROHNKITE: selection outline failed to load");
        }

        function showAt(x, y, width, height, duration, filled, accentColor) {
            if (this.item) this.item.showAt(x, y, width, height, duration, filled, accentColor);
        }

        function hideOverlay() {
            if (this.item) this.item.hideOverlay();
        }
    }

    /* Same component again, filled and short-lived: it flashes over the group
     * a window has just been moved into. Separate from the selection outline
     * because both can be up at once - the moved window's group is not always
     * the group the commands are aimed at. */
    Loader {
        id: groupIndicator
        source: "dropindicator.qml"

        onStatusChanged: {
            if (status === Loader.Error)
                console.log("KROHNKITE: group indicator failed to load");
        }

        function showAt(x, y, width, height, duration, filled, accentColor) {
            if (this.item) this.item.showAt(x, y, width, height, duration, filled, accentColor);
        }

        function hideOverlay() {
            if (this.item) this.item.hideOverlay();
        }
    }

    Loader {
        id: stackBars
        source: "stackbars.qml"

        onStatusChanged: {
            if (status === Loader.Error)
                console.log("KROHNKITE: stackbars.qml failed to load");
        }

        function render(bars, onTabClicked, accentColor) {
            if (this.item) this.item.render(bars, onTabClicked, accentColor);
            else if (bars.length > 0)
                console.log("KROHNKITE: stack bars not loaded");
        }
    }

    Component.onCompleted: {
        console.log("KROHNKITE: starting the script");
        const api = {
            "workspace": Workspace,
            // "options": Options,
            "kwin": KWin,
            "shortcuts": shortcutsLoader.item,
            "dbus": dbusCallLoader.item
        };

        (new K.KWinDriver(api)).main();
    }
    Loader {
        id: shortcutsLoader;

        source: "shortcuts.qml";
    }

    Loader {
        id: dbusCallLoader;

        source: "dbus.qml"
    }
}
