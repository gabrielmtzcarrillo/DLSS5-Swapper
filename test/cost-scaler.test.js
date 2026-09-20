'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cost = require('../src/core/dlssnr-cost-scaler');
const routes = require('../src/shared/install-routes');
const ini = require('../src/core/feeder-config');
const apply = require('../src/core/apply');
const { writePe } = require('./fixtures/pe');

function payload(root) {
  writePe(path.join(root, 'nvngx_dlssnr.dll'), { text: 'cost scaler proxy' });
  writePe(path.join(root, 'dlssnr-companion.addon64'), { text: 'cost scaler companion' });
  fs.writeFileSync(path.join(root, 'nvngx_dlssnr.ini'), '[DLSSNR_Proxy]\nResolutionScale=0.80\n');
  fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT');
  fs.writeFileSync(path.join(root, 'README.md'), 'DLSSNR-Cost-Scaler');
}

test('DLSSNR Cost Scaler is a separate DX12-native-DLSS route', () => {
  const target = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', hasNativeDlss: true };
  assert.deepEqual(routes.routesFor(target), ['native', 'feeder', 'optiscaler', 'optiscaler-multipass', 'optiscaler-fsr', 'optiscaler-fsr-hybrid', 'cost-scaler']);
  assert.equal(routes.costScalerReason(target), null);
  for (const delta of [
    { bitness: 32 },
    { hasNativeDlss: false },
    { emulator: { key: 'xenia' } },
    { apiLabel: 'DirectX 11' },
    { api: 'vulkan' },
    { api: 'opengl' }
  ]) {
    assert.equal(routes.routesFor({ ...target, ...delta }).includes('cost-scaler'), false);
  }
});

test('DLSSNR Cost Scaler payload validation and config defaults', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-scaler-payload-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  payload(root);

  assert.doesNotThrow(() => cost.validatePayload(root));
  const configured = cost.configure('[DLSSNR_Proxy]\nResolutionScale=0.85\n[Governor]\nTargetFps=90\n');
  assert.equal(ini.getIni(configured, 'DLSSNR_Proxy', 'EnableProxy'), '1');
  assert.equal(ini.getIni(configured, 'DLSSNR_Proxy', 'ResolutionScale'), '0.85');
  assert.equal(ini.getIni(configured, 'DLSSNR_Proxy', 'EnlargementMode'), '1');
  assert.equal(ini.getIni(configured, 'DLSSNR_Settings', 'UseCustomSettings'), '0');
  assert.equal(ini.getIni(configured, 'Governor', 'TargetFps'), '90');
  assert.equal(ini.getIni(configured, 'Governor', 'EnableGovernor'), '0');
});

test('DLSSNR Cost Scaler install preserves real NR runtime behind the proxy', async t => {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-scaler-game-'));
  const costRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-scaler-root-'));
  t.after(() => {
    fs.rmSync(gameDir, { recursive: true, force: true });
    fs.rmSync(costRoot, { recursive: true, force: true });
  });
  payload(costRoot);
  const exePath = writePe(path.join(gameDir, 'Game.exe'));
  writePe(path.join(gameDir, 'nvngx_dlssnr.dll'), { text: 'real nvidia nr' });
  fs.writeFileSync(path.join(gameDir, 'ReShade.ini'), '[GENERAL]\n');
  const manifest = apply.beginManifest(gameDir, exePath, 'dxgi');

  await cost.install({
    gameDir,
    exePath,
    costScalerRoot: costRoot,
    source: { payload: [] }
  }, manifest, () => {});

  assert.match(fs.readFileSync(path.join(gameDir, 'nvngx_dlssnr_real.dll'), 'utf8'), /real nvidia nr/);
  assert.match(fs.readFileSync(path.join(gameDir, 'nvngx_dlssnr.dll'), 'utf8'), /cost scaler proxy/);
  assert.equal(fs.existsSync(path.join(gameDir, 'dlssnr-companion.addon64')), true);
  assert.equal(ini.getIni(fs.readFileSync(path.join(gameDir, 'nvngx_dlssnr.ini'), 'utf8'), 'DLSSNR_Proxy', 'ResolutionScale'), '0.80');

  const saved = JSON.parse(fs.readFileSync(path.join(gameDir, '_DLSS5_Backup', 'manifest.json'), 'utf8'));
  assert.equal(saved.route, 'cost-scaler');
  assert.equal(saved.costScaler.version, cost.RELEASE.version);
  assert.ok(saved.added.includes('nvngx_dlssnr_real.dll'));
});
