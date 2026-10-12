import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  LAYER_ID,
  REQUEST_DEBOUNCE_MS,
  MAX_VIEWPORT_DEGREES,
  MAX_RENDERED,
  QUERY_SNAP_DEGREES,
  QUERY_REUSE_MS,
  ENERGY_KIND_COLORS,
  ENERGY_SELECTED_COLOR,
  KIND_LABELS,
} from './policy.js';
import {
  snapEnergyBox,
  boxContains,
  energyRetryDelayMs,
  validateEnergySnapshot,
} from './records.js';

const LAYER_NAME = 'Energy Grid (Live)';

/**
 * Own one layer's requests, records, display and viewer subscriptions.
 * Points render substations, generators, works, refineries, wells and data
 * centers; transmission lines and pipelines render as clamped polylines.
 * Records use stable string ids and latitude/longitude in degrees; line
 * records carry capped lon/lat vertex geometry.
 */
export function createAusEnergyGridLayer({ source, services } = {}) {
  if (typeof source?.fetch !== 'function')
    throw new TypeError('Energy grid requires an Overpass source');
  const { governorRequestRender } = services.render;
  const { registerPickOwner, unregisterPickOwner } = services.picking;
  const {
    clearSelectedEntityContextForLayer,
    getSelectedEntityContext,
    registerEntityContext,
    removeEntityContextsForLayer,
    selectEntityContext,
  } = services.context;

  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    records: [],
    recordById: new Map(),
    selectedId: null,
    lastUpdate: null,
    error: null,
    status: 'idle',
    stale: false,
    /** Whether the query hit QUERY_LIMIT — the view likely holds more than shown. */
    saturated: false,
    loading: false,
    abort: null,
    pendingQueryBox: null,
    retryTimer: null,
    retryDelayMs: 0,
    retryAt: 0,
    retrying: false,
    moveEndRemove: null,
    clickHandler: null,
    debounceTimer: null,
    /** Snapped box of the last successful query; a view still inside it reuses its records. */
    lastQueryBox: null,
  };

  function setStatus(status, error = null) {
    if (state.status === status && state.error === error) return;
    state.status = status;
    state.error = error;
    governorRequestRender('aus-energy-status');
  }

  function scheduleUnavailableRetry() {
    if (!state.enabled) return;
    clearTimeout(state.retryTimer);
    state.retryDelayMs = energyRetryDelayMs(state.retryDelayMs);
    state.retryAt = Date.now() + state.retryDelayMs;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      state.retryAt = 0;
      if (state.enabled && !state.loading) loadEnergy();
    }, state.retryDelayMs);
  }

  function clearUnavailableRetry({ resetBackoff = true } = {}) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
    state.retryAt = 0;
    if (resetBackoff) state.retryDelayMs = 0;
  }

  function scheduleLoad() {
    if (!state.enabled) return;
    clearUnavailableRetry({ resetBackoff: false });
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      loadEnergy();
    }, REQUEST_DEBOUNCE_MS);
  }

  // The horizon rectangle is unstable during low-angle orbits and can exclude
  // the ground point in the center of the screen. Bound nearby coverage around
  // that point instead; the camera-to-ground range keeps zoom-out queries capped.
  function viewportBox(viewer) {
    const camera = viewer?.camera;
    const canvas = viewer?.scene.canvas;
    if (typeof camera?.pickEllipsoid === 'function' && canvas) {
      const width = canvas.clientWidth || canvas.width;
      const height = canvas.clientHeight || canvas.height;
      if (!width || !height) return null;
      const focus = camera.pickEllipsoid(
        new Cesium.Cartesian2(width / 2, height / 2),
        viewer.scene.globe.ellipsoid,
      );
      if (!focus) return null;
      const location = Cesium.Cartographic.fromCartesian(focus);
      const range = Cesium.Cartesian3.distance(camera.positionWC, focus);
      const radius = Math.max(1000, 2 * range);
      const latitude = Cesium.Math.toDegrees(location.latitude);
      const longitude = Cesium.Math.toDegrees(location.longitude);
      const latSpan = radius / 111000;
      const lonSpan = latSpan / Math.cos(location.latitude);
      if (
        !Number.isFinite(latSpan + lonSpan) ||
        2 * Math.max(latSpan, lonSpan) > MAX_VIEWPORT_DEGREES ||
        Math.abs(latitude) + latSpan > 90 ||
        Math.abs(longitude) + lonSpan > 180
      )
        return null;
      return {
        south: latitude - latSpan,
        west: longitude - lonSpan,
        north: latitude + latSpan,
        east: longitude + lonSpan,
      };
    }
    // Rectangle-only viewers retain the same bounded-area contract.
    const rectangle = viewer?.camera?.computeViewRectangle(
      viewer.scene.globe.ellipsoid,
    );
    if (!rectangle) return null;
    const south = Cesium.Math.toDegrees(rectangle.south);
    const north = Cesium.Math.toDegrees(rectangle.north);
    const west = Cesium.Math.toDegrees(rectangle.west);
    const east = Cesium.Math.toDegrees(rectangle.east);
    if (
      !Number.isFinite(south + north + west + east) ||
      east <= west ||
      north - south > MAX_VIEWPORT_DEGREES ||
      east - west > MAX_VIEWPORT_DEGREES
    )
      return null;
    return { south, west, north, east };
  }

  function kindColor(record, selected) {
    return Cesium.Color.fromCssColorString(
      selected
        ? ENERGY_SELECTED_COLOR
        : ENERGY_KIND_COLORS[record.kind] || '#ffffff',
    );
  }

  function recordTitle(record) {
    const label = KIND_LABELS[record.kind] || 'Energy feature';
    return record.name ? `${record.name} — ${label}` : label;
  }

  function updateAppearance(entity, record, selected) {
    const color = kindColor(record, selected);
    if (entity.point) {
      entity.point.color = color;
      entity.point.pixelSize = selected ? 14 : 9;
    }
    if (entity.polyline) {
      entity.polyline.material = color.withAlpha(selected ? 0.98 : 0.85);
      entity.polyline.width = selected ? 4 : 2;
    }
  }

  function clearRendered() {
    if (state.dataSource?.entities) state.dataSource.entities.removeAll();
    removeEntityContextsForLayer(LAYER_ID);
  }

  function renderRecords() {
    const selectedContext = getSelectedEntityContext();
    const box = viewportBox(state.viewer);
    const visible = box
      ? state.records
          .filter((record) =>
            boxContains(box, {
              south: record.latitude,
              north: record.latitude,
              west: record.longitude,
              east: record.longitude,
            }),
          )
          .slice(0, MAX_RENDERED)
      : [];
    // A refresh may retain its own selection, never reclaim one cleared or
    // replaced by another layer or a voice action.
    if (
      selectedContext?.layerId !== LAYER_ID ||
      selectedContext.id !== state.selectedId ||
      !visible.some((record) => record.id === state.selectedId)
    ) {
      state.selectedId = null;
      clearSelectedEntityContextForLayer(LAYER_ID);
    }
    governorRequestRender('aus-energy-render');
    const visibleIds = new Set(visible.map((record) => record.id));
    for (const entity of [...state.dataSource.entities.values]) {
      if (!visibleIds.has(entity.id)) state.dataSource.entities.remove(entity);
    }
    removeEntityContextsForLayer(LAYER_ID, { retainIds: visibleIds });
    for (const record of visible) {
      const selected = record.id === state.selectedId;
      const existing = state.dataSource.entities.getById(record.id);
      if (existing?.gevEnergyRecord === record) {
        updateAppearance(existing, record, selected);
        continue;
      }
      const color = kindColor(record, selected);
      const position = Cesium.Cartesian3.fromDegrees(
        record.longitude,
        record.latitude,
      );
      const entityDef = { id: record.id, position };
      if (record.geometry?.length >= 2) {
        entityDef.polyline = {
          positions: Cesium.Cartesian3.fromDegreesArray(record.geometry.flat()),
          width: selected ? 4 : 2,
          material: color.withAlpha(0.85),
          clampToGround: true,
        };
        entityDef.point = {
          pixelSize: selected ? 14 : 9,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        };
      } else {
        entityDef.point = {
          pixelSize: selected ? 14 : 9,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        };
      }
      const entity = existing || state.dataSource.entities.add(entityDef);
      if (existing && existing.gevEnergyRecord !== record) {
        if (
          existing.gevEnergyRecord?.latitude !== record.latitude ||
          existing.gevEnergyRecord?.longitude !== record.longitude
        ) {
          entity.position = position;
        }
        entity.point = entityDef.point;
        entity.polyline = entityDef.polyline;
      }
      entity.gevEnergyRecord = record;
      entity.gevTrackedId = record.id;
      updateAppearance(entity, record, selected);
      registerEntityContext(entity, {
        id: record.id,
        layerId: LAYER_ID,
        dataSource: state.dataSource,
        layerName: LAYER_NAME,
        source:
          source.attribution?.description || source.label || 'Energy source',
        label: recordTitle(record),
        latitude: record.latitude,
        longitude: record.longitude,
        properties: {
          kind: record.kind,
          name: record.name,
          operator: record.operator,
          voltage: record.voltage,
          osmType: record.osmType,
          osmId: record.osmId,
          truncated: record.truncated,
        },
      });
    }
    const selectedEntity = state.selectedId
      ? state.dataSource.entities.getById(state.selectedId)
      : null;
    if (!selectedEntity) state.selectedId = null;
  }

  function selectRecord(id) {
    const entity = state.dataSource?.entities.getById(id);
    const record = state.recordById.get(id);
    if (!entity || !record) return false;
    clearSelection();
    state.selectedId = id;
    updateAppearance(entity, record, true);
    selectEntityContext(entity);
    governorRequestRender('aus-energy-selection');
    return true;
  }

  function clearSelection() {
    const entity = state.selectedId
      ? state.dataSource?.entities.getById(state.selectedId)
      : null;
    const record = state.recordById.get(state.selectedId);
    if (entity && record) updateAppearance(entity, record, false);
    state.selectedId = null;
    clearSelectedEntityContextForLayer(LAYER_ID);
    governorRequestRender('aus-energy-selection');
  }

  function focusNearest() {
    const camera = state.viewer?.camera;
    if (!state.enabled || !camera?.positionWC || state.viewer.trackedEntity)
      return false;
    let nearest = null;
    let distance = Infinity;
    for (const entity of state.dataSource.entities.values) {
      const position = entity.position.getValue(Cesium.JulianDate.now());
      const candidate = Cesium.Cartesian3.distanceSquared(
        camera.positionWC,
        position,
      );
      if (candidate < distance) {
        nearest = entity;
        distance = candidate;
      }
    }
    if (!nearest) return false;
    const record = state.recordById.get(nearest.id);
    const center = Cesium.Cartesian3.fromDegrees(
      record.longitude,
      record.latitude,
      0,
    );
    if (!selectRecord(nearest.id)) return false;
    camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 30), {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(
        camera.heading || 0,
        -Math.PI / 4,
        800,
      ),
    });
    governorRequestRender('aus-energy-focus');
    return true;
  }

  function installInteraction(viewer) {
    if (state.clickHandler) return;
    state.clickHandler = new Cesium.ScreenSpaceEventHandler(
      viewer.scene.canvas,
    );
    state.clickHandler.setInputAction((click) => {
      // A tool owns the pointer (src/data/inputOwnership.js): yield the click.
      if (!isPointerFree()) return;
      if (!state.enabled) return;
      const picked = viewer.scene.pick(click.position);
      const id = typeof picked?.id?.id === 'string' ? picked.id.id : null;
      if (
        id &&
        state.recordById.has(id) &&
        (id !== state.selectedId || getSelectedEntityContext()?.id !== id)
      )
        selectRecord(id);
      else if (state.selectedId) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  async function loadEnergy() {
    if (!state.enabled || !state.viewer) return;
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
    clearUnavailableRetry({ resetBackoff: false });
    const box = viewportBox(state.viewer);
    if (!box) {
      state.abort?.abort();
      state.abort = null;
      state.pendingQueryBox = null;
      state.loading = false;
      state.retrying = false;
      clearUnavailableRetry();
      renderRecords();
      setStatus('zoom-in');
      return;
    }
    // A settled view still inside the last snapped query box, with fresh
    // records, needs no new request. Failed queries never replace the last
    // successful box.
    if (
      state.lastQueryBox &&
      boxContains(state.lastQueryBox, box) &&
      state.lastUpdate &&
      Date.now() - state.lastUpdate < QUERY_REUSE_MS &&
      !state.stale &&
      state.status !== 'unavailable'
    ) {
      if (state.abort) {
        state.abort.abort();
        state.abort = null;
        state.pendingQueryBox = null;
        state.loading = false;
      }
      renderRecords();
      state.retrying = false;
      setStatus(state.dataSource.entities.values.length ? 'ready' : 'empty');
      return;
    }
    // A move inside an in-flight query must not abort and restart that query.
    if (state.abort && boxContains(state.pendingQueryBox, box)) {
      renderRecords();
      return;
    }
    const queryBox = snapEnergyBox(box);
    state.abort?.abort();
    const requestAbort = new AbortController();
    state.abort = requestAbort;
    state.pendingQueryBox = queryBox;
    state.loading = true;
    state.retrying = state.status === 'unavailable' || state.retryDelayMs > 0;
    setStatus('loading');
    renderRecords();
    try {
      const snapshot = await source.fetch(queryBox, requestAbort.signal);
      if (
        requestAbort.signal.aborted ||
        state.abort !== requestAbort ||
        !state.enabled
      )
        return;
      const { records, stale, saturated } = validateEnergySnapshot(snapshot);
      state.records = records;
      state.recordById = new Map(records.map((r) => [r.id, r]));
      state.lastUpdate = Date.now();
      state.stale = stale;
      state.saturated = saturated || records.length > MAX_RENDERED;
      state.lastQueryBox = queryBox;
      clearUnavailableRetry();
      renderRecords();
      setStatus(
        state.dataSource.entities.values.length
          ? stale
            ? 'stale'
            : 'ready'
          : 'empty',
      );
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        requestAbort.signal.aborted ||
        state.abort !== requestAbort ||
        !state.enabled
      )
        return;
      state.stale = Boolean(state.lastUpdate);
      setStatus(
        'unavailable',
        error?.message || 'Energy source temporarily unavailable',
      );
      scheduleUnavailableRetry();
    } finally {
      if (state.abort === requestAbort) {
        state.abort = null;
        state.pendingQueryBox = null;
        state.loading = false;
        state.retrying = false;
        governorRequestRender('aus-energy-status');
      }
    }
  }

  const layer = {
    id: LAYER_ID,
    name: LAYER_NAME,
    icon: '⬥',
    source: source.label || 'Mapped energy infrastructure',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    init(viewer) {
      if (state.viewer)
        throw new Error('Energy grid layer is already initialized');
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
      viewer.dataSources.add(state.dataSource);
      state.moveEndRemove =
        viewer.camera.moveEnd.addEventListener(scheduleLoad);
      installInteraction(viewer);
    },
    enable() {
      if (state.enabled) return;
      state.enabled = true;
      registerPickOwner(LAYER_ID, (id) => state.recordById.has(id));
      state.dataSource.show = true;
      // DataLayerManager calls update() right after enable(); it owns the first fetch.
    },
    disable() {
      state.enabled = false;
      unregisterPickOwner(LAYER_ID);
      clearUnavailableRetry();
      clearTimeout(state.debounceTimer);
      state.abort?.abort();
      state.abort = null;
      state.pendingQueryBox = null;
      state.loading = false;
      state.retrying = false;
      if (state.dataSource) state.dataSource.show = false;
      clearSelection();
      clearRendered();
      setStatus('idle');
    },
    update() {
      return loadEnergy();
    },
    destroy(viewer = state.viewer) {
      this.disable();
      state.moveEndRemove?.();
      state.moveEndRemove = null;
      state.clickHandler?.destroy();
      state.clickHandler = null;
      clearRendered();
      if (state.dataSource && viewer)
        viewer.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.records = [];
      state.recordById = new Map();
      state.lastQueryBox = null;
      state.lastUpdate = null;
      state.error = null;
      state.status = 'idle';
      state.stale = false;
      state.saturated = false;
      state.viewer = null;
    },
    getRowControls() {
      const count = state.dataSource?.entities.values.length || 0;
      return {
        chips: [
          {
            id: 'find-energy',
            label: 'SHOW NEAREST',
            title: state.viewer?.trackedEntity
              ? 'Stop following the current object before navigating to mapped infrastructure'
              : 'Move to the nearest loaded feature and show its details',
            disabled:
              !state.enabled || !count || Boolean(state.viewer?.trackedEntity),
            onClick: focusNearest,
          },
        ],
        legend: [
          {
            label: 'Substations',
            color: ENERGY_KIND_COLORS.substation,
            count,
            blurb:
              'Red lines are transmission; blue-grey are pipelines. Grey works, red refineries, dark-red wells, blue substations and generators, white data centers. Selected turns coral. Mapped context only — zoom in to load a city-scale view.',
          },
        ],
      };
    },
    getStats() {
      return {
        count: state.dataSource?.entities.values.length || 0,
        countLabel: state.enabled
          ? `${state.dataSource?.entities.values.length || 0} nearby`
          : '',
        lastUpdate: state.lastUpdate,
        stale: state.stale,
        saturated: state.saturated,
        error: state.error,
        status: state.status,
        loading: state.loading,
        retryAt: state.retryAt,
        retrying: state.retrying,
        retryInSec: state.retryAt
          ? Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000))
          : 0,
        loadingLabel: state.loading
          ? state.retrying
            ? 'retrying mapped energy infrastructure'
            : 'loading mapped energy infrastructure'
          : state.status === 'zoom-in'
            ? 'Zoom in to load mapped energy infrastructure'
            : [
                state.stale ? 'Showing cached locations' : '',
                state.saturated ? 'Coverage limited — zoom in' : '',
                state.status === 'empty'
                  ? 'No mapped infrastructure returned — coverage is incomplete'
                  : '',
              ]
                .filter(Boolean)
                .join(' · '),
      };
    },
  };
  return layer;
}

export { LAYER_ID };
export { buildEnergyQuery } from './records.js';
export { createAusEnergySource } from './source.js';
