import { getKeyholeGeometry } from './celestialRing.js';

/**
 * Scope mask — the app's signature viewport treatment, made real.
 *
 * History (2026-08-08 owner field test): the scope was never implemented.
 * It emerged from six zero-intensity style PostProcessStages whose stacked
 * "identity" passes progressively smeared the starfield into a circular
 * falloff — every grep for a mask came up empty because none existed. The
 * owner ruled: draw it explicitly on a canvas, make the edge featherable
 * (like the NVG/FLIR tube masks), and free the six shader passes for real.
 *
 * Retreatment (2026-10-08 owner directive): the opaque circle is now a
 * SQUARE veil — fully transparent inside the shared keyhole square,
 * feathering to a translucent page-black tint outside, so the map reads
 * through the frame at every altitude. Same canvas, same repaint gating.
 *
 * Second retreatment (owner directive): the tinted surround read as two
 * thick black bars flanking the map, so the veil is now a single thin
 * outline stroked on the shared keyhole square — no surround fill at all.
 * The terminus alpha still drives the line's opacity (faint at globe
 * scale, darker while working) and the feather slider still drives its
 * weight (hairline to 3px), so every existing control and share-link
 * field stays live.
 *
 * Implementation: one fixed canvas parented into the viewer container
 * BELOW the detection surface (z-index 2 < 5) so detection's
 * mix-blend-mode still composites over the masked scene, exactly like the
 * old in-scene artifact. The mask is one stroked square on the shared
 * keyhole geometry — redrawn only on resize, tuning change, DPR change,
 * or a QUANTIZED terminus-alpha step (see below). No rAF, no per-frame
 * paint, no render-loop coupling.
 *
 * Altitude-adaptive edge terminus: the outside fill's terminus alpha is
 * SCOPE_OUTSIDE_ALPHA at TRUE full-globe altitude (above 10 Mm, where the
 * corners stay airy) and deepens to SCOPE_TERMINUS_ALPHA_NEAR on the way
 * down, reaching the working veil by 7 Mm. Every working altitude below
 * that shares the veil, because there the map must read through the frame.
 * FEATHER is untouched BY THIS RAMP — only the terminus opacity moves here.
 * (The feather's own default is SCOPE_FEATHER_RATIO_DEFAULT below; the two
 * are independent.)
 *
 * Perf contract for that ramp: the height sample is throttled AND the repaint
 * is gated on a QUANTIZED alpha step, so a full zoom gesture costs a bounded
 * run of 2D-canvas repaints (~50 across the whole band — the alpha span, not
 * the altitude span, sets that) and a parked camera costs none. Under the
 * idle render governor a parked camera produces no frames at all, so the
 * sampler is literally free at rest. SCOPE OFF costs even less: no sampling,
 * and no canvas work beyond the single clear on the disable transition.
 */

/** Matches the page background the emergent scope faded into. */
const SCOPE_OUTSIDE_COLOR = { r: 5, g: 5, b: 8 };
/**
 * Default edge feather as a fraction of the keyhole radius.
 *
 * 0.11 since 2026-08-24 (owner final lock; 0.08 on 08-23, hard-crop 0 on
 * 08-22 — this supersedes both), REVISING the 2026-08-22 ruling that
 * set it to zero: a subtle soft edge rather than either the hard crop or the
 * retired 35 % halo. The slider is untouched and still spans 0..100; this is
 * only where it STARTS. `setScopeMaskFeather` is unchanged, so any feather a
 * share link carries, or the operator dials in, overrides this immediately, and
 * the hard-crop path at 0 is still reachable from the handle.
 *
 * Keep in lockstep with `#scope-feather-slider`'s markup value AND readout in
 * index.html and `_scopeFeatherPct` in sharelink.js — a fresh boot applies no
 * restore, so those literals ARE the first-run state. NOT the `scf` PARSE
 * fallback, which stays at 35 on purpose: a link predating that field was
 * authored when 35 was what its author saw, and a link from the feather-0 era
 * carries `scf=0` explicitly because the generator always writes the field.
 * Pinned in reasonableDefaults.test.mjs.
 */
export const SCOPE_FEATHER_RATIO_DEFAULT = 0.11;
/**
 * Terminus opacity at/above SCOPE_TERMINUS_FAR_M — a faint line at globe
 * scale.
 */
export const SCOPE_OUTSIDE_ALPHA = 0.35;
/**
 * Lowest SUPPORTED terminus opacity, as a share-link percent. The band exists
 * because anything below the globe-scale terminus is not a scope any more —
 * it is a hole in the mask — so `sce` is clamped to it on the way in AND on
 * the way out rather than round-tripping an unsupported value.
 */
export const SCOPE_TERMINUS_MIN_PCT = Math.round(SCOPE_OUTSIDE_ALPHA * 100);
export const SCOPE_TERMINUS_MAX_PCT = 100;
/**
 * Terminus opacity at/below SCOPE_TERMINUS_NEAR_M — the working line
 * weight's alpha. The frame is an outline, never a surround fill.
 */
export const SCOPE_TERMINUS_ALPHA_NEAR = 0.6;
/**
 * Camera height at/above which the terminus stays at SCOPE_OUTSIDE_ALPHA.
 * The faint corners belong to TRUE full-globe views only — below ~10 Mm the
 * frame deepens toward the working veil.
 */
export const SCOPE_TERMINUS_FAR_M = 10_000_000;
/**
 * Camera height at/below which the terminus holds the working veil. The fade
 * is deliberately STEEP: 3 Mm below the far edge the frame has settled, so
 * every working altitude (orbital, regional, city) shares one veil.
 */
export const SCOPE_TERMINUS_NEAR_M = 7_000_000;
/**
 * Repaint granularity. The ramp spans 0.25 alpha, so 0.005 steps give ~50
 * repaints across the ENTIRE 3 Mm band — the alpha span sets that count, so
 * widening the altitude band costs nothing — and zero while hovering, since a
 * still camera never crosses a step.
 */
export const SCOPE_TERMINUS_QUANTUM = 0.005;
/**
 * Outline weight range in CSS px. The feather slider (0..1) maps across it,
 * so the default feather is a hairline and a full feather is a 3px frame —
 * never a filled surround.
 */
const SCOPE_LINE_MIN_PX = 1;
const SCOPE_LINE_MAX_PX = 3;
/** Height-sample throttle. Bounds the sampler to ~8 Hz while the camera moves. */
const SCOPE_TERMINUS_SAMPLE_MS = 120;

let _canvas = null;
let _container = null;
let _viewer = null;
let _enabled = true;
let _featherRatio = SCOPE_FEATHER_RATIO_DEFAULT;
let _resizeObserver = null;
let _dprQuery = null;
let _dprListener = null;
/** Quantized terminus alpha currently PAINTED (drives the repaint gate). */
let _terminusAlpha = SCOPE_OUTSIDE_ALPHA;
/** null = adaptive; a number pins the terminus (share-link `sce`). */
let _terminusOverride = null;
let _cameraSampleRemover = null;
let _cameraMoveEndRemover = null;
let _lastTerminusSampleMs = -Infinity;
/** Repaints caused by a terminus step — evidence seam for the perf claim. */
let _terminusRepaints = 0;
/** Whether the canvas currently holds ink (drives the disabled-state early-out). */
let _painted = false;
/** Set while a coalescing scope is open; draw() defers to its single paint. */
let _paintDirty = false;
let _coalescingPaint = false;

/**
 * Smoothstep ramp from the globe-scale terminus to the working veil.
 * Pure — unit-tested directly.
 * @param {number} heightM - Camera height above the ellipsoid, in metres.
 * @returns {number} Terminus alpha in [SCOPE_OUTSIDE_ALPHA, SCOPE_TERMINUS_ALPHA_NEAR].
 */
export function scopeTerminusAlpha(heightM) {
  const h = Number(heightM);
  if (!Number.isFinite(h)) return SCOPE_OUTSIDE_ALPHA; // unknown height → globe-scale default
  if (h >= SCOPE_TERMINUS_FAR_M) return SCOPE_OUTSIDE_ALPHA;
  if (h <= SCOPE_TERMINUS_NEAR_M) return SCOPE_TERMINUS_ALPHA_NEAR;
  // 0 at the far edge → 1 at the near edge, eased so neither end steps visibly.
  const t =
    (SCOPE_TERMINUS_FAR_M - h) / (SCOPE_TERMINUS_FAR_M - SCOPE_TERMINUS_NEAR_M);
  const eased = t * t * (3 - 2 * t);
  return (
    SCOPE_OUTSIDE_ALPHA +
    (SCOPE_TERMINUS_ALPHA_NEAR - SCOPE_OUTSIDE_ALPHA) * eased
  );
}

/**
 * Snap a terminus alpha to the repaint grid. Equal quantized values mean the
 * paint would be indistinguishable, so the repaint is skipped.
 * @param {number} alpha
 * @returns {number}
 */
export function quantizeScopeTerminusAlpha(alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  // Round the PRODUCT too: n * 0.005 lands on values like 0.9400000000000001,
  // which would ride straight into the rgba() string. The quantum is 3-decimal,
  // so 3 decimals is lossless here.
  return (
    Math.round(
      Math.round(a / SCOPE_TERMINUS_QUANTUM) * SCOPE_TERMINUS_QUANTUM * 1000,
    ) / 1000
  );
}

/**
 * Clamp a share-link/UI terminus PERCENT into the supported band.
 * Non-numeric input is not a value at all — it means "absent", i.e. adaptive.
 * Pure — unit-tested directly.
 * @param {*} value
 * @returns {?number} 35..100, or null for adaptive.
 */
export function clampScopeTerminusPct(value) {
  // Anything that is not an actual number — null, undefined, '', 'abc', a
  // boolean — is ABSENT, not zero. (Number(null) === 0 would otherwise pin the
  // floor on every adaptive write.)
  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || raw === ''))
    return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct)) return null;
  return Math.max(
    SCOPE_TERMINUS_MIN_PCT,
    Math.min(SCOPE_TERMINUS_MAX_PCT, Math.round(pct)),
  );
}

/**
 * Resolve the terminus alpha for a camera height, honoring any override, and
 * repaint ONLY when the quantized value actually moves.
 * @param {number} heightM - Camera height above the ellipsoid, in metres.
 * @returns {boolean} Whether this call repainted.
 */
export function updateScopeTerminusForHeight(heightM) {
  const target = quantizeScopeTerminusAlpha(
    _terminusOverride == null ? scopeTerminusAlpha(heightM) : _terminusOverride,
  );
  if (target === _terminusAlpha) return false; // the whole perf story lives here
  _terminusAlpha = target;
  _terminusRepaints += 1;
  draw();
  return true;
}

/**
 * Pin the terminus alpha, or restore adaptive behavior.
 * @param {?number} alpha - Alpha in [0,1], or null/undefined for adaptive.
 * @returns {void}
 */
/**
 * Run `fn` with paints COALESCED: any draw() it triggers only marks the canvas
 * dirty, and exactly one paint happens at the end. The case that matters is a
 * DPR change landing on the same tick as a terminus step — two full-viewport
 * repaints where one will do.
 * @param {Function} fn
 * @returns {void}
 */
function withCoalescedPaint(fn) {
  if (_coalescingPaint) {
    fn();
    return;
  } // already inside a scope
  _coalescingPaint = true;
  _paintDirty = false;
  try {
    fn();
  } finally {
    _coalescingPaint = false;
    if (_paintDirty) {
      _paintDirty = false;
      draw();
    }
  }
}

/** @returns {number} Quantized terminus the CURRENT camera + override imply. */
function currentTerminusTarget() {
  return quantizeScopeTerminusAlpha(
    _terminusOverride == null
      ? scopeTerminusAlpha(currentCameraHeightM())
      : _terminusOverride,
  );
}

export function setScopeTerminusOverride(alpha) {
  if (alpha == null || !Number.isFinite(Number(alpha))) {
    _terminusOverride = null;
  } else {
    // Same supported band as the `sce` hash key: a sub-globe-scale terminus is
    // a hole in the mask, not a scope, so every entry point floors it.
    _terminusOverride = Math.max(
      SCOPE_OUTSIDE_ALPHA,
      Math.min(1, Number(alpha)),
    );
  }
  // Re-resolve immediately against the live camera so the override is visible
  // without waiting for the next sample.
  const target = currentTerminusTarget();
  if (target !== _terminusAlpha) {
    _terminusAlpha = target;
    _terminusRepaints += 1;
  }
  draw();
}

/** @returns {?number} The pinned terminus alpha, or null when adaptive. */
export function getScopeTerminusOverride() {
  return _terminusOverride;
}

/** @returns {number} The terminus alpha currently painted. */
export function getScopeTerminusAlpha() {
  return _terminusAlpha;
}

/** Test/diagnostics seam: repaints caused by terminus steps since install. */
export function getScopeTerminusRepaintCount() {
  return _terminusRepaints;
}

/** Backing-store scale actually used by the last draw(). */
export function scopeMaskDevicePixelRatio(
  ratio = typeof window !== 'undefined' ? window.devicePixelRatio : 1,
) {
  return Math.min(2, Number(ratio) || 1);
}

/**
 * Watch for devicePixelRatio changes and redraw.
 *
 * The ResizeObserver only fires on CONTENT-BOX changes, so dragging the
 * window between a 1x and a 2x monitor keeps the same CSS size while the
 * backing store stays at the old resolution — a permanently soft/aliased
 * scope edge until something else happens to resize. `(resolution: Ndppx)`
 * only matches the CURRENT ratio, so the listener is re-armed after every
 * change (the standard DPR-watch pattern).
 * @returns {void}
 */
function watchDevicePixelRatio() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return;
  teardownDevicePixelRatioWatch();
  const dpr = window.devicePixelRatio || 1;
  let query;
  try {
    query = window.matchMedia(`(resolution: ${dpr}dppx)`);
  } catch {
    return; // no matchMedia support for resolution queries — resize still covers the common case
  }
  _dprQuery = query;
  _dprListener = () => {
    withCoalescedPaint(() => {
      // Re-arm against the NEW ratio first, then repaint at the new scale.
      watchDevicePixelRatio();
      // Dragging a window between monitors mid-descent lands a DPR change and a
      // terminus step on the same tick; fold both into the single paint below.
      if (_enabled) updateScopeTerminusForHeight(currentCameraHeightM());
      draw();
    });
  };
  if (typeof query.addEventListener === 'function')
    query.addEventListener('change', _dprListener, { once: true });
  else if (typeof query.addListener === 'function')
    query.addListener(_dprListener);
}

function teardownDevicePixelRatioWatch() {
  if (_dprQuery && _dprListener) {
    if (typeof _dprQuery.removeEventListener === 'function')
      _dprQuery.removeEventListener('change', _dprListener);
    else if (typeof _dprQuery.removeListener === 'function')
      _dprQuery.removeListener(_dprListener);
  }
  _dprQuery = null;
  _dprListener = null;
}

/**
 * Compute the square frame geometry for the scope mask. The keyhole radius
 * is the square's half-side, so the visible edge stays anchored to the
 * shared geometry every keyhole consumer fades on.
 * Pure — unit-tested directly.
 * @param {number} width - Viewport CSS width.
 * @param {number} height - Viewport CSS height.
 * @param {number} featherRatio - Edge feather as a fraction of keyhole radius.
 * @returns {{centerX:number, centerY:number, innerR:number, outerR:number,
 *   maxR:number}|null} Centre plus inner/outer half-sides, or null when the
 *   viewport is degenerate.
 */
export function scopeMaskGeometry(width, height, featherRatio = _featherRatio) {
  const keyhole = getKeyholeGeometry(width, height);
  if (!(keyhole.radius > 0)) return null;
  const feather = Math.max(0, Math.min(1, Number(featherRatio) || 0));
  // Feather straddles the keyhole edge so the visible radius stays anchored
  // to the shared geometry every keyhole consumer (labels, cards) fades on.
  const half = keyhole.radius * feather * 0.5;
  return {
    centerX: keyhole.centerX,
    centerY: keyhole.centerY,
    innerR: Math.max(0, keyhole.radius - half),
    outerR: keyhole.radius + half,
    maxR: Math.hypot(
      Math.max(keyhole.centerX, width - keyhole.centerX),
      Math.max(keyhole.centerY, height - keyhole.centerY),
    ),
  };
}

function draw() {
  if (_coalescingPaint) {
    _paintDirty = true;
    return;
  } // one paint at scope exit
  if (!_canvas || !_container) return;
  // SCOPE OFF is the cheapest state, not a painted one: bail out BEFORE the
  // backing-store resize + clear (a full-viewport allocation) that used to run
  // on every disabled draw. The last painted mask is cleared exactly once, on
  // the transition, and after that a disabled mask does no canvas work at all.
  if (!_enabled) {
    if (!_painted) return;
    const clearCtx = _canvas.getContext('2d');
    if (clearCtx) {
      clearCtx.setTransform(1, 0, 0, 1, 0, 0);
      clearCtx.clearRect(0, 0, _canvas.width, _canvas.height);
    }
    _painted = false;
    return;
  }
  const width = _container.clientWidth;
  const height = _container.clientHeight;
  if (!(width > 0) || !(height > 0)) return;
  const dpr = scopeMaskDevicePixelRatio();
  _canvas.width = Math.round(width * dpr);
  _canvas.height = Math.round(height * dpr);
  const ctx = _canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  _painted = false; // resize+clear wiped the surface; ink goes on below
  const geo = scopeMaskGeometry(width, height, _featherRatio);
  if (!geo) return;
  const { r, g, b } = SCOPE_OUTSIDE_COLOR;
  // Thin outline on the shared keyhole edge: the stroke sits exactly on the
  // keyhole radius (the midpoint of the feather band), so the visible frame
  // stays anchored to the geometry every keyhole consumer fades on. No
  // surround fill — that read as two thick black bars flanking the map.
  const half = (geo.innerR + geo.outerR) / 2;
  const feather = Math.max(0, Math.min(1, Number(_featherRatio) || 0));
  ctx.strokeStyle = `rgba(${r},${g},${b},${_terminusAlpha})`;
  ctx.lineWidth =
    SCOPE_LINE_MIN_PX +
    Math.round(feather * (SCOPE_LINE_MAX_PX - SCOPE_LINE_MIN_PX));
  ctx.strokeRect(geo.centerX - half, geo.centerY - half, half * 2, half * 2);
  _painted = true;
}

/**
 * Install the scope mask into the viewer container. Idempotent.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
export function installScopeMask(viewer) {
  if (_canvas || !viewer?.container) return;
  _container = viewer.container;
  _viewer = viewer;
  _canvas = document.createElement('canvas');
  _canvas.id = 'scope-mask';
  _canvas.setAttribute('aria-hidden', 'true');
  _container.appendChild(_canvas);
  _resizeObserver = new ResizeObserver(() => draw());
  _resizeObserver.observe(_container);
  watchDevicePixelRatio();
  watchCameraHeight(viewer);
  // Seed from the live camera so the first paint is already correct for the
  // restored/initial altitude instead of flashing the globe-scale terminus.
  _terminusAlpha = currentTerminusTarget();
  draw();
}

/** @returns {number} Live camera height above the ellipsoid, or +Inf if unknown. */
function currentCameraHeightM() {
  const height = _viewer?.camera?.positionCartographic?.height;
  return Number.isFinite(height) ? height : Number.POSITIVE_INFINITY;
}

/**
 * Sample camera height on the scene's existing frame signal, throttled, and
 * let {@link updateScopeTerminusForHeight} decide whether a repaint is even
 * warranted. Two cheap compares per rendered frame; under the idle governor a
 * parked camera renders no frames at all, so this costs nothing at rest.
 * moveEnd additionally pins the exact settled value.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
function watchCameraHeight(viewer) {
  const preRender = viewer?.scene?.preRender;
  if (preRender?.addEventListener) {
    _cameraSampleRemover = preRender.addEventListener(() => {
      // SCOPE OFF paints nothing, so it samples nothing: no height read, no
      // throttle bookkeeping, no quantize — the listener is a single compare.
      // setScopeMaskEnabled(true) re-syncs the alpha it skipped.
      if (!_enabled) return;
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - _lastTerminusSampleMs < SCOPE_TERMINUS_SAMPLE_MS) return;
      _lastTerminusSampleMs = now;
      updateScopeTerminusForHeight(currentCameraHeightM());
    });
  }
  const moveEnd = viewer?.camera?.moveEnd;
  if (moveEnd?.addEventListener) {
    _cameraMoveEndRemover = moveEnd.addEventListener(() => {
      if (!_enabled) return;
      updateScopeTerminusForHeight(currentCameraHeightM());
    });
  }
}

function teardownCameraHeightWatch() {
  if (_cameraSampleRemover) {
    _cameraSampleRemover();
    _cameraSampleRemover = null;
  }
  if (_cameraMoveEndRemover) {
    _cameraMoveEndRemover();
    _cameraMoveEndRemover = null;
  }
  _lastTerminusSampleMs = -Infinity;
}

/**
 * @param {boolean} enabled
 * @returns {void}
 */
export function setScopeMaskEnabled(enabled) {
  const next = Boolean(enabled);
  const reEnabled = next && !_enabled;
  _enabled = next;
  if (reEnabled) {
    // The camera moved freely while the scope was off and nothing sampled it,
    // so the painted terminus can be a whole altitude band stale. Re-sync once
    // here (not a "step", so it does not count as a terminus repaint) and let
    // the next frame resume normal sampling.
    _lastTerminusSampleMs = -Infinity;
    _terminusAlpha = currentTerminusTarget();
  }
  draw();
}

/** @returns {boolean} */
export function isScopeMaskEnabled() {
  return _enabled;
}

/**
 * @param {number} ratio - Edge feather as a fraction of keyhole radius [0,1].
 * @returns {void}
 */
export function setScopeMaskFeather(ratio) {
  _featherRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  draw();
}

/** @returns {number} */
export function getScopeMaskFeather() {
  return _featherRatio;
}

/**
 * Tear the mask down (canvas + observer). Reinstall with installScopeMask.
 * @returns {void}
 */
export function destroyScopeMask() {
  _resizeObserver?.disconnect();
  _resizeObserver = null;
  teardownDevicePixelRatioWatch();
  teardownCameraHeightWatch();
  _canvas?.remove();
  _canvas = null;
  _container = null;
  _viewer = null;
  _painted = false;
}

/** Test seam. */
export function _resetScopeMaskForTest() {
  _resizeObserver?.disconnect();
  _resizeObserver = null;
  teardownDevicePixelRatioWatch();
  teardownCameraHeightWatch();
  _canvas?.remove();
  _canvas = null;
  _container = null;
  _viewer = null;
  _enabled = true;
  _featherRatio = SCOPE_FEATHER_RATIO_DEFAULT;
  _terminusAlpha = SCOPE_OUTSIDE_ALPHA;
  _terminusOverride = null;
  _terminusRepaints = 0;
  _painted = false;
  _paintDirty = false;
  _coalescingPaint = false;
}
