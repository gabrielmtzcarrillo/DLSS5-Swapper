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

// Only one verified downloadable build exists upstream today. Kept as a list
// so a future release is a one-line addition rather than a rewrite.
const VERSIONS = [V25];

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
