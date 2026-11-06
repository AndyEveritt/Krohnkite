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
    driver._pointerRequest = null;
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

/* Minimal WindowClass/controller surface the signal handlers reach for. */
function withController(driver) {
  driver.control = {
    onWindowResizeStart() {},
    onWindowResizeOver() {},
    onWindowMoveStart() {},
    onWindowMoveOver() {},
    onWindowDragging() {},
  };
  return driver;
}

function client(props = {}) {
  return { active: true, move: false, resize: false, ...props };
}

/* Fabricates distinct signal objects for every property the driver binds, so
 * _bindWindowEvents can be exercised without a KWin connection. */
function kwinClient(props = {}) {
  const target = client({ deleted: false, activities: [], ...props });
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : (t[prop] = { name: prop })),
  });
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

test('a mouse resize suppresses the pointer move during the grace period', () => {
  const { driver, env } = setup();
  const target = kwinClient({
    frameGeometry: { x: 0, y: 0, width: 100, height: 50 },
  });
  const signals = new Map();
  driver._connect = (signal, callback) => signals.set(signal, callback);
  withController(driver)._bindWindowEvents({}, target);

  /* The user grabs the border: the window signals must stamp the grace. */
  target.resize = true;
  signals.get(target.moveResizedChanged)();

  driver.onLayoutStart();
  driver.onWindowSizeCommitted(target);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 0);

  env.now += KWinDriverGrace(driver) - 1;
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(target);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 0);

  /* Release restarts the grace, so the drop re-tile right after it is the
   * resize's aftermath and must not move the pointer either. */
  target.resize = false;
  signals.get(target.moveResizedChanged)();
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(target);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 0);

  env.now += KWinDriverGrace(driver);
  driver.onLayoutStart();
  driver.onWindowSizeCommitted(target);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 1);
});

test('stepping a mouse move suppresses the pointer move', () => {
  const { driver, env } = setup();
  const target = kwinClient({
    frameGeometry: { x: 0, y: 0, width: 100, height: 50 },
  });
  const signals = new Map();
  driver._connect = (signal, callback) => signals.set(signal, callback);
  withController(driver)._bindWindowEvents({}, target);

  /* KWin can clear the move flag before the pass that follows the last step,
   * so the step itself has to arm the grace. */
  target.move = true;
  signals.get(target.interactiveMoveResizeStepped)({
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  });
  target.move = false;

  driver.onLayoutStart();
  driver.onWindowSizeCommitted(target);
  driver.onLayoutSettled();
  env.flush();
  assert.equal(env.moves, 0);
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
