import test from 'node:test';
import assert from 'node:assert/strict';
import { cctvHopPoolIndices } from './navigation.js';
import { CCTV_HOP_POOL_LIMIT } from './policy.js';

const flatKm = (lat1, lon1, lat2, lon2) =>
  Math.hypot(lat1 - lat2, lon1 - lon2) * 111;

const records = [
  { camera: { id: 'sydney-1', lat: -33.87, lon: 151.21 } },
  { camera: { id: 'san-diego', lat: 32.71, lon: -117.16 } },
  { camera: { id: 'sydney-2', lat: -33.86, lon: 151.2 } },
  { camera: { id: 'melbourne', lat: -37.81, lon: 144.96 } },
];

test('hop pool ranks nearest-first and caps at the limit', () => {
  assert.deepEqual(
    cctvHopPoolIndices(records, -33.87, 151.21, 2, flatKm),
    [0, 2],
    'two Sydney cameras outrank Melbourne and San Diego',
  );
  assert.deepEqual(
    cctvHopPoolIndices(records, -33.87, 151.21, 10, flatKm),
    [0, 2, 3, 1],
  );
});

test('hop pool falls back to catalog order without a fix', () => {
  assert.deepEqual(
    cctvHopPoolIndices(records, NaN, 151.21, 2, flatKm),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    cctvHopPoolIndices(records, -33.87, 151.21, 0, flatKm),
    [0, 2, 3, 1],
  );
  assert.deepEqual(cctvHopPoolIndices([], -33.87, 151.21, 2, flatKm), []);
});

test('hop pool limit stays a slideshow-sized window', () => {
  assert.equal(CCTV_HOP_POOL_LIMIT, 50);
});
