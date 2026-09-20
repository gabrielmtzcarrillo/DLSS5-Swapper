'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const presets = require('../src/core/game-presets');
const core = require('../src/core/apply');
const manager = require('../src/core/backend-manager');
const ini = require('../src/core/feeder-config');

function writeManifest(gameDir, manifest) {
  const file = path.join(core.backupRoot(gameDir), 'manifest.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

function profileFile(gameDir, exePath, api, route) {
  const id = crypto.createHash('sha256')
    .update(`${path.relative(gameDir, exePath).toLowerCase()}|${api}`).digest('hex').slice(0, 24);
  return path.join(gameDir, '_DLSS5_Backup', '.profiles', `${id}-${route}.json`);
}

function game(t, { configAdded = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-preset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'Dragon Age The Veilguard.exe');
  fs.writeFileSync(exe, 'exe');
  fs.writeFileSync(path.join(dir, 'OptiScaler.ini'), '[DlssNr]\nEnabled=false\nPasses=2\n');
  const manifest = {
    version: 1,
    backupPrefix: 'originals/11111111-1111-4111-8111-111111111111',
    date: '2026-09-18T04:57:58.788Z',
    game: { dir, exe: path.basename(exe), api: 'dxgi', bitness: 64, apiLabel: 'DirectX 12' },
    replaced: configAdded ? [] : [{ rel: 'OptiScaler.ini', kind: 'config' }],
    added: configAdded ? ['OptiScaler.ini', 'dxgi.dll', 'nvngx_dlssnr.dll'] : ['dxgi.dll', 'nvngx_dlssnr.dll'],
    addedDirs: [],
    reshade: { installedByUs: false, file: null, filesAdded: [] },
    route: 'optiscaler-multipass',
    optiscaler: { version: '0.8.3-multipass', family: 'presr-multipass', hook: 'dxgi.dll' }
  };
  if (!configAdded) {
    const original = core.originalPath(dir, manifest, 'OptiScaler.ini');
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, '[DlssNr]\nEnabled=false\nPasses=3\n');
  }
  writeManifest(dir, manifest);
  return { dir, exe, manifest };
}

test('Dragon Age preset is offered only for the verified multipass install', (t) => {
  const { manifest } = game(t);
  const available = presets.availability('1845910', manifest);
  assert.equal(available.available, true);
  assert.equal(available.route, 'optiscaler-multipass');
  assert.equal(presets.availability('123', manifest), null);
  assert.equal(presets.availability('1845910', { ...manifest, route: 'optiscaler' }).available, false);
  assert.equal(presets.availability('1845910', { ...manifest, optiscaler: { family: 'dlss-unlocked' } }).available, false);
});

test('applying the Dragon Age preset writes the verified config and saves the current profile first', async (t) => {
  const { dir, exe } = game(t);
  const before = fs.readFileSync(path.join(dir, 'OptiScaler.ini'), 'utf8');

  const manifest = await presets.apply(dir, '1845910');

  assert.equal(manifest.gamePreset.id, 'dragon-age-veilguard-optiscaler-multipass');
  const applied = fs.readFileSync(path.join(dir, 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(applied, 'Upscalers', 'Dx12Upscaler'), 'ffx');
  assert.equal(ini.getIni(applied, 'DlssNr', 'RunBeforeSR'), 'true');
  assert.equal(ini.getIni(applied, 'ProcessFilter', 'TargetProcessName'), 'Dragon Age The Veilguard.exe');
  const profile = JSON.parse(fs.readFileSync(profileFile(dir, exe, 'dxgi', 'optiscaler-multipass'), 'utf8'));
  assert.equal(profile.files['OptiScaler.ini'], before);
});

test('preset apply keeps a pre-existing config restorable through the active manifest', async (t) => {
  const { dir } = game(t, { configAdded: false });

  await presets.apply(dir, '1845910');
  await core.restoreFiles(dir, manager.readManifest(dir));

  const restored = fs.readFileSync(path.join(dir, 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(restored, 'DlssNr', 'Passes'), '3');
});

test('Dragon Age preset rejects missing app ids and non-multipass manifests', async (t) => {
  const { dir, manifest } = game(t);
  await assert.rejects(() => presets.apply(dir, '123'), { code: 'errPresetUnavailable' });
  writeManifest(dir, { ...manifest, route: 'optiscaler' });
  await assert.rejects(() => presets.apply(dir, '1845910'), { code: 'errPresetNeedsMultipass' });
});
