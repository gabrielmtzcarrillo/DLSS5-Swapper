'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/overlay-protocol');

function feederStatus(version, effect = `Feeder ${version}`) {
  return {
    epoch: 1, effects: true, tools: [], feedPresent: true, feedVersion: version,
    feedReason: '', feedTools: Array.from({ length: 8 }, (_, i) => ({
      id: 301 + i, kind: i === 0 ? 1 : 0, effect,
      name: `control-${i}`, min: i === 0 ? 0 : -2, max: i === 0 ? 1 : 2,
      step: 0.01, value: 0, available: i !== 0
    }))
  };
}

test('F8 preserves the exact known-good Feeder 0.12.0 identity', () => {
  const status = protocol.status(feederStatus('0.12.0'));
  assert.equal(status.feedVersion, '0.12.0');
  assert.equal(status.feedTools[0].effect, 'Feeder 0.12.0');
});

test('F8 keeps legacy 0.12.0 overlay status compatible', () => {
  const value = feederStatus('0.12.0');
  delete value.feedVersion;
  const status = protocol.status(value);
  assert.equal(status.feedVersion, '0.12.0');
});

for (const version of ['0.13.1-beta.1', '0.14.0-beta.4']) test(`F8 preserves Feeder ${version} identity`, () => {
  const status = protocol.status(feederStatus(version));
  assert.equal(status.feedVersion, version);
  assert.equal(status.feedTools[0].effect, `Feeder ${version}`);
  assert.throws(() => protocol.status(feederStatus(version, 'Feeder 0.12.0')), /Invalid Feeder tool/);
});

test('F8 rejects an unknown Feeder compatibility label', () => {
  assert.throws(() => protocol.status(feederStatus('0.15.1')), /Invalid Feeder status/);
});
