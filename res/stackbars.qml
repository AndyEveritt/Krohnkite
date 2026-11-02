/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15

/*
 * Keeps one tab strip on screen per stacked pane of the manual tiling layout.
 *
 * Strips are pooled rather than created and destroyed per arrange: arranges
 * run on nearly every KWin signal, and churning top-level windows at that
 * rate flickers and leaks. Surplus strips are hidden, and handed back out
 * the next time the count goes up.
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
                component = null;
                return null;
            }
        }
        var bar = component.createObject(stackBars);
        if (bar === null) {
            console.log("KROHNKITE: could not create a stack bar");
            return null;
        }
        /* One connection for the life of the strip; render() swaps the
         * handler it forwards to instead of reconnecting every time. */
        bar.tabClicked.connect(function (windowId) {
            if (stackBars.clickHandler !== null)
                stackBars.clickHandler(windowId);
        });
        pool.push(bar);
        return bar;
    }

    /* Draw exactly these strips. */
    function render(bars, onTabClicked, activeColor) {
        clickHandler = onTabClicked;
        for (var i = 0; i < bars.length; i++) {
            var bar = i < pool.length ? pool[i] : _acquire();
            if (bar !== null)
                bar.render(bars[i], activeColor);
        }
        for (var j = bars.length; j < pool.length; j++)
            pool[j].hideOverlay();
    }
}
