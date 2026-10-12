import test from 'node:test';
import assert from 'node:assert/strict';
import { createAusEnergySource } from './source.js';

const BOX = { south: -34, west: 150, north: -33, east: 151 };

function jsonResponse(payload, headers = {}) {
  return {
    ok: true,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => payload,
  };
}

test('unbounded boxes never reach the proxy', async () => {
  const source = createAusEnergySource({
    fetchImpl: () => {
      throw new Error('must not fetch');
    },
  });
  await assert.rejects(source.fetch(null, undefined), TypeError);
  await assert.rejects(
    source.fetch({ ...BOX, north: BOX.south }, undefined),
    TypeError,
  );
  await assert.rejects(
    source.fetch({ south: -40, west: 140, north: -30, east: 150 }, undefined),
    TypeError,
  );
});

test('elements normalize, dedupe and cap', async () => {
  const node = (id, tags) => ({
    type: 'node',
    id,
    lat: -33.5,
    lon: 150.5,
    tags,
  });
  const calls = [];
  const source = createAusEnergySource({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({
        elements: [
          node(1, { power: 'substation', name: 'Yard' }),
          node(1, { power: 'substation', name: 'Yard' }),
          node(2, { power: 'tower' }),
        ],
      });
    },
  });
  const snapshot = await source.fetch(BOX, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/overpass');
  assert.ok(
    decodeURIComponent(calls[0][1].body).includes('power"="substation'),
  );
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].id, 'ausen:n1');
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.saturated, false);
});

test('stale cache and error remarks surface honestly', async () => {
  const staleSource = createAusEnergySource({
    fetchImpl: async () =>
      jsonResponse(
        {
          elements: [
            {
              type: 'node',
              id: 1,
              lat: -33.5,
              lon: 150.5,
              tags: { power: 'substation' },
            },
          ],
        },
        { 'x-overpass-cache': 'STALE' },
      ),
  });
  const stale = await staleSource.fetch(BOX, undefined);
  assert.equal(stale.stale, true);

  const remarkSource = createAusEnergySource({
    fetchImpl: async () => jsonResponse({ elements: [], remark: 'timeout' }),
  });
  await assert.rejects(remarkSource.fetch(BOX, undefined), /incomplete/);

  const httpSource = createAusEnergySource({
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  await assert.rejects(httpSource.fetch(BOX, undefined), /rate-limited/);
});
