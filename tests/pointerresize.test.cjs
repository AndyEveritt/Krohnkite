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

function transpile(...relativePaths) {
  return relativePaths
    .map(
      (relativePath) =>
        ts.transpileModule(
          fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
          { compilerOptions: { target: ts.ScriptTarget.ES2015 } },
        ).outputText,
    )
    .join('\n');
}

/* A KWinDriver with only what the pointer path touches. Timers are queued
 * instead of run so a test can flush them explicitly, and a layout pass is
 * never active until the test opens one. */
function setup(config = {}) {
  const env = {
    now: 10000,
    moves: 0,
    timers: [],
  };
  const context = vm.createContext({
    CONFIG: { movePointerOnResize: true, ...config },
    DBUS: { moveMouseToFocus: () => env.moves++ },
    LOG: undefined,
    getTime: () => env.now,
  });
  const driver = vm.runInContext(`${transpile('src/driver/kwindriver.ts')}\n(() => {
    const driver = Object.create(KWinDriver.prototype);
    driver._lastInteractiveMoveResize = 0;
    driver._pointerCenterRequested = false;
    driver._pointerCenterPending = false;
    driver._layoutPassActive = false;
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

test('a layout pass moves the pointer once after it settles', () => {
  const { driver, env } = setup();
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client());
  driver.onWindowSizeCommitted(client());
  driver.onWindowSizeCommitted(client());
  assert.equal(env.moves, 0);
  driver.onLayoutSettled();
  assert.equal(env.moves, 0);
  env.flush();
  assert.equal(env.moves, 1);
});

test('two passes inside the delay still move the pointer once', () => {
  const { driver, env } = setup();
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client());
  driver.onLayoutSettled();
  env.now += 10;
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client());
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 1);

  /* A pass after the queued move is a separate layout change. */
  env.now += 100;
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client());
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 2);
});

test('a size commit outside a layout pass moves the pointer once', () => {
  const { driver, env } = setup();
  /* A floating-window resize shortcut commits geometry and arranges nothing. */
  driver.onWindowSizeCommitted(client());
  env.flush();
  assert.equal(env.moves, 1);
});

test('the pointer stays put when the option is off or the window is not active', () => {
  const off = setup({ movePointerOnResize: false });
  off.driver.onLayoutStart();
  off.driver.onWindowSizeCommitted(client());
  off.driver.onLayoutSettled();
  off.env.flush();

  const inactive = setup();
  inactive.driver.onLayoutStart();
  inactive.driver.onWindowSizeCommitted(client({ active: false }));
  inactive.driver.onLayoutSettled();
  inactive.env.flush();

  const dragging = setup();
  dragging.driver.onLayoutStart();
  dragging.driver.onWindowSizeCommitted(client({ move: true }));
  dragging.driver.onWindowSizeCommitted(client({ resize: true }));
  dragging.driver.onLayoutSettled();
  dragging.env.flush();

  assert.equal(off.env.moves + inactive.env.moves + dragging.env.moves, 0);
});

test('mouse moves/resizes and their aftermath never move the pointer', () => {
  const { driver, env } = setup();
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client({ move: true }));
  driver.onWindowSizeCommitted(client({ resize: true }));
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 0);

  driver._lastInteractiveMoveResize = env.now;
  env.now += KWinDriverGrace(driver) - 1;
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client());
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 0);

  env.now += 1;
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(client());
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 1);
});

test('only size changes are reported when a window is committed', () => {
  const calls = [];
  const context = vm.createContext({
    CONFIG: {},
    LOG: undefined,
    KWINCONFIG: { preventProtrusion: false },
    getTime: () => 0,
    Qt: {
      rect: (x, y, width, height) => ({ x, y, width, height }),
    },
  });
  const { DriverWindow, Rect } = vm.runInContext(
    `${transpile(
      'src/util/rect.ts',
      'src/util/kwinutil.ts',
      'src/driver/kwinwindow.ts',
    )}
    ({ DriverWindow, Rect })`,
    context,
  );

  const window = {
    deleted: false,
    resize: false,
    frameGeometry: { x: 0, y: 0, width: 100, height: 50 },
  };
  const driverWindow = Object.create(DriverWindow.prototype);
  driverWindow.window = window;
  driverWindow.noBorderManaged = false;
  driverWindow.layerManaged = false;
  driverWindow._movePointerToCenter = { isMove: false, time: 0 };
  driverWindow.adjustGeometry = (geometry) => geometry;
  const ctx = { onWindowSizeCommitted: (client) => calls.push(client) };

  driverWindow.commit(ctx, new Rect(0, 0, 100, 50)); // move, same size
  driverWindow.commit(ctx, new Rect(10, 0, 100, 50)); // still the same size
  driverWindow.commit(ctx, new Rect(10, 0, 100, 60)); // taller

  assert.equal(calls.length, 1);
  assert.equal(calls[0], window);
});

function KWinDriverGrace(driver) {
  return driver.constructor.INTERACTIVE_POINTER_GRACE_MS;
}
