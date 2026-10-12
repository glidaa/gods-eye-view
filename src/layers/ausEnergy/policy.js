/**
 * @file Live mapped energy & industry context layer (Australia-first).
 *
 * Data source: OpenStreetMap contributors — substations, generators,
 * transmission lines, refineries, works, petroleum wells, pipelines and
 * data centers, fetched viewport-bounded through the existing generic
 * `/api/overpass` proxy (the same one traffic and ALPR use) — no new server
 * route. OSM data remains ODbL 1.0, separate from the MIT code.
 *
 * This is mapped infrastructure context, not a network model: no voltages
 * are guaranteed, no capacity figures, nothing beyond what a contributor
 * chose to publish to OSM. Coverage and tag accuracy are not guaranteed.
 * The bundled `local-au-power` snapshot owns power plants; this layer owns
 * everything around them (grid + industry) so the two never double-render.
 *
 * @module layers/ausEnergy/policy
 */

export const LAYER_ID = 'aus-energy-grid';

export const OVERPASS_URL = '/api/overpass';

export const REQUEST_DEBOUNCE_MS = 500;

/** Keep public Overpass queries city-scale, never globe-wide. */
export const MAX_VIEWPORT_DEGREES = 3;

/** Overpass `out geom N;` cap — also detects possibly truncated coverage. */
export const QUERY_LIMIT = 1000;

/** Render cap. Kept at QUERY_LIMIT so a count can never disagree with the map. */
export const MAX_RENDERED = 1000;

/** Maximum polyline vertices kept per transmission line / pipeline. */
export const MAX_LINE_VERTICES = 400;

/** Query boxes are snapped outward to this grid so nearby camera moves reuse
 * one Overpass request body (the shared proxy keys its cache and in-flight
 * dedupe by the exact body) instead of each becoming a distinct upstream fetch. */
export const QUERY_SNAP_DEGREES = 0.05;

/** A view still fully inside the last snapped query box reuses those records
 * for this long before asking Overpass again. */
export const QUERY_REUSE_MS = 10 * 60 * 1000;

/** Per-kind marker palette in NSW transport blue/red/white, with coral selection. */
export const ENERGY_KIND_COLORS = Object.freeze({
  substation: '#2b7de4',
  generator: '#63b3ff',
  line: '#d7153a',
  works: '#94a3b8',
  refinery: '#f4604d',
  well: '#96202f',
  pipeline: '#86b9e8',
  data_center: '#ffffff',
});
export const ENERGY_SELECTED_COLOR = '#ff6474';

export const KIND_LABELS = Object.freeze({
  substation: 'Substation',
  generator: 'Generator',
  line: 'Transmission line',
  works: 'Industrial works',
  refinery: 'Refinery',
  well: 'Petroleum well',
  pipeline: 'Pipeline',
  data_center: 'Data center',
});
