/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/** What ManualTilingLayout is specified to do, on a 1920x1080 screen. */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createWorld } = require("./harness");

/** The arrangement from the feature's worked example, ready for more steps. */
function exampleWorld() {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();
  world.focus("A");
  world.shortcut("SplitVertical");
  world.open("D");
  world.apply();
  world.focus("C");
  world.shortcut("SplitHorizontal");
  world.open("E");
  world.apply();
  return world;
}

test("new windows split the bottom-right-most pane along its longer side", (t) => {
  const world = createWorld();
  const px = world.px;

  world.open("A");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    { A: px(0, 0, 1, 1) },
    "one window fills the screen",
  );

  world.open("B");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    { A: px(0, 0, 0.5, 1), B: px(0.5, 0, 0.5, 1) },
    "a full-screen pane is wider than tall, so it splits side by side",
  );

  world.open("C");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 1),
      B: px(0.5, 0, 0.5, 0.5),
      C: px(0.5, 0.5, 0.5, 0.5),
    },
    "B is the bottom-right-most pane and is taller than wide, so it stacks",
  );
});

test("splitting reflows the windows around the new split", (t) => {
  const world = createWorld();
  const px = world.px;
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();

  world.focus("A");
  assert.strictEqual(world.shortcut("SplitVertical"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.5, 1),
    },
    "B is pulled in under A, and C takes the whole right half it leaves",
  );

  world.open("D");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.5, 0.5),
      D: px(0.5, 0.5, 0.5, 0.5),
    },
    "C is the bottom-right-most pane and is tall, so D stacks under it",
  );

  world.focus("C");
  assert.strictEqual(world.shortcut("SplitHorizontal"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 1),
      B: px(0.5, 0, 0.25, 0.5),
      C: px(0.75, 0, 0.25, 0.5),
      D: px(0.5, 0.5, 0.5, 0.5),
    },
    "C's pane really is divided: B is pulled up into it, and D takes the lower half " +
      "that B's departure frees. D is skipped as the partner because it already " +
      "shares C's split - using it would reorient that split rather than add one",
  );

  world.open("E");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 1),
      B: px(0.5, 0, 0.25, 0.5),
      C: px(0.75, 0, 0.25, 0.5),
      D: px(0.5, 0.5, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "D is now the bottom-right-most pane and is wide, so E goes beside it",
  );
});

test("Increase splits along the pane's longer side", (t) => {
  const world = exampleWorld();
  const px = world.px;

  /* A holds the left half, 960x1080, so the longer side is vertical. */
  world.focus("A");
  assert.strictEqual(world.shortcut("Increase"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.5, 0.5),
      D: px(0.5, 0.5, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "A's pane is divided top and bottom, with B pulled into the new half",
  );
});

test("Rotate turns the split the focused window sits in", (t) => {
  const world = exampleWorld();
  const px = world.px;
  world.focus("A");
  world.shortcut("Increase");
  const stacked = world.snapshot();

  /* The rest of the arrangement is untouched by every turn. */
  const rest = {
    C: px(0.5, 0, 0.5, 0.5),
    D: px(0.5, 0.5, 0.25, 0.5),
    E: px(0.75, 0.5, 0.25, 0.5),
  };

  assert.strictEqual(world.shortcut("Rotate"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    { B: px(0, 0, 0.25, 1), A: px(0.25, 0, 0.25, 1), ...rest },
    "A over B turns a quarter clockwise: B on the left, A on the right",
  );

  assert.strictEqual(world.shortcut("Rotate"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    { B: px(0, 0, 0.5, 0.5), A: px(0, 0.5, 0.5, 0.5), ...rest },
    "another quarter turn stacks them the other way up: B over A",
  );

  assert.strictEqual(world.shortcut("Rotate"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    { A: px(0, 0, 0.25, 1), B: px(0.25, 0, 0.25, 1), ...rest },
    "and then side by side, A on the left",
  );

  assert.strictEqual(world.shortcut("Rotate"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    stacked,
    "four turns is a full circle, back to where it started",
  );
});

test("Rotate keeps the proportions of the split it turns", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  world.adjust("A", world.delta(240));
  world.apply();
  const widths = world.snapshot();
  assert.strictEqual(widths.A[2], 1920 / 2 + 240);
  const share = (1920 / 2 + 240) / 1920;

  world.focus("A");
  assert.strictEqual(world.shortcut("Rotate"), true);
  assert.strictEqual(
    world.snapshot().A[3],
    Math.round(1080 * share),
    "the 62/38 split becomes 62/38 the other way round, not 50/50",
  );

  assert.strictEqual(world.shortcut("Rotate"), true);
  const swapped = world.snapshot();
  assert.strictEqual(
    swapped.A[2],
    Math.round(1920 * share),
    "the turn that swaps the sides keeps A's own share, now on the right",
  );
  assert.strictEqual(
    swapped.A[0],
    1920 - Math.round(1920 * share),
    "and A really is the right-hand pane",
  );
});

test("Rotate refuses when the window has no split to turn", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.focus("A");
  assert.strictEqual(world.shortcut("Rotate"), false);
});

test("Decrease removes the split above the focused window", (t) => {
  const world = exampleWorld();
  const px = world.px;

  world.focus("D");
  assert.strictEqual(world.shortcut("Decrease"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0.5, 0, 0.25, 0.5),
      C: px(0.75, 0, 0.25, 0.5),
      D: px(0.5, 0.5, 0.5, 0.5),
      E: px(0, 0.5, 0.5, 0.5),
    },
    "D takes the whole half it shared with E, and E moves into A's - the bottom-right-most pane left",
  );
});

test("explicit split shortcuts force the axis", (t) => {
  const world = exampleWorld();
  const px = world.px;

  world.focus("A");
  assert.strictEqual(world.shortcut("SplitHorizontal"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.25, 1),
      B: px(0.25, 0, 0.25, 1),
      C: px(0.5, 0, 0.5, 0.5),
      D: px(0.5, 0.5, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "A's pane is taller than wide, but the explicit shortcut splits it side by side anyway",
  );
});

test("with only two windows a split can only reorient the one they share", (t) => {
  const world = createWorld();
  const px = world.px;
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  world.focus("A");
  assert.strictEqual(
    world.shortcut("SplitHorizontal"),
    false,
    "B is the only window that could be pulled in, and it already shares A's split",
  );

  assert.strictEqual(world.shortcut("SplitVertical"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    { A: px(0, 0, 1, 0.5), B: px(0, 0.5, 1, 0.5) },
    "so the split is reoriented, which is all that is left to do",
  );
});

test("commands refuse rather than pretend when they cannot act", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();

  world.focus("A");
  assert.strictEqual(
    world.shortcut("SplitHorizontal"),
    false,
    "nothing to pull into the other half of a split",
  );
  assert.strictEqual(world.shortcut("Increase"), false);
  assert.strictEqual(
    world.shortcut("Decrease"),
    false,
    "a lone window has no split above it",
  );

  world.open("B");
  world.apply();
  world.focus("A");
  assert.strictEqual(
    world.shortcut("Decrease"),
    false,
    "with two windows the split is the root, and B has nowhere else to go",
  );

  world.float("A");
  world.apply();
  world.ctx.currentWindow = world.window("A");
  assert.strictEqual(
    world.shortcut("SplitHorizontal"),
    false,
    "a floating window is not a pane of this layout",
  );
  assert.strictEqual(
    world.shortcut("Decrease"),
    false,
    "so the engine still gets its chance to handle the key",
  );
});

test("directional move swaps panes and leaves the structure alone", (t) => {
  const world = exampleWorld();
  const before = world.snapshot();
  const beforeTree = world.tree();

  world.focus("A");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  const moved = world.snapshot();

  const partner = Object.keys(before).find(
    (id) => id !== "A" && String(moved[id]) === String(before.A),
  );
  assert.ok(partner !== undefined, "some window took A's pane");
  assert.deepStrictEqual(
    moved.A,
    before[partner],
    `and A took ${partner}'s in exchange`,
  );
  assert.ok(moved.A[0] > before.A[0], "the pane A moved into is to the right");
  assert.notStrictEqual(beforeTree, world.tree(), "the occupants changed");

  world.focus("A");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(
    world.tree(),
    beforeTree,
    "swapping back restores the tree",
  );
  assert.deepStrictEqual(world.snapshot(), before);
});

test("a window with no neighbour in that direction defers to the engine", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  world.focus("A");
  assert.strictEqual(
    world.shortcut("SwapLeft"),
    false,
    "nothing to the left of the leftmost pane, so the engine can move it to the next screen",
  );
  assert.strictEqual(world.shortcut("SwapRight"), true);
});

test("windows keep their pane through minimize and fullscreen", (t) => {
  const world = exampleWorld();
  const px = world.px;
  const before = world.snapshot();

  world.minimize("D");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 1),
      B: px(0.5, 0, 0.25, 0.5),
      C: px(0.75, 0, 0.25, 0.5),
      E: px(0.5, 0.5, 0.5, 0.5),
    },
    "E takes the space while D is away",
  );

  world.restore("D");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    before,
    "and D comes back to its own pane",
  );
});

test("closing a window gives its space to its sibling only", (t) => {
  const world = exampleWorld();
  const px = world.px;

  world.close("B");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 1),
      C: px(0.5, 0, 0.5, 0.5),
      D: px(0.5, 0.5, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "C absorbs B's quarter; every other pane is untouched",
  );
});

test("floating a window releases its pane, and re-tiling gives it a new one", (t) => {
  const world = exampleWorld();
  const px = world.px;

  world.float("C");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 1),
      B: px(0.5, 0, 0.5, 0.5),
      D: px(0.5, 0.5, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "the tree closes up rather than holding an empty pane",
  );

  world.unfloat("C");
  world.apply();
  assert.ok(
    Object.keys(world.snapshot()).indexOf("C") >= 0,
    "C is tiled again",
  );
  assert.deepStrictEqual(world.floating(), [], "and nothing is left floating");
});

test("resizing moves only the divider being dragged", (t) => {
  const world = createWorld();
  const px = world.px;
  world.open("A");
  world.apply();
  world.open("P");
  world.apply();
  world.open("Q");
  world.apply();

  world.adjust("A", world.delta(200));
  world.apply();

  const wide = (1920 / 2 + 200) / 1920;
  assert.deepStrictEqual(world.snapshot(), {
    A: px(0, 0, wide, 1),
    P: px(wide, 0, 1 - wide, 0.5),
    Q: px(wide, 0.5, 1 - wide, 0.5),
  });
});

test("applying repeatedly changes nothing", (t) => {
  const world = exampleWorld();
  const once = world.snapshot();
  world.apply();
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    once,
    "arrangeScreen re-applies the layout, so apply() has to be idempotent",
  );
});

test("gaps stay inside the working area", (t) => {
  const world = exampleWorld();
  world.gap = 8;
  world.apply();

  const panes = Object.values(world.snapshot());
  panes.forEach(([x, y, w, h]) => {
    assert.ok(x >= 0 && y >= 0, `pane starts inside the screen: ${x},${y}`);
    assert.ok(
      x + w <= world.width && y + h <= world.height,
      `pane ends inside the screen: ${x + w},${y + h}`,
    );
  });

  /* B and C share the top-right pane, side by side. */
  const b = world.snapshot().B;
  const c = world.snapshot().C;
  assert.strictEqual(b[0] + b[2] + 8, c[0], "exactly one gap between panes");
});
