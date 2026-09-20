'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const extractZip = require('extract-zip');
const pe = require('./pe');
const ini = require('./feeder-config');
const { fetchVerified, digest } = require('./runtime-components');
const { safePath } = require('./file-journal');
const RELEASE = Object.freeze({
  version: '0.9.4-dlss-unlocked',
  url: 'https://github.com/ShyVortex/dlss-unlocked/releases/download/NR-v0.9.4/dlss-unlocked-standalone-NR-v0.9.4.zip',
  sha256: '65a1df2df7a8adddcc9273d353111e23606d9551fce5446b96def3862b6fd8de',
  licenseHash: '0b8b1b368799404cd240c10e5ea22cf4086ef163baf4699d983e37aafdad4299',
  family: 'dlss-unlocked'
});
const MULTIPASS_RELEASE = Object.freeze({
  version: '0.8.3-multipass',
  url: 'https://github.com/wilsjo2/OptiScaler-DLSSNR-PreSR-Multipass/releases/download/v0.8.3/OptiScaler-NR-v0.8.3.zip',
  sha256: '3f2d26fb136d964a394bf50896d082156173153a2a55b88e1995277b4dabe3c8',
  licenseHash: '855487ab700c2fe2618b75dc66f53dfbec12f99636321cbaf07805e3227488ef',
  family: 'presr-multipass'
});
const FSR_RELEASE = Object.freeze({
  version: '0.9.4-fsr',
  url: 'https://github.com/optiscaler/OptiScaler/releases/download/v0.9.4/Optiscaler_0.9.4-final.20260718._MM.7z',
  sha256: '575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad',
  family: 'fsr'
});
const RELEASES = Object.freeze([RELEASE]);
const MULTIPASS_RELEASES = Object.freeze([MULTIPASS_RELEASE]);
const FSR_RELEASES = Object.freeze([FSR_RELEASE]);
const LIBRARIES = [
  'libxess.dll', 'libxess_dx11.dll', 'libxess_fg.dll', 'libxell.dll',
  'amd_fidelityfx_vk.dll', 'amd_fidelityfx_upscaler_dx12.dll',
  'amd_fidelityfx_loader_dx12.dll', 'amd_fidelityfx_framegeneration_dx12.dll',
  'D3D12Core.dll', 'dlss-enabler-headless.dll', 'dlssg_to_fsr3_amd_is_better.dll'
];
const STREAMLINE = ['sl.interposer.dll', 'sl.common.dll', 'sl.dlss.dll', 'sl.dlss_g.dll', 'sl.deepdvc.dll', 'sl.dlss_nr.dll'];
const DLSSG_SM86 = ['dlssg_sm86.dll', 'dlssg_sm86.ini', 'THIRD_PARTY_NOTICES.txt'];
const LICENSES = ['DISCLAIMER.txt', 'NVIDIA_Streamline_LICENSE.txt', 'DLSSG_to_FSR3_LICENSE.txt', 'dlssg_sm86_THIRD_PARTY_NOTICES.txt'];
const MULTIPASS_LIBRARIES = [
  'libxess.dll', 'libxess_dx11.dll', 'libxess_fg.dll', 'libxell.dll',
  'amd_fidelityfx_vk.dll', 'amd_fidelityfx_upscaler_dx12.dll',
  'amd_fidelityfx_loader_dx12.dll', 'amd_fidelityfx_framegeneration_dx12.dll',
  'D3D12_OptiScaler/D3D12Core.dll'
];
function fail(code, message = code) { return Object.assign(new Error(message), { code }); }
function isMultipassRoute(route) {
  return route === 'optiscaler-multipass' || route === 'presr-multipass';
}
function isFsrRoute(route) {
  return route === 'optiscaler-fsr' || route === 'optiscaler-fsr-hybrid';
}
function isFsrHybridRoute(route) {
  return route === 'optiscaler-fsr-hybrid';
}
function isOptiRoute(route) {
  return route === 'optiscaler' || isMultipassRoute(route) || isFsrRoute(route);
}
function releaseFor(version, route = 'optiscaler') {
  const releases = isFsrRoute(route) ? FSR_RELEASES : isMultipassRoute(route) ? MULTIPASS_RELEASES : RELEASES;
  return releases.find(item => item.version === version) || releases[0];
}
function validatePayload(root, route = 'optiscaler') {
  if (isFsrRoute(route)) {
    for (const rel of [
      'OptiScaler.dll', 'amd_fidelityfx_dx12.dll', 'amd_fidelityfx_upscaler_dx12.dll',
      'amd_fidelityfx_framegeneration_dx12.dll', 'amd_fidelityfx_vk.dll',
      'D3D12_Optiscaler/D3D12Core.dll'
    ]) {
      if (pe.getBitness(safePath(root, rel)) !== 64) throw fail('errOptiPayload');
    }
    for (const rel of ['OptiScaler.ini', 'setup_windows.bat']) {
      if (!fs.existsSync(safePath(root, rel))) throw fail('errOptiPayload');
    }
    return;
  }
  if (isMultipassRoute(route)) {
    for (const rel of ['OptiScaler.dll', ...MULTIPASS_LIBRARIES.map(f => 'OptiScaler/' + f)]) {
      if (pe.getBitness(safePath(root, rel)) !== 64) throw fail('errOptiPayload');
    }
    for (const rel of ['OptiScaler.ini', 'setup_windows.bat', 'SHA256SUMS.txt', 'LICENSE']) {
      if (!fs.existsSync(safePath(root, rel))) throw fail('errOptiPayload');
    }
    return;
  }
  for (const rel of ['dxgi.dll', 'nvngx.dll_dlssnr.dll', 'nvngx_dlssnr.dll', ...LIBRARIES.map(f => 'OptiScaler/' + f),
    ...STREAMLINE.map(f => 'OptiScaler/streamline/' + f), ...DLSSG_SM86.slice(0, 1).map(f => 'OptiScaler/dlssg_sm86/' + f)]) {
    if (pe.getBitness(safePath(root, rel)) !== 64) throw fail('errOptiPayload');
  }
  for (const rel of ['OptiScaler.ini', ...DLSSG_SM86.slice(1).map(f => 'OptiScaler/dlssg_sm86/' + f), ...LICENSES.map(f => 'Licenses/' + f)]) {
    if (!fs.existsSync(safePath(root, rel))) throw fail('errOptiPayload');
  }
}
async function ensureOptiScaler(cacheRoot, version) {
  const release = releaseFor(version);
  return ensureRelease(cacheRoot, release, 'optiscaler');
}
async function ensureMultipass(cacheRoot, version) {
  const release = releaseFor(version, 'optiscaler-multipass');
  return ensureRelease(cacheRoot, release, 'optiscaler-multipass');
}
async function ensureFsr(cacheRoot, version) {
  const release = releaseFor(version, 'optiscaler-fsr');
  return ensureRelease(cacheRoot, release, 'optiscaler-fsr');
}
async function ensureRelease(cacheRoot, release, route) {
  const base = path.join(path.resolve(cacheRoot), 'components', `OptiScaler-${release.version}`);
  const archive = base + (release.url.toLowerCase().endsWith('.7z') ? '.7z' : '.zip');
  if (!fs.existsSync(archive) || digest(archive) !== release.sha256) await fetchVerified(release.url, release.sha256, archive);
  if (digest(archive) !== release.sha256) throw fail('errOptiPayload');
  // Re-extract verified bytes on every install. The installer below copies an
  // explicit file list, not unknown files that may have appeared in the cache.
  await extractArchive(archive, base);
  validatePayload(base, route);
  return base;
}
function extractArchive(archive, dir) {
  if (archive.toLowerCase().endsWith('.zip')) return extractZip(archive, { dir });
  return new Promise((resolve, reject) => {
    fs.promises.mkdir(dir, { recursive: true }).then(() => {
      execFile('tar', ['-xf', archive, '-C', dir], { windowsHide: true }, (error) => {
        if (error) reject(fail('errOptiPayload', error.message));
        else resolve();
      });
    }, reject);
  });
}
function hookFor(api) { return api === 'vulkan' ? 'winmm.dll' : 'dxgi.dll'; }
function isSystemDebugHelper(name, file) {
  if (!/^(?:dbghelp|dbgcore)\.dll$/i.test(name)) return false;
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
  try {
    return fs.existsSync(system) && digest(file) === digest(system);
  } catch {
    return false;
  }
}
function configure(text, target) {
  let out = text;
  if (isFsrRoute(target.route)) return configureFsr(out, target);
  for (const [section, key, value] of [
    ['DlssNr', 'Enabled', 'true'], ['Log', 'LogToFile', 'true'], ['Log', 'LogLevel', '2'],
    ['Spoofing', 'Dxgi', 'false'], ['Plugins', 'LoadAsiPlugins', 'false'],
    ['ProcessFilter', 'TargetProcessName', path.basename(target.exePath)],
    ['FrameGen', 'External', 'true'], ['DLSSG', 'AmpereMfgUnlock', 'true']
  ]) out = ini.setIni(out, section, key, value);
  // DX11/Vulkan NR needs the documented D3D12 bridge, not native DLSS output.
  // Set defaults for all APIs: games can change renderer via launch arguments
  // without changing their executable's import table or scanner result.
  for (const field of ['Dx12Upscaler', 'Dx11Upscaler', 'VulkanUpscaler']) {
    const current = ini.getIni(out, 'Upscalers', field);
    const bridge = field !== 'Dx12Upscaler';
    if (!current || current === 'auto' || (bridge && !current.endsWith('_12'))) {
      out = ini.setIni(out, 'Upscalers', field, bridge ? 'ffx_12' : 'dlss');
    }
  }
  if (isMultipassRoute(target.route)) {
    for (const [key, value] of [['RunBeforeSR', 'true'], ['Passes', '1'], ['WorkingScale', '1.0']]) {
      const current = ini.getIni(out, 'DlssNr', key);
      if (!current || current === 'auto') out = ini.setIni(out, 'DlssNr', key, value);
    }
  }
  return out;
}
function configureFsr(text, target) {
  let out = text;
  for (const [section, key, value] of [
    ['ProcessFilter', 'TargetProcessName', path.basename(target.exePath)],
    ['FSR', 'Fsr4Update', 'true'],
    ['FSR', 'Fsr4ForceEnableInt8', 'true'],
    ['FSR', 'Fsr4EnableWatermark', 'true']
  ]) out = ini.setIni(out, section, key, value);
  if (ini.getIni(out, 'FSR', 'Fsr4ForceModel') !== null) out = ini.setIni(out, 'FSR', 'Fsr4ForceModel', '2');
  if (isFsrHybridRoute(target.route)) {
    for (const [key, value] of [
      ['Enabled', 'true'], ['RunBeforeSR', 'true'], ['Passes', '1'], ['WorkingScale', '0.67']
    ]) {
      const current = ini.getIni(out, 'DlssNr', key);
      if (!current || current === 'auto' || key === 'Enabled' || key === 'RunBeforeSR') {
        out = ini.setIni(out, 'DlssNr', key, value);
      }
    }
    out = ini.setIni(out, 'Log', 'LogToFile', 'true');
    out = ini.setIni(out, 'Log', 'LogLevel', '2');
  }
  const upscalers = [
    ['Dx12Upscaler', 'fsr31'],
    ['Dx11Upscaler', 'fsr31_12'],
    ['VulkanUpscaler', 'fsr31_12']
  ];
  for (const [key, value] of upscalers) {
    const current = ini.getIni(out, 'Upscalers', key);
    if (!current || current === 'auto') out = ini.setIni(out, 'Upscalers', key, value);
  }
  return out;
}
function filesUnder(root, relRoot) {
  const base = relRoot ? safePath(root, relRoot) : path.resolve(root);
  const queue = [''];
  const files = [];
  while (queue.length) {
    const relDir = queue.shift();
    const dir = path.join(base, relDir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.join(relDir, entry.name);
      if (entry.isDirectory()) queue.push(rel);
      else if (entry.isFile()) files.push(path.join(relRoot, rel));
    }
  }
  return files;
}
function copyPlan(root, api, route = 'optiscaler') {
  if (isFsrRoute(route)) {
    return filesUnder(root, '').map(from => ({
      from: safePath(root, from),
      to: from === 'OptiScaler.dll' ? hookFor(api) : from
    }));
  }
  if (isMultipassRoute(route)) {
    const plan = [
      ['OptiScaler.dll', hookFor(api)],
      ...filesUnder(root, 'OptiScaler').map(f => [f, f])
    ];
    if (fs.existsSync(safePath(root, 'Licenses'))) {
      plan.push(...filesUnder(root, 'Licenses').map(f => [f, 'OptiScaler/licenses/' + path.basename(f)]));
    }
    for (const name of ['LICENSE', 'SHA256SUMS.txt', 'INSTALL-DLSSNR.md']) {
      if (fs.existsSync(safePath(root, name))) plan.push([name, 'OptiScaler/' + name]);
    }
    return plan.map(([from, to]) => ({ from: safePath(root, from), to }));
  }
  return [
    ['dxgi.dll', hookFor(api)], ['nvngx.dll_dlssnr.dll', 'nvngx.dll_dlssnr.dll'],
    ...filesUnder(root, 'OptiScaler').map(f => [f, f]),
    ...LICENSES.map(f => ['Licenses/' + f, 'OptiScaler/licenses/' + f]),
    ['Licenses/DISCLAIMER.txt', 'OptiScaler/README-DLSS-Unlocked.txt']
  ].map(([from, to]) => ({ from: safePath(root, from), to }));
}
function checkConflicts(gameDir, exePath, manifest, api, route = 'optiscaler') {
  // Inspect the baseline too: switching restores it before installing. Never
  // silently clobber another proxy, OptiScaler install or ASI loader.
  const { originalPath } = require('./apply');
  const exeDir = path.dirname(exePath);
  const added = new Set((manifest?.added || []).map(f => f.toLowerCase()));
  const replacements = new Map((manifest?.replaced || []).map(f => [f.rel.toLowerCase(), f]));
  const names = new Set([...fs.readdirSync(exeDir), 'dxgi.dll', 'winmm.dll', 'OptiScaler.ini']);
  const hook = hookFor(api);
  for (const name of names) {
    if (!/^(?:dxgi|winmm|version|dbghelp|d3d12|d3d11|d3d9|opengl32|wininet|winhttp|nvngx|nvapi64|OptiScaler)\.(?:dll|ini|asi)$/i.test(name) && !/\.asi$/i.test(name)) continue;
    const rel = path.relative(gameDir, path.join(exeDir, name));
    if (added.has(rel.toLowerCase())) continue;
    const file = replacements.has(rel.toLowerCase()) ? originalPath(gameDir, manifest, rel) : safePath(gameDir, rel);
    if (!fs.existsSync(file)) continue;
    // A pre-existing ReShade under the selected proxy name can be replaced
    // with a tracked backup. Other proxies require explicit user cleanup.
    if (name.toLowerCase() === hook && pe.versionMentions(file, 'ReShade')) continue;
    if (isSystemDebugHelper(name, file)) continue;
    throw fail('errOptiConflict', `Conflicting pre-existing file: ${path.join(exeDir, name)}. Restore/remove the other mod with its own installer first.`);
  }
  const pluginDir = path.join(exeDir, 'OptiScaler', 'plugins');
  if (fs.existsSync(pluginDir) && fs.readdirSync(pluginDir).some(f => /\.(dll|asi)$/i.test(f))) throw fail('errOptiConflict', 'Existing OptiScaler plugins need to be removed with their original installer first.');
  if (isFsrRoute(route) && manifest) return;
  const plannedOptiFiles = [...new Set([...LIBRARIES, ...MULTIPASS_LIBRARIES,
    ...STREAMLINE.map(f => 'streamline/' + f), ...DLSSG_SM86.map(f => 'dlssg_sm86/' + f)])];
  for (const name of plannedOptiFiles) {
    const rel = path.relative(gameDir, path.join(exeDir, 'OptiScaler', name));
    if (!added.has(rel.toLowerCase()) && fs.existsSync(safePath(gameDir, rel))) throw fail('errOptiConflict', `Pre-existing OptiScaler component: ${rel}`);
  }
}
async function install(config, log) {
  const { beginManifest, copyTracked, writeTracked, saveActiveManifest } = require('./apply');
  const { gameDir, exePath, api, optiRoot, source } = config;
  const route = isOptiRoute(config.route) ? config.route : 'optiscaler';
  validatePayload(optiRoot, route);
  const exeDir = path.dirname(exePath);
  if (isFsrRoute(route)) {
    const manifest = beginManifest(gameDir, exePath, api);
    manifest.route = route;
    manifest.game.bitness = 64;
    manifest.game.apiLabel = config.apiLabel;
    manifest.optiscaler = { version: FSR_RELEASE.version, family: FSR_RELEASE.family, hook: hookFor(api) };
    for (const item of copyPlan(optiRoot, api, route)) {
      const rel = await copyTracked(manifest, gameDir, item.from, path.join(exeDir, item.to), { kind: 'optiscaler' });
      log({ code: 'added', params: { rel } });
    }
    if (isFsrHybridRoute(route)) {
      const existingModel = path.join(exeDir, 'nvngx_dlssnr.dll');
      const nr = source.payload.find(f => f.name.toLowerCase() === 'nvngx_dlssnr.dll');
      if (nr && pe.getBitness(nr.path) !== 64) throw fail('errNoNeuralRuntime');
      if (!nr && pe.getBitness(existingModel) !== 64) throw fail('errNoNeuralRuntime');
      if (fs.existsSync(existingModel)) {
        log({ code: 'neuralModelKept', params: { rel: path.relative(gameDir, existingModel) } });
      } else if (nr) {
        await copyTracked(manifest, gameDir, nr.path, existingModel, { kind: 'runtime' });
      }
    }
    const file = path.join(exeDir, 'OptiScaler.ini');
    const prior = config.profile?.[path.relative(gameDir, file)] ?? ini.readText(file);
    await writeTracked(manifest, gameDir, file, configure(prior || ini.readText(path.join(optiRoot, 'OptiScaler.ini')), { ...config, route }), { kind: 'config' });
    await saveActiveManifest(gameDir, manifest);
    return manifest;
  }
  const existingModel = path.join(exeDir, 'nvngx_dlssnr.dll');
  const nr = source.payload.find(f => f.name.toLowerCase() === 'nvngx_dlssnr.dll') ||
    (!isMultipassRoute(route) ? { name: 'nvngx_dlssnr.dll', path: safePath(optiRoot, 'nvngx_dlssnr.dll') } : null);
  if (nr && pe.getBitness(nr.path) !== 64) throw fail('errNoNeuralRuntime');
  if (!nr && (!isMultipassRoute(route) || pe.getBitness(existingModel) !== 64)) throw fail('errNoNeuralRuntime');
  const manifest = beginManifest(gameDir, exePath, api);
  manifest.route = route;
  manifest.game.bitness = 64;
  manifest.game.apiLabel = config.apiLabel;
  const release = isMultipassRoute(route) ? MULTIPASS_RELEASE : RELEASE;
  manifest.optiscaler = { version: release.version, family: release.family, hook: hookFor(api) };
  for (const item of copyPlan(optiRoot, api, route)) {
    const rel = await copyTracked(manifest, gameDir, item.from, path.join(exeDir, item.to), { kind: 'optiscaler' });
    log({ code: 'added', params: { rel } });
  }
  // The model that ships here is NVIDIA's stock one, which runs on Blackwell.
  // Older architectures need a modded build, supplied by the person for their
  // own card, and copying ours over it would quietly break exactly the setup
  // they came here with. An existing model is left alone; ours is installed
  // only when there is none.
  const model = path.join(exeDir, 'nvngx_dlssnr.dll');
  if (fs.existsSync(model)) {
    log({ code: 'neuralModelKept', params: { rel: path.relative(gameDir, model) } });
  } else if (nr) {
    await copyTracked(manifest, gameDir, nr.path, model, { kind: 'runtime' });
  }
  const file = path.join(exeDir, 'OptiScaler.ini');
  const prior = config.profile?.[path.relative(gameDir, file)] ?? ini.readText(file);
  await writeTracked(manifest, gameDir, file, configure(prior || ini.readText(path.join(optiRoot, 'OptiScaler.ini')), { ...config, route }), { kind: 'config' });
  await saveActiveManifest(gameDir, manifest);
  return manifest;
}
module.exports = {
  RELEASE, RELEASES, MULTIPASS_RELEASE, MULTIPASS_RELEASES, FSR_RELEASE, FSR_RELEASES,
  releaseFor, LIBRARIES, ensureOptiScaler, ensureMultipass, ensureFsr, validatePayload,
  configure, configureFsr, copyPlan, hookFor, checkConflicts, install, isMultipassRoute,
  isFsrRoute, isFsrHybridRoute, isOptiRoute
};
