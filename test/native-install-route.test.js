'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writePe } = require('./fixtures/pe');

test('native install keeps the selected RenoDX v2.5 consumer and optional MFG hook restorable', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-native-route-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameDir = path.join(root, 'Game');
  const payloadDir = path.join(root, 'Payload');
  const exePath = path.join(gameDir, 'game.exe');
  const frameGeneration = path.join(gameDir, 'nvngx_dlssg.dll');
  const addon = path.join(payloadDir, 'renodx-dlss5-v2.5.addon64');
  const mfg = path.join(payloadDir, 'RTXMFG.dll');
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.writeFileSync(exePath, 'game');
  fs.writeFileSync(frameGeneration, 'original frame-generation runtime');
  writePe(addon, { text: 'RenoDX v2.5' });
  writePe(mfg, { text: 'RTX multi-frame generation' });

  const scanPath = require.resolve('../src/core/scan');
  const applyPath = require.resolve('../src/core/apply');
  const originalScan = require.cache[scanPath];
  delete require.cache[applyPath];
  require.cache[scanPath] = {
    id: scanPath, filename: scanPath, loaded: true,
    exports: {
      inspectReShade: () => ({ installed: false, file: null, kind: null, version: null, addonSupport: false }),
      scanGame: async () => ({
        dlssFiles: [{ path: frameGeneration, rel: 'nvngx_dlssg.dll', name: 'nvngx_dlssg.dll', bitness: 64, version: '1.0.0' }],
        streamlineFiles: [],
        reshade: { installed: false, file: null, kind: null, version: null, addonSupport: false }
      })
    }
  };
  t.after(() => {
    delete require.cache[applyPath];
    if (originalScan) require.cache[scanPath] = originalScan;
    else delete require.cache[scanPath];
  });

  const { applySwap, restore } = require('../src/core/apply');
  await applySwap({
    gameDir, exePath, api: 'dxgi', bitness: 64, route: 'native',
    source: { hasNeuralRendering: true, addon, payload: [] },
    mfgRoot: payloadDir, multiFrameGeneration: true, installReShade: false, addMissingDlss: false
  });

  assert.ok(fs.readFileSync(path.join(gameDir, 'renodx-dlss5-v2.5.addon64')).includes(Buffer.from('RenoDX v2.5')));
  assert.ok(fs.readFileSync(path.join(gameDir, 'version.dll')).includes(Buffer.from('RTX multi-frame generation')));
  await restore(gameDir);
  assert.equal(fs.readFileSync(frameGeneration, 'utf8'), 'original frame-generation runtime');
  assert.equal(fs.existsSync(path.join(gameDir, 'renodx-dlss5-v2.5.addon64')), false);
  assert.equal(fs.existsSync(path.join(gameDir, 'version.dll')), false);
});
