/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * Test harness for the compiled Krohnkite bundle.
 *
 * The bundle is built with `outFile` and no modules, so it has no exports:
 * every class is a plain top-level declaration. Tests get at them by
 * evaluating the bundle as a function body and returning the names they need.
 * That is why these tests are JavaScript rather than TypeScript - there is no
 * module to import, and compiling the tests through the same `outFile` would
 * merge them into the shipped script.
 *
 * Run them with `go-task test` (which builds first) or `npm test`.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BUNDLE = path.join(__dirname, "..", "krohnkite.js");

/** Names lifted out of the bundle. Add to this as tests need more. */
const EXPORTS = [
  "ManualTilingLayout",
  "TileLayout",
  "MonocleLayout",
  "LayoutUtils",
  "StackLayoutPart",
  "HalfSplitLayoutPart",
  "FillLayoutPart",
  "Rect",
  "RectDelta",
  "WindowState",
  "Shortcut",
];

let cached = null;

/** Evaluate the compiled bundle and hand back the declarations tests use. */
function loadKrohnkite() {
  if (cached !== null) return cached;
  if (!fs.existsSync(BUNDLE)) {
    throw new Error(
      `${BUNDLE} not found - build it first with \`go-task build-ts\`.`,
    );
  }
  const source = fs.readFileSync(BUNDLE, "utf8");
  cached = new Function(`${source}\nreturn { ${EXPORTS.join(", ")} };`)();
  return cached;
}

/** Deterministic xorshift32. A plain LCG loses its low bits to float precision. */
function makeRandom(seed) {
  let state = seed | 0;
  if (state === 0) state = 1;
  return function random(bound) {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) % bound;
  };
}

/**
 * A stand-in for the parts of KWin and TilingEngine a layout can see.
 *
 * Windows are plain objects carrying just what WindowClass exposes to a
 * layout: id, state, geometry, focusTime, minimized and the size hints. The
 * engine is modelled only where its behaviour changes what a layout must
 * cope with - see `arrange`.
 */
function createWorld(options) {
  const settings = options || {};
  const K = loadKrohnkite();
  const width = settings.width !== undefined ? settings.width : 1920;
  const height = settings.height !== undefined ? settings.height : 1080;
  const area = new K.Rect(0, 0, width, height);

  const windows = new Map();
  const layout = new K.ManualTilingLayout(
    settings.capacity !== undefined ? settings.capacity : null,
  );
  let gap = settings.gap !== undefined ? settings.gap : 0;
  let clock = 1;

  const ctx = {
    backend: "kwin",
    currentWindow: null,
    cursorPos: null,
    getWindowById: (id) => (windows.has(id) ? windows.get(id) : null),
    showNotification() {},
    setTimeout() {},
  };

  /** Windows the engine would hand the layout: tiled, and not minimized. */
  function tileables() {
    return [...windows.values()].filter(
      (w) => w.state === K.WindowState.Tiled && !w.minimized,
    );
  }

  function isTooSmall(w) {
    return (
      w.minSize.height > w.geometry.height || w.minSize.width > w.geometry.width
    );
  }

  function isTooBig(w) {
    return (
      w.maxSize.height < w.geometry.height || w.maxSize.width < w.geometry.width
    );
  }

  const world = {
    K,
    layout,
    ctx,
    width,
    height,
    area,

    get gap() {
      return gap;
    },
    set gap(value) {
      gap = value;
    },

    /** Run the layout on its own, with no engine behaviour around it. */
    apply() {
      layout.apply(ctx, tileables(), area, gap);
    },

    /**
     * Run the layout the way TilingEngine.arrangeScreen does, including the
     * unfitGreater/unfitLess pass (engine.ts:670-733) that floats any tile
     * smaller than its window's minimum size. Both options default to true,
     * and that pass is what turns an undersized pane into a floating window,
     * so a layout has to be tested against it rather than against apply()
     * alone. Keep this in step with the engine.
     *
     * @returns the tiles that survived.
     */
    arrange() {
      let tiles = tileables();
      const originalLength = tiles.length;
      const apply = () => layout.apply(ctx, tiles, area, gap);

      apply();

      let undersized = 0;
      tiles = tiles.filter((tile) => {
        if (isTooBig(tile)) {
          tile.state = K.WindowState.Floating;
          return false;
        }
        if (isTooSmall(tile)) undersized += 1;
        return true;
      });
      if (tiles.length !== originalLength) apply();

      if (undersized > 0) {
        if (tiles.length !== originalLength)
          undersized = tiles.filter(isTooSmall).length;
        let guard = 0;
        while (tiles.length > 0 && undersized > 0) {
          if (++guard > 500)
            throw new Error("engine unfit loop did not converge");
          tiles.shift().state = K.WindowState.Floating;
          apply();
          undersized = tiles.filter(isTooSmall).length;
        }
      }
      return tiles;
    },

    /** Open a window and arrange, as onWindowAdded would. */
    open(id, hints) {
      const h = hints || {};
      windows.set(id, {
        id,
        state: K.WindowState.Tiled,
        geometry: new K.Rect(0, 0, 400, 300),
        minSize: {
          width: h.minWidth !== undefined ? h.minWidth : 0,
          height: h.minHeight !== undefined ? h.minHeight : 0,
        },
        maxSize: {
          width: h.maxWidth !== undefined ? h.maxWidth : 1e6,
          height: h.maxHeight !== undefined ? h.maxHeight : 1e6,
        },
        focusTime: clock++,
        minimized: false,
      });
      ctx.currentWindow = windows.get(id);
      return windows.get(id);
    },

    close(id) {
      windows.delete(id);
      if (ctx.currentWindow !== null && ctx.currentWindow.id === id)
        ctx.currentWindow = null;
    },

    focus(id) {
      const window = windows.get(id);
      window.focusTime = clock++;
      ctx.currentWindow = window;
      return window;
    },

    minimize(id) {
      windows.get(id).minimized = true;
    },
    restore(id) {
      windows.get(id).minimized = false;
    },

    /** engine.toggleFloat on a tiled window. */
    float(id) {
      windows.get(id).state = K.WindowState.Floating;
    },
    /** engine.toggleFloat on a floating window - a floating one isn't tileable. */
    unfloat(id) {
      windows.get(id).state = K.WindowState.Tiled;
      ctx.currentWindow = windows.get(id);
    },

    /** Send a shortcut to the layout, arranging if it consumed it. */
    shortcut(name, arrange) {
      const consumed = layout.handleShortcut(ctx, K.Shortcut[name]);
      if (consumed) {
        if (arrange) world.arrange();
        else world.apply();
      }
      return consumed;
    },

    adjust(id, delta) {
      layout.adjust(area, tileables(), windows.get(id), delta, gap);
    },

    delta(east, west, south, north) {
      return new K.RectDelta(east || 0, west || 0, south || 0, north || 0);
    },

    window: (id) => windows.get(id),
    windows: () => [...windows.values()],
    tileables,
    floating: () =>
      [...windows.values()]
        .filter((w) => w.state === K.WindowState.Floating)
        .map((w) => w.id)
        .sort(),

    /** Geometry of every currently tiled window, as `{ id: [x, y, w, h] }`. */
    snapshot() {
      const out = {};
      tileables().forEach((w) => {
        out[w.id] = [w.geometry.x, w.geometry.y, w.geometry.width, w.geometry.height];
      });
      return out;
    },

    /** Screen fractions to the integer pixels a snapshot holds. */
    px(x, y, w, h) {
      return [
        Math.round(x * width),
        Math.round(y * height),
        Math.round(w * width),
        Math.round(h * height),
      ];
    },

    tree: () => layout.toString(),
  };

  return world;
}

/** Leaf window ids of the layout's tree, in order. Reads private state on purpose. */
function treeWindowIds(layout) {
  const out = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (node.windowId !== undefined) {
      out.push(node.windowId);
      return;
    }
    walk(node.first);
    walk(node.second);
  };
  walk(layout.root);
  return out;
}

/**
 * Everything that must hold after any sequence of operations.
 *
 * @returns a list of human-readable violations; empty means healthy.
 */
function findViolations(world, tiles) {
  const K = world.K;
  const problems = [];
  const ids = treeWindowIds(world.layout);
  const settled = tiles !== undefined ? tiles : world.tileables();

  if (new Set(ids).size !== ids.length)
    problems.push(`duplicate leaf in tree: ${ids.join(",")}`);

  ids.forEach((id) => {
    const window = world.window(id);
    if (window === undefined) {
      problems.push(`leaf ${id} has no window`);
      return;
    }
    if (window.state === K.WindowState.Floating)
      problems.push(`leaf ${id} is floating and should have released its pane`);
  });

  settled.forEach((w) => {
    if (ids.indexOf(w.id) < 0) problems.push(`tiled window ${w.id} has no pane`);
  });

  settled.forEach((w) => {
    const g = w.geometry;
    [g.x, g.y, g.width, g.height].forEach((v) => {
      if (typeof v !== "number" || Number.isNaN(v))
        problems.push(`${w.id} has a non-numeric geometry: ${g}`);
    });
    if (g.width <= 0 || g.height <= 0)
      problems.push(`${w.id} has an empty geometry: ${g}`);
    if (g.x < 0 || g.y < 0 || g.maxX > world.width || g.maxY > world.height)
      problems.push(`${w.id} falls outside the working area: ${g}`);
    if (g.width < w.minSize.width || g.height < w.minSize.height)
      problems.push(
        `${w.id} is below its minimum size after arranging: ${g} < ${w.minSize.width}x${w.minSize.height}`,
      );
  });

  for (let i = 0; i < settled.length; i++)
    for (let j = i + 1; j < settled.length; j++) {
      const a = settled[i].geometry;
      const b = settled[j].geometry;
      if (a.x < b.maxX && b.x < a.maxX && a.y < b.maxY && b.y < a.maxY)
        problems.push(`${settled[i].id} overlaps ${settled[j].id}`);
    }

  /* Without gaps the panes must account for every pixel of the screen. */
  if (world.gap === 0 && settled.length > 0) {
    const covered = settled.reduce(
      (sum, w) => sum + w.geometry.width * w.geometry.height,
      0,
    );
    const total = world.width * world.height;
    if (covered !== total)
      problems.push(`panes cover ${covered}px of ${total}px`);
  }

  return problems;
}

module.exports = {
  loadKrohnkite,
  createWorld,
  makeRandom,
  treeWindowIds,
  findViolations,
};
