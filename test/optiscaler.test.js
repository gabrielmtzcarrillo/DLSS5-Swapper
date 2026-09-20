'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const opti = require('../src/core/optiscaler');
const routes = require('../src/shared/install-routes');
const guards = require('../src/core/install-guards');
const ini = require('../src/core/feeder-config');
const { writePe } = require('./fixtures/pe');

test('OptiScaler is optional, gated by real DLSS, architecture and API', () => {
  const target = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', hasNativeDlss: true };
  assert.deepEqual(routes.routesFor(target), ['native', 'feeder', 'optiscaler', 'optiscaler-multipass', 'optiscaler-fsr', 'optiscaler-fsr-hybrid', 'cost-scaler']);
  assert.deepEqual(routes.routesFor({ ...target, multipassAvailable: true }), ['native', 'feeder', 'optiscaler', 'optiscaler-multipass', 'optiscaler-fsr', 'optiscaler-fsr-hybrid', 'cost-scaler', 'renodx']);
  assert.equal(routes.recommendedRoute({ chosen: target, primaryDlss: { rel: 'nvngx_dlss.dll' } }), 'native');
  for (const delta of [{ bitness: 32 }, { hasNativeDlss: false }, { emulator: { key: 'xenia' } }, { api: 'd3d9' }, { api: 'd3d8' }, { api: 'opengl' }, { apiLabel: 'DirectX 10' }]) {
    assert.equal(routes.routesFor({ ...target, ...delta }).includes('optiscaler'), false);
    assert.equal(routes.routesFor({ ...target, ...delta }).includes('optiscaler-multipass'), false);
  }
  assert.equal(routes.routesFor({ ...target, hasNativeDlss: false }).includes('optiscaler-fsr'), true);
  assert.equal(routes.routesFor({ ...target, hasNativeDlss: false }).includes('optiscaler-fsr-hybrid'), false);
  assert.equal(routes.routesFor({ ...target, apiLabel: 'DirectX 11' }).includes('optiscaler'), true);
  assert.equal(routes.routesFor({ ...target, apiLabel: 'DirectX 11' }).includes('optiscaler-multipass'), true);
  assert.equal(routes.routesFor({ ...target, apiLabel: 'DirectX 11', hasNativeDlss: false }).includes('optiscaler-fsr'), true);
  assert.equal(routes.routesFor({ ...target, apiLabel: 'DirectX 11', hasNativeDlss: false }).includes('optiscaler-fsr-hybrid'), false);
  assert.equal(routes.routesFor({ ...target, api: 'vulkan' }).includes('optiscaler'), true);
  assert.equal(routes.routesFor({ ...target, api: 'vulkan' }).includes('optiscaler-multipass'), true);
  assert.equal(routes.routesFor({ ...target, api: 'vulkan', hasNativeDlss: false }).includes('optiscaler-fsr'), true);
  assert.equal(routes.routesFor({ ...target, api: 'vulkan', hasNativeDlss: false }).includes('optiscaler-fsr-hybrid'), false);
  assert.equal(routes.nativeDlssPresent({ primaryDlss: { rel: 'nvngx_dlss.dll' }, install: { added: ['NVNGX_DLSS.DLL'] } }), false);
});

test('OptiScaler configuration arms NR but preserves unrelated preferences', () => {
  const text = '[DlssNr]\nEnabled=false\nIntensity=0.65\n[FrameGen]\nEnabled=false\n[Upscalers]\nDx11Upscaler=dlss\n[Other]\nSetting=keep\n';
  const target = { exePath: 'C:\\Games\\Actual Game.exe', api: 'dxgi', apiLabel: 'DirectX 11' };
  const configured = opti.configure(text, target);
  assert.equal(ini.getIni(configured, 'DlssNr', 'Enabled'), 'true');
  assert.equal(ini.getIni(configured, 'DlssNr', 'Intensity'), '0.65');
  assert.equal(ini.getIni(configured, 'Upscalers', 'Dx11Upscaler'), 'ffx_12');
  assert.equal(ini.getIni(configured, 'FrameGen', 'Enabled'), 'false');
  assert.equal(ini.getIni(configured, 'FrameGen', 'External'), 'true');
  assert.equal(ini.getIni(configured, 'DLSSG', 'AmpereMfgUnlock'), 'true');
  assert.equal(ini.getIni(configured, 'Other', 'Setting'), 'keep');
  assert.equal(ini.getIni(configured, 'Plugins', 'LoadAsiPlugins'), 'false');
  assert.equal(opti.configure(configured, target), configured);
  assert.equal(ini.getIni(opti.configure('', { ...target, api: 'vulkan' }), 'Upscalers', 'VulkanUpscaler'), 'ffx_12');
  assert.equal(ini.getIni(opti.configure('', { ...target, apiLabel: 'DirectX 12' }), 'Upscalers', 'Dx12Upscaler'), 'dlss');
});

test('OptiScaler package validation and copy plan include DLSS Unlocked MFG files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-payload-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const rel of [
    'dxgi.dll', 'nvngx.dll_dlssnr.dll', 'nvngx_dlssnr.dll',
    'OptiScaler/libxess.dll', 'OptiScaler/libxess_dx11.dll', 'OptiScaler/libxess_fg.dll',
    'OptiScaler/libxell.dll', 'OptiScaler/amd_fidelityfx_vk.dll',
    'OptiScaler/amd_fidelityfx_upscaler_dx12.dll', 'OptiScaler/amd_fidelityfx_loader_dx12.dll',
    'OptiScaler/amd_fidelityfx_framegeneration_dx12.dll', 'OptiScaler/D3D12Core.dll',
    'OptiScaler/dlss-enabler-headless.dll', 'OptiScaler/dlssg_to_fsr3_amd_is_better.dll',
    'OptiScaler/streamline/sl.interposer.dll', 'OptiScaler/streamline/sl.common.dll',
    'OptiScaler/streamline/sl.dlss.dll', 'OptiScaler/streamline/sl.dlss_g.dll',
    'OptiScaler/streamline/sl.deepdvc.dll', 'OptiScaler/streamline/sl.dlss_nr.dll',
    'OptiScaler/dlssg_sm86/dlssg_sm86.dll'
  ]) writePe(path.join(root, rel));
  for (const rel of [
    'OptiScaler.ini', 'OptiScaler/dlssg_sm86/dlssg_sm86.ini',
    'OptiScaler/dlssg_sm86/THIRD_PARTY_NOTICES.txt',
    'Licenses/DISCLAIMER.txt', 'Licenses/NVIDIA_Streamline_LICENSE.txt',
    'Licenses/DLSSG_to_FSR3_LICENSE.txt', 'Licenses/dlssg_sm86_THIRD_PARTY_NOTICES.txt'
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), rel);
  }

  assert.doesNotThrow(() => opti.validatePayload(root));
  const plan = opti.copyPlan(root, 'dxgi').map(item => item.to.replace(/\\/g, '/'));
  assert.ok(plan.includes('OptiScaler/dlssg_sm86/dlssg_sm86.dll'));
  assert.ok(plan.includes('OptiScaler/dlssg_sm86/dlssg_sm86.ini'));
  assert.ok(plan.includes('OptiScaler/streamline/sl.interposer.dll'));
});

test('OptiScaler Pre-SR Multipass package validation uses its portable layout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-multipass-payload-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const rel of [
    'OptiScaler.dll',
    'OptiScaler/libxess.dll', 'OptiScaler/libxess_dx11.dll', 'OptiScaler/libxess_fg.dll',
    'OptiScaler/libxell.dll', 'OptiScaler/amd_fidelityfx_vk.dll',
    'OptiScaler/amd_fidelityfx_upscaler_dx12.dll', 'OptiScaler/amd_fidelityfx_loader_dx12.dll',
    'OptiScaler/amd_fidelityfx_framegeneration_dx12.dll',
    'OptiScaler/D3D12_OptiScaler/D3D12Core.dll'
  ]) writePe(path.join(root, rel));
  for (const rel of ['OptiScaler.ini', 'setup_windows.bat', 'SHA256SUMS.txt', 'LICENSE']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), rel);
  }

  assert.doesNotThrow(() => opti.validatePayload(root, 'optiscaler-multipass'));
  const configured = opti.configure('[DlssNr]\nEnabled=false\nPasses=3\n', {
    exePath: 'C:\\Games\\Game.exe', api: 'dxgi', apiLabel: 'DirectX 12', route: 'optiscaler-multipass'
  });
  assert.equal(ini.getIni(configured, 'DlssNr', 'Enabled'), 'true');
  assert.equal(ini.getIni(configured, 'DlssNr', 'RunBeforeSR'), 'true');
  assert.equal(ini.getIni(configured, 'DlssNr', 'Passes'), '3');
  const plan = opti.copyPlan(root, 'dxgi', 'optiscaler-multipass').map(item => item.to.replace(/\\/g, '/'));
  assert.ok(plan.includes('dxgi.dll'));
  assert.ok(plan.includes('OptiScaler/D3D12_OptiScaler/D3D12Core.dll'));
});

test('OptiScaler FSR package validation and config follow upstream FSR 4.1.1 layout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-fsr-payload-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const rel of [
    'OptiScaler.dll', 'amd_fidelityfx_dx12.dll', 'amd_fidelityfx_upscaler_dx12.dll',
    'amd_fidelityfx_framegeneration_dx12.dll', 'amd_fidelityfx_vk.dll',
    'D3D12_Optiscaler/D3D12Core.dll'
  ]) writePe(path.join(root, rel));
  for (const rel of ['OptiScaler.ini', 'setup_windows.bat', 'Licenses/FidelityFX_v2_LICENSE.md']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), rel);
  }

  assert.doesNotThrow(() => opti.validatePayload(root, 'optiscaler-fsr'));
  const configured = opti.configure('[Upscalers]\nDx12Upscaler=auto\n[FSR]\nFsr4Update=auto\nFsr4ForceModel=auto\n', {
    exePath: 'C:\\Games\\Game.exe', api: 'dxgi', apiLabel: 'DirectX 12', route: 'optiscaler-fsr'
  });
  assert.equal(ini.getIni(configured, 'Upscalers', 'Dx12Upscaler'), 'fsr31');
  assert.equal(ini.getIni(configured, 'FSR', 'Fsr4Update'), 'true');
  assert.equal(ini.getIni(configured, 'FSR', 'Fsr4ForceEnableInt8'), 'true');
  assert.equal(ini.getIni(configured, 'FSR', 'Fsr4ForceModel'), '2');
  assert.equal(ini.getIni(configured, 'FSR', 'Fsr4EnableWatermark'), 'true');
  const hybrid = opti.configure('[DlssNr]\nWorkingScale=0.50\n[Upscalers]\nDx12Upscaler=auto\n[FSR]\nFsr4Update=auto\n', {
    exePath: 'C:\\Games\\Game.exe', api: 'dxgi', apiLabel: 'DirectX 12', route: 'optiscaler-fsr-hybrid'
  });
  assert.equal(ini.getIni(hybrid, 'DlssNr', 'Enabled'), 'true');
  assert.equal(ini.getIni(hybrid, 'DlssNr', 'RunBeforeSR'), 'true');
  assert.equal(ini.getIni(hybrid, 'DlssNr', 'Passes'), '1');
  assert.equal(ini.getIni(hybrid, 'DlssNr', 'WorkingScale'), '0.50');
  assert.equal(ini.getIni(hybrid, 'FSR', 'Fsr4ForceEnableInt8'), 'true');
  const plan = opti.copyPlan(root, 'dxgi', 'optiscaler-fsr').map(item => item.to.replace(/\\/g, '/'));
  assert.ok(plan.includes('dxgi.dll'));
  assert.ok(plan.includes('D3D12_Optiscaler/D3D12Core.dll'));
  assert.ok(plan.includes('amd_fidelityfx_upscaler_dx12.dll'));
});

test('GPU requirements and process guards reject known unsupported/running targets', async () => {
  assert.equal(guards.gpuSupported([{ name: 'NVIDIA GeForce RTX 5090', driver: '616.56' }]), true);
  assert.equal(guards.gpuSupported([{ name: 'NVIDIA GeForce RTX 5090 Laptop GPU', driver: '617.00' }]), true);
  assert.equal(guards.gpuSupported([{ name: 'NVIDIA GeForce RTX 4090', driver: '617.00' }]), false);
  assert.equal(guards.gpuSupported([{ name: 'NVIDIA GeForce RTX 5090', driver: '616.55' }]), false);
  // The card is refused; an older driver is only a warning, so the install path
  // asks these two separately.
  assert.equal(guards.gpuModelSupported([{ name: 'NVIDIA GeForce RTX 5090', driver: '610.00' }]), true);
  assert.equal(guards.driverSupported([{ name: 'NVIDIA GeForce RTX 5090', driver: '610.00' }]), false);
  assert.equal(guards.gpuModelSupported([{ name: 'NVIDIA GeForce RTX 4090', driver: '617.00' }]), false);
  assert.equal(guards.driverSupported([{ name: 'NVIDIA GeForce RTX 5080', driver: '617.00' }]), true);
  // The driver range upstream measured faulting inside NVIDIA's neural runtime
  // is a warning of its own, independent of the OptiScaler requirements.
  assert.equal(guards.driverNeuralFault([{ name: 'NVIDIA GeForce RTX 5090', driver: '616.56' }]), false);
  assert.equal(guards.driverNeuralFault([{ name: 'NVIDIA GeForce RTX 5090', driver: '616.64' }]), true);
  assert.equal(guards.driverNeuralFault([{ name: 'NVIDIA GeForce RTX 4070', driver: '616.86' }]), true);
  assert.equal(guards.driverNeuralFault([{ name: 'NVIDIA GeForce RTX 5090', driver: '610.00' }]), false);
  assert.equal(guards.driverNeuralFault(null), false);
  assert.equal(guards.driverNames([{ name: 'RTX 5090', driver: '616.64' }]), 'RTX 5090 - 616.64');
  // Blackwell is the requirement, not the name: the professional boards report
  // themselves as "RTX PRO 6000 Blackwell" and were refused for not being 50xx.
  assert.equal(guards.gpuModelSupported([{ name: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', driver: '616.56' }]), true);
  assert.equal(guards.gpuModelSupported([{ name: 'NVIDIA RTX PRO 5000 Blackwell', driver: '616.56' }]), true);
  assert.equal(guards.driverSupported([{ name: 'NVIDIA RTX PRO 6000 Blackwell', driver: '616.56' }]), true);
  // An older professional card of the same family name is still refused.
  assert.equal(guards.gpuModelSupported([{ name: 'NVIDIA RTX PRO 6000 Ada Generation', driver: '617.00' }]), false);
  assert.equal(guards.gpuModelSupported([{ name: 'NVIDIA RTX A6000', driver: '617.00' }]), false);
  const root = path.resolve('test-fixture-game');
  const game = path.join(root, 'Game.exe');
  const rows = [{ Name: 'Game.exe', ExecutablePath: game, ProcessId: -1 }, { Name: 'Game.exe', ExecutablePath: null, ProcessId: -2 }, { Name: 'Other.exe', ExecutablePath: path.resolve('elsewhere', 'Other.exe'), ProcessId: -3 }];
  assert.equal(guards.matchingProcesses(rows, root, game).length, 2);
  await assert.rejects(guards.assertGameClosed(root, game, async () => JSON.stringify(rows)), { code: 'errGameRunning' });
  // When the process list cannot be read - PowerShell restricted, a cold WMI
  // call past its timeout - the executable itself is asked instead. A file
  // that opens for writing is not a running game, and the install proceeds;
  // refusing there is what stopped people with a closed game from installing.
  const unavailable = async () => { throw new Error('Access denied'); };
  await guards.assertGameClosed(root, game, unavailable, () => false);
  await assert.rejects(guards.assertGameClosed(root, game, unavailable, () => true), { code: 'errGameRunning' });
  await guards.assertGameClosed(root, game, async () => '[]');
});

test('OptiScaler hybrid FSR route installs the NR model beside the FSR hook', async (t) => {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-hybrid-game-'));
  const optiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-hybrid-root-'));
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-hybrid-payload-'));
  t.after(() => {
    fs.rmSync(gameDir, { recursive: true, force: true });
    fs.rmSync(optiRoot, { recursive: true, force: true });
    fs.rmSync(payload, { recursive: true, force: true });
  });
  const exePath = writePe(path.join(gameDir, 'Game.exe'));
  for (const rel of [
    'OptiScaler.dll', 'amd_fidelityfx_dx12.dll', 'amd_fidelityfx_upscaler_dx12.dll',
    'amd_fidelityfx_framegeneration_dx12.dll', 'amd_fidelityfx_vk.dll',
    'D3D12_Optiscaler/D3D12Core.dll'
  ]) writePe(path.join(optiRoot, rel), { text: rel });
  fs.writeFileSync(path.join(optiRoot, 'OptiScaler.ini'), '[Upscalers]\nDx12Upscaler=auto\n[FSR]\nFsr4Update=auto\n');
  fs.writeFileSync(path.join(optiRoot, 'setup_windows.bat'), 'setup');
  const nrPath = writePe(path.join(payload, 'nvngx_dlssnr.dll'), { text: 'hybrid nr model' });

  const manifest = await opti.install({
    gameDir, exePath, api: 'dxgi', apiLabel: 'DirectX 12', route: 'optiscaler-fsr-hybrid',
    optiRoot, source: { payload: [{ name: 'nvngx_dlssnr.dll', path: nrPath }] }
  }, () => {});

  assert.equal(manifest.route, 'optiscaler-fsr-hybrid');
  assert.equal(manifest.optiscaler.family, 'fsr');
  assert.equal(fs.existsSync(path.join(gameDir, 'dxgi.dll')), true);
  assert.equal(fs.existsSync(path.join(gameDir, 'nvngx_dlssnr.dll')), true);
  const configured = fs.readFileSync(path.join(gameDir, 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(configured, 'DlssNr', 'Enabled'), 'true');
  assert.equal(ini.getIni(configured, 'DlssNr', 'RunBeforeSR'), 'true');
  assert.equal(ini.getIni(configured, 'Upscalers', 'Dx12Upscaler'), 'fsr31');
});

test('unmanaged proxies and ASI loaders are refused; anti-cheat detection remains available for warnings', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opti-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'dxgi.dll'), 'another mod');
  assert.throws(() => opti.checkConflicts(dir, path.join(dir, 'Game.exe'), null, 'dxgi'), { code: 'errOptiConflict' });
  assert.equal(fs.readFileSync(path.join(dir, 'dxgi.dll'), 'utf8'), 'another mod');
  fs.unlinkSync(path.join(dir, 'dxgi.dll'));
  fs.writeFileSync(path.join(dir, 'OtherMod.asi'), 'user loader');
  assert.throws(() => opti.checkConflicts(dir, path.join(dir, 'Game.exe'), null, 'dxgi'), { code: 'errOptiConflict' });
  fs.mkdirSync(path.join(dir, 'EasyAntiCheat'));
  assert.equal(guards.antiCheatPresent(dir), true);
});
