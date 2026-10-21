#!/usr/bin/env python3
"""Install Kröhnkite's shared SVGs as user-local hicolor theme icons."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ICON_PREFIX = "krohnkite-layout-"
LAYOUTS = ("tile", "monocle", "threecolumn", "spiral", "quarter", "stacked",
           "columns", "spread", "floating", "stair", "binarytree", "cascade")


def icon_directory(data_home):
    return data_home / "icons/hicolor/scalable/actions"


def refresh_marker(data_home):
    return data_home / "icons/hicolor/.krohnkite-layout-icons.pending"


def refresh_icons(data_home):
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = str(data_home)
    subprocess.run(
        ["xdg-icon-resource", "forceupdate", "--mode", "user", "--theme", "hicolor"],
        check=True,
        env=env,
    )


def mark_refresh_pending(data_home):
    marker = refresh_marker(data_home)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("")


def flush_icon_cache(data_home):
    """Refresh the theme cache after a change, retrying failed refreshes.

    The cache is optional for Qt/KDE; a missing or broken xdg-icon-resource
    must not fail the installation. The marker is removed only after a
    successful refresh, so the next run retries a failed/skipped refresh.
    """
    marker = refresh_marker(data_home)
    if not marker.is_file():
        return
    try:
        refresh_icons(data_home)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"warning: could not refresh the icon cache: {error}", file=sys.stderr)
        return
    try:
        marker.unlink()
    except FileNotFoundError:
        pass


def install_icons(source, data_home):
    files = [source / f"{name}.svg" for name in LAYOUTS]
    for file in files:
        if not file.is_file():
            raise ValueError(f"Missing layout SVG: {file}")
    destination = icon_directory(data_home)
    updates = []
    for file in files:
        target = destination / f"{ICON_PREFIX}{file.name}"
        if not target.is_file() or target.read_bytes() != file.read_bytes():
            updates.append((file, target))
    if updates:
        destination.mkdir(parents=True, exist_ok=True)
        mark_refresh_pending(data_home)
        for file, target in updates:
            shutil.copyfile(file, target)
    # Leave existing theme metadata and unrelated icons untouched.
    flush_icon_cache(data_home)
    return len(updates)


def uninstall_icons(data_home):
    directory = icon_directory(data_home)
    # Include icons left by renamed layouts; keep unrelated theme files.
    existing = [file for file in directory.glob(f"{ICON_PREFIX}*.svg") if file.is_file()]
    if existing:
        mark_refresh_pending(data_home)
        for file in existing:
            file.unlink()
    flush_icon_cache(data_home)
    return len(existing)


def main():
    here = Path(__file__).resolve().parent.parent
    packaged_source = here / "ui/layouts"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=packaged_source if packaged_source.is_dir() else here / "res/layouts")
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    configured = os.environ.get("XDG_DATA_HOME", "")
    data_home = Path(configured) if configured and Path(configured).is_absolute() else Path.home() / ".local/share"
    changed = uninstall_icons(data_home) if args.uninstall else install_icons(args.source, data_home)
    print(f"Kröhnkite SVG theme icons: {changed} {'removed' if args.uninstall else 'updated'}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Layout icon installation failed: {error}") from error
