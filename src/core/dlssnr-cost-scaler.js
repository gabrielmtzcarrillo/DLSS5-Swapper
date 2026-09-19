'use strict';

const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');
const pe = require('./pe');
const ini = require('./feeder-config');
const { fetchVerified, digest } = require('./runtime-components');
const { safePath } = require('./file-journal');

const RELEASE = Object.freeze({
  version: '1.0.6',
  url: 'https://github.com/xenmods/DLSSNR-Cost-Scaler/releases/download/v1.0.6/DLSSNR-Cost-Scaler-v1.0.6.zip',
  sha256: '525cc45b00dcb1ba03ce6c25905ff02c3ff3458b5e90ebf4138b307f46e13095'
});

const VERSIONS = Object.freeze([RELEASE]);
const FILES = Object.freeze([
  'nvngx_dlssnr.dll',
  'nvngx_dlssnr.ini',
  'dlssnr-companion.addon64',
  'LICENSE',
  'README.md'
]);

function fail(code, message = code) { return Object.assign(new Error(message), { code }); }

function release(version = RELEASE.version) {
  return VERSIONS.find(item => item.version === version) || RELEASE;
}

async function ensureCostScaler(cacheRoot, version) {
  const item = release(version);
  const base = path.join(path.resolve(cacheRoot), 'components', `DLSSNR-Cost-Scaler-${item.version}`);
  const archive = base + '.zip';
  if (!fs.existsSync(archive) || digest(archive) !== item.sha256) await fetchVerified(item.url, item.sha256, archive);
  if (digest(archive) !== item.sha256) throw fail('errCostScalerPayload');
  await fs.promises.rm(base, { recursive: true, force: true });
  await extractZip(archive, { dir: base });
  validatePayload(base);
  return base;
}

function validatePayload(root) {
  for (const rel of FILES) {
    if (!fs.existsSync(safePath(root, rel))) throw fail('errCostScalerPayload');
  }
  for (const rel of ['nvngx_dlssnr.dll', 'dlssnr-companion.addon64']) {
    if (pe.getBitness(safePath(root, rel)) !== 64) throw fail('errCostScalerPayload');
  }
}

function configure(text) {
  let out = text || '';
  const defaults = [
    ['DLSSNR_Proxy', 'EnableProxy', '1'],
    ['DLSSNR_Proxy', 'ResolutionScale', '0.75'],
    ['DLSSNR_Proxy', 'EnlargementMode', '1'],
    ['DLSSNR_Proxy', 'TransferStrength', '1.00'],
    ['DLSSNR_Proxy', 'ColorStrength', '1.00'],
    ['DLSSNR_Proxy', 'Sharpness', '0.20'],
    ['DLSSNR_Proxy', 'EnableDepthAwareResolve', '1'],
    ['DLSSNR_Proxy', 'EnableHotkeys', '1'],
    ['DLSSNR_Settings', 'UseCustomSettings', '0'],
    ['Governor', 'EnableGovernor', '0']
  ];
  for (const [section, key, value] of defaults) {
    if (!ini.getIni(out, section, key)) out = ini.setIni(out, section, key, value);
  }
  return out;
}

async function install(config, manifest, log = () => {}) {
  const core = require('./apply');
  const { gameDir, exePath, costScalerRoot, source } = config;
  validatePayload(costScalerRoot);
  const exeDir = path.dirname(exePath);
  const currentNr = path.join(exeDir, 'nvngx_dlssnr.dll');
  const realNr = path.join(exeDir, 'nvngx_dlssnr_real.dll');
  const payloadNr = source.payload.find(f => f.name.toLowerCase() === 'nvngx_dlssnr.dll');
  const proxy = safePath(costScalerRoot, 'nvngx_dlssnr.dll');
  const companion = safePath(costScalerRoot, 'dlssnr-companion.addon64');

  if (pe.getBitness(proxy) !== 64 || pe.getBitness(companion) !== 64) throw fail('errCostScalerPayload');

  const realRel = path.relative(gameDir, realNr);
  const realManaged = manifest.added.some(rel => rel.toLowerCase() === realRel.toLowerCase()) ||
    manifest.replaced.some(item => item.rel.toLowerCase() === realRel.toLowerCase());
  if (fs.existsSync(realNr) && !realManaged) {
    throw fail('errCostScalerConflict', `Pre-existing DLSS-NR real runtime: ${realNr}`);
  }

  if (!fs.existsSync(realNr)) {
    const realSource = fs.existsSync(currentNr) ? currentNr : (payloadNr && payloadNr.path);
    if (!realSource || pe.getBitness(realSource) !== 64) throw fail('errNoNeuralRuntime');
    await core.copyTracked(manifest, gameDir, realSource, realNr, { kind: 'runtime', newVersion: pe.getFileVersion(realSource) });
    log({ code: 'costScalerRuntimeSaved', params: { rel: realRel } });
  } else if (pe.getBitness(realNr) !== 64) {
    throw fail('errNoNeuralRuntime');
  }

  await core.copyTracked(manifest, gameDir, proxy, currentNr, { kind: 'cost-scaler', newVersion: pe.getFileVersion(proxy) });
  await core.writeTracked(
    manifest,
    gameDir,
    path.join(exeDir, 'nvngx_dlssnr.ini'),
    configure(ini.readText(path.join(exeDir, 'nvngx_dlssnr.ini')) || ini.readText(safePath(costScalerRoot, 'nvngx_dlssnr.ini'))),
    { kind: 'config' }
  );
  await core.copyTracked(manifest, gameDir, companion, path.join(exeDir, 'dlssnr-companion.addon64'), { kind: 'addon' });
  await core.enableAddonInIni(exeDir, 'dlssnr-companion.addon64',
    (code, params) => log({ code, params }), gameDir, manifest);
  for (const rel of ['LICENSE', 'README.md']) {
    await core.copyTracked(
      manifest,
      gameDir,
      safePath(costScalerRoot, rel),
      path.join(exeDir, 'DLSSNR-Cost-Scaler', rel),
      { kind: rel === 'LICENSE' ? 'license' : 'docs' }
    );
  }
  manifest.route = 'cost-scaler';
  manifest.costScaler = { version: RELEASE.version };
  await core.saveActiveManifest(gameDir, manifest);
  log({ code: 'costScalerInstalled', params: { version: RELEASE.version } });
  return manifest;
}

module.exports = { RELEASE, VERSIONS, release, ensureCostScaler, validatePayload, configure, install };
