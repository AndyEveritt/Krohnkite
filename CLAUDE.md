# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Krohnkite is a dynamic tiling extension for **KWin 6** (Plasma 6, `X-Plasma-API: declarativescript`).
The tiling logic is TypeScript in `src/`, compiled into a single script that is loaded by QML
(`res/main.qml`) inside the KWin process. It ships as a `.kwinscript` zip package.

## Build / install / dev loop

`taskfile.yaml` ([go-task](https://taskfile.dev)) is the live build system. Requires `go-task`, `npm`, `7z`.

```bash
go-task build-ts     # npm install + tsc -> ./krohnkite.js (single bundle)
go-task test         # build-ts, then npm test
go-task kwin-pkg     # assemble pkg/ tree (contents/{ui,code,config}, locale)
go-task package      # zip pkg/ -> builds/krohnkite-<tag>[-branch]_<rev>.kwinscript
go-task install      # package, then kpackagetool6 -u (upgrade) or -i (install)
go-task uninstall
go-task clean        # rm pkg/, krohnkite.js, package-lock.json
```

After any `src/` change run `go-task build-ts` and read the tsc output (`noEmitOnError: false`
— it emits anyway), then `go-task test`. `Makefile`'s `run` target and `tslint.json` are stale
(`bin/load-script.sh` no longer exists — its ancestor is in [tools/legacy/](tools/legacy/), and
tslint is not a dependency). Prefer `go-task` over `make`.

## Tests

[test/](test/) runs on Node's built-in runner (`node --test`) — no test dependencies. Coverage is
currently `ManualTilingLayout` plus the shared geometry helpers; the other layouts have none.

Tests exercise the **compiled bundle**, not the sources: `outFile` with no modules means there is
nothing to import, so [test/harness.js](test/harness.js) evaluates `krohnkite.js` as a function
body and returns the declarations it needs (`loadKrohnkite`). That is also why the tests are
JavaScript — compiling them through the same `outFile` would merge them into the shipped script.
`go-task test` builds first; `npm test` alone assumes `krohnkite.js` is current.

`createWorld()` fakes the slice of KWin and `TilingEngine` a layout can see. Its `apply()` runs the
layout alone; its `arrange()` also models `arrangeScreen`'s `unfitGreater`/`unfitLess` pass
(`engine.ts:670-733`), which floats any tile smaller than its window's `minSize` — both options
default to true, and that pass is what turns an undersized pane into a floating window, so
layout behaviour has to be tested against it. **Keep that model in step with the engine.**

`createWorld` also fakes the driver's overlays (`ctx.setStackBars`,
`setSelectionOutline`, `show/hideDropIndicator`, `highlight`) into
`world.overlays()`. `world.drag(id, point)` / `world.drop(id)` drive a mouse
drag the way `onWindowDragging` / `onWindowMoveOver` do, and
`world.followMove(id)` models `TilingEngine.followGroupMove` — the windows
leave this surface and the subtree is handed to `world.neighbor()`, a second
`ManualTilingLayout` standing in for the next output.

- `*.spec.test.js` — specified behaviour, asserting exact pane geometry.
- `*.cosmic.test.js` — stacks, group selection, directional moves, drops and
  group hand-over. Note `findViolations` checks overlap and screen coverage
  over *panes*, not windows: every member of a stacked pane shares one geometry
  on purpose, and a stack's tab strip is part of its pane's area.
- `*.unfit.test.js` — regressions for windows getting stranded outside the layout.
- `*.fuzz.test.js` — seeded random operation sequences checked against `findViolations`
  (no duplicate/orphaned panes, nothing overlapping or outside the area, no pane below its
  window's minimum, exact screen coverage). Override with `KROHNKITE_FUZZ_SEEDS` /
  `KROHNKITE_FUZZ_STEPS`; failures print the seed, step and operation to reproduce.

`ManualTilingLayout`'s move rules are a port of cosmic-comp's
`TilingLayout::move_current_node` (`cosmic-comp/src/shell/layout/tiling/mod.rs`,
~line 1507); its tree is **n-ary** for the same reason cosmic's is — `A | B | C`
and `(A | B) | C` must stay distinguishable, since every later move treats them
differently. Only one-child splits are flattened (`_cleanup`), never
same-orientation nesting. Beware cosmic's orientation names are the opposite of
this codebase's: cosmic's `Orientation::Vertical` divides *width* (panes side by
side) and is what this layout calls `"horizontal"`. The directional move keys
(`Shift*`/`Swap*`) are handled by the layout, not by the engine's own
directional move, and there is no migrate shortcut: a group crosses to another
screen or desktop by *following* the window KWin moved, via
`TilingController.onWindowChanged` → `TilingEngine.followGroupMove` →
`ManualTilingLayout.groupFollowerIds` (which asks) and `takeGroup` (which
commits), split in two because moving to another screen also reassigns the
virtual desktop, so the handler runs more than once per move and the first pass
arrives before the window has landed.

`focus.test.js` covers `topOfEachPane` ([src/util/focus.ts](src/util/focus.ts)), which the driver
applies to directional-focus candidates. A stacked pane's tabs share one geometry, so without it
a tab-mate sits at distance zero from the window being left and always wins — focus could never
leave a stack.

`layoututils.test.js` covers the shared geometry helpers — `LayoutUtils.splitWeighted` and the
`ILayoutPart` implementations built on it — since a change there moves every layout's geometry and
none of the others have tests. It needs no `CONFIG`, unlike the layouts themselves.

Verifying behaviour means installing and restarting the compositor. Per the README, config changes
need a **reboot/session restart** — do *not* toggle the script off and on in System Settings, that
starts multiple instances. [tools/autoinstall/](tools/autoinstall/) is a dev helper (systemd user
service + watchdog) that auto-installs `.kwinscript` files dropped into a folder, e.g. in a VM.

Runtime debugging goes through `LOG?.send(...)`: enable log modules in the script's config, then
read KSystemLog filtered on `krohnkite`. `Options -> Debug new Windows` dumps every window's
class/resource/caption, which is how users find filter strings.

## Compilation model (read this before adding files)

`tsconfig.json` uses `outFile` with **no modules** — there are no `import`/`export` statements
anywhere. Every declaration in `src/**/*.ts` lands in one shared global scope and is visible
everywhere, so:

- Adding a file requires no registration, but **every top-level name must be globally unique**.
- Never add `import`/`export`; it would turn the file into a module and break the bundle.
- `src/_types.ts` is named with a leading underscore so its shared enum-like consts/types come first.
- Ambient declarations for the KWin/Qt/Plasma APIs live in [src/extern/](src/extern/) — these are
  hand-written and often incomplete; extend them when you touch a new KWin property.

Runtime globals, assigned once in `KWinDriver`'s constructor: `KWIN`, `CONFIG` (= `KWINCONFIG`,
same object), `LOG` (undefined when logging is off — always use `LOG?.`), `DBUS`. `scriptRoot` is
the QML root `Item`, used to create `QTimer`s.

## Architecture

Layers, outermost first:

1. **QML shell** — [res/main.qml](res/main.qml) builds an `api` object (`workspace`, `kwin`,
   `shortcuts.qml`, `dbus.qml`) and calls `new K.KWinDriver(api).main()`.
   [res/shortcuts.qml](res/shortcuts.qml) declares every `ShortcutHandler` with its default key
   sequence, [res/dbus.qml](res/dbus.qml) the `DBusCall`s, [res/popup.qml](res/popup.qml) the OSD.
   Two more overlays exist for `ManualTilingLayout`: [res/dropindicator.qml](res/dropindicator.qml)
   (drag target / group selection outline) and
   [res/stackbars.qml](res/stackbars.qml), which pools [res/stackbar.qml](res/stackbar.qml)
   — one clickable tab strip per stacked pane. Both are `PlasmaCore.Dialog`s
   like the OSD, because that is the window kind KWin reliably shows for a
   script: a plain QtQuick `Window` is never mapped. The catch is that a Dialog
   with no `visualParent` re-places *itself*, centred on the screen, whenever it
   is shown or resized — hence the `wantX`/`wantY` properties and the
   `onXChanged`/`onYChanged` handlers that put it back, and the sizing through
   `mainItem`'s implicit size rather than the window's own width/height. Both
   log to the KWin journal (grep `KROHNKITE`) if they fail to load or end up
   somewhere other than where they were put. Both are `Loader`s in
   `main.qml` whose ids the driver reaches as globals, the same trick
   `popupDialog` uses; declare any new one in [src/extern/global.d.ts](src/extern/global.d.ts).
   `dropindicator.qml` is loaded twice: once filled as the drop indicator, once
   hollow as the group-selection outline (`selectionOutline`).
   Overlays that outlive a single call — the stack bars and the selection
   outline — are collected per arrange: `TilingEngine.arrange` calls
   `beginOverlays` / `flushOverlays` around the surface loop and each layout
   re-registers under its own key inside `apply`, so a layout that stops being
   applied stops being drawn without any teardown of its own. Keep the flush on
   every early return out of `arrange`. The drop indicator is outside that
   cycle: it belongs to a drag or a one-off flash, neither of which lines up
   with an arrange. Adding a `.qml` file means adding it to
   the `kwin-pkg` task's `cmds`/`sources`/`generates` in `taskfile.yaml` too.
2. **Driver** — [src/driver/](src/driver/). `KWinDriver` ([kwindriver.ts](src/driver/kwindriver.ts))
   implements `IDriverContext`: it connects KWin signals, wraps every `KwinWindow` in a
   `WindowClass` via `WrapperMap`, and is the only place that talks to the KWin API.
   `DriverWindow` ([kwinwindow.ts](src/driver/kwinwindow.ts)) is the per-window KWin adapter and
   owns the filter rules (`shouldIgnore` / `shouldFloat`). `KWinConfig`
   ([kwinconfig.ts](src/driver/kwinconfig.ts)) reads all user settings once at startup.
3. **Controller** — [src/engine/control.ts](src/engine/control.ts). `TilingController` is only
   event→action translation (`onWindowAdded`, `onShortcut`, `onWindowDragging`, …). Keep policy
   here, not in the driver.
4. **Engine** — [src/engine/engine.ts](src/engine/engine.ts). `TilingEngine` owns `WindowStore`,
   `LayoutStore`, `DockStore` and the arrange pipeline.
5. **Layouts** — [src/layouts/](src/layouts/). Pure geometry: each implements `ILayout.apply()`,
   setting `tile.geometry` and `tile.state` on the windows it is handed. Layouts only see
   `EngineContext` ([enginecontext.ts](src/engine/enginecontext.ts)), a deliberately narrow facade.

Interfaces for all of the above (`IConfig`, `IDriverContext`, `ILayout`, `ISurface`,
`IWindowClass`, `IShortcuts`, …) are declared in [src/common.ts](src/common.ts); shared
const-object "enums" (`WindowState`, `Shortcut`, `ArrangeReason`, `LogModules`) in
[src/_types.ts](src/_types.ts).

### Surfaces

A **surface** is the tiling unit: the triple (KWin `Output`, activity id, `VirtualDesktop`), id
format `Output@activityId#DesktopName` (`surfaceIdParse` / `KWinSurface.generateId`).
`KWinSurfaceStore` ([kwinsurface.ts](src/driver/kwinsurface.ts)) caches them and, importantly,
drops surfaces whose `Output` disappeared — KWin destroys `Output` QObjects on hotplug/resume and
feeding a dangling wrapper back into the KWin API can crash the compositor. Any new code path that
holds an `Output` across signals must respect that. Surfaces are re-created on demand; layouts
live in `LayoutStore` keyed by output name, and runtime capacity overrides are stashed and restored.

Users can label surface groups (`config -> surfaces -> define surfaces`); `srf.isFit(label)` /
`SurfaceCfg<T>` is the shared mechanism for per-surface config (gaps, docks, capacity, layout).

Each surface has a **capacity**; tileables beyond it are `overCapacity` and are either floated or
moved to a neighbouring output/virtual desktop (`OverCapacityWindows`, driven by
`CONFIG.srfExceededTo{Screen,VDesktop}` and the direction orders).

### The arrange pipeline

`TilingEngine.arrange(ctx, reason)` is the single entry point for re-tiling; every signal handler
funnels into it with an `ArrangeReason`.

```
KWin signal -> KWinDriver._connect -> _enter(...)          # reentrancy guard, swallows exceptions
            -> TilingController.onX(...)
            -> TilingEngine.arrange(ctx, reason)
                 for each surface in ctx.currentSurfaces:  # per-output current desktop (KWin 6.7)
                   getTileables(srf)                       # resolve Undecided states, split
                                                           # tileables/overCapacity, subtract docks
                 (optionally relocate overCapacity windows, then return early)
                 arrangeScreen(...) -> layout.apply(EngineContext, tileables, area, gap)
                                    -> window.commit(ctx)  # WindowClass state machine
                                    -> DriverWindow.commit -> KWin geometry/layer/border writes
```

Nothing outside `commit()` should write geometry to KWin. `WindowClass`
([window.ts](src/engine/window.ts)) holds the state machine (`WindowState`: `Undecided`, `Tiled`,
`Floating`, `Maximized`, `Docked`, `Dragging`, `Native*`, `Unmanaged`), remembers float geometry
when leaving the float states, and stores a per-surface `weight` used by resizable layouts.
Geometry helpers: `Rect` / `RectDelta` in [src/util/](src/util/).

Because everything runs inside KWin's event loop, deferred work uses
`ctx.setTimeout` → `KWinSetTimeout` (pooled `QTimer`s, [kwinsettimeout.ts](src/driver/kwinsettimeout.ts)),
never the JS `setTimeout`.

### Docks

[src/dock/](src/dock/) implements user-defined docks (windows pinned to a screen edge that reserve
space). `DockStore.render()` is called from `getTileables` and shrinks the working area before the
layout runs. Dock config is parsed from free-form text config in
[dockparseusercfg.ts](src/dock/dockparseusercfg.ts).

## Adding things: the plumbing that must stay in sync

**A config option** touches four places:
1. `<entry name="foo" type="...">` with a `<default>` in [res/config.xml](res/config.xml).
2. A widget named `kcfg_foo` in [res/config.ui](res/config.ui) (Qt Designer; KConfig XT binds by name).
3. A field on `IConfig` in [src/common.ts](src/common.ts).
4. `this.foo = KWIN.readConfig("foo", <default>)` in the `KWinConfig` constructor. Keep the default
   identical to config.xml. Multi-value text fields are split with `separate(str, "\n" | ",")` and
   validated via the helpers in [src/util/validation.ts](src/util/validation.ts).

**A layout**:
1. New class in `src/layouts/` with `public static readonly id`, `description`, `apply()`, and
   optionally `handleShortcut()`, `adjust()`, `drag()`, `dragOver()`.
   `drag()` is called repeatedly while a window is being dragged; `dragOver()`
   once when it is dropped, ahead of the controller's own swap-or-float
   handling, and returning true from it consumes the drop. A layout that
   restructures on drop rather than under the cursor previews in `drag()` (by
   drawing the drop indicator) and does the work in `dragOver()`.
2. Add `[MyLayout, <isCapacity>]` to `layoutsList` in the `KWinConfig` constructor. Ordering and
   capacity come from config keys derived by convention: `unCapitalize(id) + "Order"` (0 = disabled)
   and, when `isCapacity`, `unCapitalize(id) + "Capacity"` — so add matching `config.xml`/`config.ui`
   entries.
3. For a direct-select shortcut, follow the shortcut checklist below.

**A shortcut** touches five places: `Shortcut` in [src/_types.ts](src/_types.ts) → `ShortcutHandler`
+ getter in [res/shortcuts.qml](res/shortcuts.qml) → the getter on `IShortcuts` in
[src/common.ts](src/common.ts) → the `shortcutPairs` table in `KWinDriver._bindShortcut` → handling
in `TilingController.onShortcut` (and/or `ILayout.handleShortcut`). Note the "meta mode"
(`KrohnkiteMeta`) layer: a second shortcut set active only while meta mode is on, mapped through
`CONFIG.metaConf` / `defaultMetaConfig`.

**Translations**: `res/config.ui` strings only. Regenerate with the `lupdate`/`ts2po` recipe in
[translations/localization.txt](translations/localization.txt); compiled `.mo` files under
`translations/locale/` are copied into the package by `kwin-pkg`.

## Conventions

- Formatting is Prettier-default (2-space, double quotes, trailing commas, 80 cols). Match it.
- Every source file starts with the SPDX MIT header block; copy it into new files.
- Commit subjects use `ADD: `, `FIX: `, `Update ` prefixes.
- Version comes from `git describe --tags --abbrev=0`; `$VER`/`$REV` are substituted into
  [res/metadata.json](res/metadata.json) at package time. Don't hand-edit versions —
  `package-json` / `meta-version` tasks do it.
- `krohnkite.js`, `pkg/`, `builds/` are generated and gitignored.
