/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/**
 * "horizontal" lays a split's panes out side by side (left | right).
 * "vertical" stacks them (top / bottom).
 *
 * Note that cosmic-comp names these the other way round: its
 * `Orientation::Vertical` divides the width, which is "horizontal" here.
 */
type MTOrientation = "horizontal" | "vertical";

/**
 * A pane of the tree. Normally holds one window; holds several when it is a
 * stack, in which case they all share the pane and only one of them is on
 * top - the others sit behind it, listed in the stack's tab strip.
 */
class MTLeaf {
  /** Members, in tab order. Never empty while the leaf is in a tree. */
  public windowIds: string[];
  /**
   * Whether this pane is a stack. Sticky: a stack that has lost all but one
   * member stays a stack, so new windows keep joining it, as in COSMIC.
   */
  public isStack: boolean;

  /* Written by MTGeometry.render; null when the leaf is not on screen. */
  /** Geometry of the whole pane, tab strip included. */
  public rect: Rect | null;
  /** The part of `rect` the windows get: `rect` minus the tab strip. */
  public contentRect: Rect | null;
  /** Members that rendered last pass, in tab order. */
  public renderedIds: string[];

  constructor(windowIds: string | string[], isStack: boolean = false) {
    this.windowIds =
      typeof windowIds === "string" ? [windowIds] : windowIds.slice(0);
    this.isStack = isStack;
    this.rect = null;
    this.contentRect = null;
    this.renderedIds = [];
  }

  public get size(): number {
    return this.windowIds.length;
  }

  public has(windowId: string): boolean {
    return this.windowIds.indexOf(windowId) >= 0;
  }

  public add(windowId: string): void {
    if (!this.has(windowId)) this.windowIds.push(windowId);
  }

  /** @returns true when the leaf still holds a window afterwards. */
  public remove(windowId: string): boolean {
    const index = this.windowIds.indexOf(windowId);
    if (index >= 0) this.windowIds.splice(index, 1);
    return this.windowIds.length > 0;
  }
}

/**
 * A split holding any number of panes side by side or stacked - not just two.
 *
 * That is why the tree is n-ary. Three panes across the screen and "two
 * panes, the right of which is split again" look the same but behave
 * differently under every later move, and COSMIC distinguishes them, so the
 * tree has to as well: `A | B | C` is one split of three, `(A | B) | C` a
 * split of two whose first pane is itself a split.
 *
 * `weights` runs parallel to `children`; only the ratios between them matter.
 */
class MTNode {
  public children: MTTree[];
  public weights: number[];
  /** Geometry last rendered at; null when nothing in it is on screen. */
  public rect: Rect | null;

  constructor(
    public orientation: MTOrientation,
    children: MTTree[],
  ) {
    this.children = children.slice(0);
    this.weights = children.map(() => 1);
    this.rect = null;
  }

  public get length(): number {
    return this.children.length;
  }

  public indexOf(child: MTTree): number {
    return this.children.indexOf(child);
  }

  /** Insert a child, giving it the average share of the split. */
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

  /** Replace a child in place, keeping its share of the split. */
  public replaceAt(index: number, child: MTTree): void {
    this.children[index] = child;
  }

  /** Exchange two children, shares and all. */
  public swap(a: number, b: number): void {
    const child = this.children[a];
    this.children[a] = this.children[b];
    this.children[b] = child;
    const weight = this.weights[a];
    this.weights[a] = this.weights[b];
    this.weights[b] = weight;
  }

  /** Reverse the order of the panes, shares and all. */
  public reverse(): void {
    this.children.reverse();
    this.weights.reverse();
  }
}

type MTTree = MTLeaf | MTNode;

/** Where a subtree sits in the tree. */
interface IMTPlace {
  parent: MTNode;
  index: number;
}

/**
 * The structure of a manual tiling arrangement, and the edits every command
 * is built from. Knows nothing about windows or the screen.
 *
 * Parents are looked up on demand rather than stored: the tree is tiny, and
 * that rules out the whole class of stale-parent-pointer bugs.
 */
class ManualTilingTree {
  public root: MTTree | null;

  constructor() {
    this.root = null;
  }

  /** Whether `subtree` holds `target`; a subtree holds itself. */
  public static contains(subtree: MTTree, target: MTTree): boolean {
    if (subtree === target) return true;
    if (subtree instanceof MTLeaf) return false;
    return subtree.children.some((child) =>
      ManualTilingTree.contains(child, target),
    );
  }

  /** Every leaf of a subtree (the whole tree by default), in order. */
  public leaves(tree: MTTree | null = this.root): MTLeaf[] {
    const out: MTLeaf[] = [];
    const walk = (node: MTTree) => {
      if (node instanceof MTLeaf) out.push(node);
      else node.children.forEach(walk);
    };
    if (tree !== null) walk(tree);
    return out;
  }

  /** Every window id in a subtree, in order, stack members included. */
  public windowIds(tree: MTTree | null = this.root): string[] {
    const out: string[] = [];
    this.leaves(tree).forEach((leaf) => out.push(...leaf.windowIds));
    return out;
  }

  public findLeaf(windowId: string): MTLeaf | null {
    for (const leaf of this.leaves()) if (leaf.has(windowId)) return leaf;
    return null;
  }

  /** Whether a subtree is (still) part of this tree. */
  public has(subtree: MTTree): boolean {
    return this.root !== null && ManualTilingTree.contains(this.root, subtree);
  }

  public placeOf(target: MTTree): IMTPlace | null {
    const search = (tree: MTTree): IMTPlace | null => {
      if (tree instanceof MTLeaf) return null;
      const index = tree.indexOf(target);
      if (index >= 0) return { parent: tree, index: index };
      for (const child of tree.children) {
        const place = search(child);
        if (place !== null) return place;
      }
      return null;
    };
    return this.root === null ? null : search(this.root);
  }

  /** Swap one subtree for another, in place. */
  public replace(target: MTTree, replacement: MTTree): boolean {
    if (this.root === target) {
      this.root = replacement;
      return true;
    }
    const place = this.placeOf(target);
    if (place === null) return false;
    place.parent.replaceAt(place.index, replacement);
    return true;
  }

  /** Remove a subtree, and flatten whatever that leaves behind. */
  public detach(subtree: MTTree): boolean {
    if (this.root === subtree) {
      this.root = null;
      return true;
    }
    const place = this.placeOf(subtree);
    if (place === null) return false;
    place.parent.removeAt(place.index);
    this.cleanup();
    return true;
  }

  /**
   * Add a subtree beside everything already in the tree, splitting the whole
   * area. Predictable, and never buries the newcomer inside an existing split.
   */
  public graft(subtree: MTTree, orientation: MTOrientation): void {
    this.root =
      this.root === null
        ? subtree
        : new MTNode(orientation, [this.root, subtree]);
  }

  /**
   * Flatten splits left holding a single pane, the way COSMIC does after every
   * edit. A split of one renders exactly as its pane would, and leaving them
   * in place grows a chain of them around a window that has been pushed
   * around for a while, each one another layer for the next move to climb.
   *
   * Same-orientation nesting is deliberately left alone: `(A | B) | C` and
   * `A | B | C` behave differently, so they must stay distinguishable.
   */
  public cleanup(): void {
    const collapseOnce = (
      tree: MTTree,
    ): { node: MTNode; child: MTTree } | null => {
      if (tree instanceof MTLeaf) return null;
      if (tree.length === 1) return { node: tree, child: tree.children[0] };
      for (const child of tree.children) {
        const found = collapseOnce(child);
        if (found !== null) return found;
      }
      return null;
    };

    for (;;) {
      if (this.root instanceof MTNode && this.root.length === 0) {
        this.root = null;
        return;
      }
      const collapsed = this.root !== null ? collapseOnce(this.root) : null;
      if (collapsed === null) return;
      this.replace(collapsed.node, collapsed.child);
    }
  }

  /**
   * A compact description, e.g. `H:0.50[a,V:0.50[b,[c|d]]]`. A split lists its
   * panes' shares - just the first one's when there are two - and a stack
   * lists its members in brackets.
   */
  public toString(): string {
    const describe = (tree: MTTree | null): string => {
      if (tree === null) return "empty";
      if (tree instanceof MTLeaf)
        return tree.size > 1 || tree.isStack
          ? `[${tree.windowIds.join("|")}]`
          : tree.windowIds[0];

      const axis = tree.orientation === "horizontal" ? "H" : "V";
      const total = tree.weights.reduce((sum, weight) => sum + weight, 0);
      const shares = (tree.length === 2 ? [tree.weights[0]] : tree.weights).map(
        (weight) => (total > 0 ? weight / total : 0).toFixed(2),
      );
      return `${axis}:${shares.join(",")}[${tree.children.map(describe).join(",")}]`;
    };
    return describe(this.root);
  }
}
