#!/usr/bin/env python3
"""Reload a complete Kröhnkite bundle without restarting KWin or logging out."""

import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

SERVICE = "org.kde.KWin"
INTERFACE = "org.kde.kwin.Scripting"
PLUGIN = "krohnkite"


def invoke(method, *args):
    return subprocess.run(
        ["qdbus6", SERVICE, "/Scripting", f"{INTERFACE}.{method}", *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def validate_package(package):
    for relative in ["contents/ui/main.qml", "contents/code/script.js", "metadata.json"]:
        if not (package / relative).is_file():
            raise ValueError(f"Missing {package / relative}; run make all first.")


def stage_package(package, cache):
    validate_package(package)
    cache.mkdir(parents=True, exist_ok=True)
    # Every dependency gets a new URL, including imported JS, popup QML, and SVGs.
    # Renaming main.qml alone does not invalidate KWin's shared component cache.
    bundle = Path(tempfile.mkdtemp(prefix="reload-", dir=cache))
    shutil.copytree(package, bundle, dirs_exist_ok=True)
    return bundle / "contents/ui/main.qml"


def reload_script(main_qml):
    if invoke("isScriptLoaded", PLUGIN) == "true":
        if invoke("unloadScript", PLUGIN) != "true":
            raise RuntimeError("KWin refused to unload Kröhnkite; no replacement loaded.")
    script_id = invoke("loadDeclarativeScript", str(main_qml), PLUGIN)
    if not script_id.isdecimal():
        raise RuntimeError(f"KWin refused to load {main_qml}: {script_id}")
    invoke("start")
    if invoke("isScriptLoaded", PLUGIN) != "true":
        raise RuntimeError("Kröhnkite did not load. Inspect KWin's user journal for QML errors.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", nargs="?", type=Path, default=Path("pkg"))
    parser.add_argument("--dry-run", action="store_true", help="show commands without touching KWin or files")
    args = parser.parse_args()
    package = args.package.resolve()
    validate_package(package)
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "krohnkite"
    if args.dry_run:
        for method, values in [
            ("isScriptLoaded", [PLUGIN]), ("unloadScript", [PLUGIN]),
            ("loadDeclarativeScript", [str(cache / "<fresh-bundle>/contents/ui/main.qml"), PLUGIN]),
            ("start", []), ("isScriptLoaded", [PLUGIN]),
        ]:
            print(shlex.join(["qdbus6", SERVICE, "/Scripting", f"{INTERFACE}.{method}", *values]))
        return
    main_qml = stage_package(package, cache)
    reload_script(main_qml)
    # Keep the bundle: QML and images can be loaded lazily while the script runs.
    print(f"Kröhnkite reloaded without logout: {main_qml}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", None) or str(error)
        raise SystemExit(f"Reload failed: {detail}") from error
