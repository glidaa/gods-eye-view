import { NEM_URL, NEM_REGIONS } from './policy.js';
import { normalizeNemRegion } from './records.js';

/** Construct the NEM mix request adapter without starting a request. */
export function createNemSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function getSnapshot(signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(NEM_URL, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* already closed */
      }
      throw new Error('NEM mix temporarily unavailable');
    }
    const payload = await response.json();
    signal?.throwIfAborted();
    if (
      !payload ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== 1 ||
      !payload.regions ||
      typeof payload.regions !== 'object'
    ) {
      throw new Error('NEM mix returned an incomplete response');
    }
    const regions = NEM_REGIONS.map((meta) =>
      normalizeNemRegion(meta.code, payload.regions[meta.code]),
    );
    return {
      regions,
      fetchedAt:
        typeof payload.fetchedAt === 'number' ? payload.fetchedAt : null,
      stale: payload.stale === true,
      unavailable: payload.unavailable === true,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
    };
  }
  return {
    getSnapshot,
    label: 'OpenElectricity · 5-minute NEM mix',
  };
}
