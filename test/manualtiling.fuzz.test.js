/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * Property tests: whatever sequence of operations a user performs, the layout
 * must never produce a broken arrangement.
 *
 * The tree is long-lived, mutable state that the user edits by hand all
 * session, so the interesting failures are the ones that need a particular
 * order of events to reach. Every run is seeded and therefore reproducible;
 * a failure prints the seed, step and operation that produced it.
 *
 *   KROHNKITE_FUZZ_SEEDS=1,2,3   comma-separated seeds to run
 *   KROHNKITE_FUZZ_STEPS=20000   operations per seed
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createWorld, makeRandom, findViolations } = require("./harness");

const SEEDS = (process.env.KROHNKITE_FUZZ_SEEDS || "12345,777,4242,2024")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((s) => !Number.isNaN(s));
const STEPS = Number(process.env.KROHNKITE_FUZZ_STEPS || 2000);

/* Weighted so windows keep arriving and leaving while the tree is edited. */
const OPERATIONS = [
  "open",
  "open",
  "open",
  "close",
  "minimize",
  "restore",
  "float",
  "unfloat",
  "unfloat",
  "splitAuto",
  "splitHorizontal",
  "splitVertical",
  "unsplit",
  "rotate",
  "move",
  "move",
  "adjust",
  "gap",
];
const DIRECTIONS = ["Left", "Right", "Up", "Down"];
const MAX_WINDOWS = 10;

function runSeed(seed, steps) {
  const random = makeRandom(seed);
  const world = createWorld({ width: 1280, height: 800 });
  const pick = (list) => list[random(list.length)];
  let nextId = 1;
  let recovered = 0;
  let recoveryAttempts = 0;

  for (let step = 0; step < steps; step++) {
    const operation = pick(OPERATIONS);
    const tiles = world.tileables();
    const all = world.windows();

    if (tiles.length > 0) world.focus(pick(tiles).id);
    else world.ctx.currentWindow = null;

    switch (operation) {
      case "open": {
        if (all.length >= MAX_WINDOWS) break;
        /* Mostly ordinary minimums, occasionally an Electron-sized one. */
        const greedy = random(8) === 0;
        world.open(`w${nextId++}`, {
          minWidth: greedy ? 700 + random(300) : random(320),
          minHeight: greedy ? 400 + random(150) : random(240),
        });
        break;
      }
      case "close":
        if (all.length > 0) world.close(pick(all).id);
        break;
      case "minimize":
        if (tiles.length > 0) world.minimize(pick(tiles).id);
        break;
      case "restore": {
        const hidden = all.filter((w) => w.minimized);
        if (hidden.length > 0) world.restore(pick(hidden).id);
        break;
      }
      case "float":
        if (tiles.length > 0) world.float(pick(tiles).id);
        break;
      case "unfloat": {
        const floating = all.filter(
          (w) => w.state === world.K.WindowState.Floating,
        );
        if (floating.length === 0) break;
        const target = pick(floating);
        world.unfloat(target.id);
        recoveryAttempts++;
        if (world.arrange().some((w) => w.id === target.id)) recovered++;
        break;
      }
      case "splitAuto":
        world.shortcut("Increase");
        break;
      case "splitHorizontal":
        world.shortcut("SplitHorizontal");
        break;
      case "splitVertical":
        world.shortcut("SplitVertical");
        break;
      case "unsplit":
        world.shortcut("Decrease");
        break;
      case "rotate":
        world.shortcut("Rotate");
        break;
      case "move":
        world.shortcut(`Swap${pick(DIRECTIONS)}`);
        break;
      case "adjust": {
        if (world.ctx.currentWindow === null) break;
        const amount = pick([-300, -120, -20, 20, 120, 300]);
        const edge = random(4);
        world.adjust(
          world.ctx.currentWindow.id,
          world.delta(
            edge === 0 ? amount : 0,
            edge === 1 ? amount : 0,
            edge === 2 ? amount : 0,
            edge === 3 ? amount : 0,
          ),
        );
        break;
      }
      case "gap":
        world.gap = pick([0, 0, 0, 4, 8]);
        break;
    }

    const settled = world.arrange();
    const problems = findViolations(world, settled);
    assert.deepStrictEqual(
      problems,
      [],
      `seed ${seed}, step ${step}, after ${operation}:\n  ${problems.join(
        "\n  ",
      )}\n  tree: ${world.tree()}\n  gap: ${world.gap}`,
    );
  }

  return { recovered, recoveryAttempts };
}

SEEDS.forEach((seed) => {
  test(`${STEPS} random operations hold every invariant (seed ${seed})`, (t) => {
    const { recovered, recoveryAttempts } = runSeed(seed, STEPS);

    /* Re-tiling a floating window can legitimately fail when the windows on
       screen cannot all meet their minimum sizes at once, but it must work
       the great majority of the time - if it never worked, the layout would
       be wedging windows out of the arrangement again. */
    if (recoveryAttempts > 20) {
      const rate = recovered / recoveryAttempts;
      assert.ok(
        rate > 0.5,
        `re-tiling a floating window only worked ${recovered}/${recoveryAttempts} times (${(
          rate * 100
        ).toFixed(0)}%)`,
      );
    }
  });
});
