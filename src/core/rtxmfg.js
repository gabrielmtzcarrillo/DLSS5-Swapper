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

function fail(code, message = code) { return Object.assign(new Error(message), { code }); }

async function ensureRTXMFG(cacheRoot) {
  const base = path.join(path.resolve(cacheRoot), 'components', `RTXMFG-${RELEASE.version}`);
  const archive = base + '.zip';
  if (!fs.existsSync(archive) || digest(archive) !== RELEASE.sha256) {
    await fetchVerified(RELEASE.url, RELEASE.sha256, archive);
  }
  if (digest(archive) !== RELEASE.sha256) throw fail('errMfgPayload');
  await fs.promises.rm(base, { recursive: true, force: true });
  await extractZip(archive, { dir: base });
  const dll = safePath(base, 'RTXMFG.dll');
  if (pe.getBitness(dll) !== 64) throw fail('errMfgPayload');
  return base;
}

module.exports = { RELEASE, ensureRTXMFG };
