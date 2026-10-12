import { readResponseTextCapped } from './common/http.js';

const NEM_REGIONS = ['NSW1', 'QLD1', 'VIC1', 'SA1', 'TAS1'];
const FEED_URL = (region) =>
  `https://data.openelectricity.org.au/v4/stats/au/NEM/${region}/power/7d.json`;
const REGION_CAP = 1024 * 1024;
const CACHE_TTL_MS = 300_000;
const STALE_MAX_MS = 6 * 3600_000;
const RETRY_MIN_MS = 60_000;
const COVERAGE =
  'NEM regions NSW, QLD, VIC, SA, TAS; 5-minute regional power by fuel. ' +
  'Not WEM (WA), off-grid, or per-station output.';

/** @returns {number|null} Last finite sample of a history array, or null. */
export function lastFiniteSample(history) {
  const data = history?.data;
  if (!Array.isArray(data) || !data.length) return null;
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const value = data[i];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function invalid() {
  return new Error('invalid_nem_data');
}

/**
 * Trim one 7-day regional power feed to its latest observation per series.
 * Only `power` series survive; emissions, price and temperature are dropped.
 * Pure — throws invalid_nem_data on shape violations, never on honest gaps
 * (a series with no finite sample is absent, not zero).
 */
export function parseNemRegion(region, payload) {
  if (payload?.type !== 'power') throw invalid();
  if (payload?.network !== 'nem') throw invalid();
  if (payload?.region !== region) throw invalid();
  if (!Array.isArray(payload?.data) || payload.data.length > 200)
    throw invalid();
  const fuels = {};
  let demandMw = null;
  let observedAt = null;
  for (const entry of payload.data) {
    if (!entry || typeof entry !== 'object') throw invalid();
    if (typeof entry.id !== 'string' || entry.id.length > 160) throw invalid();
    if (entry.data_type !== 'power') continue;
    if (entry.history && typeof entry.history === 'object') {
      const last = entry.history.last;
      if (typeof last === 'string' && Number.isFinite(Date.parse(last))) {
        if (!observedAt || Date.parse(last) > Date.parse(observedAt)) {
          observedAt = new Date(Date.parse(last)).toISOString();
        }
      }
    }
    const mw = lastFiniteSample(entry.history);
    if (entry.id === `au.nem.${region.toLowerCase()}.demand`) {
      demandMw = mw;
      continue;
    }
    const fuel = entry.fuel_tech;
    if (typeof fuel !== 'string' || !/^[a-z][a-z0-9_]{0,40}$/.test(fuel)) {
      throw invalid();
    }
    if (fuel in fuels) throw invalid();
    if (mw !== null) {
      if (Math.abs(mw) > 60000) throw invalid();
      fuels[fuel] = Math.round(mw * 100) / 100;
    }
  }
  if (demandMw !== null && (demandMw < 0 || demandMw > 60000)) throw invalid();
  return { demandMw, observedAt, fuels };
}

/** Fixed official endpoints; one shared bounded refresh, no user destinations. */
export function nemProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
} = {}) {
  let cache = null;
  let operation = null;
  let attemptedAt = -Infinity;
  async function upstream(region, signal) {
    signal.throwIfAborted();
    const response = await fetchImpl(FEED_URL(region), {
      signal,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Gods Eye View (public NEM generation context)',
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('nem_upstream_unavailable');
    }
    const result = JSON.parse(
      await readResponseTextCapped(response, REGION_CAP, signal),
    );
    signal.throwIfAborted();
    return parseNemRegion(region, result);
  }
  async function refresh(signal) {
    const results = await Promise.allSettled(
      NEM_REGIONS.map((region) => upstream(region, signal)),
    );
    signal.throwIfAborted();
    const regions = {};
    for (let i = 0; i < NEM_REGIONS.length; i += 1) {
      const region = NEM_REGIONS[i];
      const result = results[i];
      regions[region] =
        result.status === 'fulfilled'
          ? { status: 'ok', ...result.value }
          : { status: 'unavailable' };
    }
    if (Object.values(regions).every((r) => r.status !== 'ok')) {
      throw new Error('nem_upstream_unavailable');
    }
    cache = { regions, fetchedAt: now() };
    return cache;
  }
  async function acquire(signal) {
    signal.throwIfAborted();
    if (cache && now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
    if (operation?.controller.signal.aborted) operation = null;
    if (!operation) {
      if (now() - attemptedAt < RETRY_MIN_MS)
        throw new Error('nem_retry_later');
      attemptedAt = now();
      const controller = new AbortController();
      const owned = { controller, waiters: 0 };
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      owned.promise = refresh(controller.signal).finally(() => {
        clearTimeout(timer);
        if (operation === owned) operation = null;
      });
      operation = owned;
    }
    const owned = operation;
    if (owned.waiters >= 32)
      throw Object.assign(new Error('nem_busy'), { status: 429 });
    owned.waiters++;
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(signal.reason ?? new Error('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([owned.promise, cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
      if (--owned.waiters === 0 && operation === owned) {
        owned.controller.abort();
        if (signal.aborted) attemptedAt = -Infinity;
      }
    }
  }
  function describe(value, stale = false) {
    return {
      schemaVersion: 1,
      source: 'OpenElectricity',
      attribution:
        'OpenElectricity (openelectricity.org.au); underlying market data Australian Energy Market Operator',
      coverage: COVERAGE,
      fetchedAt: value?.fetchedAt ?? null,
      stale: stale || !value,
      unavailable: !value,
      reason: !value
        ? 'NEM generation data unavailable'
        : stale
          ? 'Cached NEM mix; upstream unavailable'
          : null,
      regions: value?.regions ?? {},
    };
  }
  async function handler(req, res) {
    const controller = new AbortController();
    const close = () => controller.abort();
    res.once?.('close', close);
    const json = (status, value) => {
      if (controller.signal.aborted) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 429 ? { 'Retry-After': '2' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method !== 'GET')
        return json(405, { error: 'method_not_allowed' });
      if (req.url !== '/' && req.url !== '')
        return json(400, { error: 'invalid_nem_query' });
      try {
        json(200, describe(await acquire(controller.signal)));
      } catch (error) {
        if (error.status === 429) return json(429, { error: 'nem_busy' });
        const usable = cache && now() - cache.fetchedAt <= STALE_MAX_MS;
        json(200, describe(usable ? cache : null, true));
      }
    } finally {
      res.removeListener?.('close', close);
    }
  }
  return {
    name: 'nem-generation',
    configureServer({ middlewares }) {
      middlewares.use('/api/nem', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/nem', handler);
    },
  };
}
