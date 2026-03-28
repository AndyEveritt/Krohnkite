# Documentation

## Layouts

### Tile

Automatically splits the screen space between one master tile
and a vertical stack of non-master tiles.

If the ["DWM Style" option](#directional-keys-behavior) is set,
the "focus left/right" keyboard shortcuts
will instead decrease/increase the screen ratio
of master to non-master tiles, respectively.

### Monocle

One window dominates the entire screen space.

If the ["DWM Style" option](#directional-keys-behavior) is set,
the "focus left/right" keyboard shortcuts
will instead cycle focus through windows.

### Three Column

Automatically splits the screen space
into one vertical "master" tile
and two non-master vertical style,
looking like three columns.

If the ["DWM Style" option](#directional-keys-behavior) is set,
the "focus left/right" keyboard shortcuts
will instead decrease/increase the screen ratio
of master to non-master tiles, respectively.

### Spiral

Automatically splits the screen space by recursively halving the remaining area.
The first window takes the left half,
the second takes the top half of the remainder, and so on,
rotating split direction 90° each time to form an inward spiral pattern.

### Quarter

Divides the screen into up to four quadrants.
With one window it fills the screen; with two it splits vertically; with three it adds a horizontal split on the right side; with four it splits both sides.
Windows beyond four float above the tiled area.

### Stacked

Splits the screen space between two stacks of windows arranged side by side. The split direction can be rotated using the Rotate shortcut.

### Columns

Organizes windows into a dynamic number of vertical columns, each of which stacks its windows vertically.
New windows are added to the most recently active column, or distributed evenly across columns if the "balanced" option is enabled.
Windows can be moved between columns by dragging.
The layout direction can be rotated so that columns run horizontally instead.

### Spread

Overlaps all windows like a hand of playing cards,
offset horizontally so that a strip of each window is visible behind the frontmost one.
The amount of offset between windows can be adjusted with the Increase/Decrease shortcuts.

### Floating

All windows are placed in a free-floating state, as if tiling were disabled.

### Stair

Stacks windows in a staircase pattern,
each one offset diagonally from the previous
so that a strip of each window is visible beneath the one in front.
The step size can be adjusted with the Increase/Decrease shortcuts.
The stagger direction can be reversed
via the `stairReverse` configuration option.

### Binary tree

Automatically splits the screen space between one "master" tile
and a layout of non-master tiles.
The difference between this layout and [Tile](#tile) is
that "Tile" stacks all non-master tiles vertically,
while "Binary tree" progressively splits the non-master stack
in half both vertically and horizontally.

### Cascade

Places all windows at the same size, offset in a chosen direction
so each window is partially visible behind the one in front.
The cascade direction cycles through 8 compass directions
(NorthWest, North, NorthEast, East, SouthEast, South, SouthWest, West)
using the Increase/Decrease shortcuts.

## Keyboard Shortcuts

| Name                         | Description                                                                                                                                                                                                                                                             | Default shortcut |
| ---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Increase                     | For [Tile](#tile) and [Three Column](#three-column), controls the number of master windows.<br>For [Stair](#stair) and [Spread](#spread), controls the spacing of overlap/stagger between windows.<br>For [Cascade](#cascade), cycles through the 8 cascade directions. | None             |
| Decrease                     | For [Tile](#tile) and [Three Column](#three-column), controls the number of master windows.<br>For [Stair](#stair) and [Spread](#spread), controls the spacing of overlap/stagger between windows.<br>For [Cascade](#cascade), cycles through the 8 cascade directions. | None             |
| Focus Next                   | Focus the next window in the current layout.                                                                                                                                                                                                                            | `Meta+.`         |
| Focus Previous               | Focus the previous window in the current layout.                                                                                                                                                                                                                        | `Meta+,`         |
| Focus Left                   | Focus the window to the left of the current window.                                                                                                                                                                                                                     | `Meta+H`         |
| Focus Right                  | Focus the window to the right of the current window.                                                                                                                                                                                                                    | `Meta+L`         |
| Focus Down                   | Focus the window below the current window.                                                                                                                                                                                                                              | `Meta+J`         |
| Focus Up                     | Focus the window above the current window.                                                                                                                                                                                                                              | `Meta+K`         |
| Move Down/Next               | Move the current window down or forward in the layout order.                                                                                                                                                                                                            | `Meta+Shift+J`   |
| Move Up/Prev                 | Move the current window up or backward in the layout order.                                                                                                                                                                                                             | `Meta+Shift+K`   |
| Move Left                    | Move the current window to the left.                                                                                                                                                                                                                                    | `Meta+Shift+H`   |
| Move Right                   | Move the current window to the right.                                                                                                                                                                                                                                   | `Meta+Shift+L`   |
| Grow Height                  | Increase the height of the current window.                                                                                                                                                                                                                              | `Meta+Ctrl+J`    |
| Shrink Height                | Decrease the height of the current window.                                                                                                                                                                                                                              | `Meta+Ctrl+K`    |
| Shrink Width                 | Decrease the width of the current window.                                                                                                                                                                                                                               | `Meta+Ctrl+H`    |
| Grow Width                   | Increase the width of the current window.                                                                                                                                                                                                                               | `Meta+Ctrl+L`    |
| Increase                     | For [Tile](#tile) and [Three Column](#three-column), controls the number of master windows.<br>For [Stair](#stair) and [Spread](#spread), controls the spacing of overlap/stagger between windows.<br>For [Cascade](#cascade), cycles through the 8 cascade directions. | `Meta+I`         |
| Decrease                     | For [Tile](#tile) and [Three Column](#three-column), controls the number of master windows.<br>For [Stair](#stair) and [Spread](#spread), controls the spacing of overlap/stagger between windows.<br>For [Cascade](#cascade), cycles through the 8 cascade directions. | `Meta+D`         |
| Toggle Float                 | Toggle floating state for the current window.                                                                                                                                                                                                                           | `Meta+F`         |
| Toggle Float All             | Toggle floating state for all windows on the current surface.                                                                                                                                                                                                           | `Meta+Shift+F`   |
| Next Layout                  | Switch to the next layout.                                                                                                                                                                                                                                              | `Meta+\`         |
| Previous Layout              | Switch to the previous layout.                                                                                                                                                                                                                                          | `Meta+\|`        |
| Rotate                       | Rotate the current layout. For [Tile](#tile), rotates the entire layout. For [Stacked](#stacked), rotates the split direction. For [Columns](#columns), rotates the column direction clockwise.                                                                         | `Meta+R`         |
| Rotate Part                  | Rotate part of the current layout. For [Tile](#tile), rotates the master stack orientation. For [Columns](#columns), rotates the column direction counter-clockwise.                                                                                                    | `Meta+Shift+R`   |
| Set Master                   | Designate the current window as the master window.                                                                                                                                                                                                                      | `Meta+Return`    |
| Toggle Dock                  | Toggle the dock window.                                                                                                                                                                                                                                                 | None             |
| Select Layout - Tile         | Switch directly to the [Tile](#tile) layout.                                                                                                                                                                                                                            | `Meta+T`         |
| Select Layout - Monocle      | Switch directly to the [Monocle](#monocle) layout.                                                                                                                                                                                                                      | `Meta+M`         |
| Select Layout - Three Column | Switch directly to the [Three Column](#three-column) layout.                                                                                                                                                                                                            | None             |
| Select Layout - Spread       | Switch directly to the [Spread](#spread) layout.                                                                                                                                                                                                                        | None             |
| Select Layout - Stair        | Switch directly to the [Stair](#stair) layout.                                                                                                                                                                                                                          | None             |
| Select Layout - Floating     | Switch directly to the [Floating](#floating) layout.                                                                                                                                                                                                                    | None             |
| Select Layout - Quarter      | Switch directly to the [Quarter](#quarter) layout.                                                                                                                                                                                                                      | None             |
| Select Layout - Stacked      | Switch directly to the [Stacked](#stacked) layout.                                                                                                                                                                                                                      | None             |
| Select Layout - BTree        | Switch directly to the [Binary Tree](#binary-tree) layout.                                                                                                                                                                                                              | None             |
| Select Layout - Spiral       | Switch directly to the [Spiral](#spiral) layout.                                                                                                                                                                                                                        | None             |
| Select Layout - Columns      | Switch directly to the [Columns](#columns) layout.                                                                                                                                                                                                                      | None             |
| Select Layout - Cascade      | Switch directly to the [Cascade](#cascade) layout.                                                                                                                                                                                                                      | None             |

## Options

### Behavior

#### Layout Adjustment

#### Directional Keys Behavior

Tells the layouts how to interpret the "directional focus" shortcuts ("focus up, focus down, focus left, focus right"). The exact behaviour depends on the layout.

- **Directional**: The directional focus shortcuts transparently map to focusing the window in the direction
- **DWM Style**: Merges "focus up/down" with "focus previous/next", respectively. Maps "focus left/right" to a layout-dependent action. In the "Tile" and "Three Column" layouts, these keys decrease/increase the screen ratio of master to non-master tiles. In the "Monocle" layout, they also cycle focus between windows.
