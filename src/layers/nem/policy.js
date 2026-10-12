/**
 * @file Live NEM generation mix layer — "how Australia gets power now".
 *
 * Data source: OpenElectricity 5-minute regional power stats, fetched
 * server-side through the `/api/nem` proxy (5-minute cache, per-region
 * availability). This layer renders no map entities: the mix surfaces as
 * per-region panel legends and as analyst records for voice queries
 * ("what powers Queensland right now?").
 *
 * Coverage is the National Electricity Market (NSW, QLD, VIC, SA, TAS) —
 * not WA's WEM, off-grid, or per-station output.
 *
 * @module layers/nem/policy
 */

export const LAYER_ID = 'nem-generation';

export const NEM_URL = '/api/nem';

/** Refetch at most this often while enabled; the proxy caches for 5 minutes. */
export const NEM_REFRESH_MS = 5 * 60 * 1000;

/** NEM regions with representative points (state capitals) for scoping. */
export const NEM_REGIONS = Object.freeze([
  Object.freeze({ code: 'NSW1', label: 'NSW', lat: -33.87, lon: 151.21 }),
  Object.freeze({ code: 'QLD1', label: 'QLD', lat: -27.47, lon: 153.03 }),
  Object.freeze({ code: 'VIC1', label: 'VIC', lat: -37.81, lon: 144.96 }),
  Object.freeze({ code: 'SA1', label: 'SA', lat: -34.93, lon: 138.6 }),
  Object.freeze({ code: 'TAS1', label: 'TAS', lat: -42.88, lon: 147.33 }),
]);

/**
 * Display groups, in legend order. `match` tests OpenElectricity fuel_tech
 * ids; the first matching group wins. Series with no group (exports, pumps,
 * curtailment, battery charging) are load-side or spilled energy — they
 * never join the supply mix.
 */
export const NEM_FUEL_GROUPS = Object.freeze([
  Object.freeze({ group: 'Coal', match: /^coal_/ }),
  Object.freeze({ group: 'Gas', match: /^gas_/ }),
  Object.freeze({ group: 'Hydro', match: /^hydro$/ }),
  Object.freeze({ group: 'Wind', match: /^wind/ }),
  Object.freeze({ group: 'Solar', match: /^solar_/ }),
  Object.freeze({ group: 'Battery', match: /^battery_discharging$/ }),
  Object.freeze({ group: 'Bioenergy', match: /^bioenergy_/ }),
  Object.freeze({ group: 'Distillate', match: /^distillate$/ }),
  Object.freeze({ group: 'Imports', match: /^imports$/ }),
]);

export const NEM_FUEL_COLORS = Object.freeze({
  Coal: '#d7153a',
  Gas: '#f4604d',
  Hydro: '#a9d6fb',
  Wind: '#2b7de4',
  Solar: '#63b3ff',
  Battery: '#ffffff',
  Bioenergy: '#86b9e8',
  Distillate: '#96202f',
  Imports: '#94a3b8',
});
