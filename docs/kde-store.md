# KDE Store listing

Store page: <https://store.kde.org/p/2144146>

Pling/OpenDesktop renders product descriptions and changelogs as **BBCode**,
not HTML. The blocks below use only tags the platform supports: `[b]`, `[i]`,
`[h1]`, `[list]`, `[url]`, `[code]`.

## Summary

```text
A dynamic tiling extension for KWin 6, inspired by dwm.
```

## Product description

```bbcode
[h1]Kröhnkite — dynamic tiling for KWin[/h1]

Kröhnkite is a dynamic tiling extension for KWin, the window manager of KDE Plasma 6. It tiles windows automatically according to the layout you choose, instead of making you place and resize every window by hand, while still integrating with KWin: multiple monitors, activities, virtual desktops, panels and native shortcuts keep working.

Kröhnkite is inspired by [b]dwm[/b] from the suckless community and aims to stay simple in both development and usage.

[b]Layouts[/b]
[list]
[*] Tile, Monocle, Three Column, Spiral, Quarter, Stacked, Columns, Spread, Floating, Stair, Cascade and Binary Tree (dwindle)
[*] Choose the layout per screen, activity and virtual desktop, or open the interactive layout chooser
[*] Enable only the layouts you need and set their rotation order
[*] Live drag and drop: move a window onto another tile, a screen edge or a dock slot
[/list]

[b]Window management[/b]
[list]
[*] Surface capacity: limit how many windows a layout or a custom surface can hold; extra windows are minimized (default) or floated, and can be moved to other screens or virtual desktops
[*] Docks: stack several windows on the same screen side, insert, swap and reorder them
[*] Floating windows with configurable size, placement and move/resize step
[*] Optional pointer following: move the cursor to the focused window or screen centre on focus or resize
[*] Shortcut sequences: bind any action to a key sequence and override actions in register (meta) mode
[/list]

[b]Fit and finish[/b]
[list]
[*] Layout change OSD and interactive chooser using the same SVG pictograms as the settings page
[*] Per-surface overrides for gaps, capacity and overcapacity handling
[*] Russian and Chinese translations
[*] MIT licensed
[/list]

[b]Installation[/b]
[list]
[*] Download krohnkite.kwinscript
[*] Open System Settings, Window Management, KWin Scripts
[*] Use "Import KWin script..." in the top-right corner and select the file
[*] Enable Krohnkite, press Apply, then log out and back in
[/list]

Or from a terminal:

[code]kpackagetool6 -t KWin/Script -i krohnkite.kwinscript[/code]

then log out and back in so KWin loads the new package.

After changing the configuration, ask KWin to reload it:

[code]qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure[/code]

[b]Compatibility[/b]

KWin 6 (KDE Plasma 6). Per-screen virtual desktops require KWin 6.7 or later. Existing configurations are preserved when upgrading.

[b]Links[/b]
[list]
[*] [url=https://codeberg.org/anametologin/Krohnkite]Source code and issue tracker[/url]
[*] [url=https://codeberg.org/anametologin/Krohnkite/wiki]Documentation and tips[/url]
[/list]
```

## Changelog 0.9.11.0

```bbcode
[h1]Kröhnkite 0.9.11.0[/h1]

An interactive layout chooser, a new overcapacity policy, multi-window docks and a dwindle mode for the Binary Tree layout.

[list]
[*] New LayoutChooser action: click a layout or pick it with the focus shortcuts; the pointer moves to the screen centre
[*] Overcapacity windows are minimized by default and restored when a slot frees up; the eviction policy is configurable (last focused or oldest)
[*] Optional shortcut moves to a full surface: the moved window stays and another window is evicted
[*] New ShowCurrentCapacity action, bound as the register action of RaiseSurfaceCapacity
[*] Docks can hold several windows per side, with drag insertion, swapping and shortcut reordering
[*] Binary Tree layout: dwindle behaviour, drag and drop, outer tiles and SwapUp/SwapDown
[*] Pointer options: centre on the focused window when it resizes, and follow focus only on Krohnkite shortcuts
[*] Per-layout enable checkboxes and layout order starting at 1
[*] The configuration dialog floats in System Settings; KDE system windows are always ignored
[*] Reload Kröhnkite without logging out (go-task reload)
[*] Updated Russian and Chinese translations
[/list]
```
