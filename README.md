# Kröhnkite

[Documentation](/docs/docs.md) | [Tips](/docs/tips.md)

A dynamic tiling extension for KWin 6 only.

Kröhnkite is mainly inspired by [dwm](https://dwm.suckless.org/) from suckless folks,
and aims to provide rock solid stability while fully integrating into KWin.

The name of the script is from mineral [Kröhnkite][wikipedia];
it starts with K and looks cool.

[dwm]: https://dwm.suckless.org/
[wikipedia]: https://en.wikipedia.org/wiki/Kr%C3%B6hnkite

![screenshot](img/screenshot.png)

## Features

- DWM-like window tiling
  - Dynamically tile windows, rather than manually placing each
  - Floating windows
- Fully integrates into KWin features, including:
  - **Multi-screen**
  - **Activities & Virtual desktop**
  - Basic window management (minimize, fullscreen, switching, etc.)
- Multiple Layout Support
  - Tiling layout
  - Monocle layout
  - Desktop-friendly layouts (Spread, Stair)

## Development Requirements

- Typescript (see package.json)
- [go-task](https://github.com/go-task/task)
- p7zip (7z)

## Look at me

1. If you change the Krohnkite configuration, you will need to reboot. Do not toggle the script on and off, this will start multiple instances of it.
2. Delete unused KWin shortcuts. You can use any D-Bus program which can invoke D-Bus methods. Service name -`org.kde.kglobalaccel` path - `/component/kwin` method - `org.kde.kglobalaccel.Component.cleanUp`. Arch Linux example:

```
qdbus6 org.kde.kglobalaccel /component/kwin org.kde.kglobalaccel.Component.cleanUp
```

3. If you have a gap or you have gray rectangle (or white, etc.), that means that there is a program with size 1x1 that has to be filtered by title or other ways. Make sure that the following programs, if you have them, have been added to the filter:

```
xwaylandvideobridge,plasmashell,ksplashqml
```

## Installation

You can install Kröhnkite in multiple ways.

### Using .kwinscript package file

You can download `krohnkite-x.x.x.x.kwinscript` file, and install it through
_System Settings_.

1. Download the kwinscript file
2. Open `System Settings` > `Window Management` > `KWin Scripts`
3. Press `Import KWin script...` on the top-right corner
4. Select the downloaded file

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

## Settings

### Add a class name, a resource name or a window caption to ignore or float

1. to find window's className, resourcename, or caption, see [readme](https://github.com/anametologin/krohnkite#search-a-window-parameters-to-filter-float-etc)
2. you can use the name of class in square brackets: `[myNamE]` will float or ignore all windows with class or resource names such: 'myname1', 'Myname2', 'Notmyname555' etc...

### Choose layout for screen by default

1. Open Krohnkite options: ![options](img/conf.png)
2. Tab `Rules->Screen default layout`. Layout configuration has format `OutputName:ActivityId:VirtualDesktopName:layoutName`.

Multi monitor example:

`HDMI-A-1:99a12h44-e9a6-1142-55eedaa7-3a922a15ab08::columns,DP-2:spread,DP-3:Desktop 3:tile,:threecolumn`

The result will be:

- set `columns` layout as default on monitor `HDMI-A-1`, only on activity with id:`99a12h44-e9a6-1142-55eedaa7-3a922a15ab08`, every virtual desktop on this activity. If you specify `activity id`, you have to specify the virtual desktop name or leave it blank;
- set `spreadlayout` layout as default on monitor `DP-2`, on every Activity, on every virtual desktop;
- set `tilelayout` layout as default on monitor `DP-3`, on every activity, only on virtual desktop with name `Desktop 3`;
- set `threecolumnlayout` layout as default on all monitors, all activities, and all virtual desktops not covered by the previous rules.

2. How to find `outputName`, `activityId`, `VirtualDesktopName`, `layoutName`: Right after system boot, run `KSystemLog`

- Push ignore button
- Type in filter string: `krohnkite`
- Right after `KROHNKITE: starting the script` string you will see one if you have one monitor or multiple lines: Screen(output):`Screen Name`,Desktop(name):`Virtual Desktop Name`,Activity:`Activity Id`,layouts: `numbered layouts` (the case doesn't matter,`layout` ending can be omitted): `tilelayout`, `monoclelayout`, `columns`, `threecolumnlayout,` `spreadlayout`, `stairlayout`, `spirallayout`, `stackedlayout`, `floatinglayout`, `btreelayout`

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

## Useful Development Resources

- [KWin Scripting Tutorial](https://develop.kde.org/docs/plasma/kwin/)
- [KWin Scripting API](https://develop.kde.org/docs/plasma/kwin/api/)
- Adding configuration dialog
  - [Development/Tutorials/Plasma/JavaScript/ConfigDialog](https://techbase.kde.org/Development/Tutorials/Plasma/JavaScript/ConfigDialog)
  - [Development/Tutorials/Using KConfig XT](https://techbase.kde.org/Development/Tutorials/Using_KConfig_XT)
- `*.ui` files can be edited with [Qt Designer](http://doc.qt.io/qt-5/qtdesigner-manual.html).
  It's very straight-forward if you're used to UI programming.
