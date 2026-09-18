'use strict';
// OptiScaler builds are always explicit, pinned downloads. A game may name a
// pinned build, but arbitrary URLs or local archives never become installable.
const test = require('node:test');
const assert = require('node:assert/strict');
const opti = require('../src/core/optiscaler');

test('the pinned DLSS Unlocked build carries a URL and a digest', () => {
  assert.ok(opti.RELEASES.length >= 1, 'at least the current build is pinned');
  for (const release of opti.RELEASES) {
    assert.match(release.version, /^\d/, release.version);
    assert.match(release.url, /^https:\/\/github\.com\/.+\.zip$/, release.version);
    assert.match(release.sha256, /^[0-9a-f]{64}$/, release.version);
    assert.match(release.licenseHash, /^[0-9a-f]{64}$/, release.version);
  }
  assert.equal(opti.RELEASE, opti.RELEASES[0], 'the first is the default');
});

test('a game names the pinned build, and anything else falls back to the current one', () => {
  assert.equal(opti.releaseFor(opti.RELEASE.version).version, opti.RELEASE.version);
  for (const junk of [undefined, null, '', 'nonsense', '../../etc/passwd', 42, {}]) {
    assert.equal(opti.releaseFor(junk).version, opti.RELEASE.version, String(junk));
  }
});

test('pinned builds have distinct cache identities', () => {
  const versions = opti.RELEASES.map((r) => r.version);
  assert.equal(new Set(versions).size, versions.length, 'distinct version names');
  const digests = opti.RELEASES.map((r) => r.sha256);
  assert.equal(new Set(digests).size, digests.length, 'and distinct archives');
});

test('the Pre-SR Multipass fork is a separate pinned OptiScaler route', () => {
  assert.equal(opti.MULTIPASS_RELEASES[0], opti.MULTIPASS_RELEASE);
  assert.match(opti.MULTIPASS_RELEASE.version, /^\d/, opti.MULTIPASS_RELEASE.version);
  assert.match(opti.MULTIPASS_RELEASE.url, /OptiScaler-DLSSNR-PreSR-Multipass\/releases\/download\/v0\.8\.3\/OptiScaler-NR-v0\.8\.3\.zip$/);
  assert.match(opti.MULTIPASS_RELEASE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(opti.releaseFor(opti.MULTIPASS_RELEASE.version, 'optiscaler-multipass').version, opti.MULTIPASS_RELEASE.version);
  assert.equal(opti.releaseFor('nonsense', 'optiscaler-multipass').version, opti.MULTIPASS_RELEASE.version);
  assert.notEqual(opti.MULTIPASS_RELEASE.sha256, opti.RELEASE.sha256);
});
