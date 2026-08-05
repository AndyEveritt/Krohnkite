/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * The COSMIC-derived half of ManualTilingLayout: stacked panes, group
 * selection, re-parenting moves, mouse drops, and migrating a group to
 * another surface. Geometry is asserted on a 1920x1080 screen.
 *
 * The tab strip is 26px tall (MT_TABBAR_HEIGHT) and is taken off the top of a
 * stacked pane, so a full-screen stack's windows start at y=26.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createWorld, findViolations } = require("./harness");

const BAR = 26;

/** Two windows side by side, B focused. */
function pairWorld() {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  return world;
}

//#region Stacks

test("stacking a pane turns it into a tabbed container new windows join", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();

  assert.strictEqual(world.shortcut("ToggleStack"), true);
  assert.strictEqual(world.tree(), "ManualTilingLayout([A])");

  world.open("B");
  world.apply();
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout([A|B])",
    "a new window joins the focused stack instead of splitting it",
  );

  assert.deepStrictEqual(
    world.snapshot(),
    { A: [0, BAR, 1920, 1080 - BAR], B: [0, BAR, 1920, 1080 - BAR] },
    "every member fills the pane below the tab strip",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("stacking a group collects everything under it into one pane", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();

  /* Widen the selection until it covers B and C, then tab them together. */
  world.focus("C");
  world.shortcut("GroupGrow");
  assert.strictEqual(world.shortcut("ToggleStack"), true);

  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[A,[B|C]])");
  assert.deepStrictEqual(world.snapshot(), {
    A: [0, 0, 960, 1080],
    B: [960, BAR, 960, 1080 - BAR],
    C: [960, BAR, 960, 1080 - BAR],
  });
  assert.deepStrictEqual(findViolations(world), []);
});

test("a stack publishes a tab strip for the driver to draw", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();

  const bars = world.overlays().bars;
  assert.strictEqual(bars.length, 1);
  assert.deepStrictEqual(
    [bars[0].x, bars[0].y, bars[0].width, bars[0].height],
    [0, 0, 1920, BAR],
    "the strip sits along the top of the pane it belongs to",
  );
  assert.deepStrictEqual(
    bars[0].tabs.map((tab) => [tab.id, tab.title, tab.active]),
    [
      ["A", "A", false],
      ["B", "B", true],
    ],
    "the window that joined last is the active tab",
  );

  /* An ordinary pane has no strip to draw. */
  const plain = pairWorld();
  assert.deepStrictEqual(plain.overlays().bars, []);
});

test("the active tab is the focused window, not the last one to join", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();

  const active = () =>
    world.overlays().bars[0].tabs.filter((tab) => tab.active).map((t) => t.id);
  assert.deepStrictEqual(active(), ["C"], "C joined last and has the focus");

  /* Focused from outside the layout - a click on the window, or Alt+Tab. */
  world.focus("A");
  world.apply();
  assert.deepStrictEqual(
    active(),
    ["A"],
    "the strip follows the focus rather than remembering who joined last",
  );
});

test("cycling a stack raises and focuses the next member", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();

  assert.strictEqual(world.shortcut("StackNext"), true);
  assert.strictEqual(
    world.ctx.currentWindow.id,
    "A",
    "next past the last member wraps round to the first",
  );
  assert.strictEqual(world.overlays().bars[0].tabs[0].active, true);

  assert.strictEqual(world.shortcut("StackPrev"), true);
  assert.strictEqual(world.ctx.currentWindow.id, "C");

  /* Nothing to cycle through in a pane holding one window. */
  const plain = pairWorld();
  assert.strictEqual(plain.shortcut("StackNext"), false);
});

test("unstacking fans the members back out into splits", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();
  world.open("D");
  world.apply();

  assert.strictEqual(world.shortcut("ToggleStack"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[V:0.50[A,B],V:0.50[C,D]])",
    "four windows come out as a grid, not four slivers",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("splitting a stack pulls the focused member out of it", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();

  world.focus("B");
  assert.strictEqual(world.shortcut("SplitHorizontal"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[[A],B])",
    "B leaves the stack and takes half the pane; the stack stays a stack",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

//#endregion

//#region Group selection

test("growing the selection widens what the commands act on", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();

  world.focus("C");
  world.shortcut("GroupGrow");
  assert.deepStrictEqual(
    world.overlays().notifications.slice(-1),
    ["2 windows selected"],
    "B and C share the split above C",
  );
  world.shortcut("GroupGrow");
  assert.deepStrictEqual(world.overlays().notifications.slice(-1), [
    "3 windows selected",
  ]);

  world.shortcut("GroupShrink");
  assert.deepStrictEqual(world.overlays().notifications.slice(-1), [
    "2 windows selected",
  ]);
});

test("the selection is dropped as soon as focus leaves it", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();

  world.focus("C");
  world.shortcut("GroupGrow");

  /* A is outside the selection, so selecting again starts from A's own pane. */
  world.focus("A");
  world.shortcut("GroupShrink");
  assert.strictEqual(
    world.shortcut("GroupShrink"),
    false,
    "a single pane cannot be narrowed any further",
  );
});

test("the group key selects a stack before the split around it", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.focus("B");
  world.shortcut("ToggleStack");
  world.open("C");
  world.apply();
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[A,[B|C]])");

  world.shortcut("GroupGrow");
  assert.deepStrictEqual(world.overlays().notifications.slice(-1), [
    "2 windows selected",
  ]);
  assert.deepStrictEqual(
    world.overlays().outline,
    [960, 0, 960, 1080],
    "the stack is outlined as a group of its own",
  );

  /* Moving now takes the stack whole, rather than pulling C out of it. */
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[[B|C],A])",
    "the stack crossed to the left intact",
  );

  /* And it can be handed to another screen as a unit. */
  assert.deepStrictEqual(world.followMove("C", true), ["B"]);
  assert.strictEqual(world.neighbor().toString(), "ManualTilingLayout([B|C])");
});

test("without grouping it, a move pulls the focused tab out of the stack", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.focus("A");
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();
  assert.strictEqual(world.tree(), "ManualTilingLayout([A|B])");

  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[[A],B])",
    "B leaves the stack, as it always did",
  );
});

test("growing past a stack reaches the split around it", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.focus("B");
  world.shortcut("ToggleStack");
  world.open("C");
  world.apply();

  world.shortcut("GroupGrow");
  world.shortcut("GroupGrow");
  assert.deepStrictEqual(world.overlays().notifications.slice(-1), [
    "3 windows selected",
  ]);

  world.shortcut("GroupShrink");
  assert.deepStrictEqual(world.overlays().notifications.slice(-1), [
    "2 windows selected",
  ]);
  world.shortcut("GroupShrink");
  assert.strictEqual(
    world.overlays().outline,
    null,
    "and all the way back down to the pane, which needs no outline",
  );
});

//#endregion

//#region Move versus swap

/** A on the left; B over C on the right. The shape the move rules work on. */
function threeWorld() {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[A,V:0.50[B,C]])");
  return world;
}

/**
 * Three panes in a row, at equal thirds - one split of three, not a split of
 * two with a split inside it. Built by dropping C on A's left edge, which
 * joins the row rather than nesting inside it.
 */
function rowWorld() {
  const world = threeWorld();
  world.drag("C", [20, 500]);
  world.drop("C");
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.33,0.33,0.33[C,A,B])",
  );
  assert.deepStrictEqual(world.snapshot(), {
    C: [0, 0, 640, 1080],
    A: [640, 0, 640, 1080],
    B: [1280, 0, 640, 1080],
  });
  return world;
}

test("a row of three is a split of three, and moving into one forks it", (t) => {
  const world = rowWorld();

  world.focus("C");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[H:0.50[C,A],B])",
    "with panes either side, the one in the way is halved rather than swapped",
  );
  assert.deepStrictEqual(world.snapshot(), {
    C: [0, 0, 480, 1080],
    A: [480, 0, 480, 1080],
    B: [960, 0, 960, 1080],
  });
  assert.deepStrictEqual(findViolations(world), []);

  /* Now only two panes share that inner split, so it is a plain swap. */
  world.focus("C");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[H:0.50[A,C],B])");
});

test("stepping out of a row and back in makes it a row again", (t) => {
  const world = rowWorld();

  world.focus("A");
  assert.strictEqual(world.shortcut("SwapUp"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(V:0.50[A,H:0.50[C,B]])",
    "nothing above it in the row, so it steps out to the split above",
  );

  assert.strictEqual(world.shortcut("SwapDown"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.33,0.33,0.33[C,A,B])",
    "and coming back it rejoins the row as a third pane, not a nested split",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("move rule 1: a split across the way you are going turns to face it", (t) => {
  const world = threeWorld();

  world.focus("C");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[A,H:0.50[C,B]])",
    "B over C becomes C beside B, with C on the side it was pushed",
  );
  assert.deepStrictEqual(world.snapshot(), {
    A: [0, 0, 960, 1080],
    C: [960, 0, 480, 1080],
    B: [1440, 0, 480, 1080],
  });
  assert.deepStrictEqual(
    world.overlays().drop,
    [960, 0, 480, 1080],
    "and the preview flashes where it landed",
  );
  assert.deepStrictEqual(
    world.overlays().group,
    [960, 0, 960, 1080],
    "with the group it landed in outlined around it",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("a move that joins a group outlines the group it became part of", (t) => {
  const world = threeWorld();

  /* A is on the left, B over C on the right. Pushing A right takes it into
   * the pair, which is the whole arrangement once A's old half closes up. */
  world.focus("A");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(V:0.33,0.33,0.33[B,A,C])",
  );
  assert.deepStrictEqual(
    world.overlays().drop,
    [0, 360, 1920, 360],
    "the flash is A's new pane",
  );
  assert.deepStrictEqual(
    world.overlays().group,
    [0, 0, 1920, 1080],
    "and the outline is the column it is now one of, not just that pane",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("moving into a stack outlines the stack it joined", (t) => {
  const world = threeWorld();

  world.focus("C");
  assert.strictEqual(world.shortcut("ToggleStack"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[A,V:0.50[B,[C]]])",
  );

  world.focus("B");
  assert.strictEqual(world.shortcut("SwapDown"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[A,[C|B]])",
    "B becomes a tab of the stack below it",
  );
  assert.deepStrictEqual(
    world.overlays().group,
    [960, 0, 960, 1080],
    "and the stack it disappeared into is outlined",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("move rule 2: a plain pane in the way trades places", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  world.focus("B");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[B,A])");
  assert.deepStrictEqual(findViolations(world), []);
});

test("move rule 3: a group across the way you are going is entered in the middle", (t) => {
  const world = threeWorld();

  world.focus("A");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(V:0.33,0.33,0.33[B,A,C])",
    "moving across a stacked group there is no near end to arrive at, so A" +
      " lands between its panes - cosmic-comp mod.rs, `we want the middle`",
  );
  assert.deepStrictEqual(world.snapshot(), {
    B: [0, 0, 1920, 360],
    A: [0, 360, 1920, 360],
    C: [0, 720, 1920, 360],
  });
  assert.deepStrictEqual(findViolations(world), []);
});

test("move rule 3: a group along the way you are going is entered at its near end", (t) => {
  const world = rowWorld();

  /* Fork B into A to get `C | (A | B)`, a group lying along the row. */
  world.focus("B");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[C,H:0.50[A,B]])");

  world.focus("C");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.33,0.33,0.33[C,A,B])",
    "C enters at the end it arrives on, which flattens the row again",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("move rule 3: at the end of its split, a pane moves up a layer", (t) => {
  const world = threeWorld();

  world.focus("B");
  assert.strictEqual(
    world.shortcut("SwapUp"),
    true,
    "B is already the top of B-over-C, so it leaves that split entirely",
  );
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(V:0.50[B,H:0.50[A,C]])",
    "and takes the top of the whole screen instead of the top of one column",
  );
  assert.deepStrictEqual(world.snapshot(), {
    B: [0, 0, 1920, 540],
    A: [0, 540, 960, 540],
    C: [960, 540, 960, 540],
  });
  assert.deepStrictEqual(findViolations(world), []);
});

test("moving a group takes every pane under it along", (t) => {
  const world = threeWorld();

  world.focus("C");
  world.shortcut("GroupGrow");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[V:0.50[B,C],A])",
    "B and C cross to A's left as one block, still stacked together",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("the same keys move a pane and a group", (t) => {
  /* One window selected, then two, then the whole screen: no separate
     shortcut anywhere along the way. */
  const world = threeWorld();
  world.focus("C");
  assert.strictEqual(world.shortcut("SwapUp"), true);
  world.shortcut("GroupGrow");
  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.deepStrictEqual(findViolations(world), []);
});

test("moving towards a stack joins it", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();
  /* Pull B back out so A is a stack with B beside it. */
  world.focus("B");
  world.shortcut("SplitHorizontal");
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[[A],B])");

  assert.strictEqual(world.shortcut("SwapLeft"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout([A|B])",
    "B is the stack's only sibling, so moving into it makes it a tab",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("moving out of a stack leaves the other tabs behind", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.shortcut("ToggleStack");
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();
  assert.strictEqual(world.tree(), "ManualTilingLayout([A|B|C])");

  world.focus("B");
  assert.strictEqual(world.shortcut("SwapRight"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[[A|C],B])",
    "B becomes a sibling of the stack, split the way it was pushed",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("a move with nowhere left to go defers to the engine", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  world.focus("A");
  assert.strictEqual(
    world.shortcut("SwapLeft"),
    false,
    "A is already the leftmost thing on the screen",
  );
});

test("the current group is outlined until focus leaves it", (t) => {
  const world = threeWorld();

  world.focus("C");
  world.apply();
  assert.strictEqual(
    world.overlays().outline,
    null,
    "a single pane needs no outline - KWin already marks the focused window",
  );

  world.shortcut("GroupGrow");
  assert.deepStrictEqual(
    world.overlays().outline,
    [960, 0, 960, 1080],
    "the group B and C share is outlined",
  );

  world.focus("A");
  world.apply();
  assert.strictEqual(
    world.overlays().outline,
    null,
    "and stops being outlined the moment focus leaves it",
  );
});

//#endregion

//#region Mouse drops

test("dragging over a pane edge previews the split it would make", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.open("C");
  world.apply();
  /* A on the left half; B over C on the right. */

  /* Left edge of A's pane. */
  assert.deepStrictEqual(
    world.drag("C", [20, 500]),
    [0, 0, 480, 1080],
    "the indicator covers the half C would take",
  );

  assert.strictEqual(world.drop("C"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.33,0.33,0.33[C,A,B])",
    "C joins the row to A's left rather than nesting a split inside it",
  );
  assert.strictEqual(
    world.overlays().drop,
    null,
    "the indicator goes away on drop",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("dropping on the middle of a pane stacks the two windows", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  /* Middle of A's pane. */
  assert.deepStrictEqual(world.drag("B", [480, 540]), [0, 0, 960, 1080]);
  assert.strictEqual(world.drop("B"), true);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout([A|B])",
    "B joins A's pane, which becomes a stack",
  );
  assert.deepStrictEqual(world.snapshot(), {
    A: [0, BAR, 1920, 1080 - BAR],
    B: [0, BAR, 1920, 1080 - BAR],
  });
  assert.strictEqual(
    world.overlays().drop,
    null,
    "the drag's own indicator goes away on drop",
  );
  assert.deepStrictEqual(
    world.overlays().group,
    [0, 0, 1920, 1080],
    "and the stack B joined is outlined instead",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("dragging within its own pane does nothing", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();

  assert.strictEqual(
    world.drag("B", [1400, 540]),
    null,
    "B's own pane is not a target",
  );
  assert.strictEqual(world.drop("B"), false);
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[A,B])");
});

test("dropping a stack member back out of its stack splits the pane", (t) => {
  const world = createWorld();
  world.open("A");
  world.apply();
  world.open("B");
  world.apply();
  world.focus("B");
  world.shortcut("ToggleStack");
  world.focus("A");
  world.shortcut("ToggleStack");

  /* A and B are separate stacks; drag B onto A's right edge. */
  world.drag("B", [940, 540]);
  assert.strictEqual(world.drop("B"), true);
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[[A],B])");
  assert.deepStrictEqual(findViolations(world), []);
});

//#endregion

//#region Migration

test("a group follows its window to another screen", (t) => {
  const world = threeWorld();

  world.focus("C");
  world.shortcut("GroupGrow");

  /* KWin moved C to the next screen; B is selected along with it. */
  assert.deepStrictEqual(
    world.followMove("C", true),
    ["B"],
    "the rest of the group is sent after it",
  );
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(A)",
    "the panes that left close up behind them",
  );
  assert.strictEqual(
    world.neighbor().toString(),
    "ManualTilingLayout(V:0.50[B,C])",
    "and arrive on the other screen still arranged the same way",
  );
  assert.deepStrictEqual(findViolations(world), []);
});

test("the signals before a window has landed do not consume the group", (t) => {
  const world = threeWorld();

  world.focus("C");
  world.shortcut("GroupGrow");

  /* Moving to another screen reassigns the virtual desktop too, so the driver
     is told more than once - and the first time, C is still here. */
  assert.strictEqual(world.followMove("C", false), null);
  assert.strictEqual(
    world.tree(),
    "ManualTilingLayout(H:0.50[A,V:0.50[B,C]])",
    "nothing was handed over, so the group is still here",
  );

  assert.deepStrictEqual(
    world.followMove("C", true),
    ["B"],
    "and the real move still finds it",
  );
  assert.strictEqual(world.neighbor().toString(), "ManualTilingLayout(V:0.50[B,C])");
});

test("a group survives its window leaving the screen", (t) => {
  const world = threeWorld();

  world.focus("C");
  world.shortcut("GroupGrow");

  /* An arrange with the focus off this surface must not wipe the selection:
     the group still has to be here to follow C when the driver asks. */
  world.ctx.currentWindow = null;
  world.apply();
  assert.strictEqual(
    world.overlays().outline,
    null,
    "there is nothing to outline here while focus is elsewhere",
  );
  assert.deepStrictEqual(world.followMove("C", true), ["B"]);
});

test("a window on its own crosses screens alone", (t) => {
  const world = threeWorld();
  world.focus("C");
  assert.strictEqual(
    world.followMove("C", true),
    null,
    "no group is selected, so KWin's move means what it always did",
  );
  assert.strictEqual(world.tree(), "ManualTilingLayout(H:0.50[A,V:0.50[B,C]])");
});

//#endregion
