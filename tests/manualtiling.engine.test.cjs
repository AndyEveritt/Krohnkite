/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/**
 * The engine and controller plumbing ManualTilingLayout relies on: overlays
 * pulled from the layouts after an arrange or a focus change, the drop hook
 * at the end of a drag, the drag preview a layout points at, and a group
 * following its window to another surface.
 *
 * The engine and controller are built with Object.create, the same way the
 * layout chooser tests build them, so only the methods under test run.
 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
}

const SOURCE = [
  "src/util/rect.ts",
  "src/engine/enginecontext.ts",
  "src/engine/engine.ts",
  "src/engine/control.ts",
]
  .map(transpile)
  .join("\n");

/**
 * Evaluate the engine and controller with a stand-in ManualTilingLayout, and
 * run `body` against them.
 */
function scene(body) {
  const context = vm.createContext({
    CONFIG: {
      movePointerOnFocus: false,
      keepTilingOnDrag: true,
      moveFlash: true,
    },
    KrohnkiteAction: new Proxy({}, { get: (_t, action) => String(action) }),
    WindowState: {
      Tiled: "Tiled",
      Floating: "Floating",
      Docked: "Docked",
      NativeFullscreen: "NativeFullscreen",
      NativeMaximized: "NativeMaximized",
      Maximized: "Maximized",
    },
    RectParts: { Whole: 4 },
    getMethodName: () => "test",
    getTime: () => 0,
    warning: () => {},
    toRect: (r) => r,
  });
  vm.runInContext(
    `${SOURCE}
    class ManualTilingLayout {}
    this.__api = {
      TilingEngine, TilingController, ManualTilingLayout, Rect, CONFIG,
    };`,
    context,
  );
  const api = context.__api;

  const calls = [];
  const engine = Object.create(api.TilingEngine.prototype);
  engine._arranging = false;
  engine._batchDepth = 0;
  engine.arrange = (_ctx, reason) => calls.push(["arrange", reason]);

  const surfaces = {};
  const surface = (id) =>
    surfaces[id] ||
    (surfaces[id] = {
      id,
      output: { name: id.split("#")[0], geometry: { x: 0, y: 0 } },
      vDesktop: { id: id.split("#")[1] },
      layout: null,
      windows: [],
    });
  engine.layouts = {
    getCurrentLayout: (srf) => srf.layout,
    allCurrentLayouts: () =>
      Object.values(surfaces)
        .map((srf) => srf.layout)
        .filter(Boolean),
  };
  engine.windows = {
    getVisibleWindows: (srf) => srf.windows,
    getWindowById: (id) =>
      Object.values(surfaces)
        .flatMap((srf) => srf.windows)
        .find((window) => window.id === id) || null,
  };
  engine.docks = { finishDrag: () => {} };

  const controller = Object.create(api.TilingController.prototype);
  controller.engine = engine;
  controller.dragAction = null;

  const ctx = {
    currentSurfaces: [],
    currentWindow: null,
    drawOverlays: (overlays) =>
      calls.push(["draw", JSON.parse(JSON.stringify(overlays))]),
    showDragPreview: (area, rect) =>
      calls.push(["preview", [rect.x, rect.y, rect.width, rect.height]]),
    hideDragPreview: () => calls.push(["hidePreview"]),
    flashArea: (rect) =>
      calls.push(["flash", [rect.x, rect.y, rect.width, rect.height]]),
    moveWindowsToSurface: (windows, srf) =>
      calls.push(["moveTo", windows.map((w) => w.id), srf.id]),
    setTimeout: () => calls.push(["refocusLater"]),
  };

  const tiled = (id) => ({
    id,
    state: "Tiled",
    isTiled: true,
    geometry: new api.Rect(0, 0, 100, 100),
    isAlive: () => true,
  });
  return body({ api, engine, controller, ctx, calls, surface, tiled });
}

/** A layout that draws one stack bar labelled `label`. */
function drawingLayout(label) {
  return {
    overlays: () => ({
      stackBars: [{ x: 0, y: 0, width: 1, height: 1, tabs: [{ id: label }] }],
      selection: null,
    }),
  };
}

test("overlays are drawn for every surface on screen, and only those", () => {
  scene(({ engine, ctx, calls, surface, tiled }) => {
    const left = surface("left#1");
    const hidden = surface("left#2");
    const right = surface("right#1");
    left.layout = drawingLayout("left");
    hidden.layout = drawingLayout("hidden");
    right.layout = drawingLayout("right");
    [left, hidden, right].forEach((srf) => srf.windows.push(tiled(srf.id)));
    ctx.currentSurfaces = [left, right];

    engine.renderOverlays(ctx);
    assert.deepEqual(
      calls[0][1].stackBars.map((bar) => bar.tabs[0].id),
      ["left", "right"],
    );
  });
});

test("nothing is drawn over a fullscreen window or an empty surface", () => {
  scene(({ engine, ctx, calls, surface, tiled }) => {
    const full = surface("full#1");
    const empty = surface("empty#1");
    full.layout = drawingLayout("full");
    empty.layout = drawingLayout("empty");
    full.windows.push(tiled("a"), { id: "b", state: "NativeFullscreen" });
    ctx.currentSurfaces = [full, empty];

    engine.renderOverlays(ctx);
    assert.deepEqual(calls, [["draw", { stackBars: [], selection: null }]]);
  });
});

test("overlays wait for an arrange in progress to finish", () => {
  scene(({ engine, ctx, calls }) => {
    engine._arranging = true;
    engine.renderOverlays(ctx);
    engine._arranging = false;
    engine._batchDepth = 1;
    engine.renderOverlays(ctx);
    assert.deepEqual(calls, []);
  });
});

test("a focus change redraws the overlays without arranging", () => {
  scene(({ controller, ctx, calls, surface, tiled }) => {
    const srf = surface("out#1");
    srf.layout = drawingLayout("tab");
    srf.windows.push(tiled("a"));
    ctx.currentSurfaces = [srf];

    controller.onWindowFocused(ctx, srf.windows[0]);
    assert.deepEqual(
      calls.map(([kind]) => kind),
      ["draw"],
    );
  });
});

test("a layout's drop runs before the drag is torn down, then the engine arranges", () => {
  scene(({ controller, ctx, calls, surface, tiled }) => {
    const srf = surface("out#1");
    const window = tiled("a");
    srf.layout = {
      drag: () => {},
      drop: (_ctx, dragAction) =>
        calls.push(["drop", dragAction.window.id, window.isDragging]),
    };
    window.isAlive = () => true;
    window.isDragging = true;
    controller.dragAction = {
      window,
      srf,
      initialState: "Tiled",
      initialGeometry: window.geometry.clone(),
      isLayoutHasDragStep: true,
    };

    controller.onWindowMoveOver(ctx, window, "moveOver");
    assert.deepEqual(calls, [
      ["drop", "a", false],
      ["hidePreview"],
      ["arrange", "moveOver"],
    ]);
    assert.equal(controller.dragAction, null);
  });
});

test("the drag preview shows where a layout says the window would land", () => {
  scene(({ api, controller, ctx, calls, surface, tiled }) => {
    controller.dragAction = {
      window: tiled("a"),
      srf: surface("out#1"),
      dockTarget: null,
      previewRect: new api.Rect(10, 20, 30, 40),
    };
    controller.updateDragPreview(ctx);
    assert.deepEqual(calls, [["preview", [10, 20, 30, 40]]]);
  });
});

test("a group follows its window to another surface and the source re-tiles", () => {
  scene(({ api, engine, ctx, calls, surface, tiled }) => {
    const source = surface("left#1");
    const target = surface("right#1");
    const group = { name: "group" };
    const moved = tiled("a");
    moved.surface = target;
    moved.isAlive = () => true;
    const follower = tiled("b");
    follower.surface = source;
    source.windows.push(follower);
    target.windows.push(moved);

    source.layout = Object.assign(
      Object.create(api.ManualTilingLayout.prototype),
      {
        groupFollowerIds: (id) => (id === "a" ? ["b"] : null),
        takeGroup: () => group,
      },
    );
    target.layout = Object.assign(
      Object.create(api.ManualTilingLayout.prototype),
      {
        groupFollowerIds: () => null,
        graft: (subtree) => calls.push(["graft", subtree.name]),
      },
    );

    assert.equal(engine.followGroupMove(ctx, moved), source);
    assert.deepEqual(calls, [
      ["moveTo", ["b"], "right#1"],
      ["graft", "group"],
      ["refocusLater"],
    ]);
  });
});

test("a group is not taken while its window has yet to leave", () => {
  scene(({ api, engine, ctx, calls, surface, tiled }) => {
    const here = surface("left#1");
    const moved = tiled("a");
    const follower = tiled("b");
    moved.surface = here;
    follower.surface = here;
    here.windows.push(moved, follower);
    here.layout = Object.assign(
      Object.create(api.ManualTilingLayout.prototype),
      {
        groupFollowerIds: () => ["b"],
        takeGroup: () => {
          throw new Error("taken too early");
        },
      },
    );

    assert.equal(engine.followGroupMove(ctx, moved), null);
    assert.deepEqual(calls, []);
  });
});

test("nothing is drawn over a maximized window", () => {
  scene(({ engine, ctx, calls, surface, tiled }) => {
    const srf = surface("out#1");
    srf.layout = drawingLayout("tab");
    srf.windows.push(tiled("a"), { id: "b", state: "NativeMaximized" });
    ctx.currentSurfaces = [srf];

    engine.renderOverlays(ctx);
    assert.deepEqual(calls, [["draw", { stackBars: [], selection: null }]]);
  });
});

test("a group sent to another desktop does not pull the focus after it", () => {
  scene(({ api, engine, ctx, calls, surface, tiled }) => {
    /* Asked first, and has nothing to hand over: passed by, not the end of
       the search. */
    surface("other#1").layout = Object.assign(
      Object.create(api.ManualTilingLayout.prototype),
      { groupFollowerIds: () => ["gone"] },
    );
    const source = surface("out#1");
    const target = surface("out#2");
    const moved = tiled("a");
    moved.surface = target;
    const follower = tiled("b");
    follower.surface = source;
    source.windows.push(follower);
    target.windows.push(moved);
    source.layout = Object.assign(
      Object.create(api.ManualTilingLayout.prototype),
      { groupFollowerIds: () => ["b"], takeGroup: () => ({}) },
    );

    assert.equal(engine.followGroupMove(ctx, moved), source);
    assert.deepEqual(calls, [["moveTo", ["b"], "out#2"]]);
  });
});

//#region Move flash

/** A surface on screen holding `window`, under `layout`. */
function flashScene(body) {
  return scene((world) => {
    const srf = world.surface("out#1");
    const window = world.tiled("a");
    window.surface = srf;
    srf.windows.push(window);
    world.ctx.currentSurfaces = [srf];
    const before = window.geometry.clone();
    window.geometry = new world.api.Rect(50, 0, 50, 100);
    return body({ ...world, srf, window, before });
  });
}

test("a move is flashed where the layout says it landed", () => {
  flashScene(({ api, engine, ctx, calls, srf, window, before }) => {
    srf.layout = { flashArea: () => new api.Rect(0, 0, 100, 100) };
    engine.flashMove(ctx, window, before);
    assert.deepEqual(calls, [["flash", [0, 0, 100, 100]]]);
  });
});

test("a layout with no say in it gets the moved tile flashed", () => {
  flashScene(({ engine, ctx, calls, srf, window, before }) => {
    srf.layout = {};
    engine.flashMove(ctx, window, before);
    assert.deepEqual(calls, [["flash", [50, 0, 50, 100]]]);
  });
});

test("nothing is flashed when it is turned off, or nothing moved", () => {
  flashScene(({ api, engine, ctx, calls, srf, window, before }) => {
    srf.layout = { flashArea: () => new api.Rect(0, 0, 100, 100) };
    engine.flashMove(ctx, window, window.geometry.clone());
    assert.deepEqual(calls, [], "the tile did not change");

    ctx.currentSurfaces = [];
    engine.flashMove(ctx, window, before);
    assert.deepEqual(calls, [], "the window went somewhere not on screen");

    ctx.currentSurfaces = [srf];
    api.CONFIG.moveFlash = false;
    engine.flashMove(ctx, window, before);
    assert.deepEqual(calls, []);
  });
});

test("a move key flashes once the move has been handled", () => {
  flashScene(({ api, engine, controller, ctx, calls, srf, window }) => {
    srf.layout = { flashArea: () => new api.Rect(0, 0, 100, 100) };
    ctx.currentWindow = window;
    engine.handleDockWinShortcut = () => false;
    engine.handleFloatWinShortcut = () => false;
    engine.handleLayoutShortcut = () => {
      window.geometry = new api.Rect(0, 0, 50, 100);
      return true;
    };

    controller.onShortcut(ctx, "MoveLeft", "shortcutCB");
    assert.deepEqual(calls, [["flash", [0, 0, 100, 100]]]);

    controller.onShortcut(ctx, "GroupGrow", "shortcutCB");
    assert.equal(calls.length, 1, "only moves are flashed");
  });
});

//#endregion
