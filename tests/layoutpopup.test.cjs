/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(ROOT, 'res/popup.qml'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'res/main.qml'), 'utf8');

const LAYOUTS = {
  TileLayout: { name: 'Tile', icon: 'tile' },
  MonocleLayout: { name: 'Monocle', icon: 'monocle' },
  ThreeColumnLayout: { name: 'Three Column', icon: 'threecolumn' },
  SpiralLayout: { name: 'Spiral', icon: 'spiral' },
  QuarterLayout: { name: 'Quarter', icon: 'quarter' },
  StackedLayout: { name: 'Stacked', icon: 'stacked' },
  ColumnsLayout: { name: 'Columns', icon: 'columns' },
  SpreadLayout: { name: 'Spread', icon: 'spread' },
  FloatingLayout: { name: 'Floating', icon: 'floating' },
  StairLayout: { name: 'Stair', icon: 'stair' },
  BinaryTreeLayout: { name: 'Binary Tree', icon: 'binarytree' },
  CascadeLayout: { name: 'Cascade', icon: 'cascade' },
};

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
}

test('layout changes show the layout shortcut popup instead of a text notification', () => {
  const context = vm.createContext({});
  const calls = vm.runInContext(`${transpile('src/engine/engine.ts')}\n(() => {
    const engine = Object.create(TilingEngine.prototype);
    const calls = [];
    engine.layouts = {
      cycleLayout: () => ({ classID: 'MonocleLayout', description: 'Monocle' }),
      setLayout: (_surface, id) => ({ classID: id, description: id }),
    };
    const ctx = {
      currentSurface: {},
      showNotification: text => calls.push(['notification', text]),
      showLayoutShortcut: id => calls.push(['layoutShortcut', id]),
    };
    engine.cycleLayout(ctx, 1);
    engine.setLayout(ctx, 'SpiralLayout');
    return calls;
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['layoutShortcut', 'MonocleLayout'],
    ['layoutShortcut', 'SpiralLayout'],
  ]);
});

test('driver maps every layout id to its icon and honors notification duration', () => {
  const context = vm.createContext({
    CONFIG: { notificationDuration: 1000 },
    popupDialog: { showLayoutShortcut: () => {} },
  });
  const calls = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const calls = [];
    popupDialog.showLayoutShortcut = (entry, duration) => calls.push([entry, duration]);
    const driver = Object.create(KWinDriver.prototype);
    for (const id of ${JSON.stringify(Object.keys(LAYOUTS))}) {
      driver.showLayoutShortcut(id);
    }
    driver.showLayoutShortcut('UnknownLayout');
    CONFIG.notificationDuration = 0;
    driver.showLayoutShortcut('TileLayout');
    return calls;
  })()`, context);
  const expected = Object.entries(LAYOUTS).map(([id, entry]) => [
    { id, name: entry.name, icon: entry.icon },
    1000,
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), expected);
});

test('every layout popup icon exists in the package sources', () => {
  for (const { icon } of Object.values(LAYOUTS)) {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'res/layouts', `${icon}.svg`)),
      `${icon}.svg exists`,
    );
  }
});

test('popup keeps an empty icon source until a layout shortcut is shown', () => {
  assert.match(popup, /property string layoutIcon: ""/);
  const sourceExpression = popup.match(
    /source: (popupDialog\.layoutIcon === "" \? "" : Qt\.resolvedUrl\([^\n]+\))/,
  );
  assert.ok(sourceExpression);
  const requests = [];
  const sourceFor = icon => vm.runInNewContext(sourceExpression[1], {
    popupDialog: { layoutIcon: icon },
    Qt: { resolvedUrl: url => { requests.push(url); return url; } },
  });
  assert.equal(sourceFor(''), '');
  assert.deepEqual(requests, []);
  assert.equal(sourceFor('monocle'), 'layouts/monocle.svg');
  assert.deepEqual(requests, ['layouts/monocle.svg']);
});

test('popup sets the shortcut icon and name, and text notifications clear the icon', () => {
  const layoutShortcut = popup.match(
    /function showLayoutShortcut\(entry, area, duration\) \{[\s\S]*?\n {4}\}/,
  );
  assert.ok(layoutShortcut);
  assert.match(layoutShortcut[0], /layoutIcon = entry\.icon;/);
  assert.match(layoutShortcut[0], /messageLabel\.text = entry\.name;/);

  const notification = popup.match(
    /function show\(text, area, duration\) \{[\s\S]*?\n {4}\}/,
  );
  assert.ok(notification);
  assert.match(notification[0], /layoutIcon = "";/);
  assert.match(notification[0], /messageLabel\.text = text;/);
});

test('main.qml forwards layout shortcuts to the popup loader', () => {
  assert.match(
    main,
    /function showLayoutShortcut\(entry, duration\) \{[\s\S]*?if \(!this\.item\) return;[\s\S]*?this\.item\.showLayoutShortcut\(entry, area, duration\);/,
  );
});
