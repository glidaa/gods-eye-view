import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AU_FUEL_COLORS, AU_MINE_STATUS_COLORS } from './infrastructure.js';
import {
  formatCapacityMw,
  localInfrastructureOverlayCopy,
  mapAnalystRecord,
  resolveFeatureColor,
} from './localGeojsonCore.js';

function load(dir, file) {
  return readFileSync(
    new URL(`./local_data/${dir}/${file}.geojsonl`, import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

// Mainland + Tasmania + external territories (Christmas/Cocos/Norfolk/Lord
// Howe): wide enough for GA's territory rows, tight enough to catch swapped
// or null coordinates.
const AU_BBOX = { south: -45, west: 90, north: -9, east: 170 };

function assertAuPoint(feature) {
  const coords = feature.geometry?.coordinates;
  assert.equal(feature.geometry?.type, 'Point');
  assert.equal(coords?.length, 2);
  const [lon, lat] = coords;
  assert.ok(
    lat >= AU_BBOX.south &&
      lat <= AU_BBOX.north &&
      lon >= AU_BBOX.west &&
      lon <= AU_BBOX.east,
    `${feature.id} at ${lat},${lon} escapes the Australia bbox`,
  );
}

test('Australia snapshots pin their converted feature counts', () => {
  assert.equal(load('au_ports', 'ports').length, 75);
  assert.equal(load('au_mines', 'mines').length, 539);
  assert.equal(load('au_power', 'plants').length, 848);
});

test('every snapshot feature is a named Australia point', () => {
  for (const feature of load('au_ports', 'ports')) {
    assertAuPoint(feature);
    assert.ok(feature.properties?.name?.trim(), `${feature.id} unnamed`);
  }
  for (const feature of load('au_mines', 'mines')) {
    assertAuPoint(feature);
    assert.ok(feature.properties?.name?.trim(), `${feature.id} unnamed`);
  }
  for (const feature of load('au_power', 'plants')) {
    assertAuPoint(feature);
    // Unnamed plants fall back to operator/fuel labels; geometry must hold.
    assert.ok(feature.properties, `${feature.id} has no properties`);
  }
});

test('every plant fuel and mine status has a marker color', () => {
  const fuels = new Set(
    load('au_power', 'plants').map((f) => f.properties?.fuel),
  );
  assert.ok(fuels.size > 1);
  for (const fuel of fuels) {
    assert.ok(
      AU_FUEL_COLORS[fuel],
      `fuel "${fuel}" has no marker color — add it to AU_FUEL_COLORS`,
    );
    assert.equal(
      resolveFeatureColor({ fuel }, '#94a3b8', {
        property: 'fuel',
        mapping: AU_FUEL_COLORS,
        fallback: '#94a3b8',
      }),
      AU_FUEL_COLORS[fuel],
    );
  }
  const statuses = new Set(
    load('au_mines', 'mines').map((f) => f.properties?.status),
  );
  for (const status of statuses) {
    assert.ok(
      AU_MINE_STATUS_COLORS[status],
      `status "${status}" has no marker color`,
    );
  }
});

test('plant capacities are megawatts or null, never invented', () => {
  let populated = 0;
  for (const feature of load('au_power', 'plants')) {
    const mw = feature.properties?.capacityMw;
    if (mw === null || mw === undefined) continue;
    populated += 1;
    assert.equal(typeof mw, 'number');
    assert.ok(mw > 0 && mw < 10000, `${feature.id}: ${mw} MW implausible`);
  }
  assert.ok(populated > 400, `only ${populated} plants carry capacity`);
});

test('siting enrichment is present and finite', () => {
  for (const feature of [
    ...load('au_mines', 'mines'),
    ...load('au_power', 'plants'),
  ]) {
    const props = feature.properties;
    assert.ok(props.nearestPort?.trim(), `${feature.id} lacks a port`);
    assert.ok(
      Number.isFinite(props.nearestPortKm) && props.nearestPortKm >= 0,
      `${feature.id} lacks a port distance`,
    );
    assert.ok(props.nearestLanding?.trim(), `${feature.id} lacks a landing`);
    assert.ok(
      Number.isFinite(props.nearestLandingKm) && props.nearestLandingKm >= 0,
      `${feature.id} lacks a landing distance`,
    );
  }
});

test('known plants resolve to their real neighbours', () => {
  const plants = load('au_power', 'plants');
  const byName = (name) =>
    plants.find((f) => f.properties?.name === name)?.properties;
  const eraring = byName('Eraring Power Station');
  assert.equal(eraring?.fuel, 'coal');
  assert.equal(eraring?.capacityMw, 2880);
  assert.equal(eraring?.nearestPort, 'Newcastle');
  assert.ok(eraring.nearestPortKm < 60);
  const hornsdale = byName('Hornsdale Power Reserve');
  assert.equal(hornsdale?.fuel, 'battery');
  assert.equal(hornsdale?.nearestPort, 'Port Pirie');
});

test('power cards headline fuel, capacity and siting', () => {
  const copy = localInfrastructureOverlayCopy(
    {
      name: 'Eraring Power Station',
      fuel: 'coal',
      capacityMw: 2880,
      nearestPort: 'Newcastle',
      nearestPortKm: 28.8,
      nearestLanding: 'Oxford Falls, NSW, Australia',
      nearestLandingKm: 79.2,
    },
    'local-au-power',
  );
  assert.equal(copy.title, 'Eraring Power Station');
  assert.deepEqual(copy.details, [
    'Coal · 2.88 GW',
    '28.8 km to Newcastle port',
    '79.2 km to Oxford Falls landing',
  ]);
});

test('mine and port cards stay short and honest', () => {
  const mine = localInfrastructureOverlayCopy(
    {
      name: 'Abel',
      status: 'Care and maintenance',
      commodity: 'Coal',
      nearestPort: 'Newcastle',
      nearestPortKm: 17.7,
      nearestLanding: 'Oxford Falls, NSW, Australia',
      nearestLandingKm: 108,
    },
    'local-au-mines',
  );
  assert.equal(mine.title, 'Abel');
  assert.deepEqual(mine.details, [
    'Care and maintenance · Coal',
    '17.7 km to Newcastle port',
    '108 km to Oxford Falls landing',
  ]);
  const port = localInfrastructureOverlayCopy(
    { name: 'Abbot Point', state: 'Queensland', commodities: 'Coal' },
    'local-au-ports',
  );
  assert.equal(port.title, 'Abbot Point');
  assert.deepEqual(port.details, ['Coal', 'Queensland']);
});

test('capacity formats without inventing precision', () => {
  assert.equal(formatCapacityMw(2880), '2.88 GW');
  assert.equal(formatCapacityMw(2210), '2.21 GW');
  assert.equal(formatCapacityMw(150), '150 MW');
  assert.equal(formatCapacityMw(0.5), '0.5 MW');
  assert.equal(formatCapacityMw(null), '');
  assert.equal(formatCapacityMw(Number.NaN), '');
  assert.equal(formatCapacityMw(-3), '');
});

test('analyst records expose the siting fields per layer', () => {
  const power = mapAnalystRecord(
    {
      id: 'osm-node-1',
      lat: -33,
      lon: 151,
      properties: {
        name: 'Eraring',
        fuel: 'coal',
        capacityMw: 2880,
        operator: 'Origin',
        nearestPort: 'Newcastle',
        nearestPortKm: 28.8,
        nearestLanding: 'Oxford Falls',
        nearestLandingKm: 79.2,
      },
    },
    'local-au-power',
  );
  assert.equal(power.fuel, 'coal');
  assert.equal(power.capacityMw, 2880);
  assert.equal(power.nearestPort, 'Newcastle');
  assert.equal(power.nearestPortKm, 28.8);
  assert.equal(power.status, null);
  assert.equal(power.commodity, null);

  const mine = mapAnalystRecord(
    {
      id: 'ga-mine-1',
      lat: -33,
      lon: 151,
      properties: {
        name: 'Abel',
        state: 'NSW',
        status: 'Care and maintenance',
        commodity: 'Coal',
        commodityGroup: 'Coal',
      },
    },
    'local-au-mines',
  );
  assert.equal(mine.status, 'Care and maintenance');
  assert.equal(mine.commodity, 'Coal');
  assert.equal(mine.state, 'NSW');
  assert.equal(mine.fuel, null);
  assert.equal(mine.capacityMw, null);

  const port = mapAnalystRecord(
    {
      id: 'ga-port-1',
      lat: -19.9,
      lon: 148.1,
      properties: { name: 'Abbot Point', commodities: 'Coal' },
    },
    'local-au-ports',
  );
  assert.equal(port.commodities, 'Coal');
  assert.equal(port.fuel, null);
});
