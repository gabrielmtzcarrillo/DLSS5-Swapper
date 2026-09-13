'use strict';

const fs = require('fs');
const path = require('path');
const { fetchVerified } = require('./runtime-components');

// The public builds are distributed by the RenoDX DLSS installer project.
// Keep each URL and digest pinned so picking a version cannot silently
// install different rolling-release bytes.
const V25 = {
  version: '2.5',
  file: 'renodx-dlss5-v2.5.addon64',
  url: 'https://github.com/yumlevi/renodx-dlss-installer/releases/download/latest/renodx-dlss5-v2.5.addon64',
  sha256: 'a2973900531d58ff7beb21172828095bce2281bc2a81e82191f9d89c983d6a21'
};

// Upstream also keeps an unversioned file in the same rolling release, which
// they update in place as they push new builds - it is not the same content
// as v2.5. There is nothing upstream to pin a version number to, so it is
// offered under its own file name instead. The digest below is a snapshot of
// whatever was there when this was added; it is not update-tracked, so it
// must be re-pinned by hand whenever upstream moves it forward again.
const ROLLING = {
  version: 'rolling',
  file: 'renodx-dlss5.addon64',
  label: 'Rolling (unversioned upstream build)',
  url: 'https://github.com/yumlevi/renodx-dlss-installer/releases/download/latest/renodx-dlss5.addon64',
  sha256: '87aef9ddd937c7241e6bf8d8efea0045d63559135e254c60dab316db3d3a4aee'
};

const VERSIONS = [V25, ROLLING];

function release(version = V25.version) {
  return VERSIONS.find(item => item.version === version) || V25;
}

function cachePath(cacheRoot, version) {
  return path.join(path.resolve(cacheRoot), 'components', release(version).file);
}

async function ensureRenodx(cacheRoot, version) {
  const item = release(version);
  const file = cachePath(cacheRoot, item.version);
  await fetchVerified(item.url, item.sha256, file);
  if (!fs.existsSync(file)) throw Object.assign(new Error('RenoDX add-on was removed before use'), { code: 'componentRemoved' });
  return file;
}

module.exports = { V25, VERSIONS, release, cachePath, ensureRenodx };
