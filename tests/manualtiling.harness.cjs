/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/**
 * Test harness for ManualTilingLayout.
 *
 * Like the other tests here, it transpiles the sources the layout needs into
 * a fresh vm context rather than loading the bundle, so it needs no build.
 * `createWorld()` then fakes the slice of KWin and TilingEngine a layout can
 * see. The engine is modelled only where its behaviour changes what a layout
 * has to cope with - see `arrange`, `overlays` and `followMove` - and those
 * models have to be kept in step with engine.ts and control.ts.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

const SOURCES = [
  "src/_types.ts",
  "src/extern/enums.ts",
  "src/util/func.ts",
  "src/util/rect.ts",
  "src/util/rectdelta.ts",
  "src/layouts/layoututils.ts",
  "src/layouts/manualtilingtree.ts",
  "src/layouts/manualtilinggeometry.ts",
  "src/layouts/manualtilinglayout.ts",
];

let cached = null;

/** Evaluate the layout's sources and hand back the declarations tests use. */
function loadKrohnkite() {
  if (cached !== null) return cached;
  const context = vm.createContext({ print: () => {}, console });
  const source = SOURCES.map((file) =>
    fs.readFileSync(path.join(ROOT, file), "utf8"),
  ).join("\n");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      removeComments: true,
      preserveConstEnums: true,
    },
  }).outputText;
  vm.runInContext(transpiled, context);
  vm.runInContext(
    `this.__api = {
      ManualTilingLayout,
      ManualTilingTree,
      MTLeaf,
      MTNode,
      LayoutUtils,
      Rect,
      RectDelta,
      WindowState,
      KrohnkiteAction,
    };`,
    context,
  );
  cached = context.__api;
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
 * A screen with one ManualTilingLayout on it.
 *
 * Windows are plain objects carrying just what WindowClass exposes to a
 * layout: id, state, geometry, focusTime, minimized, caption and size hints.
 *
 * @param options.width, options.height screen size, 1920x1080 by default.
 * @param options.gap gap between panes, 0 by default.
 * @param options.unfitGreater, options.unfitLess the engine's unfit options;
 * KWinConfig's defaults (false, true) unless given.
 */
function createWorld(options) {
  const settings = options || {};
  const K = loadKrohnkite();
  const width = settings.width !== undefined ? settings.width : 1920;
  const height = settings.height !== undefined ? settings.height : 1080;
  const unfitGreater =
    settings.unfitGreater !== undefined ? settings.unfitGreater : false;
  const unfitLess =
    settings.unfitLess !== undefined ? settings.unfitLess : true;
  const area = new K.Rect(0, 0, width, height);

  const windows = new Map();
  const layout = new K.ManualTilingLayout(null);
  /** Stands in for the manual layout of a neighbouring output. */
  const neighborLayout = new K.ManualTilingLayout(null);
  let gap = settings.gap !== undefined ? settings.gap : 0;
  let clock = 1;

  /* The transient indicators; the persistent overlays are pulled live. */
  const indicators = { drop: null, flash: null, notifications: [] };
  let dragAction = null;

  /* Values built inside the vm have its Array and Object prototypes, which
   * assert.deepStrictEqual tells apart from this realm's. */
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const rectArray = (rect) =>
    rect === null ? null : [rect.x, rect.y, rect.width, rect.height];

  const ctx = {
    backend: "kwin",
    _current: null,
    get currentWindow() {
      return this._current;
    },
    /* Like the driver's setter: focusing stamps focusTime, and the engine
       tells every layout (TilingController.onWindowFocused). */
    set currentWindow(window) {
      if (window !== null) {
        window.focusTime = clock++;
        layout.focusChanged(window.id);
        neighborLayout.focusChanged(window.id);
      }
      this._current = window;
    },
    cursorPos: null,
    getWindowById: (id) => (windows.has(id) ? windows.get(id) : null),
    showNotification(text) {
      indicators.notifications.push(text);
    },
    setTimeout() {},
  };

  const MOVE_ACTIONS = ["MoveLeft", "MoveRight", "MoveUp", "MoveDown"];

  /**
   * Models TilingEngine.flashMove: once a move or drop has settled, flash
   * what the layout names - if the window's tile actually changed.
   */
  function flashMove(window, before) {
    if (window === null || before === null) return;
    if (window.state !== K.WindowState.Tiled || window.geometry.equals(before))
      return;
    const area = layout.flashArea(ctx, window);
    if (area !== null) indicators.flash = rectArray(area);
  }

  /** Windows the engine would hand the layout: tileable and not minimized. */
  function tileables() {
    return [...windows.values()].filter(
      (w) => w.state === K.WindowState.Tiled && !w.minimized,
    );
  }

  const isTooSmall = (w) =>
    w.minSize.height > w.geometry.height || w.minSize.width > w.geometry.width;
  const isTooBig = (w) =>
    w.maxSize.height < w.geometry.height || w.maxSize.width < w.geometry.width;

  const toPoint = (point) =>
    Array.isArray(point) ? { x: point[0], y: point[1] } : point;

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
     * unfitLess/unfitGreater pass that floats windows bigger or smaller than
     * their pane allows, re-applying the layout each time. Keep in step with
     * the engine.
     *
     * @returns the tiles that survived.
     */
    arrange() {
      let tiles = tileables();
      const originalLength = tiles.length;
      const apply = () => layout.apply(ctx, tiles, area, gap);
      /* The layout itself floats windows it has no room for. */
      const settled = () =>
        tiles.filter((tile) => tile.state === K.WindowState.Tiled);
      apply();
      if (!unfitGreater && !unfitLess) return settled();

      let undersized = 0;
      tiles = tiles.filter((tile) => {
        if (unfitLess && isTooBig(tile)) {
          tile.state = K.WindowState.Floating;
          return false;
        }
        if (unfitGreater && isTooSmall(tile)) undersized += 1;
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
      return settled();
    },

    /** Open a window and focus it, as KWin does; the caller arranges. */
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
        focusTime: 0,
        minimized: false,
        windowCaption: id,
        get isTiled() {
          return this.state === K.WindowState.Tiled;
        },
      });
      ctx.currentWindow = windows.get(id);
      return windows.get(id);
    },

    close(id) {
      windows.delete(id);
      if (ctx.currentWindow !== null && ctx.currentWindow.id === id)
        ctx._current = null;
    },

    /** Focus a window by any means: a click, Alt+Tab, a focus key. */
    focus(id) {
      ctx.currentWindow = windows.get(id);
      return windows.get(id);
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
    /** engine.toggleFloat on a floating window. */
    unfloat(id) {
      windows.get(id).state = K.WindowState.Tiled;
      ctx.currentWindow = windows.get(id);
    },

    /**
     * Send an action to the layout, re-tiling if it consumed it, as
     * TilingEngine.handleLayoutShortcut does.
     *
     * @param arrange run the engine's unfit pass too, not just apply().
     */
    shortcut(name, arrange) {
      const action = K.KrohnkiteAction[name];
      if (action === undefined) throw new Error(`no action ${name}`);
      const window = ctx.currentWindow;
      const before =
        window !== null && MOVE_ACTIONS.indexOf(name) >= 0
          ? window.geometry.clone()
          : null;
      const consumed = layout.handleShortcut(ctx, action);
      if (consumed) {
        if (arrange) world.arrange();
        else world.apply();
        flashMove(window, before);
      }
      return consumed;
    },

    /**
     * Move the mouse over a point mid-drag, as TilingController's
     * onWindowDragging does.
     *
     * @returns the drag preview rectangle, or null when there is none.
     */
    drag(id, point) {
      if (dragAction === null || dragAction.window.id !== id)
        dragAction = {
          window: windows.get(id),
          mousePointer: toPoint(point),
          previewRect: null,
          result: { isProcessed: false, isArrangeNeeded: false },
        };
      dragAction.mousePointer = toPoint(point);
      dragAction.previewRect = null;
      layout.drag(ctx, dragAction);
      indicators.drop = rectArray(dragAction.previewRect);
      return indicators.drop;
    },

    /**
     * Release the drag, as onWindowMoveOver does: the layout's drop, then an
     * arrange.
     *
     * @returns whether the drop changed the arrangement.
     */
    drop(id, arrange) {
      if (dragAction === null || dragAction.window.id !== id)
        throw new Error(`${id} is not being dragged`);
      const before = layout.toString();
      const window = dragAction.window;
      const tile = window.geometry.clone();
      layout.drop(ctx, dragAction);
      dragAction = null;
      indicators.drop = null;
      if (arrange) world.arrange();
      else world.apply();
      flashMove(window, tile);
      return layout.toString() !== before;
    },

    /**
     * What the engine would have on screen now: the layout's overlays, which
     * TilingEngine redraws after every arrange and focus change, plus the
     * drag preview and the latest flash and notifications.
     */
    overlays() {
      const drawn = layout.overlays(ctx);
      return {
        bars: plain(drawn.stackBars),
        outline: rectArray(drawn.selection),
        drop: indicators.drop,
        flash: indicators.flash,
        notifications: indicators.notifications,
      };
    },

    neighbor: () => neighborLayout,

    /**
     * Models TilingEngine.followGroupMove: KWin has moved `id` to another
     * screen, so the layout hands over the group it belonged to and the rest
     * of that group is sent after it.
     *
     * @param landed false models the early signal that arrives while the
     * window is still here, when the engine asks but does not take.
     * @returns the ids that followed, or null when nothing did.
     */
    followMove(id, landed) {
      const followerIds = layout.groupFollowerIds(id);
      if (followerIds === null || landed === false) return null;
      const group = layout.takeGroup(id);
      if (group === null) return null;
      world.close(id);
      followerIds.forEach((followerId) => world.close(followerId));
      neighborLayout.graft(group);
      return plain(followerIds);
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

    /** Geometry of every tiled window, as `{ id: [x, y, w, h] }`. */
    snapshot() {
      const out = {};
      tileables().forEach((w) => {
        out[w.id] = rectArray(w.geometry);
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

/** Window ids held by a layout's tree, in order, stack members included. */
function treeWindowIds(layout) {
  return layout.tree.windowIds();
}

/** The panes a layout last drew. Reads private state on purpose. */
function renderedPanes(layout) {
  return layout.renderedLeaves.map((leaf) => ({
    rect: leaf.rect,
    contentRect: leaf.contentRect,
    ids: leaf.renderedIds.slice(0),
    isStack: leaf.isStack,
  }));
}

/**
 * Everything that must hold after any sequence of operations.
 *
 * @param tiles the windows the last arrange left tiled; all tileables if not
 * given.
 * @param options.checkMinSize whether a pane below its window's minimum size
 * is a violation. Only guaranteed with unfitGreater, which floats such
 * windows; without it a full screen legitimately leaves some undersized.
 * @returns human-readable violations; empty means healthy.
 */
function findViolations(world, tiles, options) {
  const K = world.K;
  const checkMinSize = options === undefined || options.checkMinSize !== false;
  const problems = [];
  const ids = treeWindowIds(world.layout);
  const settled = tiles !== undefined ? tiles : world.tileables();

  if (new Set(ids).size !== ids.length)
    problems.push(`duplicate window in tree: ${ids.join(",")}`);

  ids.forEach((id) => {
    const window = world.window(id);
    if (window === undefined) problems.push(`pane ${id} has no window`);
    else if (window.state === K.WindowState.Floating)
      problems.push(`${id} is floating and should have released its pane`);
  });

  settled.forEach((w) => {
    if (ids.indexOf(w.id) < 0)
      problems.push(`tiled window ${w.id} has no pane`);
    const g = w.geometry;
    if ([g.x, g.y, g.width, g.height].some((v) => Number.isNaN(v)))
      problems.push(`${w.id} has a non-numeric geometry: ${g}`);
    if (g.width <= 0 || g.height <= 0)
      problems.push(`${w.id} has an empty geometry: ${g}`);
    if (g.x < 0 || g.y < 0 || g.maxX > world.width || g.maxY > world.height)
      problems.push(`${w.id} falls outside the working area: ${g}`);
    if (
      checkMinSize &&
      (g.width < w.minSize.width || g.height < w.minSize.height)
    )
      problems.push(
        `${w.id} is below its minimum size: ${g} < ${w.minSize.width}x${w.minSize.height}`,
      );
  });

  /* Overlap and coverage are properties of the panes, not of the windows:
   * every member of a stacked pane shares the same geometry on purpose. */
  const panes = renderedPanes(world.layout);
  panes.forEach((pane) => {
    pane.ids.forEach((id) => {
      const window = world.window(id);
      if (window === undefined || settled.indexOf(window) < 0) return;
      if (!window.geometry.equals(pane.contentRect))
        problems.push(
          `${id} does not fill its pane: ${window.geometry} != ${pane.contentRect}`,
        );
    });
  });

  for (let i = 0; i < panes.length; i++)
    for (let j = i + 1; j < panes.length; j++) {
      const a = panes[i].rect;
      const b = panes[j].rect;
      if (a.x < b.maxX && b.x < a.maxX && a.y < b.maxY && b.y < a.maxY)
        problems.push(
          `pane ${panes[i].ids.join("|")} overlaps ${panes[j].ids.join("|")}`,
        );
    }

  /* Without gaps the panes account for every pixel of the screen; a stack's
   * tab strip is part of its pane. */
  if (world.gap === 0 && settled.length > 0) {
    const covered = panes.reduce(
      (sum, pane) => sum + pane.rect.width * pane.rect.height,
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
  renderedPanes,
  findViolations,
};
