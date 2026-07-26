/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * "horizontal" splits an area into two panes side by side (left | right).
 * "vertical" stacks them (top / bottom).
 */
type MTOrientation = "horizontal" | "vertical";

/** Smallest/largest share a split is allowed to give to one of its children. */
const MT_MIN_RATIO = 0.05;
const MT_MAX_RATIO = 0.95;
/** Never hand a pane fewer pixels than this along the axis being split. */
const MT_MIN_PANE = 1;

/** A slot holding exactly one window, identified by its stable window id. */
class MTLeaf {
  /** Geometry this leaf was last rendered at; null until it renders once. */
  public rect: Rect | null;

  constructor(public windowId: string) {
    this.rect = null;
  }
}

/** A split. `first` is the left (horizontal) or top (vertical) child. */
class MTNode {
  public ratio: number;

  constructor(
    public orientation: MTOrientation,
    public first: MTTree,
    public second: MTTree,
  ) {
    this.ratio = 0.5;
  }
}

type MTTree = MTLeaf | MTNode;

/**
 * A manual tiling layout: a binary split tree the user edits directly, rather
 * than a shape derived from the number of windows.
 *
 * New windows split the bottom-right-most pane, along its longer axis. From
 * there the user rearranges with the Split/Unsplit shortcuts, resizes splits
 * like any other layout, and swaps panes with the directional move shortcuts.
 *
 * Unlike BinaryTreeLayout, the tree is state: it lives on this instance, which
 * LayoutStore keeps for the whole session, so it survives arranges and
 * switching away to another layout and back. Notable consequences:
 *
 *  - `apply` MUST stay idempotent. `arrangeScreen` re-applies the layout
 *    repeatedly when CONFIG.unfitGreater/unfitLess are on, each time with a
 *    smaller `tileables`; prune, insert and render are all safe to repeat.
 *    Don't add side effects here.
 *  - Leaves survive a window going away temporarily - minimized, fullscreen,
 *    on another virtual desktop - so a hand-built arrangement comes back
 *    intact. Such windows simply don't render, and their space collapses into
 *    their sibling. Leaves are dropped when the window closes or is floated;
 *    see _prune for why floating has to release the pane.
 *  - Panes are sized to respect each window's minimum size wherever the area
 *    allows it, because a pane below its minSize makes arrangeScreen float a
 *    window to get rid of it (engine.ts:670-733).
 *  - The tree is memory-only; it does not survive a compositor restart.
 *  - With CONFIG.layoutPerDesktop disabled one instance is shared by every
 *    virtual desktop on an output, so a single tree holds windows the user
 *    can't all see at once. Rendering stays correct, but structural edits can
 *    graft a pane next to an invisible one. Same limitation as ColumnsLayout.
 *  - CONFIG.newWindowPosition has no effect here: placement is decided by "is
 *    this id already in the tree", not by position in the engine's window list.
 */
class ManualTilingLayout implements ILayout {
  public static readonly id = "ManualTilingLayout";

  public readonly classID = ManualTilingLayout.id;
  public readonly capacity?: number | null;

  public get description(): string {
    return "Manual Tiling";
  }

  private root: MTTree | null;

  /* State from the most recent apply(). adjust() and the shortcut handlers work
   * from these instead of their own arguments, so they always see exactly what
   * was last put on screen. */
  private lastArea: Rect | null;
  private lastGap: number;
  private lastRenderedIds: Set<string>;
  /** Minimum size of each rendered window, so adjust() sees them too. */
  private lastMinSizes: { [id: string]: ISize };
  /** Leaves that actually rendered, in on-screen (in-order) sequence. */
  private renderedLeaves: MTLeaf[];

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.root = null;
    this.lastArea = null;
    this.lastGap = 0;
    this.lastRenderedIds = new Set<string>();
    this.lastMinSizes = {};
    this.renderedLeaves = [];
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    this._prune(ctx);

    const ids = new Set<string>();
    const minSizes: { [id: string]: ISize } = {};
    tileables.forEach((tileable) => {
      ids.add(tileable.id);
      minSizes[tileable.id] = tileable.minSize;
    });

    this.lastArea = area.clone();
    this.lastGap = gap;
    this.lastRenderedIds = ids;
    this.lastMinSizes = minSizes;
    this.renderedLeaves = this._renderPass(area, ids, gap);

    /* Insert one at a time, re-rendering in between, so a batch of new windows
     * lands exactly where opening them one by one would put them. */
    tileables.forEach((tileable) => {
      if (this._findLeaf(tileable.id) !== null) return;
      this._insertWindow(tileable.id);
      this.renderedLeaves = this._renderPass(area, ids, gap);
    });

    const byId: { [id: string]: WindowClass } = {};
    tileables.forEach((tileable) => {
      tileable.state = WindowState.Tiled;
      byId[tileable.id] = tileable;
    });

    const placed = new Set<string>();
    this.renderedLeaves.forEach((leaf) => {
      const window = byId[leaf.windowId];
      if (window !== undefined && leaf.rect !== null) {
        window.geometry = leaf.rect;
        placed.add(leaf.windowId);
      }
    });

    /* Anything left without a pane - only reachable when the area is too
     * small to divide any further - must be floated, not left marked Tiled.
     * A tiled window holding stale geometry is the worst outcome available:
     * it looks like it is floating but ignores every command that would put
     * it back, because as far as the engine is concerned it is already tiled. */
    tileables.forEach((tileable) => {
      if (!placed.has(tileable.id)) tileable.state = WindowState.Floating;
    });
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ): void {
    if (this.root === null) return;
    /* The engine builds `area` from the bare working area: no dock subtraction,
     * no sole-window override. Use what we actually rendered instead, or the
     * ratios get recalculated against the wrong pixel lengths. */
    const adjustArea = this.lastArea !== null ? this.lastArea : area;
    const adjustGap = this.lastArea !== null ? this.lastGap : gap;
    this._adjustNode(this.root, adjustArea, basis.id, delta, adjustGap);
  }

  public handleShortcut(
    ctx: EngineContext,
    input: Shortcut,
    data?: any,
  ): boolean {
    switch (input) {
      case Shortcut.SplitHorizontal:
        return this._split(ctx, "horizontal");
      case Shortcut.SplitVertical:
        return this._split(ctx, "vertical");

      /* Increase and Decrease are the layout-owned "more / fewer divisions"
       * keys - TileLayout adds or drops a master, Stair and Spread a tile.
       * Adding and removing a split is the same idea, and both come bound
       * already, so the layout is usable without binding anything. */
      case Shortcut.Increase:
        return this._split(ctx, null);
      case Shortcut.Decrease:
        return this._unsplit(ctx);

      /* Flipping a split is its own action, not something splitting does as a
       * side effect of having nowhere else to put a window. */
      case Shortcut.Rotate:
        return this._rotate(ctx);

      /* The engine's own directional move only reorders WindowStore.list,
       * which this layout never reads, so it would look dead here. Shift* is
       * remapped to Swap* before layouts are consulted in "focus" mode, but
       * not in "dwm" mode, hence both. */
      case Shortcut.SwapLeft:
      case Shortcut.ShiftLeft:
        return this._moveDirection(ctx, "left");
      case Shortcut.SwapRight:
      case Shortcut.ShiftRight:
        return this._moveDirection(ctx, "right");
      case Shortcut.SwapUp:
      case Shortcut.ShiftUp:
        return this._moveDirection(ctx, "up");
      case Shortcut.SwapDown:
      case Shortcut.ShiftDown:
        return this._moveDirection(ctx, "down");

      default:
        return false;
    }
  }

  public toString(): string {
    return `ManualTilingLayout(${this._describe(this.root)})`;
  }

  //#region Commands

  /**
   * Put a new split around the focused window, and move the window next to it
   * on screen into the other half. Everything else shifts up to fill the gap
   * that leaves, which is what makes the whole arrangement reflow.
   *
   * @param orientation which way to cut, or null to cut along the pane's
   * longer side - the same choice a new window would make.
   */
  private _split(
    ctx: EngineContext,
    orientation: MTOrientation | null,
  ): boolean {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null) return false;

    const partner = this._splitPartner(leaf);
    /* Nothing to pull in: only one window is tiled here. */
    if (partner === null) return false;
    const partnerIsAfter =
      this.renderedLeaves.indexOf(partner) > this.renderedLeaves.indexOf(leaf);

    /* Resolved once the partner is known, so the fit check can weigh both
     * windows' minimum sizes. */
    const cut =
      orientation !== null
        ? orientation
        : this._insertOrientation(leaf, partner.windowId);

    if (partner === this._siblingLeafOf(leaf)) {
      /* Only reachable when the focused window's own sibling is the sole
       * candidate, i.e. two windows are tiled. Pulling it into a new split
       * beside the focused window would rebuild the very node they already
       * share, so all that is left to do is reorient it. Use Rotate to do
       * this deliberately. */
      const node = (this._findParent(leaf) as { parent: MTNode }).parent;
      if (node.orientation === cut) return false;
      node.orientation = cut;
      node.ratio = 0.5;
      return true;
    }

    /* Detach first: wrapping before detaching would briefly leave the partner
     * in the tree twice. */
    if (!this._detach(partner)) return false;
    const node = new MTNode(
      cut,
      partnerIsAfter ? leaf : partner,
      partnerIsAfter ? partner : leaf,
    );
    return this._replace(leaf, node);
  }

  /**
   * The window to move into the other half of a new split.
   *
   * Nearest on screen wins, looking forwards before backwards, but the
   * focused window's own sibling is taken last: moving *that* one into a new
   * split beside the focused window produces the very node they already
   * share, so it reorients the pane instead of dividing it. Preferring anyone
   * else means a split actually adds a division. The sibling is still the
   * fallback, for when it is the only window left to draw on.
   */
  private _splitPartner(leaf: MTLeaf): MTLeaf | null {
    const index = this.renderedLeaves.indexOf(leaf);
    if (index < 0) return null;

    const sibling = this._siblingLeafOf(leaf);
    let fallback: MTLeaf | null = null;
    for (let step = 1; step < this.renderedLeaves.length; step++) {
      const nearby: MTLeaf[] = [];
      if (index + step < this.renderedLeaves.length)
        nearby.push(this.renderedLeaves[index + step]);
      if (index - step >= 0) nearby.push(this.renderedLeaves[index - step]);
      for (const candidate of nearby) {
        if (candidate !== sibling) return candidate;
        if (fallback === null) fallback = candidate;
      }
    }
    return fallback;
  }

  /** The window sharing the focused window's split, if it is a single window. */
  private _siblingLeafOf(leaf: MTLeaf): MTLeaf | null {
    const parentInfo = this._findParent(leaf);
    if (parentInfo === null) return null;
    const sibling =
      parentInfo.slot === "first"
        ? parentInfo.parent.second
        : parentInfo.parent.first;
    return sibling instanceof MTLeaf ? sibling : null;
  }

  /**
   * Turn the split the focused window sits in from side-by-side to stacked, or
   * back. The ratio is kept, so the panes hold their proportions.
   *
   * Walks past splits whose other side isn't on screen - rotating one of those
   * would change nothing the user can see.
   */
  private _rotate(ctx: EngineContext): boolean {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null) return false;

    let node: MTTree = leaf;
    for (;;) {
      const parentInfo = this._findParent(node);
      if (parentInfo === null) return false;
      const other =
        parentInfo.slot === "first"
          ? parentInfo.parent.second
          : parentInfo.parent.first;
      if (this._hasRenderable(other, this.lastRenderedIds)) {
        parentInfo.parent.orientation =
          parentInfo.parent.orientation === "horizontal"
            ? "vertical"
            : "horizontal";
        return true;
      }
      node = parentInfo.parent;
    }
  }

  /**
   * Remove the split above the focused window, expanding it into the whole
   * area that split occupied. Whatever shared the split moves, intact, into
   * the bottom-right-most pane elsewhere in the tree.
   *
   * Refused when there is nowhere else to move it to - notably when the split
   * is the root of the tree, which includes every two-window arrangement.
   *
   * Takes no orientation, unlike _split: a window has exactly one parent
   * split, so there is never a choice of which one to remove. Separate
   * horizontal and vertical unsplit commands could only ever differ by
   * refusing to act.
   */
  private _unsplit(ctx: EngineContext): boolean {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null) return false;

    const parentInfo = this._findParent(leaf);
    if (parentInfo === null) return false;
    const parent = parentInfo.parent;

    const sibling =
      parentInfo.slot === "first" ? parent.second : parent.first;

    /* Target must be outside the split being dissolved, or the sibling would
     * land right back where it started. */
    const inside = new Set<MTLeaf>(this._leaves(parent));
    const target = this._bottomRightMost(inside);
    if (target === null || target.rect === null) return false;

    const targetOrientation = this._orientationFor(target.rect);
    if (!this._replace(parent, leaf)) return false;
    return this._replace(
      target,
      new MTNode(targetOrientation, target, sibling),
    );
  }

  /** Swap the focused window with its neighbor in the given direction. */
  private _moveDirection(ctx: EngineContext, dir: Direction): boolean {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null || leaf.rect === null) return false;

    const target = this._neighbor(ctx, leaf, dir);
    /* No neighbor: let the engine take over, so an edge press still pushes
     * the window to the next screen or virtual desktop. */
    if (target === null) return false;

    const windowId = leaf.windowId;
    const rect = leaf.rect;
    leaf.windowId = target.windowId;
    leaf.rect = target.rect;
    target.windowId = windowId;
    target.rect = rect;
    return true;
  }

  /**
   * Nearest rendered leaf in the given direction. Mirrors
   * TilingEngine#getNeighborByDirection so directional keys behave the same
   * way here as everywhere else in Krohnkite.
   */
  private _neighbor(
    ctx: EngineContext,
    basis: MTLeaf,
    dir: Direction,
  ): MTLeaf | null {
    if (basis.rect === null) return null;
    const basisRect = basis.rect;

    let vertical: boolean;
    let sign: -1 | 1;
    switch (dir) {
      case "up":
        ((vertical = true), (sign = -1));
        break;
      case "down":
        ((vertical = true), (sign = 1));
        break;
      case "left":
        ((vertical = false), (sign = -1));
        break;
      case "right":
        ((vertical = false), (sign = 1));
        break;
      default:
        return null;
    }

    const candidates = this.renderedLeaves.filter((leaf) => {
      if (leaf === basis || leaf.rect === null) return false;
      const rect = leaf.rect;
      const beyond = vertical
        ? rect.y * sign > basisRect.y * sign
        : rect.x * sign > basisRect.x * sign;
      if (!beyond) return false;
      return vertical
        ? overlap(basisRect.x, basisRect.maxX, rect.x, rect.maxX)
        : overlap(basisRect.y, basisRect.maxY, rect.y, rect.maxY);
    });
    if (candidates.length === 0) return null;

    const min =
      sign *
      candidates.reduce((prevMin, leaf): number => {
        const rect = leaf.rect as Rect;
        return Math.min((vertical ? rect.y : rect.x) * sign, prevMin);
      }, Infinity);

    const closest = candidates.filter((leaf) => {
      const rect = leaf.rect as Rect;
      return (vertical ? rect.y : rect.x) === min;
    });

    return closest.sort((a, b) => {
      const winA = ctx.getWindowById(a.windowId);
      const winB = ctx.getWindowById(b.windowId);
      return (
        (winB !== null ? winB.focusTime : 0) -
        (winA !== null ? winA.focusTime : 0)
      );
    })[0];
  }

  /**
   * The leaf of the currently focused window, or null when it isn't a pane of
   * this layout right now (no focus, floating, docked, minimized, over
   * capacity, on another surface, not yet inserted). Handlers must return
   * false in that case so the engine's default handling still runs.
   */
  private _focusedRenderedLeaf(ctx: EngineContext): MTLeaf | null {
    const window = ctx.currentWindow;
    if (window === null) return null;
    for (const leaf of this.renderedLeaves) {
      if (leaf.windowId === window.id) return leaf;
    }
    return null;
  }

  //#endregion

  //#region Reconcile

  /**
   * Drop leaves whose window has gone for good or has been floated, plus any
   * duplicate id. A duplicate would make two panes fight over one window's
   * geometry, so that check is cheap insurance for a structure the user edits
   * by hand all session.
   *
   * Floated windows have to lose their slot, or the arrangement can wedge:
   * arrangeScreen floats any tile smaller than its minSize and then re-applies
   * (engine.ts:670-733), so a pane too small for its window would otherwise be
   * held empty forever and re-floated the instant the user tried to tile it
   * again. Dropping the leaf lets the tree close up, and re-tiling picks a
   * fresh pane that may actually fit.
   *
   * Matched on the state itself, not isFloating: TiledAfloat is a tileable
   * state, and dropping those leaves would fight with the same apply() that is
   * about to re-insert them.
   */
  private _prune(ctx: EngineContext): void {
    if (this.root === null) return;

    const seen = new Set<string>();
    const doomed: MTLeaf[] = [];
    this._leaves(this.root).forEach((leaf) => {
      const window = ctx.getWindowById(leaf.windowId);
      if (
        seen.has(leaf.windowId) ||
        window === null ||
        window.state === WindowState.Floating
      )
        doomed.push(leaf);
      else seen.add(leaf.windowId);
    });
    doomed.forEach((leaf) => this._detach(leaf));
  }

  /** Split the bottom-right-most pane along its longer axis, and take the new half. */
  private _insertWindow(windowId: string): void {
    const leaf = new MTLeaf(windowId);
    if (this.root === null) {
      this.root = leaf;
      return;
    }

    const target = this._bottomRightMost();
    if (target === null || target.rect === null) {
      /* Nothing is rendering (e.g. every window in the tree is minimized).
       * Graft alongside the existing tree rather than discard its structure. */
      const orientation =
        this.lastArea !== null
          ? this._orientationFor(this.lastArea)
          : "horizontal";
      this.root = new MTNode(orientation, this.root, leaf);
      return;
    }

    this._replace(
      target,
      new MTNode(this._insertOrientation(target, windowId), target, leaf),
    );
  }

  /**
   * Which way to cut the pane a new window is taking a share of. The longer
   * side wins, as specified - but if neither window would fit its minimum size
   * that way round and the other axis has room for both, take the other axis.
   * Splitting a 1280x800 pane between a terminal and something that demands
   * 940px of width only works stacked.
   */
  private _insertOrientation(target: MTLeaf, windowId: string): MTOrientation {
    if (target.rect === null) return "horizontal";
    const preferred = this._orientationFor(target.rect);
    const other: MTOrientation =
      preferred === "horizontal" ? "vertical" : "horizontal";
    if (this._fitsSplit(target, windowId, preferred)) return preferred;
    if (this._fitsSplit(target, windowId, other)) return other;
    /* Neither fits - the screen is simply full. Keep the asked-for axis and
     * let the engine's unfit handling decide what floats. */
    return preferred;
  }

  private _fitsSplit(
    target: MTLeaf,
    windowId: string,
    orientation: MTOrientation,
  ): boolean {
    if (target.rect === null) return false;
    const horizontal = orientation === "horizontal";
    const available =
      (horizontal ? target.rect.width : target.rect.height) - this.lastGap;
    return (
      this._minOf(target.windowId, horizontal) +
        this._minOf(windowId, horizontal) <=
      available
    );
  }

  private _minOf(windowId: string, horizontal: boolean): number {
    const min = this.lastMinSizes[windowId];
    if (min === undefined) return MT_MIN_PANE;
    return Math.max(MT_MIN_PANE, horizontal ? min.width : min.height);
  }

  private _bottomRightMost(exclude?: Set<MTLeaf>): MTLeaf | null {
    let best: MTLeaf | null = null;
    let bestRect: Rect | null = null;
    this.renderedLeaves.forEach((leaf) => {
      if (leaf.rect === null) return;
      if (exclude !== undefined && exclude.has(leaf)) return;
      if (
        bestRect === null ||
        leaf.rect.maxY > bestRect.maxY ||
        (leaf.rect.maxY === bestRect.maxY && leaf.rect.maxX > bestRect.maxX)
      ) {
        ((best = leaf), (bestRect = leaf.rect));
      }
    });
    return best;
  }

  private _orientationFor(rect: Rect): MTOrientation {
    return rect.width > rect.height ? "horizontal" : "vertical";
  }

  //#endregion

  //#region Walks

  private _renderPass(area: Rect, ids: Set<string>, gap: number): MTLeaf[] {
    const out: MTLeaf[] = [];
    if (this.root !== null) this._render(this.root, area, ids, gap, out);
    return out;
  }

  /**
   * Assign geometry to every renderable leaf. A split with renderable leaves
   * on one side only hands that side the entire area, gap included, so absent
   * windows never cost screen space.
   *
   * `first` is visited before `second`, which makes `out` the on-screen
   * in-order sequence the shortcut handlers rely on.
   */
  private _render(
    tree: MTTree,
    area: Rect,
    ids: Set<string>,
    gap: number,
    out: MTLeaf[],
  ): void {
    if (tree instanceof MTLeaf) {
      if (!ids.has(tree.windowId)) return;
      tree.rect = area;
      out.push(tree);
      return;
    }

    const hasFirst = this._hasRenderable(tree.first, ids);
    const hasSecond = this._hasRenderable(tree.second, ids);
    if (!hasFirst && !hasSecond) return;
    if (!hasSecond) {
      this._render(tree.first, area, ids, gap, out);
      return;
    }
    if (!hasFirst) {
      this._render(tree.second, area, ids, gap, out);
      return;
    }
    /* Too small to divide: give it all to one side rather than emit a pane
     * with no pixels in it. apply() floats whatever is left without a pane. */
    if (!this._canSplit(tree, area, gap)) {
      this._render(tree.first, area, ids, gap, out);
      return;
    }

    const [areaFirst, areaSecond] = this._splitArea(tree, area, gap, ids);
    this._render(tree.first, areaFirst, ids, gap, out);
    this._render(tree.second, areaSecond, ids, gap, out);
  }

  private _hasRenderable(tree: MTTree, ids: Set<string>): boolean {
    if (tree instanceof MTLeaf) return ids.has(tree.windowId);
    return (
      this._hasRenderable(tree.first, ids) ||
      this._hasRenderable(tree.second, ids)
    );
  }

  /** Whether an area is big enough to be divided at all. */
  private _canSplit(node: MTNode, area: Rect, gap: number): boolean {
    const length =
      node.orientation === "horizontal" ? area.width : area.height;
    return length - gap >= 2 * MT_MIN_PANE;
  }

  /**
   * How many pixels each side of a split gets, along the axis being split.
   *
   * Done as integer arithmetic rather than through
   * LayoutUtils.splitAreaHalfWeighted because the two parts must tile their
   * parent exactly: that helper drifts a pixel on some weight/gap
   * combinations (its remainder fix-up grows the trailing part without
   * accounting for the rounding already applied to that part's origin), which
   * leaves a pane hanging past its area or overlapping its sibling.
   *
   * The bounds keep every pane at its window's minimum size where the area
   * allows it - a pane below its minSize makes arrangeScreen float a window to
   * get rid of it, tearing down an arrangement the user built by hand - and
   * fall back to one pixel each when the minimums simply don't fit.
   */
  private _splitLengths(
    node: MTNode,
    area: Rect,
    gap: number,
    ids: Set<string>,
  ): [number, number] {
    const horizontal = node.orientation === "horizontal";
    const available = (horizontal ? area.width : area.height) - gap;
    const ratio = clip(node.ratio, MT_MIN_RATIO, MT_MAX_RATIO);

    let low = MT_MIN_PANE;
    let high = available - MT_MIN_PANE;
    const minFirst = this._minLength(node.first, horizontal, gap, ids);
    const minSecond = this._minLength(node.second, horizontal, gap, ids);
    if (minFirst + minSecond <= available) {
      low = minFirst;
      high = available - minSecond;
    }
    if (high < low) high = low;

    const first = clip(Math.round(available * ratio), low, high);
    return [first, available - first];
  }

  private _splitArea(
    node: MTNode,
    area: Rect,
    gap: number,
    ids: Set<string>,
  ): Rect[] {
    const [first, second] = this._splitLengths(node, area, gap, ids);
    return node.orientation === "horizontal"
      ? [
          new Rect(area.x, area.y, first, area.height),
          new Rect(area.x + first + gap, area.y, second, area.height),
        ]
      : [
          new Rect(area.x, area.y, area.width, first),
          new Rect(area.x, area.y + first + gap, area.width, second),
        ];
  }

  /**
   * Pixels a subtree needs along one axis to hold every pane in it at its
   * window's minimum size. Splits across the axis being measured add up;
   * splits along the other axis just take the larger of the two.
   *
   * Honouring the real minimums matters: a pane below its window's minSize
   * makes arrangeScreen float a window to get rid of it, which tears down an
   * arrangement the user built by hand.
   */
  private _minLength(
    tree: MTTree,
    horizontal: boolean,
    gap: number,
    ids: Set<string>,
  ): number {
    if (tree instanceof MTLeaf) {
      if (!ids.has(tree.windowId)) return 0;
      const min = this.lastMinSizes[tree.windowId];
      if (min === undefined) return MT_MIN_PANE;
      return Math.max(MT_MIN_PANE, horizontal ? min.width : min.height);
    }

    const first = this._minLength(tree.first, horizontal, gap, ids);
    const second = this._minLength(tree.second, horizontal, gap, ids);
    /* A collapsed side costs nothing - it isn't drawn. */
    if (first === 0) return second;
    if (second === 0) return first;
    return (tree.orientation === "horizontal") === horizontal
      ? first + gap + second
      : Math.max(first, second);
  }

  /**
   * Walk down to the basis window, retuning the ratio of every split on the
   * way back up. Mirrors HalfSplitLayoutPart#adjust for angles 0/90, except
   * each child is handed its own half of the area rather than the whole of it.
   *
   * @returns the delta left for the caller to consume, or null if the basis
   * isn't in this subtree.
   */
  private _adjustNode(
    tree: MTTree,
    area: Rect,
    basisId: string,
    delta: RectDelta,
    gap: number,
  ): RectDelta | null {
    if (tree instanceof MTLeaf)
      return tree.windowId === basisId ? delta : null;

    const ids = this.lastRenderedIds;
    const hasFirst = this._hasRenderable(tree.first, ids);
    const hasSecond = this._hasRenderable(tree.second, ids);
    if (!hasFirst && !hasSecond) return null;
    /* Collapsed exactly as _render collapsed it, so `area` still matches. */
    if (!hasSecond)
      return this._adjustNode(tree.first, area, basisId, delta, gap);
    if (!hasFirst)
      return this._adjustNode(tree.second, area, basisId, delta, gap);
    if (!this._canSplit(tree, area, gap))
      return this._adjustNode(tree.first, area, basisId, delta, gap);

    const [areaFirst, areaSecond] = this._splitArea(tree, area, gap, ids);
    let target: 0 | 1 = 0;
    let result = this._adjustNode(tree.first, areaFirst, basisId, delta, gap);
    if (result === null) {
      result = this._adjustNode(tree.second, areaSecond, basisId, delta, gap);
      if (result === null) return null;
      target = 1;
    }

    const horizontal = tree.orientation === "horizontal";
    const [firstLength] = this._splitLengths(tree, area, gap, ids);
    const available = (horizontal ? area.width : area.height) - gap;
    /* Feed back the ratio actually drawn, not the stored one, so dragging a
     * divider that is pinned by a minimum size doesn't jump. */
    const ratio = LayoutUtils.adjustAreaHalfWeights(
      area,
      available > 0 ? firstLength / available : 0.5,
      gap,
      target,
      result,
      horizontal,
    );
    /* NaN is reachable when a deep split's area is smaller than the gap. */
    if (!isNaN(ratio)) tree.ratio = clip(ratio, MT_MIN_RATIO, MT_MAX_RATIO);

    /* Consume the edge this split owns; leave the rest to the caller. */
    if (horizontal)
      return target === 0
        ? new RectDelta(0, result.west, result.south, result.north)
        : new RectDelta(result.east, 0, result.south, result.north);
    return target === 0
      ? new RectDelta(result.east, result.west, 0, result.north)
      : new RectDelta(result.east, result.west, result.south, 0);
  }

  //#endregion

  //#region Structure

  /** Every leaf of a subtree, in in-order sequence. */
  private _leaves(tree: MTTree | null, out?: MTLeaf[]): MTLeaf[] {
    const acc = out !== undefined ? out : [];
    if (tree === null) return acc;
    if (tree instanceof MTLeaf) {
      acc.push(tree);
      return acc;
    }
    this._leaves(tree.first, acc);
    this._leaves(tree.second, acc);
    return acc;
  }

  private _findLeaf(windowId: string): MTLeaf | null {
    const leaves = this._leaves(this.root);
    for (const leaf of leaves) {
      if (leaf.windowId === windowId) return leaf;
    }
    return null;
  }

  /* Parents are looked up on demand rather than stored: the tree is tiny, and
   * it rules out the whole class of stale-parent-pointer bugs. */
  private _findParent(
    target: MTTree,
  ): { parent: MTNode; slot: "first" | "second" } | null {
    return this.root === null ? null : this._findParentIn(this.root, target);
  }

  private _findParentIn(
    tree: MTTree,
    target: MTTree,
  ): { parent: MTNode; slot: "first" | "second" } | null {
    if (tree instanceof MTLeaf) return null;
    if (tree.first === target) return { parent: tree, slot: "first" };
    if (tree.second === target) return { parent: tree, slot: "second" };
    const inFirst = this._findParentIn(tree.first, target);
    return inFirst !== null ? inFirst : this._findParentIn(tree.second, target);
  }

  private _replace(target: MTTree, replacement: MTTree): boolean {
    if (this.root === target) {
      this.root = replacement;
      return true;
    }
    const parentInfo = this._findParent(target);
    if (parentInfo === null) return false;
    if (parentInfo.slot === "first") parentInfo.parent.first = replacement;
    else parentInfo.parent.second = replacement;
    return true;
  }

  /** Remove a subtree; its parent collapses into its sibling. */
  private _detach(subtree: MTTree): boolean {
    if (this.root === subtree) {
      this.root = null;
      return true;
    }
    const parentInfo = this._findParent(subtree);
    if (parentInfo === null) return false;
    const sibling =
      parentInfo.slot === "first"
        ? parentInfo.parent.second
        : parentInfo.parent.first;
    return this._replace(parentInfo.parent, sibling);
  }

  private _describe(tree: MTTree | null): string {
    if (tree === null) return "empty";
    if (tree instanceof MTLeaf) return tree.windowId;
    return `${tree.orientation === "horizontal" ? "H" : "V"}:${tree.ratio.toFixed(
      2,
    )}[${this._describe(tree.first)},${this._describe(tree.second)}]`;
  }

  //#endregion
}
