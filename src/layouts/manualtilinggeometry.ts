/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/** Smallest share of a split one pane may be squeezed to, as a fraction. */
const MT_MIN_SHARE = 0.05;
/** Never hand a pane fewer pixels than this along the axis being split. */
const MT_MIN_PANE = 1;
/** Height of the tab strip drawn above a stacked pane. */
const MT_TABBAR_HEIGHT = 26;

/**
 * Lays a manual tiling tree out on screen, for one set of windows.
 *
 * Built once per `apply` from the windows the engine handed the layout, and
 * kept afterwards so that resizing and the commands work from exactly what
 * was last put on screen, minimum sizes included.
 *
 * Two rules shape everything here:
 *
 *  - A pane with nothing on screen - its windows minimized, fullscreen, on
 *    another desktop - takes no space. Its share goes to the panes that are
 *    showing, and a split left with one showing pane renders as that pane.
 *  - Panes are held at their windows' minimum size wherever the area allows.
 *    A pane smaller than its window is either overlapped by it or, with
 *    CONFIG.unfitGreater, floated by `arrangeScreen` - both of which tear up
 *    an arrangement the user built by hand.
 */
class MTGeometry {
  constructor(
    /** Ids of the windows on screen. */
    public readonly ids: Set<string>,
    private readonly minSizes: { [id: string]: ISize },
    public readonly gap: number,
  ) {}

  public static empty(): MTGeometry {
    return new MTGeometry(new Set<string>(), {}, 0);
  }

  public static forWindows(windows: WindowClass[], gap: number): MTGeometry {
    const ids = new Set<string>();
    const minSizes: { [id: string]: ISize } = {};
    windows.forEach((window) => {
      ids.add(window.id);
      minSizes[window.id] = window.minSize;
    });
    return new MTGeometry(ids, minSizes, gap);
  }

  /** Whether anything in a subtree is on screen. */
  public isShowing(tree: MTTree): boolean {
    if (tree instanceof MTLeaf)
      return tree.windowIds.some((id) => this.ids.has(id));
    return tree.children.some((child) => this.isShowing(child));
  }

  /** The children of a split with something on screen, in order. */
  public showingChildren(node: MTNode): MTTree[] {
    return node.children.filter((child) => this.isShowing(child));
  }

  /**
   * Assign geometry to every node of the tree.
   *
   * @returns the leaves on screen, in order - which is on-screen order too,
   * since children are visited first to last.
   */
  public render(root: MTTree | null, area: Rect): MTLeaf[] {
    const out: MTLeaf[] = [];
    if (root !== null) this._render(root, area, out);
    return out;
  }

  private _render(tree: MTTree, area: Rect | null, out: MTLeaf[]): void {
    /* Everything below a pane that is not shown is cleared, so no stale rect
     * survives to be mistaken for a pane on screen. */
    if (area === null || !this.isShowing(tree)) {
      this._clear(tree);
      return;
    }
    tree.rect = area;

    if (tree instanceof MTLeaf) {
      tree.renderedIds = tree.windowIds.filter((id) => this.ids.has(id));
      /* The tab strip covers the top of the pane, so the windows only get
       * what is left underneath it. */
      tree.contentRect =
        tree.isStack && area.height > MT_TABBAR_HEIGHT
          ? area.gap(0, 0, MT_TABBAR_HEIGHT, 0)
          : area;
      out.push(tree);
      return;
    }

    const showing = this.showingChildren(tree);
    const areas =
      showing.length > 1 ? this.splitAreas(tree, showing, area) : null;
    tree.children.forEach((child) => {
      const index = showing.indexOf(child);
      if (areas !== null && index >= 0) this._render(child, areas[index], out);
      /* One showing pane, or too little room to divide the area: it all goes
       * to the first, and apply floats whatever is left without a pane. */
      else this._render(child, index === 0 ? area : null, out);
    });
  }

  private _clear(tree: MTTree): void {
    tree.rect = null;
    if (tree instanceof MTLeaf) {
      tree.contentRect = null;
      tree.renderedIds = [];
    } else tree.children.forEach((child) => this._clear(child));
  }

  /**
   * Divide an area between the showing panes of a split.
   *
   * Integer arithmetic against a running boundary, rather than
   * LayoutUtils.splitAreaWeighted, so that the parts tile their parent
   * exactly - no pixel left over, none counted twice.
   *
   * @returns one area per showing child, or null when there isn't room to
   * divide the area at all.
   */
  public splitAreas(
    node: MTNode,
    showing: MTTree[],
    area: Rect,
  ): Rect[] | null {
    const horizontal = node.orientation === "horizontal";
    const total = horizontal ? area.width : area.height;
    const available = total - (showing.length - 1) * this.gap;
    if (available < showing.length * MT_MIN_PANE) return null;

    const areas: Rect[] = [];
    let offset = horizontal ? area.x : area.y;
    this.splitLengths(node, showing, available).forEach((length) => {
      areas.push(
        horizontal
          ? new Rect(offset, area.y, length, area.height)
          : new Rect(area.x, offset, area.width, length),
      );
      offset += length + this.gap;
    });
    return areas;
  }

  /**
   * How many pixels along the split's axis each showing pane gets.
   *
   * Shares first, then a repair pass that lifts any pane below its windows'
   * minimum size, taking the difference from whichever panes have the most
   * room to spare. When the minimums cannot all be met the shares stand, and
   * the engine's unfit handling decides what happens to the windows.
   */
  public splitLengths(
    node: MTNode,
    showing: MTTree[],
    available: number,
  ): number[] {
    const horizontal = node.orientation === "horizontal";
    const weights = showing.map((child) => {
      const weight = node.weights[node.indexOf(child)];
      return weight > 0 ? weight : MT_MIN_SHARE;
    });
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

    /* Round the running boundary once rather than each length separately, so
     * the parts add up to exactly `available`. */
    const lengths: number[] = [];
    let acc = 0;
    let previous = 0;
    weights.forEach((weight, i) => {
      acc += weight;
      const boundary =
        i === weights.length - 1
          ? available
          : Math.round((acc / weightSum) * available);
      lengths.push(boundary - previous);
      previous = boundary;
    });

    /* When the minimums cannot all be met, still give every pane at least a
     * pixel - through the same repair, so the parts keep adding up exactly.
     * splitAreas has already checked there is a pixel for each. */
    let mins = showing.map((child) => this.minLength(child, horizontal));
    if (mins.reduce((sum, min) => sum + min, 0) > available)
      mins = showing.map(() => MT_MIN_PANE);

    let deficit = 0;
    const slack = lengths.map((length, i) => {
      if (length >= mins[i]) return length - mins[i];
      deficit += mins[i] - length;
      lengths[i] = mins[i];
      return 0;
    });
    if (deficit === 0) return lengths;

    const order = lengths.map((_, i) => i).sort((a, b) => slack[b] - slack[a]);
    for (const i of order) {
      if (deficit === 0) break;
      const take = Math.min(slack[i], deficit);
      lengths[i] -= take;
      deficit -= take;
    }
    return lengths;
  }

  /**
   * Pixels a subtree needs along one axis to hold every showing pane in it at
   * its windows' minimum size. Splits along the axis add up, gaps included;
   * splits across it need only as much as their largest pane.
   */
  public minLength(tree: MTTree, horizontal: boolean): number {
    if (tree instanceof MTLeaf)
      return this.isShowing(tree) ? this.leafMin(tree, horizontal) : 0;

    const parts = this.showingChildren(tree).map((child) =>
      this.minLength(child, horizontal),
    );
    if (parts.length === 0) return 0;
    if ((tree.orientation === "horizontal") === horizontal)
      return (
        parts.reduce((sum, part) => sum + part, 0) +
        (parts.length - 1) * this.gap
      );
    return Math.max(...parts);
  }

  /**
   * Pixels one pane needs along one axis. Stack members all get the whole
   * pane, so the most demanding of them sets the figure, and a stack has to
   * find room for its tab strip too.
   */
  public leafMin(leaf: MTLeaf, horizontal: boolean): number {
    let min = MT_MIN_PANE;
    leaf.windowIds.forEach((id) => {
      const size = this.minSizes[id];
      if (size !== undefined && this.ids.has(id))
        min = Math.max(min, horizontal ? size.width : size.height);
    });
    if (!horizontal && leaf.isStack) min += MT_TABBAR_HEIGHT;
    return min;
  }

  /**
   * Whether two panes fit side by side (or one above the other) in `area`,
   * each at its windows' minimum size.
   */
  public fitsSplit(
    area: Rect,
    a: MTLeaf,
    b: MTLeaf,
    orientation: MTOrientation,
  ): boolean {
    const horizontal = orientation === "horizontal";
    const available = (horizontal ? area.width : area.height) - this.gap;
    return (
      this.leafMin(a, horizontal) + this.leafMin(b, horizontal) <= available
    );
  }

  /**
   * Resize the pane holding `basisId` by `delta`, retuning the shares of every
   * split between it and the root.
   *
   * Each split consumes the edges it owns - a pane owns the divider before it
   * unless it is first, and the one after it unless it is last - and passes
   * the rest up to the split above, so dragging an outer edge of a nested
   * pane moves the divider that edge actually is.
   */
  public adjust(
    root: MTTree,
    area: Rect,
    basisId: string,
    delta: RectDelta,
  ): void {
    this._adjust(root, area, basisId, delta);
  }

  /** @returns the delta left for the caller, or null if `basisId` isn't here. */
  private _adjust(
    tree: MTTree,
    area: Rect,
    basisId: string,
    delta: RectDelta,
  ): RectDelta | null {
    if (tree instanceof MTLeaf) return tree.has(basisId) ? delta : null;

    const showing = this.showingChildren(tree);
    if (showing.length === 0) return null;
    /* Collapsed exactly as render collapsed it, so `area` still matches. */
    const areas =
      showing.length > 1 ? this.splitAreas(tree, showing, area) : null;
    if (areas === null) return this._adjust(showing[0], area, basisId, delta);

    let target = -1;
    let result: RectDelta | null = null;
    for (let i = 0; i < showing.length && result === null; i++) {
      result = this._adjust(showing[i], areas[i], basisId, delta);
      if (result !== null) target = i;
    }
    if (result === null) return null;

    const horizontal = tree.orientation === "horizontal";
    /* Start from the shares actually drawn, not the stored ones, so dragging
     * a divider that is pinned by a minimum size doesn't jump. */
    const total = horizontal ? area.width : area.height;
    const available = total - (showing.length - 1) * this.gap;
    const drawn = this.splitLengths(tree, showing, available).map((length) =>
      available > 0 ? length / available : 1 / showing.length,
    );
    LayoutUtils.adjustAreaWeights(
      area,
      drawn,
      this.gap,
      target,
      result,
      horizontal,
    ).forEach((weight, i) => {
      if (!isNaN(weight))
        tree.weights[tree.indexOf(showing[i])] = Math.max(MT_MIN_SHARE, weight);
    });

    const ownsStart = target > 0;
    const ownsEnd = target < showing.length - 1;
    return horizontal
      ? new RectDelta(
          ownsEnd ? 0 : result.east,
          ownsStart ? 0 : result.west,
          result.south,
          result.north,
        )
      : new RectDelta(
          result.east,
          result.west,
          ownsEnd ? 0 : result.south,
          ownsStart ? 0 : result.north,
        );
  }
}
