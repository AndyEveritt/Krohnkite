const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'tools/reload-script.py');
const fixtures = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(responses = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'krohnkite reload tests '));
  fixtures.push(directory);
  const pkg = path.join(directory, 'package');
  const files = {
    'metadata.json': '{}',
    'contents/ui/main.qml': 'import "../code/script.js" as K',
    'contents/code/script.js': '// fresh JavaScript',
    'contents/ui/popup.qml': '// fresh popup',
    'contents/ui/layouts/tile.svg': '<svg/>',
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(pkg, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }

  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'qdbus6');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const log = process.env.QDBUS_LOG;
const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
calls.push(process.argv.slice(2));
fs.writeFileSync(log, JSON.stringify(calls));
const queue = JSON.parse(fs.readFileSync(process.env.QDBUS_RESPONSES, 'utf8'));
const response = queue.shift();
fs.writeFileSync(process.env.QDBUS_RESPONSES, JSON.stringify(queue));
if (!response) process.exit(90);
if (response.error) { process.stderr.write(response.error); process.exit(response.code || 1); }
process.stdout.write(response.stdout || '');
`);
  fs.chmodSync(fake, 0o755);
  const responsesFile = path.join(directory, 'responses.json');
  const logFile = path.join(directory, 'calls.json');
  fs.writeFileSync(responsesFile, JSON.stringify(responses.map((response) =>
    typeof response === 'string' ? { stdout: response } : response)));
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    XDG_CACHE_HOME: path.join(directory, 'xdg-cache'),
    QDBUS_RESPONSES: responsesFile,
    QDBUS_LOG: logFile,
    HOME: directory,
  };
  return {
    directory, pkg, files, env, logFile,
    calls: () => fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [],
    run: (args = []) => spawnSync('python3', [helper, pkg, ...args], { cwd: directory, env, encoding: 'utf8' }),
    responsesFile,
  };
}

const output = (stdout) => ({ stdout });
const error = (stderr, code = 1) => ({ error: stderr, code });
const command = (method, ...args) => ['org.kde.KWin', '/Scripting', `org.kde.kwin.Scripting.${method}`, ...args];
const success = ['false', '42', '', 'true'];

test('stages every dependency at unique paths', () => {
  const f = fixture([...success, ...success]);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  const mains = f.calls().filter((args) => args[2].endsWith('.loadDeclarativeScript')).map((args) => args[3]);
  assert.equal(mains.length, 2);
  assert.notEqual(mains[0], mains[1]);
  for (const main of mains) {
    const bundle = path.resolve(path.dirname(main), '../..');
    for (const [relative, content] of Object.entries(f.files)) assert.equal(fs.readFileSync(path.join(bundle, relative), 'utf8'), content);
    assert.equal(fs.readFileSync(path.resolve(path.dirname(main), '../code/script.js'), 'utf8'), '// fresh JavaScript');
  }
});

test('missing package rejected before staging', () => {
  const f = fixture();
  fs.rmSync(f.pkg, { recursive: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing .*contents\/ui\/main.qml/);
  assert.equal(fs.existsSync(f.env.XDG_CACHE_HOME), false);
  assert.deepEqual(f.calls(), []);
});

test('uses exact qdbus6 argv and safe subprocess capture', () => {
  const f = fixture([output('false'), output('42'), output(''), output('true')]);
  assert.equal(f.run().status, 0);
  const calls = f.calls();
  assert.deepEqual(calls[0], command('isScriptLoaded', 'krohnkite'));
  assert.deepEqual(calls[1].slice(0, 3), command('loadDeclarativeScript').slice(0, 3));
  assert.match(calls[1][3], /\/reload-[^/]+\/contents\/ui\/main\.qml$/);
  assert.equal(calls[1][4], 'krohnkite');
  assert.deepEqual(calls.slice(2), [command('start'), command('isScriptLoaded', 'krohnkite')]);
});

test('loaded script unloads, loads and starts in order with paths containing spaces', () => {
  const f = fixture([output('true'), output('true'), output('12'), output(''), output('true')]);
  assert.equal(f.run().status, 0);
  const calls = f.calls();
  assert.deepEqual(calls.map((args) => args[2].split('.').at(-1)), ['isScriptLoaded', 'unloadScript', 'loadDeclarativeScript', 'start', 'isScriptLoaded']);
  assert.match(calls[2][3], /krohnkite reload tests/);
  assert.equal(calls[2][4], 'krohnkite');
});

test('unloaded script skips unload', () => {
  const f = fixture(success);
  assert.equal(f.run().status, 0);
  assert.equal(f.calls().some((args) => args[2].endsWith('.unloadScript')), false);
});

test('failed unload never loads replacement', () => {
  const f = fixture([output('true'), output('false')]);
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls().length, 2);
});

test('rejected load does not start', () => {
  const f = fixture([output('false'), output('-1')]);
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls().length, 2);
});

test('failed start is reported', () => {
  const f = fixture([output('false'), output('1'), error('start unavailable')]);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /start unavailable/);
});

test('successful reload atomically records bundle for future recovery', () => {
  const f = fixture(success);
  assert.equal(f.run().status, 0);
  const marker = path.join(f.env.XDG_CACHE_HOME, 'krohnkite/last-good-main-qml');
  const main = f.calls()[1][3];
  assert.equal(fs.readFileSync(marker, 'utf8'), main);
  assert.deepEqual(fs.readdirSync(path.dirname(marker)).filter((name) => name.startsWith('last-good-main-qml.tmp-')), []);
});

test('rejected replacement recovers using last-good bundle', () => {
  const f = fixture([output('true'), output('true'), output('-1'), output('31'), output(''), output('true')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Recovered using prior bundle/);
  assert.equal(f.calls()[3][3], previous);
});

test('DBus exception reports primary and recovery failure', () => {
  const f = fixture([output('true'), output('true'), error('DBus unavailable'), output('22'), error('recovery start failed')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DBus unavailable/);
  assert.match(result.stderr, /Recovery from/);
  assert.match(result.stderr, /recovery start failed/);
});

test('start failure recovers last-good bundle', () => {
  const f = fixture([output('true'), output('true'), output('12'), output(''), output('false'), output('13'), output(''), output('true')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  const previous = path.join(cache, 'previous/contents/ui/main.qml');
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  fs.writeFileSync(previous, 'prior');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  assert.match(f.run().stderr, /Recovered using prior bundle/);
  assert.equal(f.calls()[5][3], previous);
});

test('first reload and missing recovery bundle report limitation', () => {
  const f = fixture([output('true'), output('true'), output('-1')]);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No known prior working bundle/);
  assert.equal(f.calls().length, 3);
});

test('initially disabled script is not recovered after failure', () => {
  const f = fixture([output('false'), output('-1')]);
  const cache = path.join(f.env.XDG_CACHE_HOME, 'krohnkite');
  fs.mkdirSync(cache, { recursive: true });
  const previous = path.join(cache, 'previous.qml');
  fs.writeFileSync(previous, 'prior');
  fs.writeFileSync(path.join(cache, 'last-good-main-qml'), previous);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(f.calls().length, 2);
  assert.match(result.stderr, /refused to load/);
});
