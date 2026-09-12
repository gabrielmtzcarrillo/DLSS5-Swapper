'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real IPC handlers and JSON persistence, with no Electron
// window or scanner. A new context represents a fresh app launch.
const mainPath = path.join(__dirname, '../main.js');
function launch(profile, scanGame) {
  const handlers = new Map();
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    __dirname: path.dirname(mainPath),
    require(name) {
      if (name === 'electron') return {
        app: {
          getPath(key) { assert.equal(key, 'userData'); return profile; },
          setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}
        },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }
      };
      if (name === './src/core/scan.js') return { scanGame };
      if (name === './src/shared/install-routes') return { routesFor: () => [] };
      if (name === './package.json') return { version: 'test' };
      if (name === './src/core/runtime-components.js') return require('../src/core/runtime-components');
      if (name.startsWith('./src/')) return {};
      return require(name);
    }
  }, { filename: mainPath });
  return (channel, ...args) => handlers.get(channel)(null, ...args);
}

test('dgVoodoo2 selection persists and rejects unknown versions without changing the saved choice', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-dgvoodoo-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  let call = launch(profile);
  assert.equal(call('settings').dgVoodooVersion, '2.87.3');
  assert.ok(call('settings').dgVoodooVersions.includes('2.87.3'));
  assert.equal(await call('set-dgvoodoo-version', '2.87.3'), '2.87.3');
  call = launch(profile);
  assert.equal(call('settings').dgVoodooVersion, '2.87.3');
  await assert.rejects(call('set-dgvoodoo-version', '../../unknown'), /Unsupported/);
  assert.equal(launch(profile)('settings').dgVoodooVersion, '2.87.3');
});

test('store categories default to enabled for new and existing profiles', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-grouping-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  let call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, true);
  assert.equal(call('settings').groupGamesByStore, true);
  fs.writeFileSync(path.join(profile, 'library.json'), JSON.stringify({ folders: [], theme: 'dark' }));
  call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, true);
  assert.equal(call('settings').groupGamesByStore, true);
});

test('category preference persists across launches without changing library or scanning settings', async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-grouping-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'library.json');
  const original = { folders: ['C:\\Games'], manual: ['C:\\DuckStation'], scans: { example: { ok: true } }, hidden: [], autoScanDrives: false, lang: 'ar', theme: 'dark' };
  fs.writeFileSync(file, JSON.stringify(original));
  let call = launch(profile);
  assert.equal(await call('set-group-games-by-store', false), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...original, groupGamesByStore: false });
  call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, false);
  assert.equal(call('settings').groupGamesByStore, false);
  assert.equal(await call('set-group-games-by-store', true), true);
  call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, true);
  assert.equal(call('settings').groupGamesByStore, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...original, groupGamesByStore: true });
});

// Deferred scanners reproduce the stale-snapshot window without timing sleeps.
test('overlapping scans retain both results and intervening settings with async persistence', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-scan-race-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'library.json');
  const original = { folders: [], manual: [], scans: { old: { ok: true } }, hidden: [], theme: 'dark', custom: { preserved: true } };
  fs.writeFileSync(file, JSON.stringify(original, null, 2));
  const pending = new Map();
  const call = launch(profile, dir => new Promise(resolve => pending.set(dir, resolve)));
  const first = call('scan', 'C:\\Games\\First');
  const second = call('scan', 'C:\\Games\\Second');
  const writeFile = fs.promises.writeFile;
  let releaseWrite, markWriting;
  const writing = new Promise(resolve => { markWriting = resolve; });
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    markWriting();
    await gate;
    return writeFile(...args);
  });
  const theme = call('set-theme', 'light');
  await writing;
  // Reads and other IPC remain available while disk persistence is pending.
  assert.equal(call('boot').theme, 'light');
  pending.get('C:\\Games\\Second')({ reshade: { installed: false } });
  pending.get('C:\\Games\\First')({ reshade: { installed: false } });
  releaseWrite();
  const [a, b] = await Promise.all([first, second, theme]);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = dir => require('crypto').createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
  assert.deepEqual(saved, { ...original, theme: 'light', scans: { ...original.scans,
    [key(a.dir)]: JSON.parse(JSON.stringify(a)), [key(b.dir)]: JSON.parse(JSON.stringify(b)) } });
  assert.equal(launch(profile)('boot').theme, 'light');
});

test('reset discards an outstanding scan and queued writes do not restore old settings', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-scan-reset-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  let finish;
  const call = launch(profile, () => new Promise(resolve => { finish = resolve; }));
  const scan = call('scan', 'C:\\Games\\Old');
  const theme = call('set-theme', 'light');
  await call('reset');
  finish({ reshade: { installed: false } });
  await Promise.all([scan, theme]);
  assert.equal(fs.existsSync(path.join(profile, 'library.json')), false);
  await call('set-lang', 'en');
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'library.json')));
  assert.deepEqual(saved.scans, {});
  assert.equal(saved.theme, undefined);
  assert.equal(saved.lang, 'en');
});
