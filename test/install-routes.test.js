'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routesFor, recommendedRoute } = require('../src/shared/install-routes');
const feederReleases = require('../src/core/feeder-release');

test('DX10 relay requires Feeder 0.13.1 or newer', () => {
  assert.equal(feederReleases.supportsDx10('0.12.0'), false);
  assert.equal(feederReleases.supportsDx10('0.13.1-beta.1'), true);
  assert.equal(feederReleases.supportsDx10('0.14.0-beta.4'), true);
});

test('SWTOR x64 DX9 always uses Feeder even with old injected DLSS DLLs', () => {
  const chosen = { bitness: 64, api: 'd3d9', apiLabel: 'DirectX 9' };
  assert.deepEqual(routesFor(chosen), ['feeder']);
  assert.equal(recommendedRoute({ chosen, primaryDlss: { rel: 'nvngx_dlss.dll' }, install: { route: 'native' } }), 'feeder');
});
test('DX8 x86 and DX10/DX11 use Feeder; OptiScaler remains unavailable on DX10', () => {
  assert.deepEqual(routesFor({ bitness: 32, api: 'd3d8' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d8' }), []);
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 32, api: 'd3d10', apiLabel: 'DirectX 10' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 32, api: 'dxgi', apiLabel: 'DirectX 10' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d10', apiLabel: 'DirectX 10' }), []);
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 10' }), []);
});
test('real native DX12 stays available; injected DLLs never select native by themselves', () => {
  const chosen = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' };
  const primaryDlss = { rel: 'Engine\\nvngx_dlss.dll' };
  assert.deepEqual(routesFor(chosen), ['native', 'feeder']);
  assert.equal(recommendedRoute({ chosen, primaryDlss }), 'native');
  assert.equal(recommendedRoute({ chosen, primaryDlss, install: { added: ['engine/nvngx_dlss.dll'] } }), 'feeder');
  assert.deepEqual(routesFor({ ...chosen, emulator: { key: 'xenia' } }), ['feeder']);
});
