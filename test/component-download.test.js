'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const components = require('../src/core/runtime-components');
const { download } = components;

const downloadBytes = Buffer.from('verified component fixture');
const downloadHash = crypto.createHash('sha256').update(downloadBytes).digest('hex');
const ok = (body = downloadBytes) => ({ ok: true, arrayBuffer: async () => body });

function setup(t, responses) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-download-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const response = responses[calls++];
    assert.ok(response, 'unexpected request');
    if (response instanceof Error) throw response;
    return response;
  });
  return { root, file: path.join(root, 'component.zip'), calls: () => calls };
}

test('verified cache is reused offline; corrupt cache is replaced with verified bytes', async t => {
  const s = setup(t, [ok()]);
  fs.writeFileSync(s.file, downloadBytes);
  await download('https://example.test/component', s.file, downloadHash);
  assert.equal(s.calls(), 0);
  fs.writeFileSync(s.file, 'corrupt cache');
  await download('https://example.test/component', s.file, downloadHash);
  assert.equal(s.calls(), 1);
  assert.deepEqual(fs.readFileSync(s.file), downloadBytes);
  assert.deepEqual(fs.readdirSync(s.root), ['component.zip']);
});

for (const [name, response] of [
  ['network failure', new TypeError('fetch failed')],
  ['timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
  ['interrupted body', { ok: true, arrayBuffer: async () => { throw new Error('terminated'); } }],
  ['partial bytes', ok(downloadBytes.subarray(0, 5))],
  ...[408, 429, 500, 502, 503, 504].map(status => [`HTTP ${status}`, { ok: false, status }])
]) {
  test(`retries ${name} and caches only verified success`, async t => {
    const s = setup(t, [response, ok()]);
    await download('https://example.test/component', s.file, downloadHash);
    assert.equal(s.calls(), 2);
    assert.deepEqual(fs.readFileSync(s.file), downloadBytes);
    assert.deepEqual(fs.readdirSync(s.root), ['component.zip']);
  });
}

test('repeated hash mismatches fail closed after three attempts and leave no cache or parts', async t => {
  const s = setup(t, [ok(Buffer.from('bad')), ok(Buffer.from('bad')), ok(Buffer.from('bad'))]);
  fs.writeFileSync(s.file, 'old corrupt cache');
  await assert.rejects(download('https://example.test/component', s.file, downloadHash), /SHA-256/);
  assert.equal(s.calls(), 3);
  assert.deepEqual(fs.readdirSync(s.root), []);
});

test('permanent HTTP errors are not retried', async t => {
  const s = setup(t, [{ ok: false, status: 404 }]);
  await assert.rejects(download('https://example.test/component', s.file, downloadHash), /404/);
  assert.equal(s.calls(), 1);
  assert.deepEqual(fs.readdirSync(s.root), []);
});

test('filesystem failures clean up parts without retrying the network', async t => {
  const s = setup(t, [ok()]);
  t.mock.method(fs.promises, 'rename', async () => { throw new Error('disk failure'); });
  await assert.rejects(download('https://example.test/component', s.file, downloadHash), /disk failure/);
  assert.equal(s.calls(), 1);
  assert.deepEqual(fs.readdirSync(s.root), []);
});

const componentBytes = Buffer.from('official component payload');
const componentSha = crypto.createHash('sha256').update(componentBytes).digest('hex');

function tempFile(t, name = 'component.zip') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'component-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name);
}

test('a verified component is written and reported as cached afterwards', async (t) => {
  const file = tempFile(t);
  await components.fetchVerified('https://example.invalid/x.zip', componentSha, file,
    { fetchBytes: async () => componentBytes });
  assert.deepEqual(fs.readFileSync(file), componentBytes);
  assert.equal(components.cached(file, componentSha), true);
  // The .part file must not be left behind.
  assert.equal(fs.existsSync(file + '.part'), false);
});

test('a failed transfer is reported as a network problem, not a bad file', async (t) => {
  const file = tempFile(t);
  await assert.rejects(
    components.fetchVerified('https://example.invalid/x.zip', componentSha, file,
      { fetchBytes: async () => { throw new Error('Download failed (503)'); } }),
    (error) => error.code === 'componentNetwork' && /503/.test(error.message));
  assert.equal(fs.existsSync(file), false, 'nothing may be written when the download fails');
});

test('bytes that do not match the pinned checksum never reach the disk', async (t) => {
  const file = tempFile(t);
  await assert.rejects(
    components.fetchVerified('https://example.invalid/x.zip', componentSha, file,
      { fetchBytes: async () => Buffer.from('something else entirely') }),
    (error) => error.code === 'componentChecksum' && error.message.includes(componentSha));
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(file + '.part'), false);
});

// What antivirus quarantine looks like from here: the download is fine and
// matches, and then the file is not there any more.
test('a component removed right after it verified is reported as quarantine', async (t) => {
  const file = tempFile(t);
  await assert.rejects(
    components.fetchVerified('https://example.invalid/x.zip', componentSha, file, {
      fetchBytes: async () => componentBytes,
      digest: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
    }),
    (error) => error.code === 'componentRemoved' && error.message === path.dirname(file));
});

test('cached() treats a missing or altered component as not cached', (t) => {
  const file = tempFile(t);
  assert.equal(components.cached(file, componentSha), false, 'missing file');
  fs.writeFileSync(file, 'tampered');
  assert.equal(components.cached(file, componentSha), false, 'wrong bytes');
  fs.writeFileSync(file, componentBytes);
  assert.equal(components.cached(file, componentSha), true);
});
