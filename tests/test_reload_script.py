import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("reload_script", ROOT / "tools/reload-script.py")
reload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reload)


class ReloadTests(unittest.TestCase):
    def package(self, root):
        package = root / "pkg"
        files = {
            "metadata.json": "{}",
            "contents/ui/main.qml": 'import "../code/script.js" as K',
            "contents/code/script.js": "// fresh JavaScript",
            "contents/ui/popup.qml": "// fresh popup",
            "contents/ui/layouts/tile.svg": "<svg/>",
        }
        for relative, content in files.items():
            file = package / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        return package, files

    def test_stages_every_dependency_at_unique_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package, files = self.package(root)
            first = reload.stage_package(package, root / "cache")
            second = reload.stage_package(package, root / "cache")
            self.assertNotEqual(first, second)
            for main in (first, second):
                bundle = main.parents[2]
                for relative, content in files.items():
                    self.assertEqual((bundle / relative).read_text(), content)
                self.assertEqual((main.parent / "../code/script.js").resolve().read_text(), "// fresh JavaScript")

    def test_missing_dependency_rejected_before_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                reload.stage_package(root, root / "cache")
            self.assertFalse((root / "cache").exists())

    @patch.object(reload.subprocess, "run")
    def test_invoke_calls_qdbus_with_checked_capture(self, run):
        run.return_value.stdout = " true\n"
        self.assertEqual(reload.invoke("isScriptLoaded", "krohnkite"), "true")
        run.assert_called_once_with(
            ["qdbus6", "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.isScriptLoaded", "krohnkite"],
            check=True, capture_output=True, text=True,
        )

    def test_loaded_script_unloaded_then_loaded_under_same_plugin_name(self):
        with patch.object(reload, "invoke", side_effect=["true", "true", "12", "", "true"]) as invoke:
            reload.reload_script(Path("/cache/with spaces/contents/ui/main.qml"))
        self.assertEqual([call.args for call in invoke.call_args_list], [
            ("isScriptLoaded", "krohnkite"), ("unloadScript", "krohnkite"),
            ("loadDeclarativeScript", "/cache/with spaces/contents/ui/main.qml", "krohnkite"),
            ("start",), ("isScriptLoaded", "krohnkite"),
        ])

    def test_unloaded_script_does_not_attempt_unload(self):
        with patch.object(reload, "invoke", side_effect=["false", "0", "", "true"]) as invoke:
            reload.reload_script(Path("/cache/main.qml"))
        self.assertNotIn("unloadScript", [call.args[0] for call in invoke.call_args_list])

    def test_failed_unload_does_not_load_duplicate_script(self):
        with patch.object(reload, "invoke", side_effect=["true", "false"]) as invoke:
            with self.assertRaises(RuntimeError):
                reload.reload_script(Path("/cache/main.qml"))
        self.assertEqual(invoke.call_count, 2)

    def test_rejected_load_does_not_start(self):
        with patch.object(reload, "invoke", side_effect=["false", "-1"]) as invoke:
            with self.assertRaises(RuntimeError):
                reload.reload_script(Path("/cache/main.qml"))
        self.assertEqual(invoke.call_count, 2)

    def test_failed_start_is_reported(self):
        with patch.object(reload, "invoke", side_effect=["false", "1", "", "false"]):
            with self.assertRaises(RuntimeError):
                reload.reload_script(Path("/cache/main.qml"))


if __name__ == "__main__":
    unittest.main()
