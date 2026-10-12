import { NEM_REGIONS, NEM_FUEL_GROUPS } from './policy.js';

/** First matching display group for a fuel_tech id, or null (load-side). */
export function groupForFuelTech(fuelTech) {
  const id = String(fuelTech ?? '');
  for (const { group, match } of NEM_FUEL_GROUPS) {
    if (match.test(id)) return group;
  }
  return null;
}

/**
 * Normalize one /api/nem region entry to a display record. Pure — unusable
 * input reads as an unavailable region, never as a zero mix.
 */
export function normalizeNemRegion(code, entry) {
  const meta = NEM_REGIONS.find((region) => region.code === code) || {
    label: code,
    lat: null,
    lon: null,
  };
  const base = {
    code,
    label: meta.label,
    lat: meta.lat,
    lon: meta.lon,
    status: 'unavailable',
    demandMw: null,
    observedAt: null,
    fuels: {},
    totalMw: 0,
    top: [],
  };
  if (!entry || entry.status !== 'ok') return base;
  const fuels = {};
  const raw = entry.fuels && typeof entry.fuels === 'object' ? entry.fuels : {};
  for (const [fuelTech, mw] of Object.entries(raw)) {
    const group = groupForFuelTech(fuelTech);
    if (!group) continue;
    if (typeof mw !== 'number' || !Number.isFinite(mw) || mw < 0) continue;
    fuels[group] = Math.round(((fuels[group] || 0) + mw) * 100) / 100;
  }
  const totalMw = Object.values(fuels).reduce((sum, mw) => sum + mw, 0);
  const top = Object.entries(fuels)
    .map(([group, mw]) => ({
      group,
      mw,
      pct: totalMw > 0 ? Math.round((mw / totalMw) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.mw - a.mw);
  return {
    ...base,
    status: 'ok',
    demandMw:
      typeof entry.demandMw === 'number' && Number.isFinite(entry.demandMw)
        ? entry.demandMw
        : null,
    observedAt: typeof entry.observedAt === 'string' ? entry.observedAt : null,
    fuels,
    totalMw: Math.round(totalMw * 100) / 100,
    top,
  };
}

/**
 * One-line mix blurb for the panel legend ("Coal 34% · Solar 48% · 8.2 GW").
 * Pure — an unavailable region names itself instead of showing zeros.
 */
export function formatMixBlurb(region) {
  if (!region || region.status !== 'ok') return 'Mix unavailable';
  const parts = region.top
    .slice(0, 3)
    .map((fuel) => `${fuel.group} ${fuel.pct}%`);
  const total =
    region.totalMw >= 1000
      ? `${(Math.round((region.totalMw / 1000) * 100) / 100).toString()} GW`
      : `${Math.round(region.totalMw).toLocaleString('en-US')} MW`;
  const demand =
    typeof region.demandMw === 'number'
      ? ` of ${Math.round(region.demandMw).toLocaleString('en-US')} MW demand`
      : '';
  return parts.length
    ? `${parts.join(' · ')} · ${total}${demand}`
    : `No supply-side generation reported · ${total}${demand}`;
}

/**
 * Analyst records: one row per region × generating fuel group. Zero-MW
 * groups are omitted so counts answer "what is generating", not "what the
 * feed names". Pure.
 */
export function nemAnalystRecords(regions) {
  const rows = [];
  for (const region of regions || []) {
    if (!region || region.status !== 'ok') continue;
    for (const fuel of region.top || []) {
      if (!(fuel.mw > 0)) continue;
      rows.push({
        id: `nem:${region.code}:${fuel.group}`,
        region: region.label,
        fuel: fuel.group,
        mw: fuel.mw,
        pct: fuel.pct,
        lat: region.lat,
        lon: region.lon,
      });
    }
  }
  return rows;
}
