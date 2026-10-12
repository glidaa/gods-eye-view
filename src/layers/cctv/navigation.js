import * as Cesium from 'cesium';
import { CCTV_FOCUS_RESULT, CCTV_HOP_POOL_LIMIT } from './policy.js';

/**
 * Nearest-first record indices around a point, capped at `limit`: the
 * slideshow pool, so automatic hops show cameras from the viewed area
 * instead of random points on the planet. Pure.
 * @param {Array} records - Catalog records with `camera.lat/lon`.
 * @param {number} lat - Viewer latitude in degrees.
 * @param {number} lon - Viewer longitude in degrees.
 * @param {number} limit - Maximum pool size; non-positive keeps everything.
 * @param {(lat1: number, lon1: number, lat2: number, lon2: number) => number} haversineKm - Distance helper.
 * @returns {Array<number>} Indices into `records`, nearest first.
 */
export function cctvHopPoolIndices(records, lat, lon, limit, haversineKm) {
  if (!Array.isArray(records) || !records.length) return [];
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    typeof haversineKm !== 'function'
  )
    return records.map((_, index) => index);
  const ranked = records
    .map((record, index) => ({
      index,
      distKm: haversineKm(lat, lon, record?.camera?.lat, record?.camera?.lon),
    }))
    .filter((entry) => Number.isFinite(entry.distKm))
    .sort((a, b) => a.distKm - b.distKm)
    .map((entry) => entry.index);
  const capped =
    Number.isFinite(limit) && limit > 0
      ? ranked.slice(0, Math.floor(limit))
      : ranked;
  return capped.length ? capped : records.map((_, index) => index);
}

export function createNavigation({
  state: layerState,
  services,
  parts,
  source,
}) {
  /**
   * Finds the camera closest to the Cesium viewer's current position.
   * @returns {string|null} Camera ID of the nearest camera, or null.
   */

  function viewerLatLon() {
    const carto = layerState._viewer?.camera?.positionCartographic;
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }

  function nearestCameraIdToViewer() {
    const view = viewerLatLon();
    if (!view || !layerState._records.length) return null;
    const { lat, lon } = view;

    let best = null;
    for (const record of layerState._records) {
      const distKm = parts.model.haversineKm(
        lat,
        lon,
        record.camera.lat,
        record.camera.lon,
      );
      if (!best || distKm < best.distKm) {
        best = { id: record.camera.id, distKm };
      }
    }
    return best?.id || null;
  }

  /**
   * Flies the Cesium viewer camera to frame the specified CCTV camera,
   * looking along its heading from above.
   * @param {Cesium.Viewer|null} viewer Cesium viewer that owns the camera.
   * @param {Object|null} record CCTV camera runtime record.
   * @param {number} [duration=2.2] - Flight duration in seconds.
   * @returns {'focused'|'no-active-camera'|'tracking-holds-view'|'cockpit-active'} Focus result.
   */

  function focusCctvRecord(viewer, record, duration = 2.2) {
    if (!viewer || !record) return CCTV_FOCUS_RESULT.NO_ACTIVE_CAMERA;
    if (
      typeof document !== 'undefined' &&
      document.body?.classList.contains('cockpit-mode')
    ) {
      console.debug('[Data:CCTV] focus ignored while cockpit owns the camera');
      return CCTV_FOCUS_RESULT.COCKPIT_ACTIVE;
    }
    if (viewer.trackedEntity) {
      console.debug(
        '[Data:CCTV] focus ignored while a tracked entity owns the camera',
      );
      return CCTV_FOCUS_RESULT.TRACKING_HOLDS_VIEW;
    }
    const { camera } = record;
    const range = Math.max(280, camera.rangeM * 1.18);
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(
        record.position,
        Math.max(40, camera.rangeM * 0.36),
      ),
      {
        offset: new Cesium.HeadingPitchRange(
          parts.model.toRad(camera.headingDeg),
          parts.model.toRad(-22),
          range,
        ),
        duration: Math.max(0.2, duration || 0),
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      },
    );
    return CCTV_FOCUS_RESULT.FOCUSED;
  }

  function focusCamera(cameraId, duration = 2.2) {
    return focusCctvRecord(
      layerState._viewer,
      layerState._recordById.get(cameraId),
      duration,
    );
  }

  /**
   * Advances to the next camera if auto-hop is enabled and the hop interval
   * has elapsed. If the viewer has panned to a new region since the last hop,
   * snaps to the nearest camera instead of cycling sequentially.
   * @param {number} nowMs - Current timestamp in milliseconds.
   */

  function maybeAutoHop(nowMs) {
    if (
      !layerState._autoHop ||
      layerState._autoHopSuspended ||
      !layerState._enabled ||
      layerState._records.length < 2
    )
      return;
    if (nowMs - layerState._lastHopAt < layerState._autoHopSec * 1000) return;

    const viewKey = parts.model.currentViewContext();
    const viewChanged = viewKey !== layerState._lastViewContext;
    layerState._lastViewContext = viewKey;

    if (viewChanged) {
      const nearest = nearestCameraIdToViewer();
      if (nearest && nearest !== layerState._activeCameraId) {
        // Use setActiveCamera so the full activation path runs (obstruction
        // probe, projection runtime, geometry rewrite) — previously bypassed
        // with a bare assignment
        parts.selection.setActiveCamera(nearest);
        layerState._lastHopAt = nowMs;
        return;
      }
    }

    // Random pick, never the same camera twice in a row: the panel is a
    // live slideshow, not a sequential tour. (The PREV/NEXT cycler is
    // untouched; only the automatic hop is random.) The draw pools the
    // nearest cameras to the viewer, so the slideshow shows the area on
    // screen; without a viewer fix it falls back to the whole catalog.
    const currentIdx = layerState._records.findIndex(
      (record) => record.camera.id === layerState._activeCameraId,
    );
    const view = viewerLatLon();
    const pool = view
      ? cctvHopPoolIndices(
          layerState._records,
          view.lat,
          view.lon,
          CCTV_HOP_POOL_LIMIT,
          parts.model.haversineKm,
        )
      : layerState._records.map((_, index) => index);
    const nextIdx = cctvRandomHopIndex(pool.indexOf(currentIdx), pool.length);
    parts.selection.setActiveCamera(
      layerState._records[pool[nextIdx]].camera.id,
    );
    layerState._lastHopAt = nowMs;
  }

  /**
   * Resolves a catalog cycle target, including the explicit no-selection state.
   * NEXT from null selects the first record; PREV selects the last.
   * @param {number} currentIdx
   * @param {number} step
   * @param {number} count
   * @returns {number}
   */

  function cctvCycleIndex(currentIdx, step, count) {
    const total = Number.isFinite(count) ? Math.floor(count) : 0;
    if (total <= 0) return -1;
    const delta = Number.isFinite(step) ? Math.trunc(step) : 1;
    if (!Number.isFinite(currentIdx) || currentIdx < 0) {
      return delta < 0 ? total - 1 : 0;
    }
    return (((Math.floor(currentIdx) + delta) % total) + total) % total;
  }

  /**
   * Random hop target that never repeats the active camera: a draw landing
   * on the current index steps forward one (wrapping), so a slideshow of
   * any size always moves. Pure — the random source is injectable for tests.
   * @param {number} currentIdx - Active index, or -1 for no selection.
   * @param {number} count - Catalog size.
   * @param {() => number} [random=Math.random] - Random source in [0,1).
   * @returns {number} Target index, or -1 when the catalog is empty.
   */
  function cctvRandomHopIndex(currentIdx, count, random = Math.random) {
    const total = Number.isFinite(count) ? Math.floor(count) : 0;
    if (total <= 0) return -1;
    if (total === 1) return 0;
    const draw = Math.floor(random() * total);
    const current = Math.floor(currentIdx);
    if (draw === current) return (draw + 1) % total;
    return Math.max(0, Math.min(total - 1, draw));
  }
  return {
    nearestCameraIdToViewer,
    focusCctvRecord,
    focusCamera,
    maybeAutoHop,
    cctvCycleIndex,
    cctvRandomHopIndex,
  };
}
