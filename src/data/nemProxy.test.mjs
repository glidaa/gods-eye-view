import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  nemProxy,
  parseNemRegion,
  lastFiniteSample,
} from '../../server/providers/nem.js';

function series(id, data, extra = {}) {
  return {
    id,
    type: 'power',
    data_type: 'power',
    units: 'MW',
    history: {
      start: '2026-10-06T06:10:00+10:00',
      last: '2026-10-06T06:15:00+10:00',
      interval: '5m',
      data,
    },
    ...extra,
  };
}

function feed(region, entries) {
  return { type: 'power', network: 'nem', region, data: entries };
}

test('last sample wins; trailing gaps scan back, never zero-fill', () => {
  assert.equal(lastFiniteSample({ data: [1, 2, 3] }), 3);
  assert.equal(lastFiniteSample({ data: [1, null, 2, null] }), 2);
  assert.equal(lastFiniteSample({ data: [null, 'x', Number.NaN] }), null);
  assert.equal(lastFiniteSample({}), null);
  assert.equal(lastFiniteSample(null), null);
});

test('region parse keeps power series and drops the rest', () => {
  const parsed = parseNemRegion(
    'NSW1',
    feed('NSW1', [
      series('au.nem.nsw1.demand', [7000, 7058.75]),
      series('au.nem.nsw1.fuel_tech.coal_black.power', [2800, 2791.25], {
        fuel_tech: 'coal_black',
      }),
      series('au.nem.nsw1.fuel_tech.gas_ccgt.power', [0, 0], {
        fuel_tech: 'gas_ccgt',
      }),
      {
        ...series('au.nem.nsw1.fuel_tech.coal_black.emissions', [200]),
        data_type: 'emissions',
        fuel_tech: 'coal_black',
      },
      { ...series('au.nem.nsw1.price', [83.99]), data_type: 'price' },
    ]),
  );
  assert.equal(parsed.demandMw, 7058.75);
  assert.deepEqual(parsed.fuels, { coal_black: 2791.25, gas_ccgt: 0 });
  assert.equal(parsed.observedAt, '2026-10-05T20:15:00.000Z');
});

test('region parse fails closed on shape violations', () => {
  assert.throws(() => parseNemRegion('NSW1', { type: 'power' }), /invalid/);
  assert.throws(() => parseNemRegion('NSW1', feed('QLD1', [])), /invalid/);
  assert.throws(
    () =>
      parseNemRegion(
        'NSW1',
        feed('NSW1', [
          series('au.nem.nsw1.fuel_tech.hydro.power', [50], {
            fuel_tech: 'hydro',
          }),
          series('au.nem.nsw1.fuel_tech.hydro.power', [60], {
            fuel_tech: 'hydro',
          }),
        ]),
      ),
    /invalid/,
  );
  // A demand-only feed is honest, not malformed.
  const demandOnly = parseNemRegion(
    'NSW1',
    feed('NSW1', [series('au.nem.nsw1.demand', [100])]),
  );
  assert.equal(demandOnly.demandMw, 100);
  assert.deepEqual(demandOnly.fuels, {});
});

function install(options = {}) {
  let handler;
  const plugin = nemProxy({ now: () => Date.now(), ...options });
  plugin.configureServer({
    middlewares: {
      use(path, callback) {
        assert.equal(path, '/api/nem');
        handler = callback;
      },
    },
  });
  const begin = (url = '/', method = 'GET') => {
    const res = new EventEmitter();
    res.writeHead = (code, headers) => {
      res.statusCode = code;
      res.headers = headers;
    };
    res.end = (body) => {
      res.body = body;
    };
    return { res, done: handler({ url, method }, res).then(() => res) };
  };
  return { request: (url, method) => begin(url, method).done };
}

test('proxy serves trimmed regions and survives one region outage', async () => {
  const calls = [];
  const { request } = install({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/TAS1/')) {
        return new Response('boom', { status: 500 });
      }
      const region = url.split('/').at(-3);
      return Response.json(
        feed(region, [
          series(`au.nem.${region.toLowerCase()}.demand`, [100]),
          series(`au.nem.${region.toLowerCase()}.fuel_tech.hydro.power`, [50], {
            fuel_tech: 'hydro',
          }),
        ]),
      );
    },
  });
  const res = await request();
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.source, 'OpenElectricity');
  assert.equal(payload.unavailable, false);
  assert.equal(payload.stale, false);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((url) => url.includes('data.openelectricity.org.au')));
  assert.equal(payload.regions.NSW1.status, 'ok');
  assert.equal(payload.regions.NSW1.fuels.hydro, 50);
  assert.equal(payload.regions.NSW1.demandMw, 100);
  assert.equal(payload.regions.TAS1.status, 'unavailable');
  // Second request reuses the cache without refetching.
  await request();
  assert.equal(calls.length, 5);
});

test('proxy rejects non-GET and unknown paths', async () => {
  const { request } = install({ fetchImpl: async () => Response.json({}) });
  const post = await request('/', 'POST');
  assert.equal(post.statusCode, 405);
  const bad = await request('/nope');
  assert.equal(bad.statusCode, 400);
});
