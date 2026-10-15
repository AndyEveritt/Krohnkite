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

    def test_successful_reload_records_bundle_for_future_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "cache/last-good-main-qml"
            main_qml = Path(directory) / "bundle/contents/ui/main.qml"
            with patch.object(reload, "invoke", side_effect=["false", "12", "", "true"]):
                reload.reload_script(main_qml, marker)
            self.assertEqual(marker.read_text(), str(main_qml))
            self.assertFalse(marker.with_suffix(f".tmp-{reload.os.getpid()}").exists())

    def test_rejected_replacement_recovers_last_good_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory) / "previous/contents/ui/main.qml"
            previous.parent.mkdir(parents=True)
            previous.touch()
            marker = Path(directory) / "last-good-main-qml"
            marker.write_text(str(previous))
            with patch.object(reload, "invoke", side_effect=[
                "true", "true", "-1", str(31), "", "true",
            ]) as invoke:
                with self.assertRaisesRegex(RuntimeError, "Recovered using prior bundle"):
                    reload.reload_script(Path("/replacement/main.qml"), marker)
            self.assertEqual(invoke.call_args_list[2].args,
                             ("loadDeclarativeScript", "/replacement/main.qml", "krohnkite"))
            self.assertEqual(invoke.call_args_list[3].args,
                             ("loadDeclarativeScript", str(previous), "krohnkite"))

    def test_dbus_replacement_failure_reports_recovery_failure_and_primary(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory) / "previous/contents/ui/main.qml"
            previous.parent.mkdir(parents=True)
            previous.touch()
            marker = Path(directory) / "last-good-main-qml"
            marker.write_text(str(previous))
            dbus_error = reload.subprocess.CalledProcessError(1, "qdbus6", stderr="DBus unavailable")
            with patch.object(reload, "invoke", side_effect=[
                "true", "true", dbus_error, "22", RuntimeError("recovery start failed"),
            ]):
                with self.assertRaises(RuntimeError) as raised:
                    reload.reload_script(Path("/replacement/main.qml"), marker)
            self.assertIn("DBus unavailable", str(raised.exception))
            self.assertIn("Recovery from", str(raised.exception))
            self.assertIn("recovery start failed", str(raised.exception))

    def test_start_failure_recovers_last_good_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path(directory) / "previous/contents/ui/main.qml"
            previous.parent.mkdir(parents=True)
            previous.touch()
            marker = Path(directory) / "last-good-main-qml"
            marker.write_text(str(previous))
            with patch.object(reload, "invoke", side_effect=[
                "true", "true", "12", "", "false", "13", "", "true",
            ]):
                with self.assertRaisesRegex(RuntimeError, "Recovered using prior bundle"):
                    reload.reload_script(Path("/replacement/main.qml"), marker)

    def test_missing_last_good_bundle_is_reported_without_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "last-good-main-qml"
            marker.write_text(str(Path(directory) / "missing.qml"))
            with patch.object(reload, "invoke", side_effect=["true", "true", "-1"]):
                with self.assertRaisesRegex(RuntimeError, "No known prior working bundle"):
                    reload.reload_script(Path("/replacement/main.qml"), marker)


if __name__ == "__main__":
    unittest.main()
