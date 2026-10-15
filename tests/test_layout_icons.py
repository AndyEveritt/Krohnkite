import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("layout_icons", ROOT / "tools/install-layout-icons.py")
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)


class IconInstallationTests(unittest.TestCase):
    def test_installs_original_svgs_with_namespaced_theme_names(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(icons, "refresh_icons") as refresh:
            data_home = Path(directory)
            self.assertEqual(icons.install_icons(ROOT / "res/layouts", data_home), 12)
            for name in icons.LAYOUTS:
                file = icons.icon_directory(data_home) / f"krohnkite-layout-{name}.svg"
                self.assertEqual(file.read_bytes(), (ROOT / f"res/layouts/{name}.svg").read_bytes())
            refresh.assert_called_once()
            self.assertFalse((data_home / "icons/hicolor/index.theme").exists())

    def test_unchanged_icons_do_not_rewrite_or_refresh(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(icons, "refresh_icons") as refresh:
            data_home = Path(directory)
            icons.install_icons(ROOT / "res/layouts", data_home)
            refresh.reset_mock()
            self.assertEqual(icons.install_icons(ROOT / "res/layouts", data_home), 0)
            refresh.assert_not_called()

    def test_uninstall_preserves_other_icons_and_theme_metadata(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(icons, "refresh_icons"):
            data_home = Path(directory)
            icons.install_icons(ROOT / "res/layouts", data_home)
            unrelated = icons.icon_directory(data_home) / "other-application.svg"
            unrelated.write_text("keep")
            metadata = data_home / "icons/hicolor/index.theme"
            metadata.write_text("keep theme metadata")
            self.assertEqual(icons.uninstall_icons(data_home), 12)
            self.assertEqual(unrelated.read_text(), "keep")
            self.assertEqual(metadata.read_text(), "keep theme metadata")
            self.assertEqual(icons.uninstall_icons(data_home), 0)

    def test_missing_svg_fails_before_any_installation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(icons, "refresh_icons") as refresh:
            data_home = Path(directory) / "data"
            with self.assertRaises(ValueError):
                icons.install_icons(Path(directory) / "missing", data_home)
            self.assertFalse(data_home.exists())
            refresh.assert_not_called()

    def test_settings_has_only_svg_theme_references(self):
        source = (ROOT / "res/config.ui").read_text()
        self.assertNotIn("data:image/", source)
        ui = ET.fromstring(source)
        for name in icons.LAYOUTS:
            widget = ui.find(f'.//widget[@name="{name}LayoutPictogram"]')
            self.assertEqual(widget.get("class"), "QToolButton")
            self.assertEqual(widget.find('property[@name="icon"]/iconset').get("theme"),
                             f"krohnkite-layout-{name}")
            self.assertEqual(widget.findtext('property[@name="focusPolicy"]/enum'), "Qt::FocusPolicy::NoFocus")


@unittest.skipUnless(importlib.util.find_spec("PySide6"), "Optional native Qt UI test requires PySide6")
class NativeSettingsSVGTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication
        cls.app = QApplication.instance() or QApplication([])

    def test_actual_quiloader_renders_all_theme_svgs_without_package_working_directory(self):
        from PySide6.QtCore import QFile, QIODevice
        from PySide6.QtGui import QIcon
        from PySide6.QtUiTools import QUiLoader
        from PySide6.QtWidgets import QToolButton
        with tempfile.TemporaryDirectory() as directory, patch.object(icons, "refresh_icons"):
            data_home = Path(directory)
            icons.install_icons(ROOT / "res/layouts", data_home)
            old_paths, old_theme = QIcon.themeSearchPaths(), QIcon.themeName()
            try:
                QIcon.setThemeSearchPaths([str(data_home / "icons"), "/usr/share/icons"])
                QIcon.setThemeName("hicolor")
                loader = QUiLoader()
                # Emulate KWin: no setWorkingDirectory(package_dir).
                file = QFile(str(ROOT / "res/config.ui"))
                self.assertTrue(file.open(QIODevice.OpenModeFlag.ReadOnly))
                form = loader.load(file)
                file.close()
                self.assertIsNotNone(form, loader.errorString())
                for name in icons.LAYOUTS:
                    button = form.findChild(QToolButton, f"{name}LayoutPictogram")
                    self.assertIsNotNone(button, name)
                    self.assertFalse(button.icon().isNull(), name)
                    image = button.icon().pixmap(48, 32).toImage()
                    expected = QIcon(str(ROOT / f"res/layouts/{name}.svg")).pixmap(48, 32).toImage()
                    self.assertFalse(image.isNull(), name)
                    self.assertEqual(image, expected, name)
                    self.assertTrue(any(image.pixelColor(x, y).alpha() > 0
                                        for y in range(image.height()) for x in range(image.width())), name)
                    # Check the actual widget paint, not only a valid theme lookup.
                    button.resize(56, 40)
                    painted = button.grab().toImage()
                    solid = next((image.pixelColor(x, y).rgb()
                                  for y in range(image.height()) for x in range(image.width())
                                  if image.pixelColor(x, y).alpha() == 255), None)
                    self.assertIsNotNone(solid, name)
                    self.assertTrue(any(painted.pixelColor(x, y).rgb() == solid
                                        for y in range(painted.height()) for x in range(painted.width())), name)
                form.deleteLater()
            finally:
                QIcon.setThemeSearchPaths(old_paths)
                QIcon.setThemeName(old_theme)


if __name__ == "__main__":
    unittest.main()
