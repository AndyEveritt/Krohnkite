/*
    SPDX-FileCopyrightText: 2026 Andy Everitt <aajeveritt@gmail.com>

    SPDX-License-Identifier: MIT
*/

/**
 * "horizontal" lays a split's panes out side by side (left | right).
 * "vertical" stacks them (top / bottom).
 */
type MTOrientation = "horizontal" | "vertical";

/** Where a dragged window lands relative to the pane it was dropped on. */
type MTDropZone = "left" | "right" | "top" | "bottom" | "center";

/** What a move did, and so whether the selection's old slot still holds it. */
type MTMoveOutcome = "none" | "moved" | "swapped";

/** Smallest share of a split one pane may be squeezed to, as a fraction. */
const MT_MIN_SHARE = 0.05;
/** Never hand a pane fewer pixels than this along the axis being split. */
const MT_MIN_PANE = 1;
/** Height of the tab strip drawn above a stacked pane. */
const MT_TABBAR_HEIGHT = 26;
/**
 * How much of a pane, along each axis, counts as an edge for a drop. The
 * remaining middle drops onto the pane itself, joining its stack.
 */
const MT_DROP_EDGE = 0.25;
/** How long the flash showing where a move landed stays up, in ms. */
const MT_PREVIEW_DURATION = 600;

/** Distinguishes layout instances when they register their overlays. */
let mtInstanceSeq = 0;

/**
 * A slot in the tree. Normally holds one window; holds several when it is a
 * stack, in which case they all share the pane and only the active one is on
 * top - the others sit behind it, listed in the tab strip.
 */
class MTLeaf {
  /** Members, in tab order. Always at least one until the leaf is detached. */
  public windowIds: string[];
  /** Member currently on top. Null until the leaf renders once. */
  public activeId: string | null;
  /**
   * Whether this pane is a stack. Sticky: a stack that has lost all but one
   * member stays a stack, so new windows keep joining it, exactly like COSMIC.
   */
  public isStack: boolean;

  /** Geometry this leaf was last rendered at, tab strip included. */
  public rect: Rect | null;
  /** The part of `rect` the windows get - `rect` minus the tab strip. */
  public contentRect: Rect | null;
  /** Members that actually rendered last pass, in tab order. */
  public renderedIds: string[];

  constructor(windowId: string | string[]) {
    this.windowIds =
      typeof windowId === "string" ? [windowId] : windowId.slice(0);
    this.activeId = null;
    this.isStack = false;
    this.rect = null;
    this.contentRect = null;
    this.renderedIds = [];
  }

  /** The member commands act on: the active one, else the first. */
  public get windowId(): string {
    if (this.activeId !== null && this.windowIds.indexOf(this.activeId) >= 0)
      return this.activeId;
    return this.windowIds[0];
  }

  public get size(): number {
    return this.windowIds.length;
  }

  public has(windowId: string): boolean {
    return this.windowIds.indexOf(windowId) >= 0;
  }

  public add(windowId: string, index?: number): void {
    if (this.has(windowId)) return;
    if (index === undefined || index < 0 || index > this.windowIds.length)
      this.windowIds.push(windowId);
    else this.windowIds.splice(index, 0, windowId);
    this.activeId = windowId;
  }

  /** @returns true when the leaf still holds a window afterwards. */
  public remove(windowId: string): boolean {
    const index = this.windowIds.indexOf(windowId);
    if (index >= 0) this.windowIds.splice(index, 1);
    if (this.activeId === windowId) this.activeId = this.windowIds[0] || null;
    return this.windowIds.length > 0;
  }
}

/**
 * A split, holding any number of panes side by side or stacked - not just two.
 *
 * That is the whole reason this is not a binary tree. Three panes across the
 * screen and "two panes, the right of which is split again" look the same but
 * behave differently under every subsequent move, and COSMIC distinguishes
 * them, so the tree has to as well. `A | B | C` is one split of three;
 * `(A | B) | C` is a split of two whose first pane is itself a split.
 *
 * `weights` runs parallel to `children`; only the ratios between them matter.
 */
class MTNode {
  public children: MTTree[];
  public weights: number[];
  /** Geometry this subtree was last rendered at; null until it renders once. */
  public rect: Rect | null;

  constructor(
    public orientation: MTOrientation,
    children: MTTree[],
    weights?: number[],
  ) {
    this.children = children.slice(0);
    this.weights =
      weights !== undefined && weights.length === children.length
        ? weights.slice(0)
        : children.map(() => 1);
    this.rect = null;
  }

  public get length(): number {
    return this.children.length;
  }

  public indexOf(child: MTTree): number {
    return this.children.indexOf(child);
  }

  /** Insert a child, giving it the average share of the space. */
  public insert(child: MTTree, index: number): void {
    const total = this.weights.reduce((sum, weight) => sum + weight, 0);
    const share = this.weights.length > 0 ? total / this.weights.length : 1;
    const at = clip(index, 0, this.children.length);
    this.children.splice(at, 0, child);
    this.weights.splice(at, 0, share);
  }

  public removeAt(index: number): void {
    this.children.splice(index, 1);
    this.weights.splice(index, 1);
  }

  /** Replace a child in place, keeping its share of the space. */
  public replaceAt(index: number, child: MTTree): void {
    this.children[index] = child;
  }

  /** Reverse the order of the panes, shares and all. */
  public reverse(): void {
    this.children.reverse();
    this.weights.reverse();
  }
}

type MTTree = MTLeaf | MTNode;

/** What the driver needs to draw one stack's tab strip. */
interface IMTStackBarTab {
  id: string;
  title: string;
  active: boolean;
}

/** Where a subtree sits in the tree. */
interface IMTPlace {
  parent: MTNode;
  index: number;
}

/**
 * A manual tiling layout: a tree of splits the user edits directly, rather
 * than a shape derived from the number of windows.
 *
 * New windows split the focused pane, along its longer axis - or join it, when
 * it is a stack. From there the user rearranges with the Split/Unsplit
 * shortcuts, resizes splits like any other layout, swaps panes with the
 * directional swap shortcuts, pushes them around the tree with the directional
 * move shortcuts, and drags them with the mouse.
 *
 * Unlike BinaryTreeLayout, the tree is state: it lives on this instance, which
 * LayoutStore keeps for the whole session, so it survives arranges and
 * switching away to another layout and back. Notable consequences:
 *
 *  - `apply` MUST stay idempotent. `arrangeScreen` re-applies the layout
 *    repeatedly when CONFIG.unfitGreater/unfitLess are on, each time with a
 *    smaller `tileables`; prune, insert and render are all safe to repeat.
 *    Don't add side effects here. Overlays are registered against this
 *    instance's key for the same reason - a repeat replaces, it doesn't
 *    accumulate.
 *  - Leaves survive a window going away temporarily - minimized, fullscreen,
 *    on another virtual desktop - so a hand-built arrangement comes back
 *    intact. Such windows simply don't render, and their space is shared out
 *    among the panes that do. Leaves are dropped when the window closes or is
 *    floated; see _prune for why floating has to release the pane.
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

  /** Identifies this instance's overlays to the driver. */
  private readonly instanceKey: string;

  /**
   * The subtree commands act on. Null means "just the focused pane". Grown
   * and shrunk with the group shortcuts, and dropped as soon as focus leaves
   * it, so it can never quietly apply to something the user isn't looking at.
   */
  private selection: MTTree | null;
  /**
   * Whether the selection is a *group* rather than just the focused pane.
   *
   * Not the same as "the selection is a split": a stacked pane holds several
   * windows, so it can be a group on its own, and until it is selected as one
   * the commands treat it as the single pane it looks like.
   */
  private selectionGrown: boolean;

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

  /** Pane and zone the in-flight mouse drag would drop onto, if any. */
  private dropTarget: { leaf: MTLeaf; zone: MTDropZone } | null;

  /**
   * Subtree a command just moved, waiting to be flashed, and whether its own
   * pane is flashed along with the group it landed in - a drop has just had
   * the pane under the cursor for the whole drag, so it only needs the group.
   * Where it landed isn't known until the next render, which is why this is
   * held rather than drawn.
   */
  private pendingPreview: { node: MTTree } | null;

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.instanceKey = `ManualTiling#${++mtInstanceSeq}`;
    this.root = null;
    this.selection = null;
    this.selectionGrown = false;
    this.lastArea = null;
    this.lastGap = 0;
    this.lastRenderedIds = new Set<string>();
    this.lastMinSizes = {};
    this.renderedLeaves = [];
    this.dropTarget = null;
    this.pendingPreview = null;
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
      this._insertWindow(ctx, tileable.id);
      this.renderedLeaves = this._renderPass(area, ids, gap);
    });

    const byId: { [id: string]: WindowClass } = {};
    tileables.forEach((tileable) => {
      tileable.state = WindowState.Tiled;
      byId[tileable.id] = tileable;
    });

    /* Every member of a stack gets the pane, not just the active one: they are
     * all really that size, and the one on top is whichever KWin last raised. */
    const placed = new Set<string>();
    this.renderedLeaves.forEach((leaf) => {
      if (leaf.contentRect === null) return;
      leaf.renderedIds.forEach((id) => {
        const window = byId[id];
        if (window === undefined) return;
        window.geometry = leaf.contentRect as Rect;
        placed.add(id);
      });
    });

    /* Anything left without a pane - only reachable when the area is too
     * small to divide any further - must be floated, not left marked Tiled.
     * A tiled window holding stale geometry is the worst outcome available:
     * it looks like it is floating but ignores every command that would put
     * it back, because as far as the engine is concerned it is already tiled. */
    tileables.forEach((tileable) => {
      if (!placed.has(tileable.id)) tileable.state = WindowState.Floating;
    });

    /* The tab on top is whichever member has the focus. A stack raises no
     * windows of its own - they all share the pane, and the one KWin last
     * activated is the one on show - so the strip has to follow focus rather
     * than remember whichever member joined last. */
    const focused = this._focusedRenderedLeaf(ctx);
    const current = ctx.currentWindow;
    if (focused !== null && current !== null && focused.has(current.id))
      focused.activeId = current.id;

    ctx.setStackBars(this.instanceKey, this._stackBars(ctx));
    this._renderOverlays(ctx);
  }

  /**
   * Draw what the tree looks like beyond the windows themselves: the outline
   * around a group selection, and a flash where a move just landed.
   *
   * The flash is cleared as soon as it is drawn. arrangeScreen can call apply
   * several times over while it floats windows that don't fit, and only the
   * first of those is worth showing - better a preview drawn against geometry
   * that is one pass old than one that reappears on an unrelated arrange long
   * after the move.
   */
  private _renderOverlays(ctx: EngineContext): void {
    /* Drop a selection focus has wandered out of. _currentSelection does this
     * too, but not until the next command - and the outline has to come down
     * the moment it stops being true, not the next time a key is pressed.
     *
     * Focus being nowhere in this layout is not that: the window may simply
     * have gone to another screen, and the group has to still be here to
     * follow it when the driver comes asking. The outline goes away either
     * way, since there is nothing to draw it around here. */
    const focused = this._focusedRenderedLeaf(ctx);
    if (
      this.selection !== null &&
      (!this._isInTree(this.selection) ||
        (focused !== null && !this._contains(this.selection, focused)))
    )
      this._select(null, false);

    /* Only a group is outlined. A selection of one pane is just the focused
     * window, and KWin is already drawing a border around that. */
    const selection = this.selection;
    const outline =
      focused !== null && this._hasGroup() && selection !== null
        ? selection.rect
        : null;
    ctx.setSelectionOutline(this.instanceKey, outline);

    const preview = this.pendingPreview;
    this.pendingPreview = null;
    if (preview !== null) this._flashMove(ctx, preview.node);
  }

  /**
   * Flash the group a move landed in.
   *
   * Only the group, not the pane the window itself ended up in: KWin already
   * draws a border around the focused window, so flashing it again says
   * nothing. The group is the part a move through the tree makes hard to see,
   * since the window can end up next to panes it has nothing to do with and
   * inside a split or stack that reaches well beyond it.
   */
  private _flashMove(ctx: EngineContext, moved: MTTree): void {
    const landed = this._landedNode(moved);
    if (landed === null || landed.rect === null) return;

    const group = this._groupAround(landed);
    if (group !== null && group.rect !== null)
      ctx.showGroupIndicator(group.rect, MT_PREVIEW_DURATION);
  }

  /**
   * Where the subtree a command moved actually ended up.
   *
   * Usually it is still that same subtree - but joining a stack merges its
   * windows into the pane it ran into and leaves the subtree itself behind, so
   * fall back to whichever pane now holds its windows.
   */
  private _landedNode(moved: MTTree): MTTree | null {
    if (this._isInTree(moved) && moved.rect !== null) return moved;
    for (const leaf of this._leaves(moved)) {
      for (const id of leaf.windowIds) {
        const landed = this._findLeaf(id);
        if (landed !== null && landed.rect !== null) return landed;
      }
    }
    return null;
  }

  /**
   * The group a pane is a member of: the stack it is a tab of, else the
   * nearest split above it that actually divides the screen. Splits with only
   * one pane on screen are skipped - their area is the pane's own, so
   * outlining one would just redraw the pane's edge and say nothing.
   */
  private _groupAround(landed: MTTree): MTTree | null {
    if (landed instanceof MTLeaf && landed.renderedIds.length > 1)
      return landed;

    let node: MTTree = landed;
    for (;;) {
      const place = this._placeOf(node);
      if (place === null) return null;
      if (this._renderedChildren(place.parent).length >= 2) return place.parent;
      node = place.parent;
    }
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
     * shares get recalculated against the wrong pixel lengths. */
    const adjustArea = this.lastArea !== null ? this.lastArea : area;
    const adjustGap = this.lastArea !== null ? this.lastGap : gap;
    this._adjustNode(this.root, adjustArea, basis.id, delta, adjustGap);
  }

  public handleShortcut(
    ctx: EngineContext,
    input: Shortcut,
    data?: any,
  ): boolean {
    /* Any key means the previous move's flash has had its moment. */
    this.pendingPreview = null;

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

      /* Krohnkite's own directional move keys. The engine's handling of them
       * only reorders WindowStore.list, which this layout never reads, so it
       * would look dead here; this is where they do their work. Shift* is
       * remapped to Swap* before layouts are consulted in "focus" mode, but
       * not in "dwm" mode, hence both.
       *
       * They move the selection - a single pane until the group shortcuts
       * widen it - so there is no separate key for moving a group. */
      case Shortcut.SwapLeft:
      case Shortcut.ShiftLeft:
        return this._moveGroup(ctx, "left");
      case Shortcut.SwapRight:
      case Shortcut.ShiftRight:
        return this._moveGroup(ctx, "right");
      case Shortcut.SwapUp:
      case Shortcut.ShiftUp:
        return this._moveGroup(ctx, "up");
      case Shortcut.SwapDown:
      case Shortcut.ShiftDown:
        return this._moveGroup(ctx, "down");

      case Shortcut.GroupGrow:
        return this._growSelection(ctx);
      case Shortcut.GroupShrink:
        return this._shrinkSelection(ctx);

      case Shortcut.ToggleStack:
        return this._toggleStack(ctx);
      case Shortcut.StackNext:
        return this._cycleStack(ctx, 1);
      case Shortcut.StackPrev:
        return this._cycleStack(ctx, -1);

      default:
        return false;
    }
  }

  public toString(): string {
    return `ManualTilingLayout(${this._describe(this.root)})`;
  }

  //#region Moving

  /**
   * Move the selection one step in a direction, the way COSMIC does.
   *
   * This is a move through the *tree*, not across the screen: what happens is
   * decided by where the selection sits in its split, not by which pane it
   * happens to be next to. Walking out from the selection, the first of these
   * that applies wins:
   *
   *  1. **The split runs across the way we are going** - panes side by side,
   *     moving up. The whole split is wrapped in a new one facing that way,
   *     with the selection on that side of it. Shaping an arrangement is
   *     mostly this: push a window the way you want it to go.
   *  2. **We got here from a split further in.** The selection joins this
   *     split as another pane of it, next to the one it came out of - two
   *     panes become three, rather than nesting deeper.
   *  3. **There is a pane that way.** What it is decides what happens: a stack
   *     takes the window in as a tab, a group is entered at the edge we
   *     arrive on, and a plain pane either trades places with us (when the two
   *     of us are all there is) or gets split in half to take us in.
   *  4. **Nothing that way.** Step out to the split above and start again.
   *
   * Refused only when there is no split left to step out to, so a press at the
   * outer edge falls through to the engine and still pushes the window to the
   * next screen. Use the migrate shortcuts to take a whole group across
   * deliberately.
   *
   * A window inside a stack is a special case, handled first: it leaves the
   * stack rather than dragging its tab-mates along, and takes half the pane.
   */
  private _moveGroup(ctx: EngineContext, dir: Direction): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;

    const axis: MTOrientation =
      dir === "left" || dir === "right" ? "horizontal" : "vertical";
    /* Which end of a split the direction points at. */
    const toStart = dir === "left" || dir === "up";

    /* A stack selected as a group moves as the one pane it looks like;
     * otherwise the focused tab is what moves, and it leaves the stack. */
    if (
      !this.selectionGrown &&
      this._moveOutOfStack(ctx, selection, axis, toStart)
    )
      return true;

    const keep = this.selection;
    /* Where the selection is coming from. Every branch below puts it in its
     * new home first and vacates this afterwards: pulling it out first can
     * collapse the very split the move was about to act on. */
    const from = this._placeOf(selection);
    if (from === null) return false;

    /* `child` is what we are moving *relative to* at the level being looked
     * at: the selection itself at first, then whatever we stepped out of. */
    let child: MTTree = selection;

    for (;;) {
      const place = this._placeOf(child);
      if (place === null) return false;
      const parent = place.parent;

      /* A split with only one pane on screen is not really a split as far as
       * the user can tell; acting on it would swallow the press and change
       * nothing visible, so step over it. */
      if (this._renderedChildren(parent).length < 2) {
        child = parent;
        continue;
      }

      /* 1. Turn the arrangement to face the way we are going. */
      if (parent.orientation !== axis) {
        const wrapper = new MTNode(
          axis,
          toStart ? [selection, parent] : [parent, selection],
        );
        if (!this._replaceNode(parent, wrapper)) return false;
        return this._settle(from, keep, selection);
      }

      /* 2. Arrived from further in: become a pane of this split. */
      if (child !== selection) {
        parent.insert(selection, toStart ? place.index : place.index + 1);
        return this._settle(from, keep, selection);
      }

      /* 3. Something in the way. */
      const next = this._nextRenderedSibling(parent, place.index, toStart);
      if (next !== null) {
        const outcome = this._moveInto(parent, selection, next, axis, toStart);
        if (outcome === "none") return false;
        /* A swap moved it without duplicating it, so there is nothing to
         * vacate afterwards. */
        return this._settle(
          outcome === "swapped" ? null : from,
          keep,
          selection,
        );
      }

      /* 4. Ran out of panes this way: try the split above. */
      child = parent;
    }
  }

  /**
   * Put the selection into, or beside, the pane it has run into.
   *
   * @returns "none" when nothing changed, "swapped" when the selection was
   * exchanged with the pane in place - the one case that leaves no old slot to
   * vacate - and "moved" when it has been placed and its old slot is still to
   * be cleared.
   */
  private _moveInto(
    parent: MTNode,
    selection: MTTree,
    next: MTTree,
    axis: MTOrientation,
    toStart: boolean,
  ): MTMoveOutcome {
    /* Only when the two of them are all that is in this split does moving
     * "into" the neighbour mean anything - with other panes around, the
     * neighbour is simply the next one along and gets split. */
    const alone = this._renderedChildren(parent).length === 2;

    if (alone && next instanceof MTLeaf && next.isStack) {
      /* A stack takes it in - that is what a stack is for. Only a pane can
       * join: letting a whole group in would flatten its arrangement into a
       * row of tabs, which no press should do silently. */
      if (selection instanceof MTLeaf && !selection.isStack) {
        selection.windowIds.forEach((id) => next.add(id));
        return "moved";
      }
    }

    if (alone && next instanceof MTNode) {
      /* Enter the group. Along its own axis we arrive at the near end of it;
       * across its axis there is no near end, so we land in the middle. */
      if (next.orientation === axis) {
        next.insert(selection, toStart ? next.length : 0);
      } else {
        const middle = Math.floor(next.length / 2);
        if (next.length % 2 === 0) {
          next.insert(selection, middle);
        } else {
          /* No middle to slot into, so split the pane that is in the way. */
          const target = next.children[middle];
          const wrapper = new MTNode(
            axis,
            toStart ? [target, selection] : [selection, target],
          );
          next.replaceAt(middle, wrapper);
        }
      }
      return "moved";
    }

    if (alone) {
      /* Just the two of us: trade places, shares and all. */
      const from = parent.indexOf(selection);
      const to = parent.indexOf(next);
      if (from < 0 || to < 0) return "none";
      parent.children[from] = next;
      parent.children[to] = selection;
      const weight = parent.weights[from];
      parent.weights[from] = parent.weights[to];
      parent.weights[to] = weight;
      return "swapped";
    }

    /* Three or more panes here: halve the one in the way and take the side we
     * arrive on. This is what turns `A | B | C` into `(A | B) | C`. */
    const at = parent.indexOf(next);
    if (at < 0) return "none";
    parent.replaceAt(
      at,
      new MTNode(axis, toStart ? [next, selection] : [selection, next]),
    );
    return "moved";
  }

  /**
   * A window being moved out of the stack it is a tab of: it leaves alone and
   * takes half of the stack's pane, split the way it was pushed.
   *
   * @returns whether this was that case and it has been handled.
   */
  private _moveOutOfStack(
    ctx: EngineContext,
    selection: MTTree,
    axis: MTOrientation,
    toStart: boolean,
  ): boolean {
    if (!(selection instanceof MTLeaf) || selection.size < 2) return false;
    const current = ctx.currentWindow;
    if (current === null || !selection.has(current.id)) return false;

    selection.remove(current.id);
    const moved = new MTLeaf(current.id);
    if (
      !this._replaceNode(
        selection,
        new MTNode(axis, toStart ? [moved, selection] : [selection, moved]),
      )
    ) {
      /* Put it back rather than lose the window. */
      selection.add(current.id);
      return false;
    }
    this._select(moved, false);
    this._preview(moved);
    return true;
  }

  /**
   * Finish a move: vacate the slot the selection came from, flatten whatever
   * that leaves behind, put the selection back and flash where it landed.
   *
   * The subtree is in the tree twice for the moment between being placed and
   * this running - that is the point, since taking it out first can dissolve
   * the split the move was aiming at.
   */
  private _settle(
    from: IMTPlace | null,
    keep: MTTree | null,
    moved: MTTree,
  ): boolean {
    if (from !== null) {
      const index =
        from.parent.children[from.index] === moved
          ? from.index
          : from.parent.indexOf(moved);
      if (index >= 0) from.parent.removeAt(index);
    }
    this._cleanup();

    const grown = this.selectionGrown;
    if (keep !== null && this._isInTree(keep)) this._select(keep, grown);
    else if (this._isInTree(moved)) this._select(moved, grown);
    else this._select(null, false);
    this._preview(moved);
    return true;
  }

  /** Flash where a move landed, once the next render knows where that is. */
  private _preview(moved: MTTree): void {
    this.pendingPreview = { node: moved };
  }

  /** The next pane of a split that is actually on screen, in a direction. */
  private _nextRenderedSibling(
    parent: MTNode,
    index: number,
    toStart: boolean,
  ): MTTree | null {
    const step = toStart ? -1 : 1;
    for (let i = index + step; i >= 0 && i < parent.length; i += step) {
      if (this._hasRenderable(parent.children[i], this.lastRenderedIds))
        return parent.children[i];
    }
    return null;
  }

  //#endregion

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

    /* A stack holding more than one window divides into itself: the focused
     * member leaves the stack and takes half of the pane. */
    if (leaf.size > 1) {
      const current = ctx.currentWindow;
      const movingId = current !== null ? current.id : leaf.windowId;
      const cut =
        orientation !== null
          ? orientation
          : this._insertOrientation(leaf, movingId);
      if (!leaf.remove(movingId)) return false;
      const moved = new MTLeaf(movingId);
      return this._replaceNode(leaf, new MTNode(cut, [leaf, moved]));
    }

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

    const place = this._placeOf(leaf);
    if (
      place !== null &&
      place.parent.length === 2 &&
      place.parent.indexOf(partner) >= 0
    ) {
      /* The only other pane of this split is the one we would pull in, so
       * there is no division to add - all that is left to do is reorient the
       * split they already share. Use Rotate to do this deliberately. */
      if (place.parent.orientation === cut) return false;
      place.parent.orientation = cut;
      place.parent.weights = place.parent.children.map(() => 1);
      return true;
    }

    /* Detach first: wrapping before detaching would briefly leave the partner
     * in the tree twice. */
    if (!this._detach(partner)) return false;
    const node = new MTNode(
      cut,
      partnerIsAfter ? [leaf, partner] : [partner, leaf],
    );
    const replaced = this._replaceNode(leaf, node);
    this._cleanup();
    return replaced;
  }

  /**
   * The window to move into the other half of a new split.
   *
   * Nearest on screen wins, looking forwards before backwards, but the
   * focused window's own sibling is taken last: moving *that* one into a new
   * split beside the focused window produces the very split they already
   * share, so it reorients the pane instead of dividing it. Preferring anyone
   * else means a split actually adds a division. The sibling is still the
   * fallback, for when it is the only window left to draw on.
   */
  private _splitPartner(leaf: MTLeaf): MTLeaf | null {
    const index = this.renderedLeaves.indexOf(leaf);
    if (index < 0) return null;

    const sibling = this._soleSiblingLeafOf(leaf);
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

  /** The one other pane of this pane's split, if the split holds just two. */
  private _soleSiblingLeafOf(leaf: MTLeaf): MTLeaf | null {
    const place = this._placeOf(leaf);
    if (place === null || place.parent.length !== 2) return null;
    const sibling = place.parent.children[place.index === 0 ? 1 : 0];
    return sibling instanceof MTLeaf ? sibling : null;
  }

  /**
   * Give the split the selection sits in a quarter turn clockwise, so four
   * presses come back to where they started:
   *
   *     A | B  ->  A / B  ->  B | A  ->  B / A  ->  A | B
   *
   * A quarter turn always flips the axis; every other one also reverses the
   * panes, because rotating a stack clockwise puts the top pane on the right.
   * Shares are carried through, so each pane keeps its own slice.
   *
   * Walks past splits with only one pane on screen - rotating one of those
   * would change nothing the user can see.
   */
  private _rotate(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;

    let node: MTTree = selection;
    for (;;) {
      const place = this._placeOf(node);
      if (place === null) return false;
      const parent = place.parent;
      if (this._renderedChildren(parent).length >= 2) {
        if (parent.orientation === "horizontal") {
          parent.orientation = "vertical";
        } else {
          parent.orientation = "horizontal";
          parent.reverse();
        }
        return true;
      }
      node = parent;
    }
  }

  /**
   * Remove a division: the focused pane absorbs the pane next to it, which
   * moves - keeping its own internal arrangement - into the bottom-right-most
   * pane elsewhere in the tree.
   *
   * Refused when there is nowhere else to move it to, which includes every
   * two-window arrangement: there would be no "elsewhere" to move it to.
   *
   * Takes no direction, unlike _split: which division to remove is decided by
   * where the focused pane already is, so separate horizontal and vertical
   * unsplit commands could only ever differ by refusing to act.
   */
  private _unsplit(ctx: EngineContext): boolean {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null) return false;

    const place = this._placeOf(leaf);
    if (place === null) return false;
    const parent = place.parent;

    /* The pane that gets dissolved into the focused one: the next along, or
     * the previous when the focused pane is last. */
    const evicted =
      place.index + 1 < parent.length
        ? parent.children[place.index + 1]
        : parent.children[place.index - 1];
    if (evicted === undefined) return false;

    /* Target must be outside what is being dissolved, or it would land right
     * back where it started. */
    const inside = new Set<MTLeaf>(this._leaves(evicted));
    this._leaves(leaf).forEach((one) => inside.add(one));
    const target = this._bottomRightMost(inside);
    if (target === null || target.rect === null) return false;

    const targetOrientation = this._orientationFor(target.rect);
    if (!this._detach(evicted)) return false;
    const targetPlace = this._placeOf(target);
    if (targetPlace === null) {
      /* The target was the whole tree; it becomes one side of a new split. */
      this.root = new MTNode(targetOrientation, [target, evicted]);
      return true;
    }
    targetPlace.parent.replaceAt(
      targetPlace.index,
      new MTNode(targetOrientation, [target, evicted]),
    );
    this._cleanup();
    return true;
  }

  /**
   * Give up the group a window belongs to, so the rest of it can follow that
   * window to wherever it has just gone.
   *
   * This is how a group crosses to another screen or virtual desktop: there is
   * no shortcut of its own for it. KWin's own "one screen to the left" and
   * friends move the focused window, the driver notices, and this hands over
   * everything selected along with it - arrangement intact, since the subtree
   * itself is what is handed over.
   *
   * Only a *group* follows. With a single pane selected there is nothing to
   * take along and this declines, leaving KWin's move to mean what it always
   * did.
   *
   * @returns the subtree to graft at the destination and the windows that
   * still have to be sent there, or null if that window isn't in a group here.
   */
  public groupFollowerIds(windowId: string): string[] | null {
    const selection = this._groupOf(windowId);
    if (selection === null) return null;

    const followerIds: string[] = [];
    this._leaves(selection).forEach((one) =>
      one.windowIds.forEach((id) => {
        if (id !== windowId) followerIds.push(id);
      }),
    );
    return followerIds.length > 0 ? followerIds : null;
  }

  /**
   * Detach the group for grafting at its destination. The moved window's own
   * pane goes with it, so the group arrives complete rather than in two
   * pieces.
   *
   * Separate from `groupFollowerIds` on purpose: a window changing screen
   * announces itself more than once - moving to another output reassigns the
   * virtual desktop too - and the first of those signals arrives before the
   * window has actually landed. Asking first and taking second means those
   * early signals don't consume the group and leave the real move with
   * nothing to hand over.
   */
  public takeGroup(windowId: string): MTTree | null {
    const selection = this._groupOf(windowId);
    if (selection === null) return null;

    if (!this._detach(selection)) return null;
    this._select(null, false);
    this._cleanup();
    return selection;
  }

  /** The selected group holding a window, if it is in one. */
  private _groupOf(windowId: string): MTTree | null {
    if (!this._hasGroup()) return null;
    const selection = this.selection as MTTree;

    const leaf = this._findLeaf(windowId);
    if (leaf === null || !this._contains(selection, leaf)) return null;
    return selection;
  }

  /**
   * Attach a subtree that arrived from another surface. It goes in beside
   * everything already here, splitting the whole area along its longer axis,
   * which is both predictable and never buried inside an existing split.
   */
  public graft(subtree: MTTree): void {
    if (this.root === null) {
      this.root = subtree;
      return;
    }
    const orientation =
      this.lastArea !== null
        ? this._orientationFor(this.lastArea)
        : "horizontal";
    this.root = new MTNode(orientation, [this.root, subtree]);
  }

  //#endregion

  //#region Selection

  /**
   * The subtree commands act on.
   *
   * The stored selection is kept only while it still holds the focused window
   * and is still part of the tree; anything else means focus has moved on and
   * the selection collapses back to the focused pane. That is what stops a
   * group selection from silently applying to windows the user has stopped
   * looking at.
   */
  private _currentSelection(ctx: EngineContext): MTTree | null {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null) return null;
    if (
      this.selection !== null &&
      this._isInTree(this.selection) &&
      this._contains(this.selection, leaf)
    )
      return this.selection;
    this._select(leaf, false);
    return leaf;
  }

  private _select(node: MTTree | null, grown: boolean): void {
    this.selection = node;
    this.selectionGrown = node !== null && grown;
  }

  /** Whether the commands are aimed at a group rather than one pane. */
  private _hasGroup(): boolean {
    return (
      this.selection !== null &&
      this.selectionGrown &&
      this._isInTree(this.selection)
    );
  }

  /** Widen the selection to the enclosing split. */
  private _growSelection(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;

    /* A stack is several windows in one pane, so it is a group before the
     * split around it is. Selecting it first is what lets it be moved - or
     * sent to another screen - as the one thing it looks like, rather than
     * the focused tab being pulled out of it. */
    if (
      !this.selectionGrown &&
      selection instanceof MTLeaf &&
      selection.renderedIds.length > 1
    ) {
      this._select(selection, true);
      this._announceSelection(ctx, selection);
      return true;
    }

    const place = this._placeOf(selection);
    if (place === null) return false;
    this._select(place.parent, true);
    this._announceSelection(ctx, place.parent);
    /* Consumed, even though no pane moved: letting it fall through to the
     * engine would hand the key to whatever else answers to it. */
    return true;
  }

  /** Narrow the selection back towards the focused pane. */
  private _shrinkSelection(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null) return false;

    /* Back down to the single pane it looks like. */
    if (selection instanceof MTLeaf) {
      if (!this.selectionGrown) return false;
      this._select(selection, false);
      this._announceSelection(ctx, selection);
      return true;
    }

    let next: MTTree | null = null;
    for (const child of selection.children) {
      if (this._contains(child, leaf)) {
        next = child;
        break;
      }
    }
    if (next === null) return false;

    /* One step down is still a group if it is a split, or a stack - a stack
     * holds more than one window however far down it sits. */
    const stillAGroup =
      next instanceof MTNode || next.renderedIds.length > 1;
    this._select(next, stillAGroup);
    this._announceSelection(ctx, next);
    return true;
  }

  /** Outline the selection on screen, and say how much it holds. */
  private _announceSelection(ctx: EngineContext, node: MTTree): void {
    const windows = this._leaves(node).reduce(
      (sum, leaf) => sum + leaf.renderedIds.length,
      0,
    );
    if (node.rect !== null) ctx.highlight(node.rect);
    ctx.showNotification(
      windows === 1 ? "1 window selected" : `${windows} windows selected`,
    );
  }

  //#endregion

  //#region Stacks

  /**
   * Turn the selection into one stacked pane, or spread a stack back out.
   *
   * Stacking a group collects every window under it, in on-screen order, into
   * a single pane where they share the space as tabs. Unstacking is the
   * inverse: the members fan back out into splits along the pane's longer
   * axis, so nothing is lost either way.
   */
  private _toggleStack(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;

    if (selection instanceof MTLeaf && selection.isStack)
      return this._unstack(selection);

    const leaves = this._leaves(selection);
    const windowIds: string[] = [];
    leaves.forEach((leaf) =>
      leaf.windowIds.forEach((id) => {
        if (windowIds.indexOf(id) < 0) windowIds.push(id);
      }),
    );
    if (windowIds.length === 0) return false;

    const current = ctx.currentWindow;
    const stack = new MTLeaf(windowIds);
    stack.isStack = true;
    stack.activeId =
      current !== null && windowIds.indexOf(current.id) >= 0
        ? current.id
        : windowIds[0];
    if (!this._replaceNode(selection, stack)) return false;
    /* Still the same group, now living in one pane. */
    this._select(stack, stack.renderedIds.length > 1 || this.selectionGrown);
    return true;
  }

  /** Fan a stack's members back out into splits. */
  private _unstack(stack: MTLeaf): boolean {
    stack.isStack = false;
    if (stack.size < 2) return true;

    const ids = stack.windowIds.slice(0);
    const orientation =
      stack.rect !== null ? this._orientationFor(stack.rect) : "horizontal";

    /* Build a balanced tree rather than a comb, so five windows come out as a
     * grid instead of a stack of ever-thinner slivers. */
    const build = (from: number, to: number, cut: MTOrientation): MTTree => {
      if (to - from === 1) return new MTLeaf(ids[from]);
      const mid = from + Math.ceil((to - from) / 2);
      const other: MTOrientation =
        cut === "horizontal" ? "vertical" : "horizontal";
      return new MTNode(cut, [build(from, mid, other), build(mid, to, other)]);
    };

    return this._replaceNode(stack, build(0, ids.length, orientation));
  }

  /** Raise the next member of the focused stack, and focus it. */
  private _cycleStack(ctx: EngineContext, step: -1 | 1): boolean {
    const leaf = this._focusedRenderedLeaf(ctx);
    if (leaf === null || leaf.renderedIds.length < 2) return false;

    const current = ctx.currentWindow;
    const index = current !== null ? leaf.renderedIds.indexOf(current.id) : -1;
    const next =
      leaf.renderedIds[
        wrapIndex((index >= 0 ? index : 0) + step, leaf.renderedIds.length)
      ];
    const window = ctx.getWindowById(next);
    if (window === null) return false;

    leaf.activeId = next;
    ctx.currentWindow = window;
    return true;
  }

  /** What the driver has to draw for every stack on screen right now. */
  private _stackBars(ctx: EngineContext): IStackBar[] {
    const bars: IStackBar[] = [];
    this.renderedLeaves.forEach((leaf) => {
      if (!leaf.isStack || leaf.rect === null) return;
      const tabs: IMTStackBarTab[] = [];
      leaf.renderedIds.forEach((id) => {
        const window = ctx.getWindowById(id);
        tabs.push({
          id: id,
          title: window !== null ? window.windowCaption : id,
          active: id === leaf.activeId,
        });
      });
      if (tabs.length === 0) return;
      bars.push({
        x: leaf.rect.x,
        y: leaf.rect.y,
        width: leaf.rect.width,
        height: MT_TABBAR_HEIGHT,
        tabs: tabs,
      });
    });
    return bars;
  }

  //#endregion

  //#region Dragging

  /**
   * Preview where the window being dragged would land.
   *
   * Deliberately returns false every time: re-tiling on each mouse move would
   * shuffle the panes out from under the cursor. The tree is edited on drop,
   * in dragOver; all this does is light up the target.
   */
  public drag(
    ctx: EngineContext,
    draggingRect: Rect,
    window: WindowClass,
    workingArea: Rect,
  ): boolean {
    const cursor = ctx.cursorPos || draggingRect.center;
    this.dropTarget = this._dropTargetAt(cursor, window.id);

    if (this.dropTarget === null) ctx.hideDropIndicator();
    else
      ctx.showDropIndicator(
        this._dropRect(this.dropTarget.leaf, this.dropTarget.zone),
      );
    return false;
  }

  /**
   * Finish a drag: put the window where the indicator said it would go.
   *
   * Dropping on a pane's edge splits it; dropping on the middle joins that
   * pane's stack, creating one if the pane isn't stacked yet. That mirrors
   * COSMIC, where dragging one window onto another stacks them.
   */
  public dragOver(ctx: EngineContext, window: WindowClass): boolean {
    const target = this.dropTarget;
    this.dropTarget = null;
    ctx.hideDropIndicator();
    if (target === null) return false;

    const source = this._findLeaf(window.id);
    if (source === null || source === target.leaf) return false;

    /* Free the window's old slot first; the pane goes away if it was the last
     * member, which is what lets the rest of the tree close up behind it. */
    if (!source.remove(window.id)) this._detach(source);
    if (!this._isInTree(target.leaf)) return false;

    if (target.zone === "center") {
      target.leaf.isStack = true;
      target.leaf.add(window.id);
      this._cleanup();
      this._preview(target.leaf);
      return true;
    }

    const axis: MTOrientation =
      target.zone === "left" || target.zone === "right"
        ? "horizontal"
        : "vertical";
    const movedFirst = target.zone === "left" || target.zone === "top";
    const moved = new MTLeaf(window.id);

    /* Along an existing split, join it as another pane rather than nesting a
     * new one inside it - the same reason a move makes three panes of two. */
    const place = this._placeOf(target.leaf);
    if (place !== null && place.parent.orientation === axis) {
      place.parent.insert(moved, movedFirst ? place.index : place.index + 1);
      this._cleanup();
      this._preview(moved);
      return true;
    }

    const replaced = this._replaceNode(
      target.leaf,
      new MTNode(
        axis,
        movedFirst ? [moved, target.leaf] : [target.leaf, moved],
      ),
    );
    this._cleanup();
    if (replaced) this._preview(moved);
    return replaced;
  }

  /** The pane under the cursor, and which of its zones the cursor is in. */
  private _dropTargetAt(
    cursor: [number, number],
    windowId: string,
  ): { leaf: MTLeaf; zone: MTDropZone } | null {
    for (const leaf of this.renderedLeaves) {
      if (leaf.rect === null || !leaf.rect.includesPoint(cursor)) continue;
      /* Its own pane, with nothing else in it: there is no move to make. */
      if (leaf.size === 1 && leaf.has(windowId)) return null;
      return { leaf: leaf, zone: this._dropZone(leaf.rect, cursor) };
    }
    return null;
  }

  private _dropZone(rect: Rect, [x, y]: [number, number]): MTDropZone {
    const horizontal = (x - rect.x) / rect.width;
    const vertical = (y - rect.y) / rect.height;
    const nearest = Math.min(horizontal, 1 - horizontal, vertical, 1 - vertical);
    if (nearest > MT_DROP_EDGE) return "center";
    if (nearest === horizontal) return "left";
    if (nearest === 1 - horizontal) return "right";
    if (nearest === vertical) return "top";
    return "bottom";
  }

  /** The area the dropped window would end up occupying. */
  private _dropRect(leaf: MTLeaf, zone: MTDropZone): Rect {
    const rect = leaf.rect as Rect;
    const halfWidth = Math.round(rect.width / 2);
    const halfHeight = Math.round(rect.height / 2);
    switch (zone) {
      case "left":
        return new Rect(rect.x, rect.y, halfWidth, rect.height);
      case "right":
        return new Rect(
          rect.x + rect.width - halfWidth,
          rect.y,
          halfWidth,
          rect.height,
        );
      case "top":
        return new Rect(rect.x, rect.y, rect.width, halfHeight);
      case "bottom":
        return new Rect(
          rect.x,
          rect.y + rect.height - halfHeight,
          rect.width,
          halfHeight,
        );
      default:
        return rect.clone();
    }
  }

  //#endregion

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
      if (leaf.renderedIds.indexOf(window.id) >= 0) return leaf;
    }
    return null;
  }

  //#region Reconcile

  /**
   * Drop windows that have gone for good or have been floated, plus any
   * duplicate id. A duplicate would make two panes fight over one window's
   * geometry, so that check is cheap insurance for a structure the user edits
   * by hand all session.
   *
   * Floated windows have to lose their slot, or the arrangement can wedge:
   * arrangeScreen floats any tile smaller than its minSize and then re-applies
   * (engine.ts:670-733), so a pane too small for its window would otherwise be
   * held empty forever and re-floated the instant the user tried to tile it
   * again. Dropping the window lets the tree close up, and re-tiling picks a
   * fresh pane that may actually fit.
   *
   * Matched on the state itself, not isFloating: TiledAfloat is a tileable
   * state, and dropping those would fight with the same apply() that is
   * about to re-insert them.
   */
  private _prune(ctx: EngineContext): void {
    if (this.root === null) return;

    const seen = new Set<string>();
    const emptied: MTLeaf[] = [];
    this._leaves(this.root).forEach((leaf) => {
      leaf.windowIds.slice(0).forEach((id) => {
        const window = ctx.getWindowById(id);
        if (
          seen.has(id) ||
          window === null ||
          window.state === WindowState.Floating
        )
          leaf.remove(id);
        else seen.add(id);
      });
      if (leaf.size === 0) emptied.push(leaf);
    });
    emptied.forEach((leaf) => this._detach(leaf));
  }

  /**
   * Split the focused pane along its longer axis and take the new half - or,
   * when the focused pane is a stack, join it as another tab.
   */
  private _insertWindow(ctx: EngineContext, windowId: string): void {
    const leaf = new MTLeaf(windowId);
    if (this.root === null) {
      this.root = leaf;
      return;
    }

    const target = this._insertTarget(ctx);
    if (target === null || target.rect === null) {
      /* Nothing is rendering (e.g. every window in the tree is minimized).
       * Graft alongside the existing tree rather than discard its structure. */
      const orientation =
        this.lastArea !== null
          ? this._orientationFor(this.lastArea)
          : "horizontal";
      this.root = new MTNode(orientation, [this.root, leaf]);
      return;
    }

    if (target.isStack) {
      target.add(windowId);
      return;
    }

    this._replaceNode(
      target,
      new MTNode(this._insertOrientation(target, windowId), [target, leaf]),
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
      this._leafMin(target, horizontal) + this._minOf(windowId, horizontal) <=
      available
    );
  }

  private _minOf(windowId: string, horizontal: boolean): number {
    const min = this.lastMinSizes[windowId];
    if (min === undefined) return MT_MIN_PANE;
    return Math.max(MT_MIN_PANE, horizontal ? min.width : min.height);
  }

  /**
   * Pixels a pane needs along one axis. Stack members all get the whole pane,
   * so the most demanding of them sets the figure, and a stack also has to
   * find room for its tab strip.
   */
  private _leafMin(
    leaf: MTLeaf,
    horizontal: boolean,
    ids?: Set<string>,
  ): number {
    let min = MT_MIN_PANE;
    leaf.windowIds.forEach((id) => {
      if (ids !== undefined && !ids.has(id)) return;
      min = Math.max(min, this._minOf(id, horizontal));
    });
    if (!horizontal && leaf.isStack) min += MT_TABBAR_HEIGHT;
    return min;
  }

  /**
   * The pane a new window takes half of: the focused one.
   *
   * The new window is usually already active by the time this runs - KWin
   * focuses it as it maps - so the focused window is more often than not the
   * one that isn't in the tree yet. Falling back to the most recently focused
   * pane covers that, and it covers a batch of windows arriving in one apply()
   * too: each insert makes its own leaf the newest, so the second window
   * splits the first exactly as it would have if they had opened one at a
   * time.
   */
  private _insertTarget(ctx: EngineContext): MTLeaf | null {
    const current = ctx.currentWindow;
    let newest: MTLeaf | null = null;
    let newestTime = -Infinity;
    for (const leaf of this.renderedLeaves) {
      if (leaf.rect === null) continue;
      if (current !== null && leaf.has(current.id)) return leaf;
      leaf.renderedIds.forEach((id) => {
        const window = ctx.getWindowById(id);
        const time = window !== null ? window.focusTime : 0;
        if (time > newestTime) ((newest = leaf), (newestTime = time));
      });
    }
    /* null only when nothing is rendering at all; the caller grafts instead. */
    return newest;
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
   * Assign geometry to every renderable leaf. Panes with nothing on screen are
   * left out entirely and their share goes to the panes that are, so an absent
   * window never costs screen space.
   *
   * Children are visited in order, which makes `out` the on-screen sequence
   * the shortcut handlers rely on.
   */
  private _render(
    tree: MTTree,
    area: Rect,
    ids: Set<string>,
    gap: number,
    out: MTLeaf[],
  ): void {
    tree.rect = area;

    if (tree instanceof MTLeaf) {
      tree.renderedIds = tree.windowIds.filter((id) => ids.has(id));
      if (tree.renderedIds.length === 0) {
        tree.rect = null;
        tree.contentRect = null;
        return;
      }
      if (tree.activeId === null || tree.renderedIds.indexOf(tree.activeId) < 0)
        tree.activeId = tree.renderedIds[0];
      /* The tab strip is drawn over the top of the pane, so the windows only
       * get what is left underneath it. */
      tree.contentRect =
        tree.isStack && area.height > MT_TABBAR_HEIGHT
          ? area.gap(0, 0, MT_TABBAR_HEIGHT, 0)
          : area;
      out.push(tree);
      return;
    }

    const showing = this._renderedChildren(tree, ids);
    if (showing.length === 0) {
      tree.rect = null;
      return;
    }
    if (showing.length === 1) {
      this._render(showing[0], area, ids, gap, out);
      return;
    }

    const areas = this._splitAreas(tree, showing, area, gap, ids);
    if (areas === null) {
      /* Too small to divide: give it all to one pane rather than emit panes
       * with no pixels in them. apply() floats whatever is left over. */
      this._render(showing[0], area, ids, gap, out);
      return;
    }
    showing.forEach((child, i) => this._render(child, areas[i], ids, gap, out));
  }

  /** The children of a split with something on screen, in order. */
  private _renderedChildren(node: MTNode, ids?: Set<string>): MTTree[] {
    const known = ids !== undefined ? ids : this.lastRenderedIds;
    return node.children.filter((child) => this._hasRenderable(child, known));
  }

  private _hasRenderable(tree: MTTree, ids: Set<string>): boolean {
    if (tree instanceof MTLeaf) return tree.windowIds.some((id) => ids.has(id));
    return tree.children.some((child) => this._hasRenderable(child, ids));
  }

  /**
   * Divide an area between the panes of a split.
   *
   * Done as integer arithmetic against a running boundary rather than through
   * LayoutUtils.splitAreaWeighted so that the parts tile their parent exactly
   * and every pane can be held at its window's minimum size: a pane below its
   * minSize makes arrangeScreen float a window to get rid of it, tearing down
   * an arrangement the user built by hand.
   *
   * @returns one area per showing child, or null when there isn't room to
   * divide the area at all.
   */
  private _splitAreas(
    node: MTNode,
    showing: MTTree[],
    area: Rect,
    gap: number,
    ids: Set<string>,
  ): Rect[] | null {
    const horizontal = node.orientation === "horizontal";
    const count = showing.length;
    const total = horizontal ? area.width : area.height;
    const available = total - (count - 1) * gap;
    if (available < count * MT_MIN_PANE) return null;

    const lengths = this._splitLengths(node, showing, available, gap, ids);

    const areas: Rect[] = [];
    let offset = horizontal ? area.x : area.y;
    lengths.forEach((length) => {
      areas.push(
        horizontal
          ? new Rect(offset, area.y, length, area.height)
          : new Rect(area.x, offset, area.width, length),
      );
      offset += length + gap;
    });
    return areas;
  }

  /**
   * How many pixels along the split's axis each pane gets.
   *
   * Shares first, then a repair pass that lifts any pane below the minimum
   * size of the windows in it, taking the difference from whichever panes have
   * the most room to spare. When the minimums cannot all be met the shares
   * stand as they are and the engine's unfit handling floats something.
   */
  private _splitLengths(
    node: MTNode,
    showing: MTTree[],
    available: number,
    gap: number,
    ids: Set<string>,
  ): number[] {
    const horizontal = node.orientation === "horizontal";
    const weights = showing.map((child) => {
      const index = node.indexOf(child);
      const weight = index >= 0 ? node.weights[index] : 1;
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

    const mins = showing.map((child) =>
      this._minLength(child, horizontal, gap, ids),
    );
    const minSum = mins.reduce((sum, min) => sum + min, 0);
    if (minSum > available) {
      /* Cannot satisfy the minimums; make sure nothing is left with no pixels
       * at all and let arrangeScreen deal with the rest. */
      return lengths.map((length) => Math.max(MT_MIN_PANE, length));
    }

    let deficit = 0;
    const slack: number[] = [];
    lengths.forEach((length, i) => {
      if (length < mins[i]) {
        deficit += mins[i] - length;
        lengths[i] = mins[i];
        slack.push(0);
      } else slack.push(length - mins[i]);
    });
    if (deficit === 0) return lengths;

    /* Take the shortfall from the panes with the most to spare first. */
    const order = lengths
      .map((_, i) => i)
      .sort((a, b) => slack[b] - slack[a]);
    for (const i of order) {
      if (deficit === 0) break;
      const take = Math.min(slack[i], deficit);
      lengths[i] -= take;
      deficit -= take;
    }
    return lengths;
  }

  /**
   * Pixels a subtree needs along one axis to hold every pane in it at its
   * window's minimum size. Splits across the axis being measured add up;
   * splits along the other axis just take the largest of their panes.
   */
  private _minLength(
    tree: MTTree,
    horizontal: boolean,
    gap: number,
    ids: Set<string>,
  ): number {
    if (tree instanceof MTLeaf) {
      if (!tree.windowIds.some((id) => ids.has(id))) return 0;
      return this._leafMin(tree, horizontal, ids);
    }

    const parts = this._renderedChildren(tree, ids).map((child) =>
      this._minLength(child, horizontal, gap, ids),
    );
    if (parts.length === 0) return 0;
    if ((tree.orientation === "horizontal") === horizontal)
      return (
        parts.reduce((sum, part) => sum + part, 0) + (parts.length - 1) * gap
      );
    return parts.reduce((most, part) => Math.max(most, part), 0);
  }

  /**
   * Walk down to the basis window, retuning the shares of every split on the
   * way back up.
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
    if (tree instanceof MTLeaf) return tree.has(basisId) ? delta : null;

    const ids = this.lastRenderedIds;
    const showing = this._renderedChildren(tree, ids);
    if (showing.length === 0) return null;
    /* Collapsed exactly as _render collapsed it, so `area` still matches. */
    if (showing.length === 1)
      return this._adjustNode(showing[0], area, basisId, delta, gap);

    const areas = this._splitAreas(tree, showing, area, gap, ids);
    if (areas === null)
      return this._adjustNode(showing[0], area, basisId, delta, gap);

    let target = -1;
    let result: RectDelta | null = null;
    for (let i = 0; i < showing.length; i++) {
      result = this._adjustNode(showing[i], areas[i], basisId, delta, gap);
      if (result !== null) {
        target = i;
        break;
      }
    }
    if (result === null || target < 0) return null;

    const horizontal = tree.orientation === "horizontal";
    /* Feed back the shares actually drawn, not the stored ones, so dragging a
     * divider that is pinned by a minimum size doesn't jump. */
    const total = horizontal ? area.width : area.height;
    const available = total - (showing.length - 1) * gap;
    const drawn = this._splitLengths(tree, showing, available, gap, ids).map(
      (length) => (available > 0 ? length / available : 1 / showing.length),
    );
    const adjusted = LayoutUtils.adjustAreaWeights(
      area,
      drawn,
      gap,
      target,
      result,
      horizontal,
    );
    adjusted.forEach((weight, i) => {
      const index = tree.indexOf(showing[i]);
      if (index >= 0 && !isNaN(weight))
        tree.weights[index] = Math.max(MT_MIN_SHARE, weight);
    });

    /* Consume the edges this split owns; leave the rest to the caller. A pane
     * owns the divider before it unless it is first, and the one after it
     * unless it is last. */
    const ownsStart = target > 0;
    const ownsEnd = target < showing.length - 1;
    if (horizontal)
      return new RectDelta(
        ownsEnd ? 0 : result.east,
        ownsStart ? 0 : result.west,
        result.south,
        result.north,
      );
    return new RectDelta(
      result.east,
      result.west,
      ownsEnd ? 0 : result.south,
      ownsStart ? 0 : result.north,
    );
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
    tree.children.forEach((child) => this._leaves(child, acc));
    return acc;
  }

  private _findLeaf(windowId: string): MTLeaf | null {
    const leaves = this._leaves(this.root);
    for (const leaf of leaves) {
      if (leaf.has(windowId)) return leaf;
    }
    return null;
  }

  /** Whether `subtree` holds `target` - itself counts. */
  private _contains(subtree: MTTree, target: MTTree): boolean {
    if (subtree === target) return true;
    if (subtree instanceof MTLeaf) return false;
    return subtree.children.some((child) => this._contains(child, target));
  }

  private _isInTree(subtree: MTTree): boolean {
    return this.root !== null && this._contains(this.root, subtree);
  }

  /* Parents are looked up on demand rather than stored: the tree is tiny, and
   * it rules out the whole class of stale-parent-pointer bugs. */
  private _placeOf(target: MTTree): IMTPlace | null {
    return this.root === null ? null : this._placeIn(this.root, target);
  }

  private _placeIn(tree: MTTree, target: MTTree): IMTPlace | null {
    if (tree instanceof MTLeaf) return null;
    const index = tree.indexOf(target);
    if (index >= 0) return { parent: tree, index: index };
    for (const child of tree.children) {
      const place = this._placeIn(child, target);
      if (place !== null) return place;
    }
    return null;
  }

  /** Swap one subtree for another, in place. */
  private _replaceNode(target: MTTree, replacement: MTTree): boolean {
    if (this.root === target) {
      this.root = replacement;
      return true;
    }
    const place = this._placeOf(target);
    if (place === null) return false;
    place.parent.replaceAt(place.index, replacement);
    return true;
  }

  /** Remove a subtree, and any split it leaves with nothing in it. */
  private _detach(subtree: MTTree): boolean {
    if (this.selection !== null && this._contains(subtree, this.selection))
      this._select(null, false);
    if (this.root === subtree) {
      this.root = null;
      return true;
    }
    const place = this._placeOf(subtree);
    if (place === null) return false;
    place.parent.removeAt(place.index);
    this._cleanup();
    return true;
  }

  /**
   * Flatten splits left holding a single pane, the way COSMIC does after every
   * edit. A split of one is not a split - it renders exactly as its pane would
   * - and leaving them in place would grow a chain of them around a window
   * that has been pushed around for a while, each one another layer for the
   * next move to climb through.
   */
  private _cleanup(): void {
    if (this.root === null) return;
    for (;;) {
      const collapsed = this._collapseOnce(this.root);
      if (collapsed === null) break;
      if (!this._replaceNode(collapsed.node, collapsed.child)) break;
    }
    if (this.root instanceof MTNode && this.root.length === 0) this.root = null;
  }

  private _collapseOnce(
    tree: MTTree,
  ): { node: MTNode; child: MTTree } | null {
    if (tree instanceof MTLeaf) return null;
    if (tree.length === 1) return { node: tree, child: tree.children[0] };
    for (const child of tree.children) {
      const found = this._collapseOnce(child);
      if (found !== null) return found;
    }
    return null;
  }

  private _describe(tree: MTTree | null): string {
    if (tree === null) return "empty";
    if (tree instanceof MTLeaf)
      return tree.size > 1 || tree.isStack
        ? `[${tree.windowIds.join("|")}]`
        : tree.windowIds[0];

    const axis = tree.orientation === "horizontal" ? "H" : "V";
    const total = tree.weights.reduce((sum, weight) => sum + weight, 0);
    /* Two panes are described by the first one's share, as they always have
     * been; more than two need all of them. */
    const shares = (
      tree.length === 2 ? [tree.weights[0]] : tree.weights
    ).map((weight) => (total > 0 ? weight / total : 0).toFixed(2));
    const children = tree.children.map((child) => this._describe(child));
    return `${axis}:${shares.join(",")}[${children.join(",")}]`;
  }

  //#endregion
}
