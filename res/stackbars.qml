/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15

/*
 * Keeps one tab strip on screen per stacked pane.
 *
 * The strips are pooled rather than created and destroyed per arrange: the
 * engine re-arranges on nearly every KWin signal, and churning top-level
 * windows at that rate flickers and leaks. Surplus strips are just hidden and
 * handed back out next time the count goes up.
 */
Item {
    id: stackBars

    property var pool: []
    property var component: null
    property var clickHandler: null

    function _acquire() {
        if (component === null) {
            component = Qt.createComponent("stackbar.qml");
            if (component.status !== Component.Ready) {
                console.log("KROHNKITE: stackbar.qml failed to load: " + component.errorString());
                return null;
            }
        }
        var bar = component.createObject(stackBars);
        if (bar === null) {
            console.log("KROHNKITE: could not create a stack bar");
            return null;
        }
        /* One connection for the life of the object; the handler it forwards
         * to is swapped out by render() instead of reconnecting each time. */
        bar.tabClicked.connect(function (windowId) {
            if (stackBars.clickHandler !== null)
                stackBars.clickHandler(windowId);
        });
        pool.push(bar);
        return bar;
    }

    function render(bars, onTabClicked, accentColor) {
        clickHandler = onTabClicked;

        for (var i = 0; i < bars.length; i++) {
            var bar = i < pool.length ? pool[i] : _acquire();
            if (bar === null) continue;
            bar.render(bars[i], accentColor);
        }
        for (var j = bars.length; j < pool.length; j++)
            pool[j].hideOverlay();
    }
}
