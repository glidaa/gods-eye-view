import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LINE_VERTICES,
  QUERY_LIMIT,
  QUERY_SNAP_DEGREES,
} from './policy.js';
import {
  boxContains,
  buildEnergyQuery,
  detectEnergyKind,
  energyRetryDelayMs,
  normalizeEnergyElement,
  snapEnergyBox,
  validateEnergySnapshot,
} from './records.js';

test('query shape stays bounded and pinnable', () => {
  const query = buildEnergyQuery(-34, 150, -33, 151);
  assert.ok(query.startsWith('[out:json][timeout:25];('));
  assert.ok(query.endsWith(`out geom ${QUERY_LIMIT};`));
  // Every selector carries the same bbox; plants stay with the snapshot.
  for (const selector of [
    'node["power"="substation"]',
    'way["power"="substation"]',
    'node["power"="generator"]',
    'way["power"="line"]',
    'node["man_made"="works"]',
    'way["man_made"="works"]',
    'node["man_made"="refinery"]',
    'way["man_made"="refinery"]',
    'node["man_made"="petroleum_well"]',
    'way["man_made"="pipeline"]',
    'node["telecom"="data_center"]',
    'way["telecom"="data_center"]',
  ]) {
    assert.ok(
      query.includes(`${selector}(-34,150,-33,151)`),
      `missing bounded ${selector}`,
    );
  }
  assert.ok(!query.includes('power"="plant"'));
});

test('kind detection covers the rendered tags only', () => {
  assert.equal(detectEnergyKind({ power: 'substation' }), 'substation');
  assert.equal(detectEnergyKind({ power: 'generator' }), 'generator');
  assert.equal(detectEnergyKind({ power: 'line' }), 'line');
  assert.equal(detectEnergyKind({ man_made: 'works' }), 'works');
  assert.equal(detectEnergyKind({ man_made: 'refinery' }), 'refinery');
  assert.equal(detectEnergyKind({ man_made: 'petroleum_well' }), 'well');
  assert.equal(detectEnergyKind({ man_made: 'pipeline' }), 'pipeline');
  assert.equal(detectEnergyKind({ telecom: 'data_center' }), 'data_center');
  assert.equal(detectEnergyKind({ power: 'plant' }), null);
  assert.equal(detectEnergyKind({ power: 'tower' }), null);
  assert.equal(detectEnergyKind(null), null);
});

test('nodes normalize to point records', () => {
  const record = normalizeEnergyElement({
    type: 'node',
    id: 42,
    lat: -33.86,
    lon: 151.21,
    tags: { power: 'substation', name: 'City South', voltage: '132000' },
  });
  assert.deepEqual(record, {
    id: 'ausen:n42',
    osmType: 'node',
    osmId: 42,
    kind: 'substation',
    name: 'City South',
    operator: null,
    voltage: '132000',
    latitude: -33.86,
    longitude: 151.21,
    geometry: null,
    truncated: false,
  });
});

test('line ways keep capped geometry and centroid', () => {
  const geometry = [];
  for (let i = 0; i < MAX_LINE_VERTICES + 50; i += 1) {
    geometry.push({ lat: -33 + i * 0.001, lon: 151 });
  }
  const record = normalizeEnergyElement({
    type: 'way',
    id: 7,
    tags: { power: 'line', voltage: '330000' },
    geometry,
  });
  assert.equal(record.kind, 'line');
  assert.equal(record.geometry.length, MAX_LINE_VERTICES);
  assert.equal(record.truncated, true);
  assert.ok(Math.abs(record.latitude - -32.775) < 0.001);
  assert.equal(record.longitude, 151);
});

test('area ways centroid without keeping rings', () => {
  const record = normalizeEnergyElement({
    type: 'way',
    id: 9,
    tags: { power: 'substation', name: 'Yard' },
    geometry: [
      { lat: -33, lon: 151 },
      { lat: -33, lon: 152 },
      { lat: -34, lon: 152 },
      { lat: -34, lon: 151 },
    ],
  });
  assert.equal(record.latitude, -33.5);
  assert.equal(record.longitude, 151.5);
  assert.equal(record.geometry, null);
});

test('unusable elements read as null, never as zero-island points', () => {
  assert.equal(normalizeEnergyElement(null), null);
  assert.equal(
    normalizeEnergyElement({ type: 'node', id: 1, lat: 0, lon: 0 }),
    null,
  );
  assert.equal(
    normalizeEnergyElement({
      type: 'node',
      id: 1,
      lat: -91,
      lon: 0,
      tags: { power: 'substation' },
    }),
    null,
  );
  assert.equal(
    normalizeEnergyElement({
      type: 'way',
      id: 2,
      tags: { power: 'line' },
      geometry: [],
    }),
    null,
  );
  assert.equal(
    normalizeEnergyElement({
      type: 'relation',
      id: 3,
      tags: { power: 'line' },
    }),
    null,
  );
});

test('snapshot validation fails closed on bad records', () => {
  const good = {
    id: 'ausen:n1',
    kind: 'substation',
    latitude: -33,
    longitude: 151,
    geometry: null,
  };
  assert.equal(
    validateEnergySnapshot({ records: [good], stale: false, saturated: false })
      .records.length,
    1,
  );
  assert.throws(
    () =>
      validateEnergySnapshot({
        records: [{ ...good, latitude: 91 }],
        stale: false,
        saturated: false,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      validateEnergySnapshot({
        records: [good, good],
        stale: false,
        saturated: false,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      validateEnergySnapshot({
        records: [good],
        stale: 'no',
        saturated: false,
      }),
    TypeError,
  );
});

test('box snap and containment reuse nearby views', () => {
  const snapped = snapEnergyBox({
    south: -33.87,
    west: 151.19,
    north: -33.85,
    east: 151.22,
  });
  assert.deepEqual(snapped, {
    south: -33.9,
    west: 151.15,
    north: -33.85,
    east: 151.25,
  });
  assert.equal(
    boxContains(snapped, {
      south: -33.87,
      west: 151.19,
      north: -33.85,
      east: 151.22,
    }),
    true,
  );
  assert.equal(QUERY_SNAP_DEGREES, 0.05);
});

test('retry backs off to a ceiling', () => {
  assert.equal(energyRetryDelayMs(0), 30000);
  assert.equal(energyRetryDelayMs(30000), 60000);
  assert.equal(energyRetryDelayMs(240000), 240000);
  assert.equal(energyRetryDelayMs(999999), 240000);
});
