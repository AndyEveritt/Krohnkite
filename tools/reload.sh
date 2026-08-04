#!/bin/sh
#
# Reload Krohnkite into the running KWin, without restarting the session.
#
# Usage: tools/reload.sh [pkg-dir]        (default: ./pkg, i.e. `go-task kwin-pkg`)
#
# This talks to org.kde.KWin /Scripting directly instead of toggling the script
# in System Settings: the toggle does not reliably unload the old instance, so
# it ends up running two of them. Here the unload is explicit and verified
# before anything is loaded again.

set -e

PKG_SRC="${1:-pkg}"
PLUGIN=krohnkite
STAGE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/krohnkite-reload"

QDBUS="$(command -v qdbus6 || command -v qdbus-qt6 || command -v qdbus)"
[ -n "$QDBUS" ] || { echo "reload: no qdbus binary found" >&2; exit 1; }
[ -f "$PKG_SRC/contents/ui/main.qml" ] || {
	echo "reload: no package tree at $PKG_SRC (run: go-task kwin-pkg)" >&2
	exit 1
}

_invoke() { "$QDBUS" org.kde.KWin /Scripting "org.kde.kwin.Scripting.$@"; }

# KWin's QML engine keeps compiled units keyed by file URL for the lifetime of
# the process, so re-loading the same path re-runs the *old* code. Stage every
# reload under a fresh directory to get a fresh URL.
stage="$STAGE_ROOT/$(date +%s%N)"
mkdir -p "$stage"
cp -r "$PKG_SRC/." "$stage/"

if [ "$(_invoke isScriptLoaded "$PLUGIN")" = "true" ]; then
	_invoke unloadScript "$PLUGIN" >/dev/null
	if [ "$(_invoke isScriptLoaded "$PLUGIN")" != "false" ]; then
		echo "reload: failed to unload $PLUGIN" >&2
		exit 1
	fi
fi

_invoke loadDeclarativeScript "$stage/contents/ui/main.qml" "$PLUGIN" >/dev/null
_invoke start
if [ "$(_invoke isScriptLoaded "$PLUGIN")" != "true" ]; then
	echo "reload: failed to load $PLUGIN from $stage" >&2
	exit 1
fi
echo "reload: $PLUGIN running from $stage"

# Keep the last few staged copies around (the running one is still reading from
# its directory), drop the rest.
ls -1d "$STAGE_ROOT"/* 2>/dev/null | sort -r | tail -n +4 | xargs -r rm -rf
