/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/** Geometry helpers shared by every layout. */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadKrohnkite, makeRandom } = require("./harness");

/** Stand-ins for WindowClass: the layout parts only read and write `weight`. */
function fakeTiles(count) {
  const tiles = [];
  for (let i = 0; i < count; i++) tiles.push({ id: `w${i}`, weight: 1 });
  return tiles;
}

/** Every combination of length, gap and weight worth checking. */
function eachSplit(visit) {
  const { LayoutUtils, Rect } = loadKrohnkite();
  for (let length = 2; length <= 1400; length++) {
    for (const gap of [0, 2, 4, 8, 16]) {
      if (length <= gap + 2) continue;
      for (let i = 1; i < 200; i++) {
        const weight = i / 200;
        const [first, second] = LayoutUtils.splitAreaHalfWeighted(
          new Rect(0, 0, length, 100),
          weight,
          gap,
          true,
        );
        visit({ length, gap, weight, first, second });
      }
    }
  }
}

test("splitAreaHalfWeighted keeps both parts inside the area", (t) => {
  const offenders = [];
  eachSplit(({ length, gap, weight, first, second }) => {
    if (first.width < 0 || second.width < 0 || second.x < first.x)
      offenders.push(
        `length ${length} gap ${gap} weight ${weight}: ${first} | ${second}`,
      );
  });
  assert.deepStrictEqual(offenders.slice(0, 5), []);
});

/*
 * Regression: splitWeighted used to floor each part's origin and its length
 * separately, then add the leftover pixels to the trailing part - without
 * accounting for the rounding already applied to that part's origin. The
 * trailing part could end a pixel past the line it was given, so a window hung
 * a pixel over the screen edge or its neighbor, and the gap between two panes
 * came out a pixel wide. Only with a non-zero gap, and more often as the gap
 * grew. Every layout that splits through this helper was affected.
 */
test("splitAreaHalfWeighted tiles its area exactly", (t) => {
  const offenders = [];
  eachSplit(({ length, gap, weight, first, second }) => {
    const covered = first.width + gap + second.width;
    if (second.x + second.width !== length || covered !== length)
      offenders.push(
        `length ${length} gap ${gap} weight ${weight}: ` +
          `${first} | ${second} covers ${covered}`,
      );
  });
  assert.deepStrictEqual(
    offenders.slice(0, 5),
    [],
    `${offenders.length} weight/gap combinations do not tile exactly`,
  );
});

test("splitWeighted tiles a line exactly for any number of parts", (t) => {
  const { LayoutUtils } = loadKrohnkite();
  const random = makeRandom(20260726);
  const offenders = [];

  for (let count = 1; count <= 6; count++) {
    for (let length = count * 4; length <= 1400; length += 7) {
      for (const gap of [0, 2, 4, 8, 16]) {
        if (length <= (count - 1) * gap + count) continue;
        /* A mix of even weights and lopsided ones, as adjust() produces. */
        const weights = [];
        for (let i = 0; i < count; i++)
          weights.push(count === 1 ? 1 : 0.2 + random(100) / 100);

        const begin = random(50);
        const parts = LayoutUtils.splitWeighted(
          [begin, length],
          weights,
          gap,
        );
        const describe = () =>
          `${count} parts, length ${length}, gap ${gap}, weights ${weights
            .map((w) => w.toFixed(2))
            .join("/")}: ${parts.map(([b, l]) => `[${b},${l}]`).join(" ")}`;

        if (parts.length !== count) offenders.push(`wrong count: ${describe()}`);
        if (parts[0][0] !== begin)
          offenders.push(`does not start on the line: ${describe()}`);
        const last = parts[parts.length - 1];
        if (last[0] + last[1] !== begin + length)
          offenders.push(`does not end on the line: ${describe()}`);
        parts.forEach(([, partLength], i) => {
          if (partLength < 0) offenders.push(`negative part ${i}: ${describe()}`);
        });
        for (let i = 1; i < parts.length; i++) {
          const previousEnd = parts[i - 1][0] + parts[i - 1][1];
          if (parts[i][0] - previousEnd !== gap)
            offenders.push(`gap before part ${i} is wrong: ${describe()}`);
        }
      }
    }
  }

  assert.deepStrictEqual(
    offenders.slice(0, 5),
    [],
    `${offenders.length} splits are malformed`,
  );
});

/*
 * The layout parts every other layout is built from. They are exercised here
 * rather than through the layouts themselves because a layout needs CONFIG,
 * which only exists inside a running KWin - but these parts are where the
 * shared splitting maths actually reaches the screen.
 */

test("StackLayoutPart tiles its area exactly", (t) => {
  const { StackLayoutPart, Rect } = loadKrohnkite();
  const random = makeRandom(4242);
  const part = new StackLayoutPart();
  const offenders = [];

  for (let count = 1; count <= 6; count++) {
    for (const gap of [0, 4, 8, 16]) {
      for (let height = count * 20; height <= 1080; height += 37) {
        const tiles = fakeTiles(count);
        /* Weights drift away from 1 as the user resizes tiles. */
        tiles.forEach((tile) => (tile.weight = 0.3 + random(200) / 100));
        const area = new Rect(0, 0, 800, height);
        const rects = part.apply(area, tiles, gap);

        if (rects[0].y !== area.y)
          offenders.push(`starts at ${rects[0].y}, not ${area.y}`);
        const last = rects[rects.length - 1];
        if (last.maxY !== area.maxY)
          offenders.push(
            `${count} tiles, gap ${gap}, height ${height}: ends at ${last.maxY}, not ${area.maxY}`,
          );
        for (let i = 1; i < rects.length; i++)
          if (rects[i].y - rects[i - 1].maxY !== gap)
            offenders.push(
              `${count} tiles, gap ${gap}, height ${height}: gap ${i} is ${
                rects[i].y - rects[i - 1].maxY
              }`,
            );
      }
    }
  }
  assert.deepStrictEqual(
    offenders.slice(0, 5),
    [],
    `${offenders.length} stacks are malformed`,
  );
});

test("HalfSplitLayoutPart tiles its area exactly at every angle", (t) => {
  const { HalfSplitLayoutPart, FillLayoutPart, Rect } = loadKrohnkite();
  const offenders = [];

  for (const angle of [0, 90, 180, 270]) {
    for (const gap of [0, 4, 8, 16]) {
      for (let size = 40; size <= 1200; size += 23) {
        for (const ratio of [0.1, 0.25, 0.5, 0.58, 0.7, 0.9]) {
          const part = new HalfSplitLayoutPart(
            new FillLayoutPart(),
            new FillLayoutPart(),
          );
          part.angle = angle;
          part.ratio = ratio;
          part.primarySize = 1;

          const area = new Rect(0, 0, size, size);
          const rects = part.apply(area, fakeTiles(2), gap);
          const inside = rects.every(
            (r) =>
              r.x >= area.x &&
              r.y >= area.y &&
              r.maxX <= area.maxX &&
              r.maxY <= area.maxY &&
              r.width > 0 &&
              r.height > 0,
          );
          if (!inside)
            offenders.push(
              `angle ${angle}, gap ${gap}, size ${size}, ratio ${ratio}: ${rects.join(
                " | ",
              )}`,
            );
        }
      }
    }
  }
  assert.deepStrictEqual(
    offenders.slice(0, 5),
    [],
    `${offenders.length} half splits leave their area`,
  );
});
