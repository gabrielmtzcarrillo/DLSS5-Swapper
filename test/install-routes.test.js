'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routesFor, recommendedRoute } = require('../src/shared/install-routes');
const feederReleases = require('../src/core/feeder-release');

test('DX10 relay requires Feeder 0.13.1 or newer', () => {
  assert.equal(feederReleases.supportsDx10('0.12.0'), false);
  assert.equal(feederReleases.supportsDx10('0.13.1-beta.1'), true);
  assert.equal(feederReleases.supportsDx10('0.14.0-beta.4'), true);
  assert.equal(feederReleases.supportsDx10('1.16.0-beta.4'), true);
});

test('Feeder 1.16.0-beta.4 is selectable while 0.15.1 stays the default', () => {
  assert.equal(feederReleases.VERSIONS[0].version, '0.15.1');
  assert.equal(feederReleases.release().version, '0.15.1');
  assert.equal(feederReleases.release('9.9.9').version, '0.15.1');
  const beta = feederReleases.release('1.16.0-beta.4');
  assert.equal(beta.version, '1.16.0-beta.4');
  assert.notEqual(beta.hashes['dlss5-feed.addon64'], feederReleases.hashes['dlss5-feed.addon64']);
  // Every release pins the same file set, so the payload scanner verifies
  // each one the same way.
  assert.deepEqual(Object.keys(beta.hashes).sort(), Object.keys(feederReleases.hashes).sort());
});

test('SWTOR x64 DX9 always uses Feeder even with old injected DLSS DLLs', () => {
  const chosen = { bitness: 64, api: 'd3d9', apiLabel: 'DirectX 9' };
  assert.deepEqual(routesFor(chosen), ['feeder']);
  assert.equal(recommendedRoute({ chosen, primaryDlss: { rel: 'nvngx_dlss.dll' }, install: { route: 'native' } }), 'feeder');
});
test('DX8 x86 and DX10/DX11 use Feeder; OptiScaler remains unavailable on DX10', () => {
  assert.deepEqual(routesFor({ bitness: 32, api: 'd3d8' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d8' }), []);
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11' }), ['feeder', 'optiscaler-fsr']);
  assert.deepEqual(routesFor({ bitness: 32, api: 'd3d10', apiLabel: 'DirectX 10' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 32, api: 'dxgi', apiLabel: 'DirectX 10' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d10', apiLabel: 'DirectX 10' }), []);
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 10' }), []);
});
test('real native DX12 stays available; injected DLLs never select native by themselves', () => {
  const chosen = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' };
  const primaryDlss = { rel: 'Engine\\nvngx_dlss.dll' };
  assert.deepEqual(routesFor(chosen), ['native', 'feeder', 'optiscaler-fsr']);
  assert.equal(recommendedRoute({ chosen, primaryDlss }), 'native');
  assert.equal(recommendedRoute({ chosen, primaryDlss, install: { added: ['engine/nvngx_dlss.dll'] } }), 'feeder');
  assert.deepEqual(routesFor({ ...chosen, emulator: { key: 'xenia' } }), ['feeder']);
});
