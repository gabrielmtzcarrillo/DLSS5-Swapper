'use strict';

const fs = require('fs');
const path = require('path');
const { fetchVerified } = require('./runtime-components');

// The public v2.5 build is distributed by the RenoDX DLSS installer project.
// Keep the URL and digest pinned so selecting it cannot silently install a
// different rolling-release binary.
const V25 = {
  file: 'renodx-dlss5-v2.5.addon64',
  url: 'https://github.com/yumlevi/renodx-dlss-installer/releases/download/latest/renodx-dlss5-v2.5.addon64',
  sha256: '87aef9ddd937c7241e6bf8d8efea0045d63559135e254c60dab316db3d3a4aee'
};

function cachePath(cacheRoot) {
  return path.join(path.resolve(cacheRoot), 'components', V25.file);
}

async function ensureRenoDxV25(cacheRoot) {
  const file = cachePath(cacheRoot);
  await fetchVerified(V25.url, V25.sha256, file);
  if (!fs.existsSync(file)) throw Object.assign(new Error('RenoDX v2.5 add-on was removed before use'), { code: 'componentRemoved' });
  return file;
}

module.exports = { V25, cachePath, ensureRenoDxV25 };
