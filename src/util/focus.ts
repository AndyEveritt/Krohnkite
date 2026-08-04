/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * Reduce directional-focus candidates so that windows sharing a pane count
 * once, as whichever of them was focused last.
 *
 * The tabs of a stacked pane all have the same geometry on purpose, and that
 * breaks directional focus in two ways:
 *
 *  - A tab-mate of the window being left sits at distance zero, which beats
 *    every genuine neighbour. Focus could never leave the stack.
 *  - A stack being moved *into* should hand over the tab on top, not whichever
 *    of its equidistant members a tie-break happens to reach first - landing
 *    on a buried tab changes what the pane is showing just by focusing it.
 *
 * The most recently focused member of a pane is the one on top, so keeping
 * only that one answers both.
 *
 * @param basis the window focus is moving away from; kept whatever happens,
 * since callers look for it in the result.
 */
function topOfEachPane<T>(
  items: T[],
  geometryOf: (item: T) => Rect,
  focusTimeOf: (item: T) => number,
  basis: T | null,
): T[] {
  const paneKey = (rect: Rect): string =>
    `${rect.x},${rect.y},${rect.width},${rect.height}`;

  const basisKey = basis !== null ? paneKey(geometryOf(basis)) : null;

  const order: string[] = [];
  const best: { [key: string]: T } = {};

  items.forEach((item) => {
    const key = paneKey(geometryOf(item));

    if (item === basis) {
      /* Always kept, and it owns its pane outright: any tab-mate is dropped
       * below, so nothing else can claim this key. */
      if (best[key] === undefined) order.push(key);
      best[key] = item;
      return;
    }
    /* A tab-mate of the window being left is in the same place as it, and
     * there is no direction from a window to one on top of it. */
    if (basisKey !== null && key === basisKey) return;

    const current = best[key];
    if (current === undefined) {
      order.push(key);
      best[key] = item;
    } else if (focusTimeOf(item) > focusTimeOf(current)) {
      best[key] = item;
    }
  });

  return order.map((key) => best[key]);
}
