import {
  QUERY_LIMIT,
  QUERY_SNAP_DEGREES,
  MAX_LINE_VERTICES,
} from './policy.js';

export function textTag(value) {
  const t = String(value ?? '').trim();
  return t || null;
}

export function numTag(value) {
  // `Number('')` and `Number('   ')` are 0, not NaN — a blank or whitespace-only
  // tag value must read as missing, never as a zero measurement.
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Snap a viewport box OUTWARD to the query grid, clamped to valid ranges.
 * Pure so the reuse contract is pinnable.
 * @param {{south:number,west:number,north:number,east:number}} box
 * @param {number} [step=QUERY_SNAP_DEGREES]
 */
export function snapEnergyBox(box, step = QUERY_SNAP_DEGREES) {
  const down = (v) => Math.floor(v / step) * step;
  const up = (v) => Math.ceil(v / step) * step;
  return {
    south: Math.max(-90, down(box.south)),
    west: Math.max(-180, down(box.west)),
    north: Math.min(90, up(box.north)),
    east: Math.min(180, up(box.east)),
  };
}

/** Whether `inner` lies entirely within `outer` (no dateline handling; the viewport gate already rejects east <= west). */
export function boxContains(outer, inner) {
  if (!outer || !inner) return false;
  return (
    inner.south >= outer.south &&
    inner.north <= outer.north &&
    inner.west >= outer.west &&
    inner.east <= outer.east
  );
}

/**
 * Backoff progression for the unavailable-state retry: 30 s, doubling to a
 * 240 s ceiling. Pure so the progression is pinnable without booting the layer.
 */
export function energyRetryDelayMs(prevDelayMs) {
  const RETRY_MIN_MS = 30000;
  const RETRY_CEIL_MS = 240000;
  if (!Number.isFinite(prevDelayMs) || prevDelayMs <= 0) return RETRY_MIN_MS;
  return Math.min(prevDelayMs * 2, RETRY_CEIL_MS);
}

/**
 * Classify one element's tags into a display kind. Null when the tags match
 * nothing this layer renders. `power=plant` is deliberately absent — the
 * bundled `local-au-power` snapshot owns plants.
 * @param {object} [tags] OSM tags.
 * @returns {string|null} Kind key from policy KIND_LABELS.
 */
export function detectEnergyKind(tags) {
  const t = tags && typeof tags === 'object' ? tags : {};
  if (t.power === 'substation') return 'substation';
  if (t.power === 'generator') return 'generator';
  if (t.power === 'line') return 'line';
  if (t.man_made === 'refinery') return 'refinery';
  if (t.man_made === 'works') return 'works';
  if (t.man_made === 'petroleum_well') return 'well';
  if (t.man_made === 'pipeline') return 'pipeline';
  if (t.telecom === 'data_center') return 'data_center';
  return null;
}

function validLonLat(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180 &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90
  );
}

/**
 * Map one raw Overpass element to a plain energy record. Nodes read lat/lon;
 * ways read their inline `geometry` (the query asks for `out geom`) and
 * centroid to a bbox-center point. Lines and pipelines keep their vertices
 * (capped); area ways (substations, works) keep the centroid only. Null for
 * anything unusable.
 */
export function normalizeEnergyElement(el) {
  if (!el || !Number.isSafeInteger(el.id) || el.id <= 0) return null;
  const tags = el.tags || {};
  const kind = detectEnergyKind(tags);
  if (!kind) return null;
  const lineKind = kind === 'line' || kind === 'pipeline';
  let lat = null;
  let lon = null;
  let geometry = null;
  let truncated = false;
  if (el.type === 'node') {
    if (!validLonLat(el.lon, el.lat)) return null;
    lat = el.lat;
    lon = el.lon;
  } else if (el.type === 'way' && Array.isArray(el.geometry)) {
    const points = el.geometry.filter((p) => p && validLonLat(p.lon, p.lat));
    if (!points.length) return null;
    if (lineKind) {
      truncated = points.length > MAX_LINE_VERTICES;
      geometry = points.slice(0, MAX_LINE_VERTICES).map((p) => [p.lon, p.lat]);
    }
    let south = 90;
    let north = -90;
    let west = 180;
    let east = -180;
    for (const p of points) {
      if (p.lat < south) south = p.lat;
      if (p.lat > north) north = p.lat;
      if (p.lon < west) west = p.lon;
      if (p.lon > east) east = p.lon;
    }
    lat = (south + north) / 2;
    lon = (east + west) / 2;
  } else {
    return null;
  }
  return {
    id: `ausen:${el.type[0]}${el.id}`,
    osmType: el.type,
    osmId: el.id,
    kind,
    name: textTag(tags.name),
    operator: textTag(tags.operator),
    voltage: textTag(tags.voltage),
    latitude: lat,
    longitude: lon,
    geometry,
    truncated,
  };
}

/**
 * Overpass QL for the viewport. One bounded selector per tag pair (the
 * shared proxy rejects any unbounded selector), full inline geometry for
 * ways so lines render without a second fetch. Exported so the query shape
 * is pinnable.
 */
export function buildEnergyQuery(south, west, north, east) {
  const box = `(${south},${west},${north},${east})`;
  const selectors = [
    `node["power"="substation"]${box}`,
    `way["power"="substation"]${box}`,
    `node["power"="generator"]${box}`,
    `way["power"="line"]${box}`,
    `node["man_made"="works"]${box}`,
    `way["man_made"="works"]${box}`,
    `node["man_made"="refinery"]${box}`,
    `way["man_made"="refinery"]${box}`,
    `node["man_made"="petroleum_well"]${box}`,
    `way["man_made"="pipeline"]${box}`,
    `node["telecom"="data_center"]${box}`,
    `way["telecom"="data_center"]${box}`,
  ];
  return (
    `[out:json][timeout:25];(${selectors.join(';')};);` +
    `out geom ${QUERY_LIMIT};`
  );
}

/** Validate a source-independent snapshot before replacing the accepted display. */
export function validateEnergySnapshot(snapshot) {
  if (
    !Array.isArray(snapshot?.records) ||
    typeof snapshot.stale !== 'boolean' ||
    typeof snapshot.saturated !== 'boolean'
  ) {
    throw new TypeError('Energy source returned an invalid snapshot');
  }
  const ids = new Set();
  for (const record of snapshot.records) {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !record.id.trim() ||
      ids.has(record.id) ||
      typeof record.kind !== 'string' ||
      !Number.isFinite(record.latitude) ||
      Math.abs(record.latitude) > 90 ||
      !Number.isFinite(record.longitude) ||
      Math.abs(record.longitude) > 180 ||
      (record.geometry != null &&
        (!Array.isArray(record.geometry) ||
          record.geometry.some(
            (p) =>
              !Array.isArray(p) || p.length !== 2 || !validLonLat(p[0], p[1]),
          )))
    ) {
      throw new TypeError('Energy source returned an invalid record');
    }
    ids.add(record.id);
  }
  return snapshot;
}
