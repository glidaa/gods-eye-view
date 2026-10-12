/**
 * TRANSPORT bars — the top bar (brand, notifications bell, menu) and the
 * bottom status bar (live coords/stack, layer counts).
 *
 * The top bar reuses the #title-bar mount (layout obstacles, stacking pins
 * and the fps meter anchor to that id); only its content is new. Menu
 * actions delegate to the controls they name — the NSW dock menu, the help
 * overlay, the share button, the key-setup chip, the credit lightbox — so
 * there is exactly one behavior behind each label.
 */

import {
  getUnreadCount,
  markNotificationsRead,
  bindNotificationCenter,
  renderNotificationCenter,
  recordNotification,
} from './notifications.js';
import { openHelp } from './help.js';

/**
 * Format camera position for the bottom bar.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} altM
 * @returns {string}
 */
export function formatTransportCoords(latDeg, lonDeg, altM) {
  if (![latDeg, lonDeg, altM].every(Number.isFinite)) return '--';
  const lat = `${Math.abs(latDeg).toFixed(2)}°${latDeg >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(lonDeg).toFixed(2)}°${lonDeg >= 0 ? 'E' : 'W'}`;
  const alt =
    altM >= 1000 ? `${(altM / 1000).toFixed(1)}KM` : `${Math.round(altM)}M`;
  return `${lat} ${lon} · ALT ${alt}`;
}

/**
 * Format the layer count for the bottom bar.
 * @param {number} shown
 * @param {number} total
 * @returns {string}
 */
export function formatLayerCounts(shown, total) {
  if (!Number.isFinite(shown) || !Number.isFinite(total)) return '--';
  return `SHOWING ${shown}/${total}`;
}

/**
 * Default menu actions, each delegating to the control it names.
 * @param {object} doc - Document.
 * @returns {Record<string, () => void>}
 */
export function transportMenuActions(doc) {
  const click = (el) => {
    try {
      el?.click?.();
    } catch {
      /* A missing control is a no-op, never a throw. */
    }
  };
  return {
    'nsw-views': () => click(doc.querySelector?.('[data-nsw-views-menu]')),
    help: () => openHelp(doc),
    share: () => click(doc.getElementById?.('share-btn')),
    providers: () => {
      const chip = doc.getElementById?.('key-setup-chip');
      if (chip && !chip.hidden) click(chip);
      else recordNotification('Provider settings need the dev server');
    },
    attribution: () => {
      const links = [...(doc.querySelectorAll?.('#cesium-credits a') || [])];
      const match =
        links.find((link) =>
          String(link.textContent || '').includes('attribution'),
        ) || links[0];
      if (match) click(match);
      else recordNotification('Attribution is listed under Data attribution');
    },
  };
}

/**
 * Mount the TRANSPORT bars.
 * @param {object} [options]
 * @param {object} [options.document] - Document (defaults to global).
 * @param {() => ({ coords: string, stack: string, layers: string }|null)} [options.getStatus] - Bottom-bar status source, polled on tickMs.
 * @param {number} [options.tickMs] - Status poll interval.
 * @param {Record<string, () => void>} [options.actions] - Menu action overrides (tests).
 * @param {Function} [options.setIntervalImpl] - Timer injection (tests).
 * @param {Function} [options.clearIntervalImpl] - Timer injection (tests).
 * @returns {{ destroy: () => void, refresh: () => void }|null} Handle, or null when the mounts are absent.
 */
export function createTransportBars({
  document: doc = globalThis.document,
  getStatus = null,
  tickMs = 1000,
  actions = null,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
} = {}) {
  if (!doc?.getElementById) return null;
  const helpBtn = doc.getElementById('help-btn');
  const bellBtn = doc.getElementById('notifications-btn');
  const bellList = doc.getElementById('notifications-list');
  const menuBtn = doc.getElementById('transport-menu-btn');
  const menu = doc.getElementById('transport-menu');
  const coordsEl = doc.getElementById('transport-coords');
  const stackEl = doc.getElementById('transport-stack');
  const layersEl = doc.getElementById('transport-layers');
  if (!bellBtn && !menuBtn && !coordsEl) return null;

  const resolvedActions = { ...transportMenuActions(doc), ...(actions || {}) };

  const closeAll = () => {
    for (const [btn, panel] of [
      [bellBtn, bellList],
      [menuBtn, menu],
    ]) {
      if (!btn || !panel) continue;
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  };
  const toggle = (btn, panel, onOpen) => {
    const willOpen = panel.hidden;
    closeAll();
    panel.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) onOpen?.();
  };

  const onBell = () =>
    bellBtn &&
    bellList &&
    toggle(bellBtn, bellList, () => markNotificationsRead());
  const onMenuBtn = () => menuBtn && menu && toggle(menuBtn, menu);
  const onMenuClick = (event) => {
    const action = event?.target?.closest?.('[data-transport-action]')?.dataset
      ?.transportAction;
    if (!action) return;
    closeAll();
    try {
      resolvedActions[action]?.();
    } catch {
      /* Menu actions never throw into the chrome. */
    }
  };
  const onDocumentClick = (event) => {
    const target = event?.target;
    if (!target?.closest) {
      closeAll();
      return;
    }
    if (
      target.closest('.transport-bell-wrap') ||
      target.closest('.transport-menu-wrap')
    )
      return;
    closeAll();
  };
  const onKey = (event) => {
    if (event?.key === 'Escape') closeAll();
  };

  const onHelp = () => {
    try {
      openHelp(doc);
    } catch {
      /* Help must never throw into the chrome. */
    }
  };
  helpBtn?.addEventListener('click', onHelp);
  bellBtn?.addEventListener('click', onBell);
  menuBtn?.addEventListener('click', onMenuBtn);
  menu?.addEventListener('click', onMenuClick);
  doc.addEventListener?.('click', onDocumentClick);
  doc.addEventListener?.('keydown', onKey);

  bindNotificationCenter({
    listEl: bellList,
    countEl: doc.getElementById('notifications-count'),
  });

  const refresh = () => {
    renderNotificationCenter();
    if (typeof getStatus !== 'function') return;
    let status = null;
    try {
      status = getStatus();
    } catch {
      status = null;
    }
    if (!status) return;
    if (coordsEl && status.coords != null) coordsEl.textContent = status.coords;
    if (stackEl && status.stack != null) stackEl.textContent = status.stack;
    if (layersEl && status.layers != null) layersEl.textContent = status.layers;
  };
  refresh();
  const timer =
    typeof getStatus === 'function'
      ? setIntervalImpl(() => refresh(), tickMs)
      : null;

  return {
    refresh,
    get unread() {
      return getUnreadCount();
    },
    destroy() {
      if (timer != null) {
        try {
          clearIntervalImpl(timer);
        } catch {
          /* Timer teardown must not break disposal. */
        }
      }
      helpBtn?.removeEventListener?.('click', onHelp);
      bellBtn?.removeEventListener?.('click', onBell);
      menuBtn?.removeEventListener?.('click', onMenuBtn);
      menu?.removeEventListener?.('click', onMenuClick);
      doc.removeEventListener?.('click', onDocumentClick);
      doc.removeEventListener?.('keydown', onKey);
      bindNotificationCenter({});
      closeAll();
    },
  };
}
