'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function launch() {
  const windows = new Set();
  let ready, mainWindow, cleanupCount = 0, exited = false;
  const app = Object.assign(new EventEmitter(), {
    setAppUserModelId() {}, getPath: () => 'test-profile', getVersion: () => 'test',
    whenReady: () => ({ then(callback) { ready = callback; } }),
    quit() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      app.emit('before-quit', event);
      if (event.prevented) return;
      for (const window of [...windows]) window.close();
      exited = true;
    }
  });
  class Window extends EventEmitter {
    constructor() { super(); windows.add(this); mainWindow = this; }
    loadFile() {}
    close() { if (windows.delete(this)) this.emit('closed'); }
  }
  const filename = path.resolve(__dirname, '../main.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    __dirname: path.dirname(filename),
    require(name) {
      if (name === 'electron') return { app, BrowserWindow: Window, ipcMain: { handle() {} } };
      if (name === './src/overlay-ipc') return () => {};
      if (name === './src/overlay-service') return () => ({
        start() { windows.add(overlay); },
        close() { cleanupCount++; overlay.close(); }
      });
      if (name.startsWith('./src/')) return {};
      return require(name);
    }
  }, { filename });
  const overlay = { close() { windows.delete(overlay); } };
  return { app, ready: () => ready(), closeMain: () => mainWindow.close(),
    windows, get cleanupCount() { return cleanupCount; }, get exited() { return exited; } };
}

test('closing the main window quits even with a hidden overlay window open', async () => {
  const app = launch();
  await app.ready();
  assert.equal(app.windows.size, 2);
  app.closeMain();
  await new Promise(setImmediate);
  assert.equal(app.cleanupCount, 1);
  assert.equal(app.windows.size, 0);
  assert.equal(app.exited, true);
});

test('application quit closes the main window without reentering shutdown', async () => {
  const app = launch();
  await app.ready();
  app.app.quit();
  await new Promise(setImmediate);
  assert.equal(app.cleanupCount, 1);
  assert.equal(app.windows.size, 0);
  assert.equal(app.exited, true);
});
