import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  NSW_VIEW_MANAGED_LAYERS,
  NSW_VIEWS,
  applyNswView,
  createNswViewsWidget,
  nswViewById,
} from './nswViews.js';
import { REGISTERED_LAYER_IDS } from '../data/layerState.js';

const here = dirname(fileURLToPath(import.meta.url));

test('managed layers are the registered energy/event/connectivity set', () => {
  assert.equal(new Set(NSW_VIEW_MANAGED_LAYERS).size, 9);
  for (const id of NSW_VIEW_MANAGED_LAYERS) {
    assert.ok(
      REGISTERED_LAYER_IDS.includes(id),
      `managed layer is registered: ${id}`,
    );
  }
});

test('each view partitions exactly the managed layers', () => {
  const ids = NSW_VIEWS.map((view) => view.id);
  assert.equal(new Set(ids).size, 5);
  assert.equal(
    new Set(NSW_VIEWS.map((view) => view.label)).size,
    NSW_VIEWS.length,
  );
  assert.equal(
    new Set(NSW_VIEWS.map((view) => view.icon)).size,
    NSW_VIEWS.length,
  );
  for (const view of NSW_VIEWS) {
    const union = [...view.on, ...view.off];
    assert.deepEqual(new Set(union), new Set(NSW_VIEW_MANAGED_LAYERS));
    assert.equal(
      union.length,
      NSW_VIEW_MANAGED_LAYERS.length,
      `${view.id} has no overlap or gap`,
    );
    assert.ok(view.blurb.length > 0);
    assert.ok(
      view.camera.lat >= -45 &&
        view.camera.lat <= -9 &&
        view.camera.lon >= 90 &&
        view.camera.lon <= 170,
      `${view.id} frames Australia`,
    );
    assert.ok(
      view.camera.alt >= 50_000 && view.camera.alt <= 3_000_000,
      `${view.id} has a sane map altitude`,
    );
  }
});

test('the five locations each get a dock icon and a menu entry', () => {
  assert.deepEqual(
    NSW_VIEWS.map((view) => view.id),
    ['nsw', 'vic', 'sydney', 'melbourne', 'newcastle'],
  );
  assert.ok(
    NSW_VIEWS.every((view) => view.quick),
    'every location is one dock click away',
  );
  assert.equal(nswViewById('nsw')?.label, 'NSW');
  assert.equal(nswViewById('melbourne')?.label, 'Melbourne');
  assert.equal(nswViewById('nope'), null);
});

test('applyNswView sets exact layer state with user origin, then flies', async () => {
  const calls = [];
  const manager = {
    setEnabled: async (id, enabled, options) => {
      calls.push([id, enabled, options]);
      return true;
    },
  };
  let flown = null;
  const result = await applyNswView(nswViewById('newcastle'), {
    dataManager: manager,
    flyToView: async (camera) => {
      flown = camera;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.viewId, 'newcastle');
  assert.deepEqual(result.failedLayerIds, []);
  assert.equal(result.cameraOk, true);
  assert.equal(calls.length, NSW_VIEW_MANAGED_LAYERS.length);
  for (const [id, enabled, options] of calls) {
    assert.deepEqual(options, { origin: 'user' });
    assert.equal(enabled, nswViewById('newcastle').on.includes(id));
  }
  assert.deepEqual(flown, nswViewById('newcastle').camera);
});

test('applyNswView collects failures and always flies the camera', async () => {
  const manager = {
    setEnabled: async (id) => {
      if (id === 'local-firms') return false;
      if (id === 'aus-energy-grid') throw new Error('refused');
      return true;
    },
  };
  let flown = false;
  const result = await applyNswView(nswViewById('nsw'), {
    dataManager: manager,
    flyToView: async () => {
      flown = true;
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedLayerIds.sort(), [
    'aus-energy-grid',
    'local-firms',
  ]);
  assert.equal(result.cameraOk, true);
  assert.equal(flown, true);

  const cameraFail = await applyNswView(nswViewById('nsw'), {
    dataManager: { setEnabled: async () => true },
    flyToView: async () => {
      throw new Error('superseded');
    },
  });
  assert.equal(cameraFail.ok, false);
  assert.equal(cameraFail.cameraOk, false);
  assert.deepEqual(cameraFail.failedLayerIds, []);
});

test('applyNswView rejects a missing view', async () => {
  await assert.rejects(
    () => applyNswView(null, { dataManager: {}, flyToView: async () => {} }),
    TypeError,
  );
});

test('template carries the dock hooks', () => {
  const markup = readFileSync(
    join(here, 'templates', 'nsw-views.html'),
    'utf8',
  );
  for (const hook of [
    'id="nsw-views"',
    'data-nsw-views-row',
    'data-nsw-views-menu',
    'data-nsw-views-menu-list',
    'aria-haspopup="true"',
    'hidden',
  ]) {
    assert.ok(markup.includes(hook), `template includes ${hook}`);
  }
});

function fakeDom() {
  const listeners = new Map();
  const on = (type, fn, options) => {
    const capture = options === true;
    const list = listeners.get(type) ?? [];
    list.push({ fn, capture });
    listeners.set(type, list);
  };
  const off = (type, fn, options) => {
    const capture = options === true;
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter(
        (entry) => entry.fn !== fn || entry.capture !== capture,
      ),
    );
  };
  function makeElement(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      dataset: {},
      children: [],
      parent: null,
      hidden: false,
      textContent: '',
      attributes: new Map(),
      listeners: new Map(),
      setAttribute(key, value) {
        this.attributes.set(key, String(value));
      },
      getAttribute(key) {
        return this.attributes.get(key) ?? null;
      },
      removeAttribute(key) {
        this.attributes.delete(key);
      },
      appendChild(child) {
        if (child.parent) child.remove();
        this.children.push(child);
        child.parent = this;
        return child;
      },
      append(...nodes) {
        for (const child of nodes) this.appendChild(child);
      },
      remove() {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
      },
      contains(target) {
        let node = target;
        while (node) {
          if (node === this) return true;
          node = node.parent;
        }
        return false;
      },
      addEventListener(type, fn, options) {
        const capture = options === true;
        const list = this.listeners.get(type) ?? [];
        list.push({ fn, capture });
        this.listeners.set(type, list);
      },
      click() {
        const event = { target: this, stopPropagation() {} };
        for (const entry of this.listeners.get('click') ?? []) entry.fn(event);
      },
      focus() {
        document.activeElement = this;
      },
    };
    Object.defineProperty(el, 'textContent', {
      get() {
        return this.children.map((child) => child.textContent).join('');
      },
      set(value) {
        this.children = [];
        this._text = String(value);
      },
      configurable: true,
    });
    el.classList = {
      contains: (name) => el.className.split(' ').includes(name),
      toggle(name, force) {
        const classes = new Set(el.className.split(' ').filter(Boolean));
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        el.className = [...classes].join(' ');
        return next;
      },
    };
    return el;
  }
  const find = (root, predicate) => {
    for (const child of root.children) {
      if (predicate(child)) return child;
      const nested = find(child, predicate);
      if (nested) return nested;
    }
    return null;
  };
  const matches = (el, selector) => {
    if (selector.startsWith('[data-')) {
      const key = selector
        .slice('[data-'.length, -1)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return key in el.dataset;
    }
    if (selector.startsWith('.'))
      return el.className.split(' ').includes(selector.slice(1));
    return false;
  };
  const document = {
    activeElement: null,
    createElement: makeElement,
    addEventListener: on,
    removeEventListener: off,
    dispatch(type, event) {
      for (const entry of listeners.get(type) ?? []) entry.fn(event);
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
  };
  const container = makeElement('div');
  container.querySelector = (selector) =>
    matches(container, selector)
      ? container
      : find(container, (el) => matches(el, selector));
  const row = makeElement('div');
  row.dataset.nswViewsRow = '';
  const menuList = makeElement('div');
  menuList.dataset.nswViewsMenuList = '';
  const menuButton = makeElement('button');
  menuButton.dataset.nswViewsMenu = '';
  container.appendChild(menuList);
  container.appendChild(row);
  container.appendChild(menuButton);
  return { document, container, row, menuList, menuButton };
}

function fakeManager() {
  const state = new Map(NSW_VIEW_MANAGED_LAYERS.map((id) => [id, false]));
  const calls = [];
  let subscriber = null;
  return {
    calls,
    state,
    setEnabled: async (id, enabled) => {
      calls.push([id, enabled]);
      state.set(id, enabled);
      return true;
    },
    subscribe(cb) {
      subscriber = cb;
      return () => {
        subscriber = null;
      };
    },
    emit(change) {
      subscriber?.(change);
    },
  };
}

function withDocument(document, run) {
  const prior = globalThis.document;
  const restore = () => {
    if (prior === undefined) delete globalThis.document;
    else globalThis.document = prior;
  };
  globalThis.document = document;
  let result;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === 'function')
    return result.finally(restore);
  restore();
  return result;
}

test('widget renders dock and menu, disabled until the manager connects', () => {
  const dom = fakeDom();
  return withDocument(dom.document, () => {
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async () => {},
    });
    try {
      assert.equal(
        dom.row.children.length,
        NSW_VIEWS.filter((view) => view.quick).length,
      );
      assert.equal(dom.menuList.children.length, NSW_VIEWS.length);
      assert.ok(dom.container.classList.contains('is-disabled'));
      assert.equal(dom.menuButton.getAttribute('aria-disabled'), 'true');
      const manager = fakeManager();
      widget.connect(manager);
      assert.ok(!dom.container.classList.contains('is-disabled'));
      assert.equal(dom.menuButton.getAttribute('aria-disabled'), null);
    } finally {
      widget.destroy();
    }
  });
});

test('clicking a dock icon applies the exact display and marks it active', async () => {
  const dom = fakeDom();
  return withDocument(dom.document, async () => {
    const manager = fakeManager();
    let flown = null;
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async (camera) => {
        flown = camera;
      },
    });
    try {
      widget.connect(manager);
      const button = dom.row.children[0];
      const view = nswViewById(button.dataset.nswView);
      button.click();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(widget.getActive(), view.id);
      assert.ok(button.classList.contains('is-active'));
      assert.equal(button.getAttribute('aria-current'), 'true');
      assert.deepEqual(flown, view.camera);
      const enabled = new Map(manager.calls);
      assert.equal(enabled.size, NSW_VIEW_MANAGED_LAYERS.length);
      for (const id of view.on) assert.equal(enabled.get(id), true);
      for (const id of view.off) assert.equal(enabled.get(id), false);
    } finally {
      widget.destroy();
    }
  });
});

test('rapid clicks queue and the last display wins exactly', async () => {
  const dom = fakeDom();
  return withDocument(dom.document, async () => {
    const manager = fakeManager();
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async () => {},
    });
    try {
      widget.connect(manager);
      const first = widget.apply('nsw');
      assert.equal(widget.getActive(), 'nsw');
      const second = widget.apply('newcastle');
      assert.equal(widget.getActive(), 'newcastle');
      const [firstResult, secondResult] = await Promise.all([first, second]);
      assert.equal(firstResult.viewId, 'nsw');
      assert.equal(secondResult.viewId, 'newcastle');
      assert.equal(widget.getActive(), 'newcastle');
      const view = nswViewById('newcastle');
      for (const id of view.on) assert.equal(manager.state.get(id), true);
      for (const id of view.off) assert.equal(manager.state.get(id), false);
    } finally {
      widget.destroy();
    }
  });
});

test('layer churn during a slow apply keeps active; after it clears', async () => {
  const dom = fakeDom();
  return withDocument(dom.document, async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const manager = fakeManager();
    manager.setEnabled = async (id, enabled) => {
      await gate;
      manager.calls.push([id, enabled]);
      manager.state.set(id, enabled);
      return true;
    };
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async () => {},
    });
    try {
      widget.connect(manager);
      const pending = widget.apply('sydney');
      manager.emit({ type: 'visibility', layerId: 'local-au-power' });
      assert.equal(widget.getActive(), 'sydney');
      release();
      await pending;
      manager.emit({ type: 'visibility', layerId: 'local-au-power' });
      assert.equal(widget.getActive(), null);
    } finally {
      widget.destroy();
    }
  });
});

test('menu opens, applies and closes; escape and outside clicks close it', async () => {
  const dom = fakeDom();
  return withDocument(dom.document, async () => {
    const manager = fakeManager();
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async () => {},
    });
    try {
      widget.connect(manager);
      dom.menuButton.click();
      assert.equal(widget.isMenuOpen(), true);
      assert.equal(dom.menuList.hidden, false);
      const item = dom.menuList.children.at(-1);
      item.click();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(widget.getActive(), item.dataset.nswView);
      assert.equal(widget.isMenuOpen(), false);

      dom.menuButton.click();
      assert.equal(widget.isMenuOpen(), true);
      dom.document.dispatch('keydown', {
        key: 'Escape',
        stopPropagation() {},
      });
      assert.equal(widget.isMenuOpen(), false);

      dom.menuButton.click();
      dom.document.dispatch('pointerdown', {
        target: dom.document.createElement('div'),
      });
      assert.equal(widget.isMenuOpen(), false);
    } finally {
      widget.destroy();
    }
  });
});

test('external managed-layer change clears active; unmanaged change keeps it', async () => {
  const dom = fakeDom();
  return withDocument(dom.document, async () => {
    const manager = fakeManager();
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async () => {},
    });
    try {
      widget.connect(manager);
      const applied = await widget.apply('sydney');
      assert.equal(applied.ok, true);
      assert.equal(widget.getActive(), 'sydney');
      manager.emit({ type: 'visibility', layerId: 'cameras' });
      assert.equal(widget.getActive(), 'sydney');
      manager.emit({ type: 'visibility', layerId: 'local-au-power' });
      assert.equal(widget.getActive(), null);
      assert.ok(
        !dom.row.children.some((button) =>
          button.classList.contains('is-active'),
        ),
      );
    } finally {
      widget.destroy();
    }
  });
});

test('widget guards its inputs and cleans up document listeners', () => {
  const dom = fakeDom();
  return withDocument(dom.document, () => {
    assert.throws(
      () => createNswViewsWidget({ flyToView: async () => {} }),
      TypeError,
    );
    assert.throws(
      () => createNswViewsWidget({ container: dom.container }),
      TypeError,
    );
    const bare = dom.document.createElement('div');
    assert.throws(
      () =>
        createNswViewsWidget({ container: bare, flyToView: async () => {} }),
      TypeError,
    );
    const widget = createNswViewsWidget({
      container: dom.container,
      flyToView: async () => {},
    });
    assert.equal(dom.document.listenerCount('pointerdown'), 1);
    widget.destroy();
    assert.equal(dom.document.listenerCount('pointerdown'), 0);
    assert.equal(dom.document.listenerCount('keydown'), 0);
  });
});
