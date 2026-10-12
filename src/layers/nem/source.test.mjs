import test from 'node:test';
import assert from 'node:assert/strict';
import { createNemSource } from './source.js';

function payloadResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function regionEntry(fuels) {
  return { status: 'ok', demandMw: 1000, observedAt: null, fuels };
}

test('snapshot normalizes all five regions', async () => {
  const seen = [];
  const source = createNemSource({
    fetchImpl: async (url, options) => {
      seen.push([url, options]);
      return payloadResponse({
        schemaVersion: 1,
        fetchedAt: 123,
        stale: false,
        unavailable: false,
        reason: null,
        regions: {
          NSW1: regionEntry({ coal_black: 100 }),
          QLD1: regionEntry({ coal_black: 200 }),
          VIC1: regionEntry({ coal_brown: 300 }),
          SA1: regionEntry({ gas_ocgt: 400 }),
          TAS1: regionEntry({ hydro: 500 }),
        },
      });
    },
  });
  const snapshot = await source.getSnapshot(undefined);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], '/api/nem');
  assert.equal(snapshot.regions.length, 5);
  assert.deepEqual(
    snapshot.regions.map((region) => [region.code, region.totalMw]),
    [
      ['NSW1', 100],
      ['QLD1', 200],
      ['VIC1', 300],
      ['SA1', 400],
      ['TAS1', 500],
    ],
  );
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.unavailable, false);
});

test('malformed payloads fail closed', async () => {
  for (const payload of [
    null,
    { schemaVersion: 1 },
    { schemaVersion: 2, regions: {} },
  ]) {
    const source = createNemSource({
      fetchImpl: async () => payloadResponse(payload),
    });
    await assert.rejects(source.getSnapshot(undefined), /incomplete/);
  }
  const httpSource = createNemSource({
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(httpSource.getSnapshot(undefined), /unavailable/);
});
