/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/** Where a dragged window lands relative to the pane it is dropped on. */
type MTDropZone = "left" | "right" | "top" | "bottom" | "center";

interface IMTDropTarget {
  leaf: MTLeaf;
  zone: MTDropZone;
}

/**
 * What the commands act on: a single pane, or - once grown - a group.
 *
 * Anchored to the window that had the focus when it was made. Focus moving
 * anywhere else, by any means, ends it: a group is a deliberate, short-lived
 * aim at "these panes, for the next command", and must never quietly apply
 * to windows the user has stopped looking at.
 */
interface IMTSelection {
  node: MTTree;
  /**
   * Whether this is a group rather than just the focused pane. Not the same
   * as "the node is a split": a stack holds several windows, so it can be a
   * group on its own, but until it is grown into one the commands treat it as
   * the single pane it looks like.
   */
  grown: boolean;
  anchorId: string;
}

/**
 * How much of a pane, along each axis, counts as an edge for a drop. The
 * middle that remains drops onto the pane itself, joining its stack.
 */
const MT_DROP_EDGE = 0.25;

/** What a move did, and so whether the selection's old slot still holds it. */
type MTMoveOutcome = "moved" | "swapped";

/**
 * Manual tiling, modelled on COSMIC's: a tree of splits the user edits
 * directly, rather than a shape derived from how many windows there are.
 *
 * New windows split the focused pane along its longer side - or join it, if
 * it is a stack. From there the user rearranges with the directional move
 * keys (a port of cosmic-comp's `TilingLayout::move_current_node`), the split
 * and rotate keys, stacks, group selection, mouse drags and the usual resize.
 *
 * The tree is state, held on this instance for the whole session by
 * LayoutStore, so it survives arranges and switching to another layout and
 * back. Consequences:
 *
 *  - `apply` MUST stay idempotent. `arrangeScreen` re-applies the layout with
 *    fewer windows while CONFIG.unfitGreater/unfitLess float the ones that do
 *    not fit; pruning, inserting and rendering are all safe to repeat.
 *  - Panes survive their windows going away temporarily - minimized,
 *    fullscreen, on another desktop - so a hand-built arrangement comes back
 *    intact. They are dropped when the window closes or is floated.
 *  - The tree lives in memory only; it does not survive a KWin restart.
 *  - With CONFIG.layoutPerDesktop off, one instance serves every desktop of an
 *    output, so one tree holds windows that are never on screen together.
 *    Rendering stays correct, but an edit can put a pane next to one that is
 *    not showing. ColumnsLayout has the same limitation.
 *  - CONFIG.newWindowPosition has no effect: where a window goes is decided by
 *    focus and the tree, not by its place in the engine's window list.
 */
class ManualTilingLayout implements ILayout {
  public static readonly id = "ManualTilingLayout";

  public readonly classID = ManualTilingLayout.id;
  public readonly capacity?: number | null;

  public get description(): string {
    return "Manual Tiling";
  }

  private readonly tree: ManualTilingTree;

  /* What the most recent apply() put on screen. adjust(), the commands and
   * the overlays all work from these rather than their own arguments, so they
   * always see exactly what the user sees. */
  private geometry: MTGeometry;
  private lastArea: Rect | null;
  /** Leaves on screen, in on-screen order. */
  private renderedLeaves: MTLeaf[];

  private selection: IMTSelection | null;

  constructor(capacity?: number | null) {
    this.capacity = capacity !== undefined ? capacity : null;
    this.tree = new ManualTilingTree();
    this.geometry = MTGeometry.empty();
    this.lastArea = null;
    this.renderedLeaves = [];
    this.selection = null;
  }

  public apply(
    ctx: EngineContext,
    tileables: WindowClass[],
    area: Rect,
    gap: number,
  ): void {
    this._prune(ctx);
    this.lastArea = area.clone();

    this.geometry = MTGeometry.forWindows(tileables, gap);
    this._render();
    /* Insert one at a time, re-rendering in between, so a batch of new windows
     * lands exactly where opening them one by one would put them. */
    tileables.forEach((tileable) => {
      if (this.tree.findLeaf(tileable.id) !== null) return;
      this._insertWindow(ctx, tileable.id);
      this._render();
    });

    /* Anything left without a pane - only possible when the area is too small
     * to divide any further - is floated rather than left marked Tiled,
     * holding stale geometry and ignoring every command that would fix it.
     * It gives up its pane at once, as _prune would on the next pass, and the
     * rest are laid out again without it. Each round floats at least one
     * window, so this ends. */
    let tiles = tileables;
    for (;;) {
      const placed = this._placements();
      const unplaced = tiles.filter((tile) => placed[tile.id] === undefined);
      if (unplaced.length === 0) {
        tiles.forEach((tile) => {
          tile.state = WindowState.Tiled;
          tile.geometry = placed[tile.id];
        });
        break;
      }
      unplaced.forEach((tile) => {
        tile.state = WindowState.Floating;
        this._release(tile.id);
      });
      tiles = tiles.filter((tile) => placed[tile.id] !== undefined);
      this.geometry = MTGeometry.forWindows(tiles, gap);
      this._render();
    }
  }

  public adjust(
    area: Rect,
    tiles: WindowClass[],
    basis: WindowClass,
    delta: RectDelta,
    gap: number,
  ): void {
    if (this.tree.root === null) return;
    /* The engine passes the bare working area: no dock subtraction, no
     * sole-window override. Shares have to be worked out against what was
     * actually rendered, or they come out against the wrong pixel lengths. */
    this.geometry.adjust(
      this.tree.root,
      this.lastArea !== null ? this.lastArea : area,
      basis.id,
      delta,
    );
  }

  public handleShortcut(ctx: EngineContext, action: KrohnkiteAction): boolean {
    switch (action) {
      case KrohnkiteAction.SplitHorizontal:
        return this._split(ctx, "horizontal");
      case KrohnkiteAction.SplitVertical:
        return this._split(ctx, "vertical");

      /* Increase and Decrease are the layout-owned "more / fewer divisions"
       * keys - TileLayout adds or drops a master, Stair and Spread a tile.
       * Adding and removing a split is the same idea, and both come bound, so
       * the layout is usable before anything else is. */
      case KrohnkiteAction.Increase:
        return this._split(ctx, null);
      case KrohnkiteAction.Decrease:
        return this._unsplit(ctx);

      case KrohnkiteAction.Rotate:
        return this._rotate(ctx);

      /* The engine's own handling of these only reorders the window list,
       * which this layout never reads. When a move is refused - nothing left
       * to step out to - the key falls through to the engine, which pushes
       * the window on to the next screen. */
      case KrohnkiteAction.MoveLeft:
        return this._move(ctx, "left");
      case KrohnkiteAction.MoveRight:
        return this._move(ctx, "right");
      case KrohnkiteAction.MoveUp:
        return this._move(ctx, "up");
      case KrohnkiteAction.MoveDown:
        return this._move(ctx, "down");

      case KrohnkiteAction.GroupGrow:
        return this._growSelection(ctx);
      case KrohnkiteAction.GroupShrink:
        return this._shrinkSelection(ctx);

      case KrohnkiteAction.ToggleStack:
        return this._toggleStack(ctx);
      case KrohnkiteAction.StackNext:
        return this._cycleStack(ctx, 1);
      case KrohnkiteAction.StackPrev:
        return this._cycleStack(ctx, -1);
      case KrohnkiteAction.StackMoveNext:
        return this._moveTab(ctx, 1);
      case KrohnkiteAction.StackMovePrev:
        return this._moveTab(ctx, -1);

      default:
        return false;
    }
  }

  /**
   * What to draw over the tiles: a tab strip per stack, and an outline around
   * the selected group. Pure - it reads the last render and the focus, so the
   * engine can redraw on a focus change without an arrange.
   */
  public overlays(ctx: EngineContext): ILayoutOverlays {
    const selection = this._liveSelection(ctx);
    return {
      stackBars: this._stackBars(ctx),
      /* Only a group is outlined. A single pane is the focused window, and
       * KWin already draws a border around that. */
      selection:
        selection !== null && selection.grown ? selection.node.rect : null,
    };
  }

  /**
   * Any window gaining the focus but the one a selection was made from ends
   * it - for good, so focus coming back does not revive an old group.
   */
  public focusChanged(windowId: string): void {
    if (this.selection !== null && this.selection.anchorId !== windowId)
      this.selection = null;
  }

  /**
   * What to flash after a window has been moved or dropped: the group it
   * ended up in - the selected group, if it moved as one - rather than its
   * own pane. KWin already borders the focused window; what a move through
   * the tree makes hard to see is which split or stack it landed inside,
   * which can reach well beyond it.
   *
   * @returns null when there is no group to show, such as a pane alone on
   * the screen.
   */
  public flashArea(ctx: EngineContext, window: WindowClass): Rect | null {
    const leaf = this.tree.findLeaf(window.id);
    if (leaf === null || leaf.rect === null) return null;
    const selection = this._liveSelection(ctx);
    const moved =
      selection !== null &&
      selection.grown &&
      ManualTilingTree.contains(selection.node, leaf)
        ? selection.node
        : leaf;
    const group = this._groupAround(moved);
    return group !== null ? group.rect : null;
  }

  public toString(): string {
    return `ManualTilingLayout(${this.tree})`;
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
   *     with the selection on that side of it.
   *  2. **We got here from a split further in.** The selection joins this
   *     split as another pane of it, next to the one it came out of - two
   *     panes become three, rather than nesting deeper.
   *  3. **There is a pane that way.** A stack takes the window in as a tab, a
   *     group is entered at the edge we arrive on, and a plain pane either
   *     trades places with us (when the two of us are all there is) or is
   *     split in half to take us in.
   *  4. **Nothing that way.** Step out to the split above and start again.
   *
   * A window inside a stack is handled first: it leaves the stack rather
   * than dragging its tab-mates along, and takes half the pane.
   */
  private _move(ctx: EngineContext, dir: Direction): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;
    const moving = selection.node;

    const axis: MTOrientation =
      dir === "left" || dir === "right" ? "horizontal" : "vertical";
    /* Which end of a split the direction points at. */
    const toStart = dir === "left" || dir === "up";

    if (!selection.grown && this._moveOutOfStack(ctx, moving, axis, toStart))
      return true;

    /* Every branch below puts the selection in its new home first and vacates
     * this afterwards: pulling it out first can collapse the very split the
     * move is about to act on. */
    const from = this.tree.placeOf(moving);
    if (from === null) return false;

    /* What we are moving *relative to* at the level being looked at: the
     * selection at first, then whatever we stepped out of. */
    let child: MTTree = moving;
    for (;;) {
      const place = this.tree.placeOf(child);
      if (place === null) return false;
      const parent = place.parent;

      /* A split with one pane on screen is not a split as far as the user can
       * tell; acting on it would swallow the key and change nothing visible. */
      if (this.geometry.showingChildren(parent).length < 2) {
        child = parent;
        continue;
      }

      /* 1. Turn the arrangement to face the way we are going. */
      if (parent.orientation !== axis) {
        const wrapper = new MTNode(
          axis,
          toStart ? [moving, parent] : [parent, moving],
        );
        if (!this.tree.replace(parent, wrapper)) return false;
        return this._settle(from, moving);
      }

      /* 2. Arrived from further in: become a pane of this split. */
      if (child !== moving) {
        parent.insert(moving, toStart ? place.index : place.index + 1);
        return this._settle(from, moving);
      }

      /* 3. Something in the way. */
      const next = this._nextShowingSibling(parent, place.index, toStart);
      if (next !== null) {
        const outcome = this._moveInto(parent, moving, next, axis, toStart);
        /* A swap leaves no old slot to vacate. */
        return this._settle(outcome === "swapped" ? null : from, moving);
      }

      /* 4. Ran out of panes this way: try the split above. */
      child = parent;
    }
  }

  /**
   * Put the selection into, or beside, the pane it has run into.
   *
   * @returns "swapped" when the selection traded places with the pane - which
   * leaves no old slot to vacate - and otherwise "moved", when it has been
   * placed and its old slot is still to be cleared.
   */
  private _moveInto(
    parent: MTNode,
    moving: MTTree,
    next: MTTree,
    axis: MTOrientation,
    toStart: boolean,
  ): MTMoveOutcome {
    /* Only when the two of them are all there is in this split does moving
     * "into" the neighbour mean anything; with others around, the neighbour
     * is just the next pane along, and gets split. */
    const alone = this.geometry.showingChildren(parent).length === 2;

    /* A stack takes a pane in - that is what a stack is for. Never a group:
     * that would flatten its arrangement into a row of tabs. */
    if (
      alone &&
      next instanceof MTLeaf &&
      next.isStack &&
      moving instanceof MTLeaf &&
      !moving.isStack
    ) {
      moving.windowIds.forEach((id) => next.add(id));
      return "moved";
    }

    if (alone && next instanceof MTNode) {
      /* Enter the group. Along its own axis we arrive at the near end;
       * across it there is no near end, so we land in the middle. */
      if (next.orientation === axis) {
        next.insert(moving, toStart ? next.length : 0);
      } else {
        const middle = Math.floor(next.length / 2);
        if (next.length % 2 === 0) next.insert(moving, middle);
        else {
          /* No gap in the middle to slot into: split the pane that is. */
          const target = next.children[middle];
          next.replaceAt(
            middle,
            new MTNode(axis, toStart ? [target, moving] : [moving, target]),
          );
        }
      }
      return "moved";
    }

    if (alone) {
      /* Just the two of us: trade places, shares and all. */
      parent.swap(parent.indexOf(moving), parent.indexOf(next));
      return "swapped";
    }

    /* Three or more panes here: halve the one in the way and take the side we
     * arrive on. This is what turns `A | B | C` into `(A | B) | C`. */
    parent.replaceAt(
      parent.indexOf(next),
      new MTNode(axis, toStart ? [next, moving] : [moving, next]),
    );
    return "moved";
  }

  /**
   * The focused window leaving the stack it is a tab of: it goes alone, and
   * takes half of the stack's pane, split the way it was pushed.
   *
   * @returns whether this was that case, and has been handled.
   */
  private _moveOutOfStack(
    ctx: EngineContext,
    moving: MTTree,
    axis: MTOrientation,
    toStart: boolean,
  ): boolean {
    if (!(moving instanceof MTLeaf) || moving.renderedIds.length < 2)
      return false;
    const current = ctx.currentWindow;
    if (current === null || !moving.has(current.id)) return false;

    const moved = this._splitOff(moving, current.id, axis, toStart);
    if (moved === null) return false;
    this._select(ctx, moved, false);
    return true;
  }

  /**
   * Take one window out of a stack into a pane of its own, beside the stack.
   *
   * @returns the new pane, or null if nothing changed.
   */
  private _splitOff(
    stack: MTLeaf,
    windowId: string,
    axis: MTOrientation,
    movedFirst: boolean,
  ): MTLeaf | null {
    if (stack.size < 2 || !stack.remove(windowId)) return null;
    const moved = new MTLeaf(windowId);
    const wrapper = new MTNode(
      axis,
      movedFirst ? [moved, stack] : [stack, moved],
    );
    if (this.tree.replace(stack, wrapper)) return moved;
    /* Put it back rather than lose the window. */
    stack.add(windowId);
    return null;
  }

  /**
   * Finish a move: vacate the slot the selection came from, and flatten
   * whatever that leaves behind.
   *
   * The subtree is in the tree twice between being placed and this running.
   * That is the point: taking it out first can dissolve the split the move
   * was aiming at.
   */
  private _settle(from: IMTPlace | null, moved: MTTree): boolean {
    if (from !== null) {
      const index =
        from.parent.children[from.index] === moved
          ? from.index
          : from.parent.indexOf(moved);
      if (index >= 0) from.parent.removeAt(index);
    }
    this.tree.cleanup();
    return true;
  }

  /** The next pane of a split that is on screen, in a direction. */
  private _nextShowingSibling(
    parent: MTNode,
    index: number,
    toStart: boolean,
  ): MTTree | null {
    const step = toStart ? -1 : 1;
    for (let i = index + step; i >= 0 && i < parent.length; i += step) {
      if (this.geometry.isShowing(parent.children[i]))
        return parent.children[i];
    }
    return null;
  }

  //#endregion

  //#region Splitting

  /**
   * Put a new split around the focused pane, and move the pane next to it on
   * screen into the other half. Everything else shifts up to fill the gap
   * that leaves, which is what makes the whole arrangement reflow.
   *
   * @param orientation which way to cut, or null for along the pane's longer
   * side - the same choice a new window would make.
   */
  private _split(
    ctx: EngineContext,
    orientation: MTOrientation | null,
  ): boolean {
    const leaf = this._focusedLeaf(ctx);
    if (leaf === null) return false;

    /* A stack of several windows divides itself: the focused member leaves
     * it and takes half of the pane. */
    if (leaf.renderedIds.length > 1) {
      const current = ctx.currentWindow!;
      const cut =
        orientation !== null
          ? orientation
          : this._splitOrientation(leaf, new MTLeaf(current.id));
      return this._splitOff(leaf, current.id, cut, false) !== null;
    }

    const partner = this._splitPartner(leaf);
    /* Nothing to pull in: only one pane is showing. */
    if (partner === null) return false;
    const partnerIsAfter =
      this.renderedLeaves.indexOf(partner) > this.renderedLeaves.indexOf(leaf);
    const cut =
      orientation !== null
        ? orientation
        : this._splitOrientation(leaf, partner);

    const place = this.tree.placeOf(leaf);
    if (
      place !== null &&
      place.parent.length === 2 &&
      place.parent.indexOf(partner) >= 0
    ) {
      /* The only other pane of this split is the one we would pull in, so
       * there is no division to add; all that is left is to reorient the
       * split they already share. */
      if (place.parent.orientation === cut) return false;
      place.parent.orientation = cut;
      place.parent.weights = place.parent.children.map(() => 1);
      return true;
    }

    /* Detach first: wrapping first would put the partner in the tree twice. */
    if (!this.tree.detach(partner)) return false;
    const replaced = this.tree.replace(
      leaf,
      new MTNode(cut, partnerIsAfter ? [leaf, partner] : [partner, leaf]),
    );
    this.tree.cleanup();
    return replaced;
  }

  /**
   * The pane to move into the other half of a new split.
   *
   * Nearest on screen wins, looking forwards before backwards, but the focused
   * pane's own sole sibling comes last: moving that one into a new split
   * beside the focused pane produces the very split they already share. It
   * is still the fallback, for when it is the only other pane showing.
   */
  private _splitPartner(leaf: MTLeaf): MTLeaf | null {
    const index = this.renderedLeaves.indexOf(leaf);
    if (index < 0) return null;

    const place = this.tree.placeOf(leaf);
    const sibling =
      place !== null && place.parent.length === 2
        ? place.parent.children[1 - place.index]
        : null;

    let fallback: MTLeaf | null = null;
    for (let step = 1; step < this.renderedLeaves.length; step++) {
      for (const i of [index + step, index - step]) {
        const candidate = this.renderedLeaves[i];
        if (candidate === undefined) continue;
        if (candidate !== sibling) return candidate;
        if (fallback === null) fallback = candidate;
      }
    }
    return fallback;
  }

  /**
   * Remove a division: the focused pane absorbs the pane next to it, which
   * moves - keeping its own arrangement - next to the bottom-right-most pane
   * elsewhere in the tree.
   *
   * Refused when there is no "elsewhere", which includes every two-pane
   * arrangement. Takes no direction: which division goes is decided by where
   * the focused pane already is.
   */
  private _unsplit(ctx: EngineContext): boolean {
    const leaf = this._focusedLeaf(ctx);
    if (leaf === null) return false;
    const place = this.tree.placeOf(leaf);
    if (place === null) return false;

    /* The next pane along, or the previous one when the focused pane is last. */
    const evicted =
      place.parent.children[
        place.index + 1 < place.parent.length
          ? place.index + 1
          : place.index - 1
      ];
    if (evicted === undefined) return false;

    /* The target has to be outside both, or the pane lands where it was. */
    const exclude = new Set<MTLeaf>([
      ...this.tree.leaves(evicted),
      ...this.tree.leaves(leaf),
    ]);
    const target = this._bottomRightMost(exclude);
    if (target === null || target.rect === null) return false;

    const orientation = this._orientationFor(target.rect);
    if (!this.tree.detach(evicted)) return false;
    this.tree.replace(target, new MTNode(orientation, [target, evicted]));
    this.tree.cleanup();
    return true;
  }

  /**
   * Give the split the selection sits in a quarter turn clockwise, so four
   * presses come back to where they started:
   *
   *     A | B  ->  A / B  ->  B | A  ->  B / A  ->  A | B
   *
   * Every turn flips the axis; every other one also reverses the panes,
   * since turning a column clockwise puts its top pane on the right. Splits
   * with a single pane on screen are walked past - turning one would change
   * nothing the user can see.
   */
  private _rotate(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;

    let node: MTTree = selection.node;
    for (;;) {
      const place = this.tree.placeOf(node);
      if (place === null) return false;
      const parent = place.parent;
      if (this.geometry.showingChildren(parent).length >= 2) {
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

  //#endregion

  //#region Selection

  /**
   * The selection the commands act on, falling back to the focused pane when
   * there is no live one. Null when the focused window is not a pane of this
   * layout - commands must then return false, so the engine's default
   * handling still runs.
   */
  private _currentSelection(ctx: EngineContext): IMTSelection | null {
    const live = this._liveSelection(ctx);
    if (live !== null) return live;
    const leaf = this._focusedLeaf(ctx);
    if (leaf === null) return null;
    return this._select(ctx, leaf, false);
  }

  /** The stored selection, if focus has not moved since it was made. */
  private _liveSelection(ctx: EngineContext): IMTSelection | null {
    const selection = this.selection;
    const current = ctx.currentWindow;
    if (
      selection === null ||
      current === null ||
      selection.anchorId !== current.id ||
      !this.tree.has(selection.node)
    )
      return null;
    return selection;
  }

  private _select(
    ctx: EngineContext,
    node: MTTree,
    grown: boolean,
  ): IMTSelection | null {
    const current = ctx.currentWindow;
    this.selection =
      current !== null
        ? { node: node, grown: grown, anchorId: current.id }
        : null;
    return this.selection;
  }

  /** Widen the selection to the enclosing split. */
  private _growSelection(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;

    /* A stack is several windows in one pane, so it is a group before the
     * split around it is. Selecting it first is what lets it be moved - or
     * sent to another screen - as the one thing it looks like, rather than
     * having its focused tab pulled out of it. */
    const node = selection.node;
    if (
      !selection.grown &&
      node instanceof MTLeaf &&
      node.renderedIds.length > 1
    )
      return this._announce(ctx, this._select(ctx, node, true));

    const place = this.tree.placeOf(node);
    if (place === null) return false;
    return this._announce(ctx, this._select(ctx, place.parent, true));
  }

  /** Narrow the selection back towards the focused pane. */
  private _shrinkSelection(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    const leaf = this._focusedLeaf(ctx);
    if (selection === null || leaf === null || !selection.grown) return false;

    const node = selection.node;
    if (node instanceof MTLeaf)
      return this._announce(ctx, this._select(ctx, node, false));

    const next = node.children.find((child) =>
      ManualTilingTree.contains(child, leaf),
    );
    if (next === undefined) return false;
    /* One step down is still a group if it is a split, or a stack. */
    const stillGroup = next instanceof MTNode || next.renderedIds.length > 1;
    return this._announce(ctx, this._select(ctx, next, stillGroup));
  }

  /**
   * Say how much the selection now holds. The outline itself is drawn with
   * the other overlays, by the arrange the engine runs after the command.
   * Always true: the key was consumed even though no pane moved.
   */
  private _announce(ctx: EngineContext, selection: IMTSelection | null): true {
    if (selection === null) return true;
    const windows = this.tree
      .leaves(selection.node)
      .reduce((sum, leaf) => sum + leaf.renderedIds.length, 0);
    ctx.showNotification(
      windows === 1 ? "1 window selected" : `${windows} windows selected`,
    );
    return true;
  }

  //#endregion

  //#region Stacks

  /**
   * Turn the selection into one stacked pane, or spread a stack back out.
   *
   * Stacking a group collects every window under it, in order, into a single
   * pane where they share the space as tabs. Unstacking is the inverse: the
   * members fan back out into splits, so nothing is lost either way.
   */
  private _toggleStack(ctx: EngineContext): boolean {
    const selection = this._currentSelection(ctx);
    if (selection === null) return false;
    const node = selection.node;

    if (node instanceof MTLeaf && node.isStack) return this._unstack(node);

    const stack = new MTLeaf(this.tree.windowIds(node), true);
    if (!this.tree.replace(node, stack)) return false;
    /* Still the same group, now living in one pane. */
    this._select(ctx, stack, selection.grown || stack.size > 1);
    return true;
  }

  /**
   * Fan a stack's members back out, as a balanced tree rather than a comb, so
   * five windows come out as a grid instead of a row of ever-thinner slivers.
   */
  private _unstack(stack: MTLeaf): boolean {
    stack.isStack = false;
    if (stack.size < 2) return true;

    const ids = stack.windowIds.slice(0);
    const build = (from: number, to: number, cut: MTOrientation): MTTree => {
      if (to - from === 1) return new MTLeaf(ids[from]);
      const mid = from + Math.ceil((to - from) / 2);
      const across: MTOrientation =
        cut === "horizontal" ? "vertical" : "horizontal";
      return new MTNode(cut, [
        build(from, mid, across),
        build(mid, to, across),
      ]);
    };
    const orientation =
      stack.rect !== null ? this._orientationFor(stack.rect) : "horizontal";
    return this.tree.replace(stack, build(0, ids.length, orientation));
  }

  /** Raise and focus the next member of the focused stack. */
  private _cycleStack(ctx: EngineContext, step: -1 | 1): boolean {
    const leaf = this._focusedLeaf(ctx);
    if (leaf === null || leaf.renderedIds.length < 2) return false;

    const index = leaf.renderedIds.indexOf(ctx.currentWindow!.id);
    const next = ctx.getWindowById(
      leaf.renderedIds[wrapIndex(index + step, leaf.renderedIds.length)],
    );
    if (next === null) return false;
    ctx.currentWindow = next;
    return true;
  }

  /**
   * Move the focused window one place along its stack's tab strip, wrapping
   * at the ends.
   *
   * The step is taken among the tabs on screen and applied by swapping the
   * two ids, so a member that is not showing - minimized, on another desktop -
   * keeps its place, and nothing is reordered behind the user's back.
   */
  private _moveTab(ctx: EngineContext, step: -1 | 1): boolean {
    const leaf = this._focusedLeaf(ctx);
    if (leaf === null || leaf.renderedIds.length < 2) return false;

    const shown = leaf.renderedIds;
    const index = shown.indexOf(ctx.currentWindow!.id);
    const from = leaf.windowIds.indexOf(shown[index]);
    const to = leaf.windowIds.indexOf(
      shown[wrapIndex(index + step, shown.length)],
    );
    if (from === to) return false;

    leaf.windowIds[from] = leaf.windowIds[to];
    leaf.windowIds[to] = shown[index];
    return true;
  }

  /**
   * The member of a stack that is on top: the one focused most recently.
   * Stacks raise nothing themselves - whichever member KWin last activated is
   * the one showing - so this is derived rather than remembered.
   */
  private _topOf(ctx: EngineContext, leaf: MTLeaf): string {
    let top = leaf.renderedIds[0];
    let topTime = -Infinity;
    leaf.renderedIds.forEach((id) => {
      const window = ctx.getWindowById(id);
      const time = window !== null ? window.focusTime : 0;
      if (time > topTime) {
        top = id;
        topTime = time;
      }
    });
    return top;
  }

  private _stackBars(ctx: EngineContext): IStackBar[] {
    const bars: IStackBar[] = [];
    this.renderedLeaves.forEach((leaf) => {
      if (!leaf.isStack || leaf.rect === null) return;
      const top = this._topOf(ctx, leaf);
      bars.push({
        x: leaf.rect.x,
        y: leaf.rect.y,
        width: leaf.rect.width,
        height: MT_TABBAR_HEIGHT,
        tabs: leaf.renderedIds.map((id) => {
          const window = ctx.getWindowById(id);
          return {
            id: id,
            title: window !== null ? window.windowCaption : id,
            active: id === top,
          };
        }),
      });
    });
    return bars;
  }

  //#endregion

  //#region Dragging

  /**
   * Preview where the window being dragged would land.
   *
   * Never re-tiles: shuffling panes on every mouse move would pull them out
   * from under the cursor. The tree changes once, in `drop`; until then this
   * only points the drag preview at the target.
   */
  public drag(_ctx: EngineContext, dragAction: DragAction): void {
    const target = this._dropTarget(dragAction);
    dragAction.previewRect =
      target !== null ? this._dropRect(target.leaf.rect!, target.zone) : null;
  }

  /**
   * Put a dropped window where the preview said it would go.
   *
   * Dropping on a pane's edge splits it; dropping on its middle joins the
   * pane's stack, making it one if it is not already - the same as dragging
   * one window onto another in COSMIC.
   */
  public drop(_ctx: EngineContext, dragAction: DragAction): void {
    const target = this._dropTarget(dragAction);
    if (target === null) return;
    const windowId = dragAction.window.id;
    const axis: MTOrientation =
      target.zone === "left" || target.zone === "right"
        ? "horizontal"
        : "vertical";
    const movedFirst = target.zone === "left" || target.zone === "top";

    /* Onto the edge of its own stack: leave the stack, to that side. */
    const source = this.tree.findLeaf(windowId);
    if (source === target.leaf) {
      this._splitOff(source, windowId, axis, movedFirst);
      return;
    }

    /* Free the old slot first; the pane goes if it was the last member,
     * which is what lets the rest of the tree close up behind it. A window
     * dragged in from another screen has no slot here to free. */
    if (source !== null) this._release(windowId, source);
    if (!this.tree.has(target.leaf)) return;

    if (target.zone === "center") {
      target.leaf.isStack = true;
      target.leaf.add(windowId);
      this.tree.cleanup();
      return;
    }

    /* Along an existing split, join it as another pane rather than nesting a
     * new split inside it - the same reason a move makes three panes of two. */
    const moved = new MTLeaf(windowId);
    const place = this.tree.placeOf(target.leaf);
    if (place !== null && place.parent.orientation === axis)
      place.parent.insert(moved, movedFirst ? place.index : place.index + 1);
    else
      this.tree.replace(
        target.leaf,
        new MTNode(
          axis,
          movedFirst ? [moved, target.leaf] : [target.leaf, moved],
        ),
      );
    this.tree.cleanup();
  }

  /** The pane under the cursor, and which of its zones the cursor is in. */
  private _dropTarget(dragAction: DragAction): IMTDropTarget | null {
    if (!dragAction.window.isTiled) return null;
    const cursor = dragAction.mousePointer;
    const windowId = dragAction.window.id;

    for (const leaf of this.renderedLeaves) {
      const rect = leaf.rect;
      if (rect === null || !rect.includesPoint(cursor)) continue;
      const zone = this._dropZone(rect, cursor);
      /* Its own pane: nothing to do, unless it is leaving a stack - one with
       * another member on screen, or it would split off beside nothing. */
      if (
        leaf.has(windowId) &&
        (leaf.renderedIds.length < 2 || zone === "center")
      )
        return null;
      return { leaf: leaf, zone: zone };
    }
    return null;
  }

  private _dropZone(rect: Rect, cursor: QPoint): MTDropZone {
    const horizontal = (cursor.x - rect.x) / rect.width;
    const vertical = (cursor.y - rect.y) / rect.height;
    const nearest = Math.min(
      horizontal,
      1 - horizontal,
      vertical,
      1 - vertical,
    );
    if (nearest > MT_DROP_EDGE) return "center";
    if (nearest === horizontal) return "left";
    if (nearest === 1 - horizontal) return "right";
    if (nearest === vertical) return "top";
    return "bottom";
  }

  /** The area a window dropped in a zone of a pane would end up with. */
  private _dropRect(rect: Rect, zone: MTDropZone): Rect {
    const halfWidth = Math.round(rect.width / 2);
    const halfHeight = Math.round(rect.height / 2);
    switch (zone) {
      case "left":
        return new Rect(rect.x, rect.y, halfWidth, rect.height);
      case "right":
        return new Rect(rect.maxX - halfWidth, rect.y, halfWidth, rect.height);
      case "top":
        return new Rect(rect.x, rect.y, rect.width, halfHeight);
      case "bottom":
        return new Rect(rect.x, rect.maxY - halfHeight, rect.width, halfHeight);
      default:
        return rect.clone();
    }
  }

  //#endregion

  //#region Moving groups between surfaces

  /**
   * The rest of the group a window belongs to, so it can follow that window
   * to the screen or desktop it has just been sent to.
   *
   * This is how a group crosses to another surface: there is no command of
   * its own for it. KWin's own "window to next screen" and friends move the
   * focused window, and TilingEngine.followGroupMove hands everything
   * selected along with it. Only a group follows; a single pane moves as it
   * always did.
   *
   * @returns the ids of the windows to send after it, or null if the window
   * is not in a selected group here.
   */
  public groupFollowerIds(windowId: string): string[] | null {
    const group = this._groupOf(windowId);
    if (group === null) return null;
    /* Only the windows that were on screen here. A pane can outlive its
     * window leaving for another surface on its own, and that window is not
     * part of what the user sees as the group. */
    const ids = this.tree
      .windowIds(group)
      .filter((id) => id !== windowId && this.geometry.ids.has(id));
    return ids.length > 0 ? ids : null;
  }

  /**
   * Detach the group a window belongs to, for grafting at its destination.
   * The window's own pane goes with it, so the group arrives complete.
   *
   * Separate from `groupFollowerIds` so the engine can ask without committing:
   * a window changing screen announces itself more than once, and the first
   * of those can arrive before it has actually left.
   */
  public takeGroup(windowId: string): MTTree | null {
    const group = this._groupOf(windowId);
    if (group === null || !this.tree.detach(group)) return null;
    this.selection = null;
    return group;
  }

  /** Attach a group that arrived from another surface, beside everything. */
  public graft(group: MTTree): void {
    this.tree.graft(
      group,
      this.lastArea !== null
        ? this._orientationFor(this.lastArea)
        : "horizontal",
    );
  }

  private _groupOf(windowId: string): MTTree | null {
    const selection = this.selection;
    if (
      selection === null ||
      !selection.grown ||
      selection.anchorId !== windowId ||
      !this.tree.has(selection.node)
    )
      return null;
    const leaf = this.tree.findLeaf(windowId);
    if (leaf === null || !ManualTilingTree.contains(selection.node, leaf))
      return null;
    return selection.node;
  }

  //#endregion

  //#region Reconcile

  /**
   * Drop windows that have closed or been floated, and any duplicate id - a
   * duplicate would have two panes fight over one window's geometry.
   *
   * Floated windows must lose their pane or the arrangement can wedge: with
   * CONFIG.unfitGreater, arrangeScreen floats any window bigger than its pane,
   * so a pane too small for its window would otherwise be held empty forever
   * and re-floated the moment the user tiled it again. Releasing it lets the
   * tree close up, and re-tiling finds a fresh pane that may fit.
   *
   * Matched on the state itself rather than isFloating: TiledAfloat is a
   * tileable state, and dropping those would fight the apply() that is about
   * to put them straight back.
   */
  private _prune(ctx: EngineContext): void {
    const seen = new Set<string>();
    this.tree.leaves().forEach((leaf) => {
      leaf.windowIds.slice(0).forEach((id) => {
        const window = ctx.getWindowById(id);
        if (
          seen.has(id) ||
          window === null ||
          window.state === WindowState.Floating
        )
          this._release(id, leaf);
        else seen.add(id);
      });
    });
  }

  /** Take a window out of its pane, and the pane out of the tree if empty. */
  private _release(
    windowId: string,
    leaf: MTLeaf | null = this.tree.findLeaf(windowId),
  ): void {
    if (leaf !== null && !leaf.remove(windowId)) this.tree.detach(leaf);
  }

  /**
   * Split the focused pane along its longer side and give the new window the
   * second half - or add it as another tab, if the pane is a stack.
   */
  private _insertWindow(ctx: EngineContext, windowId: string): void {
    const leaf = new MTLeaf(windowId);
    const target = this._insertTarget(ctx);
    if (target === null || target.rect === null) {
      /* Nothing on screen to split - every window in the tree is minimized,
       * say. Add it beside them rather than discard the arrangement. */
      this.graft(leaf);
      return;
    }

    if (target.isStack) target.add(windowId);
    else
      this.tree.replace(
        target,
        new MTNode(this._splitOrientation(target, leaf), [target, leaf]),
      );
  }

  /**
   * The pane a new window takes half of: the focused one.
   *
   * The new window is usually focused already by the time this runs - KWin
   * activates it as it maps - so the focused window is more often than not
   * the one that isn't in the tree yet. Falling back to the most recently
   * focused pane covers that, and a batch of windows arriving in one apply()
   * too: each insert makes its own pane the newest, so the second window
   * splits the first, just as it would have opening one at a time.
   */
  private _insertTarget(ctx: EngineContext): MTLeaf | null {
    const focused = this._focusedLeaf(ctx);
    if (focused !== null) return focused;

    let newest: MTLeaf | null = null;
    let newestTime = -Infinity;
    this.renderedLeaves.forEach((leaf) =>
      leaf.renderedIds.forEach((id) => {
        const window = ctx.getWindowById(id);
        const time = window !== null ? window.focusTime : 0;
        if (time > newestTime) {
          newest = leaf;
          newestTime = time;
        }
      }),
    );
    return newest;
  }

  /**
   * Which way to cut a pane to fit another beside it. The longer side, unless
   * the two only fit at their minimum sizes the other way round: splitting a
   * 1280x800 pane between a terminal and something that demands 940px of
   * width only works one above the other. When neither way fits the screen
   * is simply full, and the longer side stands.
   */
  private _splitOrientation(target: MTLeaf, incoming: MTLeaf): MTOrientation {
    if (target.rect === null) return "horizontal";
    const preferred = this._orientationFor(target.rect);
    const other: MTOrientation =
      preferred === "horizontal" ? "vertical" : "horizontal";
    if (this.geometry.fitsSplit(target.rect, target, incoming, preferred))
      return preferred;
    if (this.geometry.fitsSplit(target.rect, target, incoming, other))
      return other;
    return preferred;
  }

  private _bottomRightMost(exclude: Set<MTLeaf>): MTLeaf | null {
    let best: MTLeaf | null = null;
    for (const leaf of this.renderedLeaves) {
      const rect = leaf.rect;
      if (rect === null || exclude.has(leaf)) continue;
      const bestRect = best !== null ? best.rect! : null;
      if (
        bestRect === null ||
        rect.maxY > bestRect.maxY ||
        (rect.maxY === bestRect.maxY && rect.maxX > bestRect.maxX)
      )
        best = leaf;
    }
    return best;
  }

  private _orientationFor(rect: Rect): MTOrientation {
    return rect.width > rect.height ? "horizontal" : "vertical";
  }

  //#endregion

  //#region Rendering

  private _render(): void {
    this.renderedLeaves =
      this.lastArea !== null
        ? this.geometry.render(this.tree.root, this.lastArea)
        : [];
  }

  /**
   * Where each window on screen goes. Every member of a stack gets the pane,
   * not just the one on top: they all really are that size, and the one
   * showing is whichever KWin raised last.
   */
  private _placements(): { [id: string]: Rect } {
    const placed: { [id: string]: Rect } = {};
    this.renderedLeaves.forEach((leaf) =>
      leaf.renderedIds.forEach((id) => (placed[id] = leaf.contentRect!)),
    );
    return placed;
  }

  /**
   * The pane of the focused window, or null when it isn't on screen in this
   * layout - nothing focused, floating, minimized, on another surface, not
   * inserted yet.
   */
  private _focusedLeaf(ctx: EngineContext): MTLeaf | null {
    const current = ctx.currentWindow;
    if (current === null) return null;
    for (const leaf of this.renderedLeaves)
      if (leaf.renderedIds.indexOf(current.id) >= 0) return leaf;
    return null;
  }

  /**
   * The group a pane belongs to: the stack it is a tab of, else the nearest
   * split above it with more than one pane on screen. A split showing only
   * this pane covers exactly the pane, so outlining it would say nothing.
   */
  private _groupAround(node: MTTree): MTTree | null {
    if (node instanceof MTLeaf && node.renderedIds.length > 1) return node;
    for (;;) {
      const place = this.tree.placeOf(node);
      if (place === null) return null;
      if (this.geometry.showingChildren(place.parent).length >= 2)
        return place.parent;
      node = place.parent;
    }
  }

  //#endregion
}
