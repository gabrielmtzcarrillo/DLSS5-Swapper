'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePe } = require('./fixtures/pe');

test('multi-frame generation upgrades an existing DLSS-G runtime and restores it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-mfg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameDir = path.join(root, 'Game');
  const payloadDir = path.join(root, 'Payload');
  const exePath = path.join(gameDir, 'game.exe');
  const fgPath = path.join(gameDir, 'nvngx_dlssg.dll');
  const sourceMfg = path.join(payloadDir, 'RTXMFG.dll');
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(exePath, 'game');
  fs.writeFileSync(fgPath, 'original multi-frame runtime');
  writePe(sourceMfg, { text: 'new multi-frame unlock' });

  const scanPath = require.resolve('../src/core/scan');
  const applyPath = require.resolve('../src/core/apply');
  const originalScan = require.cache[scanPath];
  t.after(() => {
    delete require.cache[applyPath];
    if (originalScan) require.cache[scanPath] = originalScan;
    else delete require.cache[scanPath];
  });
  require.cache[scanPath] = {
    id: scanPath, filename: scanPath, loaded: true,
    exports: {
      inspectReShade: () => ({ installed: false, file: null, kind: null, version: null, addonSupport: false }),
      scanGame: async () => ({
        dlssFiles: [{ path: fgPath, rel: 'nvngx_dlssg.dll', name: 'nvngx_dlssg.dll', bitness: 64, version: '1.0.0' }],
        streamlineFiles: [],
        reshade: { installed: false, file: null, kind: null, version: null, addonSupport: false }
      })
    }
  };

  const { applySwap, restore } = require('../src/core/apply');
  await applySwap({
    gameDir, exePath, api: 'dxgi', bitness: 64, route: 'native',
    source: { hasNeuralRendering: true, addon: null, payload: [] },
    mfgRoot: payloadDir, multiFrameGeneration: true, installReShade: false, addMissingDlss: false
  });
  assert.deepEqual(fs.readFileSync(path.join(gameDir, 'version.dll')), fs.readFileSync(sourceMfg));
  await restore(gameDir);
  assert.equal(fs.readFileSync(fgPath, 'utf8'), 'original multi-frame runtime');
});
