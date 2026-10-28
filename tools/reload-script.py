#!/usr/bin/env python3
"""Reload a complete Krohnkite bundle without restarting KWin or logging out."""

import argparse
import fcntl
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

SERVICE = "org.kde.KWin"
INTERFACE = "org.kde.kwin.Scripting"
SCRIPT_INTERFACE = "org.kde.kwin.Script"
PLUGIN = "krohnkite"
RELOAD_ERRORS = (ValueError, RuntimeError, OSError, subprocess.CalledProcessError)


def invoke(method, *args, path="/Scripting", interface=INTERFACE):
    return subprocess.run(
        ["qdbus6", SERVICE, path, f"{interface}.{method}", *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def validate_package(package):
    for relative in ["contents/ui/main.qml", "contents/code/script.js", "metadata.json"]:
        if not (package / relative).is_file():
            raise ValueError(f"Missing {package / relative}; run 'go-task package' first.")


def stage_package(package, cache):
    validate_package(package)
    cache.mkdir(parents=True, exist_ok=True)
    # Every dependency gets a new URL, including imported JS, popup QML, and SVGs.
    # Renaming main.qml alone does not invalidate KWin's shared component cache.
    bundle = Path(tempfile.mkdtemp(prefix="reload-", dir=cache))
    try:
        shutil.copytree(package, bundle, dirs_exist_ok=True)
    except OSError:
        shutil.rmtree(bundle, ignore_errors=True)
        raise
    return bundle / "contents/ui/main.qml"


def bundle_root(main_qml):
    """Return the staged bundle a `contents/ui/main.qml` belongs to."""
    return main_qml.parent.parent.parent


def prune_bundles(cache, *keep):
    """Delete staged bundles that nothing references any more.

    A loaded script can still pull QML and images from its bundle lazily, so the
    bundle it runs from has to survive until the script is replaced.
    """
    kept = {bundle_root(main_qml).resolve() for main_qml in keep if main_qml is not None}
    for bundle in cache.glob("reload-*"):
        if bundle.is_dir() and bundle.resolve() not in kept:
            shutil.rmtree(bundle, ignore_errors=True)


def read_last_good(last_good_file):
    if last_good_file is None:
        return None
    try:
        main_qml = Path(last_good_file.read_text().strip())
    except OSError:
        return None
    return main_qml if main_qml.is_file() else None


def remember_last_good(last_good_file, main_qml):
    if last_good_file is None:
        return
    last_good_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = last_good_file.with_suffix(f".tmp-{os.getpid()}")
    try:
        temporary.write_text(str(main_qml))
        os.replace(temporary, last_good_file)
    finally:
        temporary.unlink(missing_ok=True)


def load_and_run(main_qml):
    script_id = invoke("loadDeclarativeScript", str(main_qml), PLUGIN)
    if not script_id.isdecimal():
        raise RuntimeError(f"KWin refused to load {main_qml}: {script_id}")
    # Run only the script just loaded. Scripting.start() would also start every
    # other loaded-but-unstarted KWin script. KWin reports QML errors of this
    # script in its own journal only, so a broken bundle is not detected here.
    invoke("run", path=f"/Scripting/Script{script_id}", interface=SCRIPT_INTERFACE)


def reload_script(main_qml, last_good_file=None):
    was_loaded = invoke("isScriptLoaded", PLUGIN) == "true"
    previous_main_qml = read_last_good(last_good_file) if was_loaded else None
    if was_loaded and invoke("unloadScript", PLUGIN) != "true":
        raise RuntimeError("KWin refused to unload Krohnkite; no replacement loaded.")
    try:
        load_and_run(main_qml)
    except RELOAD_ERRORS as primary_error:
        if not was_loaded:
            raise
        if previous_main_qml is None:
            recovery = "No known prior working bundle is available for recovery."
        else:
            try:
                load_and_run(previous_main_qml)
                recovery = f"Recovered using prior bundle {previous_main_qml}."
            except RELOAD_ERRORS as recovery_error:
                detail = getattr(recovery_error, "stderr", None) or str(recovery_error)
                recovery = f"Recovery from {previous_main_qml} failed: {detail}"
        detail = getattr(primary_error, "stderr", None) or str(primary_error)
        raise RuntimeError(f"Replacement reload failed: {detail} {recovery}") from primary_error
    try:
        remember_last_good(last_good_file, main_qml)
    except OSError as error:
        print(f"Warning: could not record last working bundle: {error}", file=sys.stderr)


def reload_package(package, cache):
    last_good_file = cache / "last-good-main-qml"
    main_qml = stage_package(package, cache)
    try:
        reload_script(main_qml, last_good_file)
    except RELOAD_ERRORS:
        # The rejected bundle never replaced the running script, so drop it.
        prune_bundles(cache, read_last_good(last_good_file))
        raise
    prune_bundles(cache, main_qml, read_last_good(last_good_file))
    # Keep the loaded bundle: QML and images can be loaded lazily while the script runs.
    print(f"Krohnkite reloaded without logout: {main_qml}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", nargs="?", type=Path, default=Path("pkg"))
    parser.add_argument("--dry-run", action="store_true", help="show commands without touching KWin or files")
    args = parser.parse_args()
    package = args.package.resolve()
    validate_package(package)
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "krohnkite"
    if args.dry_run:
        for path, interface, method, values in [
            ("/Scripting", INTERFACE, "isScriptLoaded", [PLUGIN]),
            ("/Scripting", INTERFACE, "unloadScript", [PLUGIN]),
            ("/Scripting", INTERFACE, "loadDeclarativeScript",
             [str(cache / "<fresh-bundle>/contents/ui/main.qml"), PLUGIN]),
            ("/Scripting/Script<script-id>", SCRIPT_INTERFACE, "run", []),
        ]:
            print(shlex.join(["qdbus6", SERVICE, path, f"{interface}.{method}", *values]))
        return
    cache.mkdir(parents=True, exist_ok=True)
    # Pruning removes every bundle but the caller's own, so overlapping runs have
    # to be serialized before one of them can delete a bundle the other is loading.
    with open(cache / "reload.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        reload_package(package, cache)


if __name__ == "__main__":
    try:
        main()
    except RELOAD_ERRORS as error:
        detail = getattr(error, "stderr", None) or str(error)
        raise SystemExit(f"Reload failed: {detail}") from error
