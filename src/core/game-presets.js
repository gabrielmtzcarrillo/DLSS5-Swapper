'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const journal = require('./file-journal');
const core = require('./apply');
const backends = require('./backend-manager');

const PRESETS = Object.freeze({
  '1845910': Object.freeze({
    id: 'dragon-age-veilguard-optiscaler-multipass',
    appid: '1845910',
    game: 'Dragon Age: The Veilguard',
    label: 'Dragon Age: The Veilguard OptiScaler Pre-SR Multipass',
    route: 'optiscaler-multipass',
    family: 'presr-multipass',
    config: path.join(__dirname, '..', '..', 'settings', '1845910', 'OptiScaler.ini'),
    sha256: '71cc969c06d60add4b425c4e1603b00889cd28d4eb422e08a99aac4cfd41eb1f'
  })
});

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function presetFor(appid) {
  return PRESETS[String(appid || '')] || null;
}

function activeManifestEligible(preset, manifest) {
  return Boolean(
    preset &&
    manifest &&
    manifest.version === 1 &&
    manifest.route === preset.route &&
    manifest.optiscaler &&
    manifest.optiscaler.family === preset.family
  );
}

function availability(appid, manifest) {
  const preset = presetFor(appid);
  if (!preset) return null;
  const sourceExists = fs.existsSync(preset.config) && digest(preset.config) === preset.sha256;
  return {
    id: preset.id,
    appid: preset.appid,
    label: preset.label,
    route: preset.route,
    sourceExists,
    available: sourceExists && activeManifestEligible(preset, manifest)
  };
}

async function apply(gameDir, appid) {
  const preset = presetFor(appid);
  if (!preset) throw fail('errPresetUnavailable');
  if (!fs.existsSync(preset.config) || digest(preset.config) !== preset.sha256) throw fail('errPresetUnavailable');
  const manifest = backends.readManifest(gameDir);
  if (!activeManifestEligible(preset, manifest)) throw fail('errPresetNeedsMultipass');

  const exe = journal.safePath(gameDir, manifest.game.exe);
  const target = path.join(path.dirname(exe), 'OptiScaler.ini');
  await backends.saveProfile(gameDir, manifest);
  await core.writeTracked(manifest, gameDir, target, fs.readFileSync(preset.config, 'utf8'), { kind: 'config' });
  manifest.gamePreset = {
    id: preset.id,
    appid: preset.appid,
    label: preset.label,
    appliedAt: new Date().toISOString(),
    file: path.relative(gameDir, target)
  };
  await core.saveActiveManifest(gameDir, manifest);
  return manifest;
}

module.exports = { PRESETS, presetFor, availability, apply, activeManifestEligible };
