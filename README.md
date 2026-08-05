# Kröhnkite
Author of [Kröhnkite](https://github.com/esjeon/krohnkite). A dynamic tiling extension for KWin 6 only. 
Kröhnkite is mainly inspired by [dwm][] from suckless folks, and aims to
provide rock solid stability while fully integrating into KWin.

The name of the script is from mineral [Kröhnkite][wikipedia]; it starts with
K and looks cool.

[dwm]: https://dwm.suckless.org/
[wikipedia]: https://en.wikipedia.org/wiki/Kr%C3%B6hnkite

![screenshot](img/screenshot.png)

## Features

- DWM-like window tiling
  - Dynamically tile windows, rather than manually placing each.
  - Floating windows
- Fully integrates into KWin features, including:
  - **Multi-screen**
  - **Activities & Virtual desktop**
  - Basic window management (minimize, fullscreen, switching, etc)
- Multiple Layout Support
  - Tiling layout
  - Monocle layout
  - Desktop-friendly layouts (Spread, Stair)
  - Manual Tiling layout - build the arrangement yourself with explicit splits

## Development Requirement

- Typescript (see package.json)
- [go-task](https://github.com/go-task/task)
- p7zip (7z)

Tests live in `test/` and run on Node's built-in test runner, with no extra dependencies:

```
go-task test
```

## Look at me

1. If you change the Krohnkite configuration, you will need to reboot. Do not toggle the script on and off, this will start multiple instances of it. (If you build from the repository, `go-task reload` picks up configuration changes without a reboot — see [Reloading without a reboot](#reloading-without-a-reboot-development).)
2. Delete unused KWin shortcuts you can use any D-Bus program which can invoke D-Bus methods. Service name -`org.kde.kglobalaccel` path - `/component/kwin` method - `org.kde.kglobalaccel.Component.cleanUp`. ArchLinux example:

```
qdbus6 org.kde.kglobalaccel /component/kwin org.kde.kglobalaccel.Component.cleanUp
```

3. If you have a gap or vice versa you have gray(white etc) rectangle that means that there is a program with size 1x1 that have to be filtered by title or other ways. Make sure that the following programs, if you have them, have been added to the filter:

```
xwaylandvideobridge,plasmashell,ksplashqml
```

## Installation

You can install Kröhnkite in multiple ways.

### Using .kwinscript package file

You can download `krohnkite-x.x.x.x.kwinscript` file, and install it through
_System Settings_.

1.  Download the kwinscript file
2.  Open `System Settings` > `Window Management` > `KWin Scripts`
3.  Press `Import KWin script...` on the top-right corner
4.  Select the downloaded file

Alternatively, through command-line:
get info about package:

```
kpackagetool6 -t KWin/Script -s krohnkite
```

install:

```
kpackagetool6 -t KWin/Script -i krohnkite-x.x.x.x.kwinscript
```

upgrade:

```
kpackagetool6 -t KWin/Script -u krohnkite-x.x.x.x.kwinscript
```

uninstall:

```
kpackagetool6 -t KWin/Script -r krohnkite
```

### Installing from Git repository

Make sure you have [go-task](https://taskfile.dev/installation/), [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) and [7-zip](https://www.7-zip.org/download.html) packages installed. All packages after building will be in `builds` folder.
The simplest method to automatically build and install kwinscript package would be:

```
 go-task install
```

You can also build `.kwinscript` package file using:

```
go-task package
```

uninstall package:

```
go-task uninstall
```

### Reloading without a reboot (development)

If you are changing the sources, you do not have to restart the session for every build:

```
go-task reload
```

This rebuilds the package tree and hot-swaps the script in the running KWin through
`org.kde.KWin /Scripting` (unload, verify it is gone, load again). It is safe in the way toggling
the script in System Settings is not — the old instance is explicitly unloaded first — and it
re-reads your configuration as well. Note that it runs the build from a staged copy under
`~/.cache/krohnkite-reload/`, so run `go-task install` when you want the change to persist across
logins.

## Settings

### Add a class name, a resource name or a window caption to ignore or float

1. to found window's className,resourcename or caption see [readme](https://github.com/anametologin/krohnkite#search-a-window-parameters-to-filter-float-etc)
2. you can use the name of class in square brackets: `[myNamE]` will float or ignore all windows with class or resource names such: 'myname1', 'Myname2', 'Notmyname555' etc...

### Choose layout for screen by default

1. Open Krohnkite options: ![options](img/conf.png)
2. Tab `Rules->Screen default layout`. Layout configuration has format `OutputName:ActivityId:VirtualDesktopName:layoutName` multi monitor example: `HDMI-A-1:99a12h44-e9a6-1142-55eedaa7-3a922a15ab08::columns,DP-2:spread,DP-3:Desktop 3:tile,:threecolumn` - result will be:

- set `columns` layout as default on monitor `HDMI-A-1`, only on activity with id:`99a12h44-e9a6-1142-55eedaa7-3a922a15ab08`, every Virtual Desktops on this activity.(if you specify `activity id` you have to to specify virtual desktop name or leave it blank)
- set `spreadlayout` layout as default on monitor `DP-2`, every Activities, every Virtual Desktops;
- set `tilelayout` layout as default on monitor `DP-3`, on every activity, only on virtual desktop with name `Desktop 3`
- set `threecolumnlayout` layout as default on all monitors,all activities and all Virtual Desktops not covered by the previous rules

2. How to find `outputName`, `activityId`, `VirtualDesktopName`, `layoutName`:
   Right after system boot run KSystemLog

- Push ignore button
- Type in filter string: `krohnkite`
- Right after `KROHNKITE: starting the script` string you will see one if you have one monitor or multiple lines: Screen(output):`Screen Name`,Desktop(name):`Virtual Desktop Name`,Activity:`Activity Id`,layouts: `numbered layouts` (the case doesn't matter,`layout` ending can be omitted): `tilelayout`, `monoclelayout`, `columns`, `threecolumnlayout,` `spreadlayout`, `stairlayout`, `spirallayout`, `stackedlayout`, `floatinglayout`, `btreelayout`, `manualtilinglayout`

3. `Apply` -> `reboot`

### Search a window parameters to filter, float etc.

1. Krohnkite options: ![options](img/conf.png)
2. Options->Debug new Windows
3. Reboot
4. Run KSystemLog
5. Push `Ignore` button
6. Type in filter string: `krohnkite`
7. All created windows krohnkite working with will be there.
8. Every debug entry contains parameters except those that are false and empty.

## Default Key Bindings

| Key              | Action             |
| ---------------- | ------------------ |
| Meta + .         | Focus Next         |
| Meta + ,         | Focus Previous     |
|                  |                    |
| Meta + J         | Focus Down         |
| Meta + K         | Focus Up           |
| Meta + H         | Focus Left         |
| Meta + L         | Focus Right        |
|                  |                    |
| Meta + Shift + J | Move Down/Next     |
| Meta + Shift + K | Move Up/Previous   |
| Meta + Shift + H | Move Left          |
| Meta + Shift + L | Move Right         |
|                  |                    |
| Meta + I         | Increase           |
| Meta + D         | Decrease           |
| Meta + F         | Toggle Floating    |
| Meta + \         | Next Layout        |
| Meta + \|        | Previous Layout    |
|                  |                    |
| Meta + Return    | Set as Master      |
|                  |                    |
| Meta + T         | Use Tile Layout    |
| Meta + M         | Use Monocle Layout |
| _unbound_        | Use Spread Layout  |
| _unbound_        | Use Stair Layout   |
| _unbound_        | Use Cascade Layout |
| _unbound_        | Use Manual Tiling Layout |

### Manual Tiling Layout

New windows split the focused window along its longer side, so the arrangement
grows where you are working, the way a manual tiling WM's does. From there you
shape it yourself:

| Key       | Action                                     |
| --------- | ------------------------------------------ |
| Meta + I  | Split along the pane's longer side          |
| Meta + D  | Unsplit                                     |
| Meta + R  | Rotate the split a quarter turn clockwise   |
| _unbound_ | Split Horizontal (panes side by side)       |
| _unbound_ | Split Vertical (panes stacked)              |
| Meta + Shift + H/J/K/L | Move through the tree (see below)  |
| _unbound_ | Select More / Select Less (group selection) |
| _unbound_ | Toggle Stack, Next Tab, Previous Tab        |
| _unbound_ | Move Tab Left / Move Tab Right              |

`Split` divides the focused window's pane and moves the nearest other window
into the new half; everything else reflows to fill the gap that leaves. It
skips the window already sharing the focused window's split when choosing which
to move, because using that one would simply reorient the split they share
rather than adding a division - `Rotate` is the way to do that deliberately.
With only two windows tiled there is nobody else to draw on, so a split falls
back to reorienting.

`Rotate` gives the split the focused window sits in a quarter turn clockwise,
so four presses come back to where they started:

```
A | B  ->  A / B  ->  B | A  ->  B / A  ->  A | B
```

Every turn flips the axis, and every other one also swaps the two sides -
turning a stack clockwise puts the top pane on the right. Each pane keeps its
own share of the split throughout, and splits whose other half is not currently
on screen are skipped.

`Unsplit` removes the split above the focused window, expanding it into that
whole area and moving whatever shared the split - keeping its own internal
arrangement - into the bottom-right-most pane elsewhere. It is refused when
there is nowhere else to move it to, which includes every two-window
arrangement. It takes no direction because a window has exactly one split above
it; there is never a choice of which one to remove.

Split, unsplit and rotate reuse `Increase`, `Decrease` and `Rotate`, keys the
other layouts already use for the same ideas, so the layout is usable without
binding anything. `Meta + I` picks the direction the same way a new window does
- the pane's longer side, or the other one if that is the only way both windows
fit - and the two explicit shortcuts are there for when you want to force it.

#### Group selection

`Select More` widens what the commands act on. A stacked pane is a group in its
own right - several windows sharing one pane - so from inside a stack the first
press selects the whole stack, which is what lets it be moved, or sent to
another screen, as the one thing it looks like rather than shedding the focused
tab. From there it widens to the split around it, then the split around that,
and `Select Less` narrows it back down; the group stays outlined on screen for
as long as it is selected, and its size is announced. The selection is dropped - and the outline comes
down - the moment you focus a window outside it, so a command can never quietly
apply to panes you have stopped looking at. `Move`, `Migrate` and
`Toggle Stack` all act on the selection; split, unsplit and swap always act on
the focused pane alone.

#### Moving

`Meta + Shift + H/J/K/L` - Krohnkite's usual move keys - move the selection the
COSMIC way, reshaping the arrangement rather than swapping two panes' contents.
It is a move through
the tree rather than across the screen - what happens is decided by where the
selection sits in its split, not by which pane it happens to be beside.

A split here holds *any number* of panes, not just two, and that distinction is
the whole point: three panes across the screen (`A | B | C`) and two panes whose
first is split again (`(A | B) | C`) look similar but behave differently under
every later move, so they are kept apart. Walking outwards from the selection,
the first of these that applies wins:

1. **The split runs across the way you are going** - panes side by side, and
   you press Up. The whole split is wrapped in a new one facing that way, with
   the selection on that side. This is the one you use most: you shape an
   arrangement by pushing windows the way you want them to go.
2. **You got here from a split further in.** The selection joins this split as
   another pane of it, beside the one it came out of - two panes become three,
   rather than nesting deeper. This is how you get equal thirds.
3. **There is a pane that way.** What it is decides what happens. A stack takes
   the window in as a tab. A group is entered - at its near end if it runs the
   same way you are going, in the middle if it runs across you, since then it
   has no near end. A plain pane trades places with you when the two of you are
   all that is in the split, and otherwise is halved to take you in - that is
   what turns `A | B | C` into `(A | B) | C`.
4. **Nothing that way.** Step out to the split above and start again.

Only when there is no split left to step out to does `Move` decline, and then
the press falls through to Krohnkite's usual "push it to the next screen".
There is one set of move keys, not one for windows and one for groups: they act
on the selection, which is a single pane until you grow it. A window inside a
stack is the one special case - it leaves the stack rather than dragging its
tab-mates with it, and takes half of the stack's pane.

Each move flashes an outline where the selection landed.

The colour of all three overlays - the drop indicator, the group outline and a
stack's active tab - is `Options -> Manual Tiling Overlays -> Colour`. It takes
`#rgb`, `#rrggbb`, `#aarrggbb` or a colour name, and anything it cannot parse
falls back to the default rather than drawing an invisible overlay.

#### Stacks

`Toggle Stack` collects everything in the selection into one pane where the
windows share the space as tabs, with a strip along the top of the pane naming
them; the active tab is highlighted and clicking a tab raises that window.
`Next Tab` / `Previous Tab` cycle without the mouse and `Move Tab Left` /
`Move Tab Right` reorder the strip, carrying the focused tab one place along
and trading places with the tab that was there. Members that are not on screen
- minimized, or on another virtual desktop - keep their place in the order, so
the strip does not rearrange itself when they come back. The ordinary focus
keys treat the whole stack as one pane: they move focus off it in any
direction, and moving focus *onto* it lands on the tab that is showing. While a pane is a stack,
new windows join it as another tab instead of splitting it - so a stack stays a
stack even when it is down to one window, until you toggle it off. Toggling off
fans the members back out into a balanced set of splits. Splitting a stack
pulls just the focused member out into a pane of its own.

#### Mouse

Dragging a tiled window shows a translucent indicator of where it would land
and drops it there when you let go: onto the edge of a pane splits that pane -
or joins the split it is already part of, when the two run the same way - and
onto the middle of a pane joins that pane's stack, creating one if it isn't
stacked yet. Nothing re-tiles until you release, so the panes hold still while
you aim.

#### Taking a group to another screen or desktop

There is no shortcut of its own for this. KDE's own **Window One Screen to the
Left/Right** and **Window One Desktop to the Left/Right** move the focused
window as they always have - and when a group is selected, the rest of it
follows, arrangement intact, so a group of panes arrives laid out the way it
left. With a single pane selected nothing follows and those shortcuts mean
exactly what they always did. If the destination screen is running a different
layout the windows still move; only their arrangement is lost.

Split borders resize with the usual grow/shrink keys or the mouse. The arrangement
persists while the script runs - including across minimize/restore, fullscreen,
virtual desktop switches and switching to another layout and back - but is not
saved across a KWin restart. Floating a window (`Meta + F`) releases its pane;
re-tiling it gives it a fresh one rather than the old spot.

Panes are sized to respect each window's minimum size. If the windows on a
screen can't all meet their minimums at once - an Electron app asking for 940px
of width on a 1280px screen leaves little room for anything else - Krohnkite
floats windows until the rest fit, which is the behavior of `Options -> Unfit
windows`. Setting a **Capacity** for the layout caps how many panes it will
create, which is usually a better way to bound this.

## Tips

### Unsupported animations

1. Don't use `Squash` animation of minimizing windows ([see issue](https://codeberg.org/anametologin/Krohnkite/issues/29)). To change: `Kde Settings->Animations->Window minimize-> `None` or `Magic Lamp`. 

### Setting Up for Multi-Screen

Krohnkite supports multi-screen setup, but KWin has to be configured to unlock
the full potential of the script.

1. Enable `Separate Screen Focus` feature:

- `System Settings` > `Window Management` > `Window Behavior` > `Multiscreen Behaviour`

  `OR` use console commands:

```
   kwriteconfig6 --file ~/.config/kwinrc --group Windows --key ActiveMouseScreen false
   kwriteconfig6 --file ~/.config/kwinrc --group Windows --key SeparateScreenFocus true
```

2. Bind keys for global shortcut `Switch to Next/Previous Screen`
   (Recommend: `Meta + ,` / `Meta + .`)
3. Bind keys for global shortcut `Window to Next/Previous Screen`
   (Recommend: `Meta + <` / `Meta + >`)

### Removing Title Bars

Breeze window decoration can be configured to completely remove title bars from
all windows:

1. `System Setting` > `Application Style` > `Window Decorations`
2. Click `Configure Breeze` inside the decoration preview.
3. `Window-Specific Overrides` tab > `Add` button
4. Enter the followings, and press `Ok`:
   - `Regular expression to match`: `.*`
   - Tick `Hide window title bar`

### Changing Border Colors

Changing the border color makes it easier to identify current window. This is
convinient if title bars are removed.

1. You can use the Oxygen decoration theme. [Oxygen theme settings][]
2. You can install third-party decorations, see [Border color conversation][]
3. You can add to the WM section in $HOME/.config/kdeglobals (this changes the default Breeze decoration frame colors):
    - `frame=R,G,B`
    - `inactiveFrame=R,G,B`

[Oxygen theme settings]: https://github.com/anametologin/krohnkite/assets/165245883/51b4cb48-33c7-4627-a119-33d1abbe2b99
[Border color conversation]: https://github.com/anametologin/krohnkite/issues/15

### Setting Minimum Geometry Size

Some applications like discord and KDE settings dont tile nicely as they have a minimum size requirement.
This causes the applications to overlap with other applications. To mitigate this we can set minimum size for all windows to be 0.

1. `System Setting` > `Window Management` > `Window Rules`
2. Click on `+ Add New...`
3. Set `Window class` to be `Unimportant`
4. Set `Window types` to `Normal Window`
5. Click `+ Add Properties...`
6. Add the `Minimum Size` Property
7. Set the fields to `Force` and `0` x `0`
8. Apply

### Prevent borders and shadows from disappearing.

When a window is marked "maximized" in Breeze theme, its borders are removed to save screen space.
This behavior may not be preferable depending on your setup. This can be mitigated by disabling maximized windows using Window Rules.

1. `System Setting` > `Window Management` > `Window Rules`
2. Click on `+ Add New...`
3. Set `Window class` to be `Unimportant`
4. Set `Window types` to `Normal Window`
5. Click `+ Add Properties...`
6. Add the `Maximized horizontally` and `Maximized vertically` Properties.
7. Set the options to `Force` and `No`.
8. Apply

## Useful Development Resources

- [KWin Scripting Tutorial](https://develop.kde.org/docs/plasma/kwin/)
- [KWin Scripting API](https://develop.kde.org/docs/plasma/kwin/api/)
- Adding configuration dialog
  - [Development/Tutorials/Plasma/JavaScript/ConfigDialog](https://techbase.kde.org/Development/Tutorials/Plasma/JavaScript/ConfigDialog)
  - [Development/Tutorials/Using KConfig XT](https://techbase.kde.org/Development/Tutorials/Using_KConfig_XT)
- `*.ui` files can be edited with [Qt Designer](http://doc.qt.io/qt-5/qtdesigner-manual.html).
  It's very straight-forward if you're used to UI programming.
