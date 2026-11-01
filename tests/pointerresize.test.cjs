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

function transpile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
  ).outputText;
}

/* A KWinDriver with only what the resize-pointer path touches. Timers are
 * queued instead of run so a test can flush them explicitly. */
function setup(config = {}) {
  const env = {
    now: 10000,
    moves: 0,
    timers: [],
  };
  const context = vm.createContext({
    CONFIG: { movePointerOnResize: true, floatSkipPager: false, ...config },
    DBUS: { moveMouseToFocus: () => env.moves++ },
    LOG: undefined,
    getTime: () => env.now,
  });
  const driver = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    driver._lastInteractiveMoveResize = 0;
    driver._centerPointerPending = false;
    return driver;
  })()`, context);
  driver.setTimeout = (func) => env.timers.push(func);
  env.flush = () => {
    for (const func of env.timers.splice(0)) func();
  };
  return { driver, env };
}

function client(props = {}) {
  return { active: true, move: false, resize: false, ...props };
}

test('a resize of the active window centers the pointer once the layout settles', () => {
  const { driver, env } = setup();
  driver._onWindowSizeChanged(client());
  assert.equal(env.moves, 0);
  env.flush();
  assert.equal(env.moves, 1);
});

test('several resizes from one arrange are coalesced into one pointer move', () => {
  const { driver, env } = setup();
  driver._onWindowSizeChanged(client());
  driver._onWindowSizeChanged(client());
  driver._onWindowSizeChanged(client());
  assert.equal(env.timers.length, 1);
  env.flush();
  assert.equal(env.moves, 1);
  driver._onWindowSizeChanged(client());
  env.flush();
  assert.equal(env.moves, 2);
});

test('the pointer stays put when the option is off or the window is not active', () => {
  const off = setup({ movePointerOnResize: false });
  off.driver._onWindowSizeChanged(client());
  const inactive = setup();
  inactive.driver._onWindowSizeChanged(client({ active: false }));
  assert.equal(off.env.timers.length + inactive.env.timers.length, 0);
});

test('mouse moves/resizes and their aftermath never move the pointer', () => {
  const { driver, env } = setup();
  driver._onWindowSizeChanged(client({ resize: true }));
  driver._onWindowSizeChanged(client({ move: true }));
  assert.equal(env.timers.length, 0);

  driver._lastInteractiveMoveResize = env.now;
  env.now += KWinDriverGrace(driver) - 1;
  driver._onWindowSizeChanged(client());
  assert.equal(env.timers.length, 0);

  env.now += 1;
  driver._onWindowSizeChanged(client());
  env.flush();
  assert.equal(env.moves, 1);
});

test('only size changes, not moves, reach the resize handler', () => {
  const { driver } = setup();
  const signals = new Map();
  driver._connect = (signal, callback) => signals.set(signal, callback);
  const sizes = [];
  driver._onWindowSizeChanged = (c) => sizes.push({ ...c.frameGeometry });
  const target = client({
    deleted: false,
    frameGeometry: { x: 0, y: 0, width: 100, height: 50 },
  });
  /* Every other signal _bindWindowEvents connects is a distinct dummy. */
  const kwinClient = new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : (t[prop] = { name: prop })),
  });
  driver._bindWindowEvents({}, kwinClient);
  const geometryChanged = signals.get(kwinClient.frameGeometryChanged);

  target.frameGeometry = { x: 40, y: 10, width: 100, height: 50 };
  geometryChanged();
  target.frameGeometry = { x: 40, y: 10, width: 120, height: 50 };
  geometryChanged();
  geometryChanged();
  target.frameGeometry = { x: 0, y: 0, width: 120, height: 60 };
  geometryChanged();

  assert.deepEqual(sizes.map(({ width, height }) => [width, height]), [
    [120, 50],
    [120, 60],
  ]);
});

function KWinDriverGrace(driver) {
  return driver.constructor.INTERACTIVE_POINTER_GRACE_MS;
}
