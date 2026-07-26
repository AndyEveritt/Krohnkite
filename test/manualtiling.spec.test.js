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
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.25, 1),
      D: px(0.75, 0, 0.25, 1),
    },
    "C and D are already a pair, so their shared split just reorients",
  );

  world.open("E");
  world.apply();
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.25, 1),
      D: px(0.75, 0, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "D is now the bottom-right-most pane and is tall, so E stacks under it",
  );
});

test("Increase splits along the pane's longer side", (t) => {
  const world = exampleWorld();
  const px = world.px;

  world.focus("A");
  assert.strictEqual(world.shortcut("Increase"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.25, 1),
      B: px(0.25, 0, 0.25, 1),
      C: px(0.5, 0, 0.25, 1),
      D: px(0.75, 0, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "A is wide, and already paired with B, so the pair turns side by side",
  );

  world.focus("A");
  assert.strictEqual(world.shortcut("Increase"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.25, 1),
      D: px(0.75, 0, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "A is tall now, so the same key stacks the pair again",
  );

  world.focus("C");
  assert.strictEqual(world.shortcut("Increase"), true);
  assert.deepStrictEqual(
    world.snapshot(),
    {
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.25, 0.5),
      D: px(0.5, 0.5, 0.25, 0.5),
      E: px(0.75, 0, 0.25, 1),
    },
    "C's neighbour D is not its sibling, so this builds a real new split",
  );
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
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.25, 0.5),
      D: px(0.75, 0, 0.25, 1),
      E: px(0.5, 0.5, 0.25, 0.5),
    },
    "D takes the whole column it shared with E, and E moves into C's - the bottom-right-most pane left",
  );
});

test("explicit split shortcuts force the axis", (t) => {
  const world = exampleWorld();
  const px = world.px;

  world.focus("A");
  assert.strictEqual(
    world.shortcut("SplitVertical"),
    false,
    "A and B are already stacked, so there is nothing to change",
  );

  assert.strictEqual(world.shortcut("SplitHorizontal"), true);
  assert.deepStrictEqual(world.snapshot().A, px(0, 0, 0.25, 1));
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
  const before = world.tree();

  world.focus("A");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  const moved = world.snapshot();
  assert.deepStrictEqual(
    moved.A,
    world.px(0.5, 0, 0.25, 1),
    "A takes C's pane",
  );
  assert.deepStrictEqual(
    moved.C,
    world.px(0, 0, 0.5, 0.5),
    "and C takes A's",
  );
  assert.notStrictEqual(before, world.tree(), "the occupants changed");

  world.focus("A");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(world.tree(), before, "swapping back restores the tree");
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
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      C: px(0.5, 0, 0.25, 1),
      E: px(0.75, 0, 0.25, 1),
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
      C: px(0.5, 0, 0.25, 1),
      D: px(0.75, 0, 0.25, 0.5),
      E: px(0.75, 0.5, 0.25, 0.5),
    },
    "A absorbs B's half; the right-hand panes are untouched",
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
      A: px(0, 0, 0.5, 0.5),
      B: px(0, 0.5, 0.5, 0.5),
      D: px(0.5, 0, 0.5, 0.5),
      E: px(0.5, 0.5, 0.5, 0.5),
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

  const a = world.snapshot().A;
  const b = world.snapshot().B;
  assert.strictEqual(a[1] + a[3] + 8, b[1], "exactly one gap between panes");
});
