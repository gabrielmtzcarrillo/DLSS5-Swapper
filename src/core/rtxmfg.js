'use strict';

const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');
const pe = require('./pe');
const { fetchVerified, digest } = require('./runtime-components');
const { safePath } = require('./file-journal');

const RELEASE = Object.freeze({
  version: '1.3.2',
  url: 'https://github.com/dashdogy/RTX40MFG-Unlock/releases/download/v1.3.2/RTXMFG-v1.3.2.zip',
  sha256: '7baec084500bcc806be488c17b4822fdef0ecc802fd7d23c5be8184fbe660811'
});

// Older upstream tags (v1.2.x and earlier) package a different, ASI-loader
// based build this installer has no deployment logic for, so only the
// current single-DLL release is listed. Kept as an array so a future
// compatible release is a one-line addition rather than a rewrite.
const VERSIONS = [RELEASE];

function release(version = RELEASE.version) {
  return VERSIONS.find(item => item.version === version) || RELEASE;
}

function fail(code, message = code) { return Object.assign(new Error(message), { code }); }

async function ensureRTXMFG(cacheRoot, version) {
  const item = release(version);
  const base = path.join(path.resolve(cacheRoot), 'components', `RTXMFG-${item.version}`);
  const archive = base + '.zip';
  if (!fs.existsSync(archive) || digest(archive) !== item.sha256) {
    await fetchVerified(item.url, item.sha256, archive);
  }
  if (digest(archive) !== item.sha256) throw fail('errMfgPayload');
  await fs.promises.rm(base, { recursive: true, force: true });
  await extractZip(archive, { dir: base });
  const dll = safePath(base, 'RTXMFG.dll');
  if (pe.getBitness(dll) !== 64) throw fail('errMfgPayload');
  return base;
}

module.exports = { RELEASE, VERSIONS, release, ensureRTXMFG };
