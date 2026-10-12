/**
 * @file Curated location displays: one click sets an exact layer state and
 * frames the region that shows it. The launcher missions are the front door;
 * these are the rooms — a bottom-left icon dock for instant switching plus a
 * menu listing every display with its blurb.
 *
 * A view owns ONLY its managed layers (energy, events, and the two
 * connectivity layers); anything else on the globe is left untouched. Layer
 * failures never throw out of apply — the result names them and the camera
 * still flies.
 *
 * @module ui/nswViews
 */

/** Layers a view sets exactly; every other layer is left untouched. */
export const NSW_VIEW_MANAGED_LAYERS = Object.freeze([
  'earthquakes',
  'local-firms',
  'local-au-ports',
  'local-au-mines',
  'local-au-power',
  'aus-energy-grid',
  'nem-generation',
  'local-datacenters',
  'telegeography-submarine-cables',
]);

/**
 * Curated displays. `quick` views get dock icons; all views appear in the
 * menu. Cameras are top-down map framings (pitch defaults to -90).
 */
export const NSW_VIEWS = Object.freeze([
  Object.freeze({
    id: 'nsw',
    label: 'NSW',
    icon: '⬔',
    blurb: 'Power, ports, mines and live events, statewide',
    quick: true,
    on: Object.freeze([
      'earthquakes',
      'local-firms',
      'local-au-ports',
      'local-au-mines',
      'local-au-power',
      'aus-energy-grid',
      'nem-generation',
    ]),
    off: Object.freeze(['local-datacenters', 'telegeography-submarine-cables']),
    camera: Object.freeze({ lat: -32.5, lon: 147.0, alt: 1700000 }),
  }),
  Object.freeze({
    id: 'vic',
    label: 'VIC',
    icon: '⬒',
    blurb: 'Power, ports, mines and live events, statewide',
    quick: true,
    on: Object.freeze([
      'earthquakes',
      'local-firms',
      'local-au-ports',
      'local-au-mines',
      'local-au-power',
      'aus-energy-grid',
      'nem-generation',
    ]),
    off: Object.freeze(['local-datacenters', 'telegeography-submarine-cables']),
    camera: Object.freeze({ lat: -37.2, lon: 144.3, alt: 850000 }),
  }),
  Object.freeze({
    id: 'sydney',
    label: 'Sydney',
    icon: '⬣',
    blurb: 'Ports, cable landings and datacenters',
    quick: true,
    on: Object.freeze([
      'local-au-ports',
      'local-datacenters',
      'telegeography-submarine-cables',
      'local-au-power',
    ]),
    off: Object.freeze([
      'earthquakes',
      'local-firms',
      'local-au-mines',
      'aus-energy-grid',
      'nem-generation',
    ]),
    camera: Object.freeze({ lat: -33.87, lon: 151.21, alt: 130000 }),
  }),
  Object.freeze({
    id: 'melbourne',
    label: 'Melbourne',
    icon: '◉',
    blurb: 'Port, cable landings and datacenters',
    quick: true,
    on: Object.freeze([
      'local-au-ports',
      'local-datacenters',
      'telegeography-submarine-cables',
      'local-au-power',
    ]),
    off: Object.freeze([
      'earthquakes',
      'local-firms',
      'local-au-mines',
      'aus-energy-grid',
      'nem-generation',
    ]),
    camera: Object.freeze({ lat: -37.81, lon: 144.96, alt: 130000 }),
  }),
  Object.freeze({
    id: 'newcastle',
    label: 'Newcastle',
    icon: '◎',
    blurb: 'Port, coal country and power stations',
    quick: true,
    on: Object.freeze([
      'local-au-power',
      'local-au-mines',
      'local-au-ports',
      'aus-energy-grid',
    ]),
    off: Object.freeze([
      'earthquakes',
      'local-firms',
      'nem-generation',
      'local-datacenters',
      'telegeography-submarine-cables',
    ]),
    camera: Object.freeze({ lat: -32.9, lon: 151.65, alt: 220000 }),
  }),
]);

export function nswViewById(id) {
  return NSW_VIEWS.find((view) => view.id === id) || null;
}

/**
 * Apply one display: exact managed-layer state plus the region framing.
 * Layer and camera failures are collected, never thrown — a refused layer
 * must not strand the camera, and a superseded flight must not fail the
 * layers.
 * @param {object} view NSW view definition.
 * @param {object} services
 * @param {{setEnabled: Function}} services.dataManager
 * @param {(camera: object) => any} services.flyToView
 * @returns {Promise<{ok: boolean, viewId: string, failedLayerIds: string[], cameraOk: boolean}>}
 */
export async function applyNswView(view, { dataManager, flyToView }) {
  if (!view) throw new TypeError('applyNswView requires a view');
  const failedLayerIds = [];
  const toggle = async (layerId, enabled) => {
    try {
      const result = await dataManager.setEnabled(layerId, enabled, {
        origin: 'user',
      });
      if (result === false) failedLayerIds.push(layerId);
    } catch {
      failedLayerIds.push(layerId);
    }
  };
  const layers = Promise.all([
    ...view.on.map((id) => toggle(id, true)),
    ...view.off.map((id) => toggle(id, false)),
  ]);
  const camera = (async () => {
    try {
      await flyToView(view.camera);
      return true;
    } catch {
      return false;
    }
  })();
  const [, cameraOk] = await Promise.all([layers, camera]);
  return {
    ok: failedLayerIds.length === 0 && cameraOk,
    viewId: view.id,
    failedLayerIds,
    cameraOk,
  };
}

const MENU_BUTTON_TITLE = 'All locations';

/**
 * Bottom-left demo-display dock: quick icon buttons plus a menu listing
 * every display. Active marks the last applied view and clears the moment a
 * managed layer changes underneath it (the display is no longer exact).
 */
export function createNswViewsWidget({ container, flyToView }) {
  if (!container) throw new TypeError('NSW views widget requires a container');
  if (typeof flyToView !== 'function')
    throw new TypeError('NSW views widget requires a flyToView flight');
  let dataManager = null;
  let unsubscribe = null;
  let activeId = null;
  let applyChain = Promise.resolve();
  let pendingApplies = 0;
  let menuOpen = false;
  const buttons = new Map();

  const row = container.querySelector('[data-nsw-views-row]');
  const menuButton = container.querySelector('[data-nsw-views-menu]');
  const menu = container.querySelector('[data-nsw-views-menu-list]');
  if (!row || !menuButton || !menu)
    throw new TypeError('NSW views container is missing its dock markup');

  function setActive(id) {
    activeId = id;
    for (const [viewId, elements] of buttons) {
      for (const el of elements) {
        const on = viewId === id;
        el.classList.toggle('is-active', on);
        if (on) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      }
    }
  }

  function setMenuOpen(open) {
    menuOpen = open;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.classList.toggle('is-active', open);
  }

  async function apply(id) {
    const view = nswViewById(id);
    const manager = dataManager;
    if (!view || !manager) return null;
    // Applies serialize: rapid clicks queue instead of dropping, and the last
    // click's exact layer state wins. Active + menu respond instantly — a
    // slow layer load must never leave the dock looking dead.
    pendingApplies += 1;
    setActive(id);
    setMenuOpen(false);
    const task = applyChain.then(() =>
      applyNswView(view, { dataManager: manager, flyToView }),
    );
    applyChain = task.catch(() => {});
    try {
      return await task;
    } finally {
      pendingApplies -= 1;
    }
  }

  function onDocumentPointerDown(event) {
    if (!menuOpen) return;
    if (container.contains(event.target)) return;
    setMenuOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && menuOpen) {
      event.stopPropagation();
      setMenuOpen(false);
      menuButton.focus?.();
    }
  }

  function onLayerChange(change) {
    if (pendingApplies > 0) return;
    if (change?.type !== 'visibility') return;
    if (!NSW_VIEW_MANAGED_LAYERS.includes(change.layerId)) return;
    setActive(null);
  }

  function render() {
    row.textContent = '';
    menu.textContent = '';
    buttons.clear();
    for (const view of NSW_VIEWS.filter((item) => item.quick)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nsw-view-btn';
      button.dataset.nswView = view.id;
      button.textContent = view.icon;
      button.title = `${view.label} — ${view.blurb}`;
      button.setAttribute('aria-label', `${view.label}: ${view.blurb}`);
      button.addEventListener('click', () => apply(view.id));
      row.appendChild(button);
      buttons.set(view.id, [button]);
    }
    menuButton.textContent = '☰';
    menuButton.title = MENU_BUTTON_TITLE;
    menuButton.setAttribute('aria-label', MENU_BUTTON_TITLE);
    for (const view of NSW_VIEWS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'nsw-views-menu-item';
      item.dataset.nswView = view.id;
      const icon = document.createElement('span');
      icon.className = 'nsw-views-menu-icon';
      icon.textContent = view.icon;
      const text = document.createElement('span');
      text.className = 'nsw-views-menu-text';
      const label = document.createElement('span');
      label.className = 'nsw-views-menu-label';
      label.textContent = view.label;
      const blurb = document.createElement('span');
      blurb.className = 'nsw-views-menu-blurb';
      blurb.textContent = view.blurb;
      text.appendChild(label);
      text.appendChild(blurb);
      item.appendChild(icon);
      item.appendChild(text);
      item.setAttribute('aria-label', `${view.label}: ${view.blurb}`);
      item.addEventListener('click', () => apply(view.id));
      menu.appendChild(item);
      buttons.get(view.id)?.push(item) ?? buttons.set(view.id, [item]);
    }
    syncEnabled();
  }

  function syncEnabled() {
    const ready = !!dataManager;
    container.classList.toggle('is-disabled', !ready);
    for (const elements of buttons.values()) {
      for (const el of elements) {
        if (ready) el.removeAttribute('aria-disabled');
        else el.setAttribute('aria-disabled', 'true');
      }
    }
    if (ready) menuButton.removeAttribute('aria-disabled');
    else menuButton.setAttribute('aria-disabled', 'true');
  }

  menuButton.addEventListener('click', () => {
    if (!dataManager) return;
    setMenuOpen(!menuOpen);
  });
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeyDown, true);
  render();

  return {
    /** Connect the layer manager; enables the dock and clears stale active marks. */
    connect(next) {
      dataManager = next || null;
      unsubscribe?.();
      unsubscribe = null;
      if (typeof dataManager?.subscribe === 'function') {
        unsubscribe = dataManager.subscribe(onLayerChange);
      }
      setActive(null);
      syncEnabled();
    },
    apply,
    getActive: () => activeId,
    isMenuOpen: () => menuOpen,
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      dataManager = null;
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
