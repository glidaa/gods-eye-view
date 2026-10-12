import { LAYER_ID, NEM_REFRESH_MS, NEM_FUEL_COLORS } from './policy.js';
import { formatMixBlurb, nemAnalystRecords } from './records.js';

const LAYER_NAME = 'NEM Generation Mix';

/**
 * Own the live NEM fuel-mix feed. This layer renders no map entities: the
 * mix surfaces as per-region panel legends and as analyst records. Refresh
 * is pull-based (enable + 5-minute cadence + manual refresh chip).
 */
export function createNemGenerationLayer({ feed, services = {} } = {}) {
  if (typeof feed?.getSnapshot !== 'function')
    throw new TypeError('NEM mix requires a snapshot feed');
  const governorRequestRender =
    services.render?.governorRequestRender || (() => {});

  const state = {
    enabled: false,
    regions: [],
    fetchedAt: null,
    stale: false,
    unavailable: false,
    reason: null,
    error: null,
    status: 'idle',
    loading: false,
    abort: null,
  };

  function setStatus(status, error = null) {
    if (state.status === status && state.error === error) return;
    state.status = status;
    state.error = error;
    governorRequestRender('nem-status');
  }

  async function refresh() {
    if (!state.enabled) return;
    state.abort?.abort();
    const requestAbort = new AbortController();
    state.abort = requestAbort;
    state.loading = true;
    setStatus('loading');
    try {
      const snapshot = await feed.getSnapshot(requestAbort.signal);
      if (
        requestAbort.signal.aborted ||
        state.abort !== requestAbort ||
        !state.enabled
      )
        return;
      state.regions = snapshot.regions;
      state.fetchedAt = snapshot.fetchedAt;
      state.stale = snapshot.stale;
      state.unavailable = snapshot.unavailable;
      state.reason = snapshot.reason;
      const ok = snapshot.regions.filter((r) => r.status === 'ok').length;
      setStatus(
        snapshot.unavailable || ok === 0
          ? 'unavailable'
          : snapshot.stale
            ? 'stale'
            : ok < snapshot.regions.length
              ? 'partial'
              : 'ready',
        snapshot.unavailable ? snapshot.reason || 'NEM mix unavailable' : null,
      );
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        requestAbort.signal.aborted ||
        state.abort !== requestAbort ||
        !state.enabled
      )
        return;
      state.stale = state.regions.length > 0;
      setStatus('unavailable', error?.message || 'NEM mix unavailable');
    } finally {
      if (state.abort === requestAbort) {
        state.abort = null;
        state.loading = false;
        governorRequestRender('nem-status');
      }
    }
  }

  function needsRefresh() {
    if (!state.fetchedAt) return true;
    return Date.now() - state.fetchedAt >= NEM_REFRESH_MS;
  }

  const layer = {
    id: LAYER_ID,
    name: LAYER_NAME,
    icon: '⬓',
    source: feed.label || 'Live NEM mix',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    init() {},
    enable() {
      if (state.enabled) return;
      state.enabled = true;
      // DataLayerManager calls update() right after enable(); it owns the first fetch.
    },
    disable() {
      state.enabled = false;
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      setStatus('idle');
    },
    update() {
      if (!state.enabled || state.loading) return Promise.resolve();
      if (
        state.status !== 'idle' &&
        state.status !== 'unavailable' &&
        !needsRefresh()
      ) {
        return Promise.resolve();
      }
      return refresh();
    },
    destroy() {
      this.disable();
      state.regions = [];
      state.fetchedAt = null;
      state.stale = false;
      state.unavailable = false;
      state.reason = null;
      state.error = null;
      state.status = 'idle';
    },
    getRowControls() {
      const ok = state.regions.filter((r) => r.status === 'ok');
      return {
        chips: [
          {
            id: 'refresh-nem',
            label: 'REFRESH MIX',
            title: 'Refetch the 5-minute NEM generation mix',
            disabled: !state.enabled || state.loading,
            onClick: () => {
              refresh();
            },
          },
        ],
        legend: state.regions.map((region) => ({
          label: `${region.label} mix`,
          color: NEM_FUEL_COLORS[region.top?.[0]?.group] || '#94a3b8',
          count: ok.length,
          blurb: formatMixBlurb(region),
        })),
      };
    },
    getStats() {
      const ok = state.regions.filter((r) => r.status === 'ok').length;
      return {
        count: ok,
        countLabel: state.enabled ? `${ok}/5 regions` : '',
        lastUpdate: state.fetchedAt,
        stale: state.stale,
        error: state.error,
        status: state.status,
        loading: state.loading,
        loadingLabel: state.loading
          ? 'loading NEM generation mix'
          : state.status === 'unavailable'
            ? state.reason || 'NEM mix unavailable'
            : state.status === 'stale'
              ? 'Showing cached mix'
              : state.status === 'partial'
                ? 'Some regions unavailable'
                : '',
      };
    },
    getAnalystRecords(maxCount = 2000) {
      if (!state.enabled || !state.regions.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return nemAnalystRecords(state.regions).slice(0, limit);
    },
  };
  return layer;
}

export { LAYER_ID };
export { createNemSource } from './source.js';
