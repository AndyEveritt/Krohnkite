/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * `topOfEachPane` decides which windows directional focus may land on.
 *
 * It exists because a stacked pane's tabs all share one geometry: without it
 * a tab-mate sits at distance zero from the window being left and wins every
 * time, so focus can never leave a stack.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadKrohnkite } = require("./harness");

const K = loadKrohnkite();

/** A window: an id, the pane it occupies, and when it last had the focus. */
function win(id, [x, y, w, h], focusTime) {
  return { id, rect: new K.Rect(x, y, w, h), focusTime: focusTime || 0 };
}

function reduce(windows, basis) {
  return K.topOfEachPane(
    windows,
    (item) => item.rect,
    (item) => item.focusTime,
    basis !== undefined ? basis : null,
  ).map((item) => item.id);
}

const LEFT = [0, 0, 960, 1080];
const RIGHT = [960, 0, 960, 1080];

test("windows in different panes are all kept", (t) => {
  const a = win("A", LEFT);
  const b = win("B", RIGHT);
  assert.deepStrictEqual(reduce([a, b], a), ["A", "B"]);
});

test("the tabs of the stack being left are dropped", (t) => {
  /* S1 has the focus; S2 and S3 are its tab-mates, in the same place. */
  const s1 = win("S1", LEFT, 3);
  const s2 = win("S2", LEFT, 2);
  const s3 = win("S3", LEFT, 1);
  const other = win("B", RIGHT, 4);

  assert.deepStrictEqual(
    reduce([s1, s2, s3, other], s1),
    ["S1", "B"],
    "only the neighbour is left to move to, so focus can leave the stack",
  );
});

test("the window being left is kept even when it shares its pane", (t) => {
  const s1 = win("S1", LEFT, 1);
  const s2 = win("S2", LEFT, 9);
  assert.deepStrictEqual(
    reduce([s2, s1], s1),
    ["S1"],
    "callers look for the basis in the result, so it survives a tab-mate " +
      "that was focused more recently",
  );
});

test("a stack being moved into offers the tab on top", (t) => {
  const a = win("A", LEFT, 9);
  const s1 = win("S1", RIGHT, 2);
  const s2 = win("S2", RIGHT, 7);
  const s3 = win("S3", RIGHT, 5);

  assert.deepStrictEqual(
    reduce([a, s1, s2, s3], a),
    ["A", "S2"],
    "S2 was focused last, so it is the one on show",
  );
});

test("panes keep the order they were given in", (t) => {
  const a = win("A", [0, 0, 100, 100]);
  const b = win("B", [100, 0, 100, 100]);
  const c = win("C", [200, 0, 100, 100]);
  assert.deepStrictEqual(reduce([c, a, b], null), ["C", "A", "B"]);
});

test("with no basis, nothing is dropped but the buried tabs", (t) => {
  const s1 = win("S1", LEFT, 1);
  const s2 = win("S2", LEFT, 5);
  const b = win("B", RIGHT, 3);
  assert.deepStrictEqual(reduce([s1, s2, b], null), ["S2", "B"]);
});
