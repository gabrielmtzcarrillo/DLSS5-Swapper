'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

function harness(t, options = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-bridge-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const endpoint = path.join(userData, 'overlay-bridge.endpoint');
  const ipcMain = new EventEmitter(), events = new EventEmitter();
  let win, server;
  class Window extends EventEmitter {
    constructor() {
      super(); win = this; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {}, setFrameRate() { if (options.configureError) throw Error('Offscreen unavailable'); }, send() {}, enableDeviceEmulation() {},
        executeJavaScript: async () => options.height ?? 300,
        invalidate() {
          assert.equal(fs.existsSync(endpoint), false, 'endpoint must not precede a frame');
          if (!options.noFrame) this.emit('paint', {}, {}, {
            getSize: () => ({ width: 534, height: 300 }), toBitmap: () => Buffer.alloc(534 * 300 * 4)
          });
        }
      });
    }
    async loadFile() { if (options.loadError) throw Error('panel missing'); if (options.hang) await new Promise(() => {}); }
    setContentSize() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const filename = path.resolve(__dirname, '../src/overlay-bridge.js');
  const realRequire = createRequire(filename);
  const stubs = {
    electron: { ipcMain },
    './overlay-preferences': { events, read: () => { if (options.preferencesError) throw Error('Invalid settings'); return {}; } },
    'node:net': { createServer() {
      server = Object.assign(new EventEmitter(), {
        listen(_name, done) {
          assert.equal(fs.existsSync(endpoint), false);
          if (options.listenError) this.emit('error', Object.assign(Error('Access denied'), { code: 'EACCES' }));
          else done();
        }, close() { this.closed = true; }
      });
      return server;
    } }
  };
  const context = { module: { exports: {} }, require: name => stubs[name] || realRequire(name), __dirname: path.dirname(filename), Buffer, console, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  return { userData, endpoint, ipcMain, events, get win() { return win; }, get server() { return server; },
    start: extra => context.module.exports({ BrowserWindow: Window, userData, startupTimeoutMs: 30, ...extra }) };
}

for (const [name, options, stage] of [
  ['window configuration', { configureError: true }, 'configure-window'],
  ['missing panel', { loadError: true }, 'load-panel'],
  ['invalid preferences', { preferencesError: true }, 'preferences'],
  ['invalid height', { height: NaN }, 'measure-panel'],
  ['no first frame', { noFrame: true }, 'first-frame'],
  ['hung load', { hang: true }, 'load-panel'],
  ['pipe denied', { listenError: true }, 'listen-pipe']
]) test(`failed bridge: ${name} cleans up without publishing readiness`, async t => {
  const h = harness(t, options);
  await assert.rejects(h.start(), error => error.stage === stage && error.endpoint === h.endpoint);
  assert.equal(fs.existsSync(h.endpoint), false);
  assert.equal(h.win.destroyed, true);
  assert.equal(h.ipcMain.listenerCount('lab-overlay-control'), 0);
  assert.equal(h.ipcMain.listenerCount('lab-overlay-resize'), 0);
  assert.equal(h.events.listenerCount('change'), 0);
  if (h.server) assert.equal(h.server.closed, true);
});

test('ready bridge publishes only after a frame; renderer loss revokes it and reports once', async t => {
  const h = harness(t), errors = [];
  const bridge = await h.start({ onFailure: error => errors.push(error) });
  assert.ok(bridge.getFrame());
  assert.match(fs.readFileSync(h.endpoint, 'utf8'), /^[0-9a-f]{32}$/);
  h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 7 });
  h.server.emit('error', Error('later error'));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /running.*crashed.*7/);
  assert.equal(fs.existsSync(h.endpoint), false);
  assert.equal(h.server.closed, true);
  bridge.close();
});

test('close preserves an endpoint owned by another attempt', async t => {
  const h = harness(t), bridge = await h.start();
  fs.writeFileSync(h.endpoint, 'another-token');
  bridge.close();
  assert.equal(fs.readFileSync(h.endpoint, 'utf8'), 'another-token');
});

test('renderer failure during a hung load rejects immediately and cannot publish later', async t => {
  const h = harness(t, { hang: true });
  const pending = h.start();
  h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
  await assert.rejects(pending, /load-panel.*crashed/);
  assert.equal(fs.existsSync(h.endpoint), false);
  assert.equal(h.win.destroyed, true);
});

test('runtime pipe failure cleans up and reports transport diagnostics', async t => {
  const h = harness(t), errors = [];
  await h.start({ onFailure: error => errors.push(error) });
  h.server.emit('error', Object.assign(Error('transport lost'), { code: 'EPIPE' }));
  assert.equal(errors[0].code, 'EPIPE');
  assert.equal(h.win.destroyed, true);
  assert.equal(fs.existsSync(h.endpoint), false);
});

test('runtime failure offers recovery and repeated start never duplicates a healthy bridge', async t => {
  const h = harness(t), createService = require('../src/overlay-service');
  let fail, attempts = 0, prompts = 0, closed = 0;
  const service = createService({ userData: h.userData, log() {},
    startBridge: async ({ onFailure }) => { fail = onFailure; attempts++; return { close() { closed++; } }; },
    showError: async () => { prompts++; return true; }
  });
  await service.start(); await service.start(); assert.equal(attempts, 1);
  fail(Error('renderer lost'));
  await new Promise(resolve => setImmediate(resolve));
  await service.start();
  assert.equal(attempts, 2); assert.equal(prompts, 1); assert.equal(closed, 1);
  service.close();
});

test('recovery saves diagnostics, retries explicitly and closes the replacement', async t => {
  const h = harness(t);
  const createService = require('../src/overlay-service');
  let attempts = 0, closed = 0, prompts = 0;
  const service = createService({ userData: h.userData, version: '2.2.1', log() {},
    startBridge: async () => { if (++attempts === 1) throw Object.assign(Error('pipe failed'), { stage: 'listen-pipe', code: 'EACCES' }); return { close() { closed++; } }; },
    showError: async detail => { prompts++; assert.match(detail, /EACCES/); return true; }
  });
  await Promise.all([service.start(), service.start()]);
  assert.equal(attempts, 2); assert.equal(prompts, 1);
  const diagnostic = JSON.parse(fs.readFileSync(path.join(h.userData, 'overlay-bridge-error.json')));
  assert.equal(diagnostic.stage, 'listen-pipe'); assert.equal(diagnostic.version, '2.2.1');
  service.close(); assert.equal(closed, 1);
});

test('dismissal does not loop and shutdown during startup closes the late bridge', async t => {
  const h = harness(t), createService = require('../src/overlay-service');
  let attempts = 0;
  const dismissed = createService({ userData: h.userData, log() {}, startBridge: async () => { attempts++; throw Error('failed'); }, showError: async () => false });
  await dismissed.start(); assert.equal(attempts, 1); dismissed.close();
  let resolve, closed = 0;
  const service = createService({ userData: h.userData, log() {}, startBridge: () => new Promise(r => { resolve = r; }), showError: () => assert.fail('no prompt after shutdown') });
  const pending = service.start(); service.close(); resolve({ close() { closed++; } });
  await pending; assert.equal(closed, 1);
});
