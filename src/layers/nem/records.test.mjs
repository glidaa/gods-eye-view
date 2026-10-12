import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupForFuelTech,
  normalizeNemRegion,
  formatMixBlurb,
  nemAnalystRecords,
} from './records.js';

test('fuel groups route supply-side series and reject the rest', () => {
  assert.equal(groupForFuelTech('coal_black'), 'Coal');
  assert.equal(groupForFuelTech('coal_brown'), 'Coal');
  assert.equal(groupForFuelTech('gas_ocgt'), 'Gas');
  assert.equal(groupForFuelTech('hydro'), 'Hydro');
  assert.equal(groupForFuelTech('wind'), 'Wind');
  assert.equal(groupForFuelTech('solar_utility'), 'Solar');
  assert.equal(groupForFuelTech('solar_rooftop'), 'Solar');
  assert.equal(groupForFuelTech('battery_discharging'), 'Battery');
  assert.equal(groupForFuelTech('bioenergy_biomass'), 'Bioenergy');
  assert.equal(groupForFuelTech('distillate'), 'Distillate');
  assert.equal(groupForFuelTech('imports'), 'Imports');
  // Load-side and spilled energy never join the supply mix.
  assert.equal(groupForFuelTech('exports'), null);
  assert.equal(groupForFuelTech('pumps'), null);
  assert.equal(groupForFuelTech('battery_charging'), null);
  assert.equal(groupForFuelTech('curtailment_wind'), null);
  assert.equal(groupForFuelTech('curtailment_solar_utility'), null);
  assert.equal(groupForFuelTech('mystery_future_fuel'), null);
});

test('region normalization groups, totals and ranks', () => {
  const region = normalizeNemRegion('NSW1', {
    status: 'ok',
    demandMw: 7058.75,
    observedAt: '2026-10-06T06:15:00.000Z',
    fuels: {
      coal_black: 2791.25,
      solar_utility: 2553.16,
      solar_rooftop: 2606.95,
      wind: 1719.79,
      gas_ocgt: 45,
      hydro: 21.99,
      battery_discharging: 32.27,
      battery_charging: 32.83,
      exports: 400.36,
      pumps: 87.04,
    },
  });
  assert.equal(region.status, 'ok');
  assert.equal(region.label, 'NSW');
  assert.equal(region.lat, -33.87);
  assert.deepEqual(region.fuels, {
    Coal: 2791.25,
    Solar: 5160.11,
    Wind: 1719.79,
    Gas: 45,
    Hydro: 21.99,
    Battery: 32.27,
  });
  assert.equal(region.totalMw, 9770.41);
  assert.deepEqual(
    region.top.map((fuel) => fuel.group),
    ['Solar', 'Coal', 'Wind', 'Gas', 'Battery', 'Hydro'],
  );
  assert.equal(region.top[0].pct, 52.8);
  assert.equal(region.demandMw, 7058.75);
});

test('unusable regions read unavailable, never zero', () => {
  for (const entry of [null, undefined, {}, { status: 'unavailable' }]) {
    const region = normalizeNemRegion('SA1', entry);
    assert.equal(region.status, 'unavailable');
    assert.equal(region.totalMw, 0);
    assert.deepEqual(region.top, []);
    assert.equal(formatMixBlurb(region), 'Mix unavailable');
  }
  assert.equal(formatMixBlurb(null), 'Mix unavailable');
});

test('mix blurb headlines the top three plus scale', () => {
  const region = normalizeNemRegion('NSW1', {
    status: 'ok',
    demandMw: 7058.75,
    observedAt: null,
    fuels: { coal_black: 2791.25, solar_utility: 5160.11, wind: 1719.79 },
  });
  assert.equal(
    formatMixBlurb(region),
    'Solar 53.4% · Coal 28.9% · Wind 17.8% · 9.67 GW of 7,059 MW demand',
  );
});

test('analyst records cover generating fuels only', () => {
  const rows = nemAnalystRecords([
    normalizeNemRegion('TAS1', {
      status: 'ok',
      demandMw: 1100,
      observedAt: null,
      fuels: { hydro: 900, wind: 150, gas_ocgt: 0 },
    }),
    normalizeNemRegion('SA1', { status: 'unavailable' }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.region, row.fuel, row.mw]),
    [
      ['TAS', 'Hydro', 900],
      ['TAS', 'Wind', 150],
    ],
  );
  assert.equal(rows[0].lat, -42.88);
  assert.equal(rows[0].lon, 147.33);
  assert.ok(rows[0].id.startsWith('nem:TAS1:'));
});
