/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * Regression tests for windows getting stuck outside the layout.
 *
 * arrangeScreen floats any tile smaller than its window's minimum size and
 * re-applies the layout (engine.ts:670-733); unfitGreater and unfitLess both
 * default to true. Early versions of this layout kept the pane of a floated
 * window reserved, so re-tiling it put it straight back into the pane that was
 * too small and it was floated again immediately - a window that looked
 * floating with no way to get it back.
 *
 * These use `arrange`, not `apply`, because the bug only exists once the
 * engine's unfit pass is in play.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createWorld, findViolations } = require("./harness");

/* A modest screen, and minimums of the kind real toolkits report. Electron
   apps really do ask for something like 940x500. */
const SCREEN = { width: 1280, height: 800 };
const ORDINARY = { minWidth: 400, minHeight: 300 };
const GREEDY = { minWidth: 940, minHeight: 500 };

test("a window floated for being too small can be tiled again", (t) => {
  const world = createWorld(SCREEN);
  world.open("konsole", ORDINARY);
  world.arrange();
  world.open("dolphin", { minWidth: 480, minHeight: 320 });
  world.arrange();
  world.open("firefox", { minWidth: 500, minHeight: 400 });
  world.arrange();
  assert.deepStrictEqual(
    world.floating(),
    [],
    "three ordinary windows fit on this screen",
  );

  world.open("discord", GREEDY);
  world.arrange();
  assert.ok(
    world.floating().length > 0,
    "a window demanding 940px of width cannot share this screen with three others",
  );

  /* What the user does about it: focus the floating window and press Meta+F.
     konsole needs 400x300, which fits alongside discord's 940x500 if the two
     are stacked, so this one has to come back. Whether the others can depends
     on whether their minimums fit at all, which is not something the layout
     gets to decide. */
  assert.ok(world.floating().indexOf("konsole") >= 0);
  world.unfloat("konsole");
  const settled = world.arrange();

  assert.ok(
    settled.some((w) => w.id === "konsole"),
    "konsole should be tiled again, not floated straight back out",
  );
  assert.deepStrictEqual(
    findViolations(world, settled),
    [],
    "and the result is a healthy arrangement",
  );
});

test("panes are not made smaller than their window's minimum size", (t) => {
  const world = createWorld(SCREEN);
  world.open("konsole", { minWidth: 300, minHeight: 200 });
  world.open("discord", GREEDY);
  const settled = world.arrange();

  assert.strictEqual(
    settled.length,
    2,
    "300 + 940 fits across 1280px, so both windows should tile",
  );
  assert.deepStrictEqual(world.floating(), []);
  settled.forEach((w) => {
    assert.ok(
      w.geometry.width >= w.minSize.width &&
        w.geometry.height >= w.minSize.height,
      `${w.id} got ${w.geometry}, below its ${w.minSize.width}x${w.minSize.height} minimum`,
    );
  });
});

test("a new window takes the axis that fits when the longer side will not", (t) => {
  const world = createWorld(SCREEN);
  world.open("discord", GREEDY);
  world.arrange();
  /* 940 + 400 will not fit across 1280px, but 500 + 250 fits down 800px. */
  world.open("konsole", { minWidth: 400, minHeight: 250 });
  const settled = world.arrange();

  assert.strictEqual(settled.length, 2, "both windows tile");
  const discord = world.window("discord").geometry;
  const konsole = world.window("konsole").geometry;
  assert.strictEqual(
    discord.width,
    world.width,
    "the screen is wider than tall, but only stacking fits both minimums",
  );
  assert.strictEqual(konsole.width, world.width);
  assert.ok(discord.height >= 500 && konsole.height >= 250);
});

test("the longer side still wins when both windows fit that way", (t) => {
  const world = createWorld(SCREEN);
  world.open("discord", GREEDY);
  world.arrange();
  /* 940 + 300 does fit across 1280px, so there is no reason to stack. */
  world.open("konsole", { minWidth: 300, minHeight: 300 });
  const settled = world.arrange();

  assert.strictEqual(settled.length, 2);
  assert.strictEqual(world.window("discord").geometry.height, world.height);
  assert.strictEqual(world.window("discord").geometry.width, 940);
  assert.strictEqual(world.window("konsole").geometry.width, 1280 - 940);
});

test("a tiled window always has a pane, whatever the engine does", (t) => {
  /* Far more windows than the screen can hold at their minimums. Whatever
     survives must have real geometry: a window left marked tiled while
     holding stale geometry is the failure that looks like floating but
     ignores every command to put it back. */
  const world = createWorld({ width: 800, height: 600 });
  for (let i = 0; i < 8; i++)
    world.open(`w${i}`, { minWidth: 300, minHeight: 200 });
  const settled = world.arrange();

  assert.deepStrictEqual(findViolations(world, settled), []);
  settled.forEach((w) => {
    assert.ok(
      w.geometry.width > 0 && w.geometry.height > 0,
      `${w.id} has no pane`,
    );
  });
});
