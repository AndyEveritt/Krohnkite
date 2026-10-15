#!/usr/bin/env python3
"""Install Kröhnkite's shared SVGs as user-local hicolor theme icons."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess

ICON_PREFIX = "krohnkite-layout-"
LAYOUTS = ("tile", "monocle", "threecolumn", "spiral", "quarter", "stacked",
           "columns", "spread", "floating", "stair", "binarytree", "cascade")


def icon_directory(data_home):
    return data_home / "icons/hicolor/scalable/actions"


def refresh_icons():
    subprocess.run(["xdg-icon-resource", "forceupdate", "--mode", "user", "--theme", "hicolor"], check=True)


def install_icons(source, data_home):
    files = [source / f"{name}.svg" for name in LAYOUTS]
    for file in files:
        if not file.is_file():
            raise ValueError(f"Missing layout SVG: {file}")
    destination = icon_directory(data_home)
    destination.mkdir(parents=True, exist_ok=True)
    changed = 0
    for file in files:
        target = destination / f"{ICON_PREFIX}{file.name}"
        if not target.is_file() or target.read_bytes() != file.read_bytes():
            shutil.copyfile(file, target)
            changed += 1
    # Leave existing theme metadata and unrelated icons untouched.
    if changed:
        refresh_icons()
    return changed


def uninstall_icons(data_home):
    changed = 0
    for name in LAYOUTS:
        file = icon_directory(data_home) / f"{ICON_PREFIX}{name}.svg"
        if file.is_file():
            file.unlink()
            changed += 1
    if changed:
        refresh_icons()
    return changed


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
