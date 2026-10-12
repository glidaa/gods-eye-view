import { createLocalGeoJsonLayer } from './localGeojsonCore.js';

// Resolved by Vite in builds and relative to this module in other consumers.
const datacentersUrl = new URL(
  './local_data/datacenters/datacenters.geojsonl',
  import.meta.url,
).href;
const damsUrl = new URL('./local_data/dams/dams.geojsonl', import.meta.url)
  .href;
const auPortsUrl = new URL(
  './local_data/au_ports/ports.geojsonl',
  import.meta.url,
).href;
const auMinesUrl = new URL(
  './local_data/au_mines/mines.geojsonl',
  import.meta.url,
).href;
const auPowerUrl = new URL(
  './local_data/au_power/plants.geojsonl',
  import.meta.url,
).href;

/**
 * Marker colors by canonical power-station fuel (`fuel` property of the
 * `local-au-power` snapshot). NSW transport palette: fossil fuels read red,
 * clean generation reads blue, storage reads white. Red is the official NSW
 * Government primary (#D7153A); the blue is a luminous companion — the
 * official NSW blue (#002664) is too dark to read as a marker on the night
 * map. Keys must cover every fuel the conversion emits —
 * src/data/auSnapshots.test.mjs pins that against the bundle.
 */
export const AU_FUEL_COLORS = Object.freeze({
  coal: '#d7153a',
  gas: '#f4604d',
  solar: '#63b3ff',
  wind: '#2b7de4',
  hydro: '#a9d6fb',
  battery: '#ffffff',
  oil: '#96202f',
  bioenergy: '#86b9e8',
  geothermal: '#d3e9fa',
  other: '#94a3b8',
  unknown: '#5b6472',
});

/**
 * Marker colors by mine status (`status` property of the `local-au-mines`
 * snapshot): operating blue, developing white, dormant grey.
 * Pinned against the bundle by src/data/auSnapshots.test.mjs.
 */
export const AU_MINE_STATUS_COLORS = Object.freeze({
  'Operating mine': '#2b7de4',
  'Care and maintenance': '#94a3b8',
  'Developing mine': '#ffffff',
});

/**
 * Create fresh infrastructure layers without starting or loading them.
 * Datacenters, dams, then the three Australia energy/industry snapshots
 * (ports, mines, power stations), with stable standalone identities.
 * @param {object} services Caller-owned context, overlay and render operations.
 * @returns {object[]} Layers in panel order.
 */
export function createInfrastructureLayers(services) {
  const datacenters = createLocalGeoJsonLayer(
    {
      id: 'local-datacenters',
      url: datacentersUrl,
      name: 'Datacenters',
      color: '#00ffff', // Cyan
      icon: '▣',
      source: 'Local',
      labels: true,
      labelMax: 700,
      labelGridPx: 138,
    },
    services,
  );

  const dams = createLocalGeoJsonLayer(
    {
      id: 'local-dams',
      url: damsUrl,
      name: 'Dams',
      color: '#0088ff', // Blue
      icon: '▰',
      source: 'USACE',
      labels: true,
      labelMax: 900,
      labelGridPx: 132,
    },
    services,
  );

  const auPorts = createLocalGeoJsonLayer(
    {
      id: 'local-au-ports',
      url: auPortsUrl,
      name: 'Australian Ports',
      color: '#d7153a', // NSW red
      icon: '⬣',
      source: 'Geoscience Australia',
      labels: true,
      labelMax: 200,
      labelGridPx: 132,
    },
    services,
  );

  const auMines = createLocalGeoJsonLayer(
    {
      id: 'local-au-mines',
      url: auMinesUrl,
      name: 'Australian Mines',
      color: '#2b7de4', // NSW blue fallback; markers color by status
      colorBy: {
        property: 'status',
        mapping: AU_MINE_STATUS_COLORS,
        fallback: '#2b7de4',
      },
      icon: '⬒',
      source: 'Geoscience Australia',
      labels: true,
      labelMax: 700,
      labelGridPx: 138,
    },
    services,
  );

  const auPower = createLocalGeoJsonLayer(
    {
      id: 'local-au-power',
      url: auPowerUrl,
      name: 'Australian Power Stations',
      color: '#94a3b8', // Grey fallback; markers color by fuel
      colorBy: {
        property: 'fuel',
        mapping: AU_FUEL_COLORS,
        fallback: '#94a3b8',
      },
      icon: '⬔',
      source: 'OpenStreetMap',
      labels: true,
      labelMax: 700,
      labelGridPx: 138,
    },
    services,
  );

  return [datacenters, dams, auPorts, auMines, auPower];
}
