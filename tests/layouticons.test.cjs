const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const INSTALLER = path.join(ROOT, 'tools/install-layout-icons.py');
const LAYOUTS = [
  'tile', 'monocle', 'threecolumn', 'spiral', 'quarter', 'stacked',
  'columns', 'spread', 'floating', 'stair', 'binarytree', 'cascade',
];

function withSandbox(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'krohnkite-icons-'));
  const dataHome = path.join(directory, 'data');
  const bin = path.join(directory, 'bin');
  const refreshLog = path.join(directory, 'refresh.log');
  fs.mkdirSync(bin);
  const refreshStub = path.join(bin, 'xdg-icon-resource');
  fs.writeFileSync(refreshStub, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.ICON_REFRESH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  fs.chmodSync(refreshStub, 0o755);
  const env = {
    ...process.env,
    XDG_DATA_HOME: dataHome,
    ICON_REFRESH_LOG: refreshLog,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
  };
  const invoke = (...args) => spawnSync('python3', [INSTALLER, ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env,
  });
  try {
    run({ directory, dataHome, refreshLog, invoke });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function refreshes(log) {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function iconDirectory(dataHome) {
  return path.join(dataHome, 'icons/hicolor/scalable/actions');
}

test('installs original SVG bytes under all 12 namespaced theme names', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    for (const name of LAYOUTS) {
      const installed = path.join(iconDirectory(dataHome), `krohnkite-layout-${name}.svg`);
      assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(ROOT, 'res/layouts', `${name}.svg`)));
    }
    assert.equal(refreshes(refreshLog).length, 1);
    assert.equal(fs.existsSync(path.join(dataHome, 'icons/hicolor/index.theme')), false);
  });
});

test('unchanged installation preserves files and does not refresh icons', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    assert.equal(invoke().status, 0);
    const installed = path.join(iconDirectory(dataHome), 'krohnkite-layout-tile.svg');
    const originalContent = fs.readFileSync(installed);
    const before = fs.statSync(installed);
    const refreshCount = refreshes(refreshLog).length;
    const result = invoke();
    const after = fs.statSync(installed);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'Kröhnkite SVG theme icons: 0 updated');
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ino, before.ino);
    assert.deepEqual(fs.readFileSync(installed), originalContent);
    assert.equal(refreshes(refreshLog).length, refreshCount);
  });
});

test('repairs a corrupted installed icon and refreshes once', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    assert.equal(invoke().status, 0);
    const installed = path.join(iconDirectory(dataHome), 'krohnkite-layout-tile.svg');
    fs.writeFileSync(installed, '<svg>corrupted</svg>');
    const refreshCount = refreshes(refreshLog).length;
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(ROOT, 'res/layouts/tile.svg')));
    assert.equal(refreshes(refreshLog).length, refreshCount + 1);
  });
});

test('uninstall removes only Krohnkite icons and is idempotent', () => {
  withSandbox(({ dataHome, invoke }) => {
    assert.equal(invoke().status, 0);
    const unrelated = path.join(iconDirectory(dataHome), 'other-application.svg');
    const metadata = path.join(dataHome, 'icons/hicolor/index.theme');
    fs.writeFileSync(unrelated, 'keep icon');
    fs.writeFileSync(metadata, 'keep theme metadata');
    const removed = invoke('--uninstall');
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(removed.stdout.trim(), 'Kröhnkite SVG theme icons: 12 removed');
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep icon');
    assert.equal(fs.readFileSync(metadata, 'utf8'), 'keep theme metadata');
    const second = invoke('--uninstall');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), 'Kröhnkite SVG theme icons: 0 removed');
  });
});

test('missing source fails before creating data directories or refreshing icons', () => {
  withSandbox(({ dataHome, refreshLog, invoke }) => {
    const result = invoke('--source', path.join(os.tmpdir(), `missing-layouts-${process.pid}`));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing layout SVG/);
    assert.equal(fs.existsSync(dataHome), false);
    assert.equal(refreshes(refreshLog).length, 0);
  });
});

test('settings use SVG theme references for every layout pictogram', () => {
  const source = fs.readFileSync(path.join(ROOT, 'res/config.ui'), 'utf8');
  assert.doesNotMatch(source, /data:image\//);
  for (const name of LAYOUTS) {
    const widget = source.match(new RegExp(`<widget\\b(?=[^>]*\\bname="${name}LayoutPictogram")[^>]*>([\\s\\S]*?)<\\/widget>`));
    assert.ok(widget, `${name} pictogram widget missing`);
    assert.match(widget[0], /class="QToolButton"/);
    assert.match(widget[1], new RegExp(`<iconset\\b[^>]*\\btheme="krohnkite-layout-${name}"`));
    assert.match(widget[1], /<property name="focusPolicy"><enum>Qt::FocusPolicy::NoFocus<\/enum><\/property>/);
  }
});

const PYTHON = process.env.PYTHON || 'python3';
const hasPySide6 = spawnSync(PYTHON, ['-c', 'import importlib.util; print("yes" if importlib.util.find_spec("PySide6") else "no")'], { encoding: 'utf8' });
const nativeSkip = hasPySide6.status === 0 && hasPySide6.stdout.trim() === 'yes'
  ? false
  : 'Optional native Qt UI test requires PySide6';

test('Qt UI loader renders all installed theme SVGs and paints buttons without package working directory', { skip: nativeSkip }, () => {
  withSandbox(({ dataHome, invoke }) => {
    const install = invoke();
    assert.equal(install.status, 0, install.stderr);
    const script = String.raw`
import os, sys
from PySide6.QtCore import QFile, QIODevice
from PySide6.QtGui import QIcon
from PySide6.QtUiTools import QUiLoader
from PySide6.QtWidgets import QApplication, QToolButton
root, data_home = sys.argv[1:]
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
app = QApplication.instance() or QApplication([])
QIcon.setThemeSearchPaths([os.path.join(data_home, "icons"), "/usr/share/icons"])
QIcon.setThemeName("hicolor")
loader = QUiLoader()
ui_file = QFile(os.path.join(root, "res/config.ui"))
assert ui_file.open(QIODevice.OpenModeFlag.ReadOnly), "could not open settings UI"
form = loader.load(ui_file)
ui_file.close()
assert form is not None, loader.errorString()
layouts = "tile monocle threecolumn spiral quarter stacked columns spread floating stair binarytree cascade".split()
for name in layouts:
    button = form.findChild(QToolButton, name + "LayoutPictogram")
    assert button is not None, name
    assert not button.icon().isNull(), name
    image = button.icon().pixmap(48, 32).toImage()
    expected = QIcon(os.path.join(root, "res/layouts", name + ".svg")).pixmap(48, 32).toImage()
    assert not image.isNull() and image == expected, name
    assert any(image.pixelColor(x, y).alpha() > 0 for y in range(image.height()) for x in range(image.width())), name
    button.resize(56, 40)
    painted = button.grab().toImage()
    solid = next((image.pixelColor(x, y).rgb() for y in range(image.height()) for x in range(image.width()) if image.pixelColor(x, y).alpha() == 255), None)
    assert solid is not None, name
    assert any(painted.pixelColor(x, y).rgb() == solid for y in range(painted.height()) for x in range(painted.width())), name
form.deleteLater()
`;
    const result = spawnSync(PYTHON, ['-c', script, ROOT, dataHome], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, XDG_DATA_HOME: dataHome, QT_QPA_PLATFORM: 'offscreen' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});
