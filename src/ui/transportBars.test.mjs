import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTransportCoords,
  formatLayerCounts,
  transportMenuActions,
  createTransportBars,
} from './transportBars.js';
import {
  recordNotification,
  getUnreadCount,
  _resetNotificationsForTest,
} from './notifications.js';

class FakeElement extends EventTarget {
  constructor(tag, document) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this._text = '';
    this.className = '';
    this.hidden = false;
    this.attributes = new Map();
    this._listeners = new Map();
  }

  addEventListener(type, fn, options) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return super.addEventListener(type, fn, options);
  }

  removeEventListener(type, fn, options) {
    this._listeners.get(type)?.delete(fn);
    return super.removeEventListener(type, fn, options);
  }

  /** Deliver a synthetic event object straight to this node's listeners. */
  emitFake(type, event) {
    for (const fn of [...(this._listeners.get(type) || [])]) fn(event);
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    // Real DOM: assigning textContent drops all child nodes.
    this._text = String(value);
    this.children = [];
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  matches(selector) {
    if (selector.startsWith('.'))
      return this.className.split(' ').includes(selector.slice(1));
    if (selector === '[data-transport-action]')
      return this.dataset.transportAction != null;
    return false;
  }

  closest(selector) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node = this;
    while (node) {
      if (typeof node.matches === 'function' && node.matches(selector))
        return node;
      node = node.parent || null;
    }
    return null;
  }

  click() {
    const event = new Event('click', { bubbles: true });
    this.dispatchEvent(event);
  }
}

function fakeDocument(ids = []) {
  const listeners = new Map();
  const document = {
    elements: new Map(),
    createElement: (tag) => new FakeElement(tag, document),
    getElementById: (id) => document.elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    emit(type, event) {
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
  for (const id of ids) {
    const el = document.createElement('div');
    el.id = id;
    el.hidden = id.endsWith('-list') || id === 'transport-menu';
    document.elements.set(id, el);
  }
  return document;
}

const BAR_IDS = [
  'notifications-btn',
  'notifications-count',
  'notifications-list',
  'transport-menu-btn',
  'transport-menu',
  'transport-coords',
  'transport-stack',
  'transport-layers',
];

test('formatTransportCoords renders Sydney camera state', () => {
  assert.equal(
    formatTransportCoords(-33.8688, 151.2093, 8000),
    '33.87°S 151.21°E · ALT 8.0KM',
  );
  assert.equal(
    formatTransportCoords(51.5, -0.12, 250),
    '51.50°N 0.12°W · ALT 250M',
  );
  assert.equal(formatTransportCoords(NaN, 0, 0), '--');
});

test('formatLayerCounts renders showing/available', () => {
  assert.equal(formatLayerCounts(3, 40), 'SHOWING 3/40');
  assert.equal(formatLayerCounts(0, 0), 'SHOWING 0/0');
  assert.equal(formatLayerCounts(NaN, 1), '--');
});

test('createTransportBars returns null when the chrome is absent', () => {
  assert.equal(createTransportBars({ document: fakeDocument() }), null);
  assert.equal(createTransportBars({ document: null }), null);
});

test('createTransportBars polls status and clears timers on destroy', () => {
  _resetNotificationsForTest();
  const document = fakeDocument(BAR_IDS);
  let calls = 0;
  const timers = new Set();
  const bars = createTransportBars({
    document,
    getStatus: () => {
      calls += 1;
      return {
        coords: `coords ${calls}`,
        stack: 'Satellite',
        layers: 'SHOWING 2/9',
      };
    },
    setIntervalImpl: (fn, ms) => {
      assert.equal(ms, 1000);
      const id = timers.size + 1;
      timers.add(id);
      fn();
      return id;
    },
    clearIntervalImpl: (id) => timers.delete(id),
  });
  assert.ok(bars);
  // One mount refresh plus one injected tick.
  assert.equal(calls, 2);
  assert.equal(
    document.getElementById('transport-coords').textContent,
    'coords 2',
  );
  assert.equal(
    document.getElementById('transport-stack').textContent,
    'Satellite',
  );
  assert.equal(
    document.getElementById('transport-layers').textContent,
    'SHOWING 2/9',
  );
  assert.equal(timers.size, 1);
  bars.refresh();
  assert.equal(calls, 3);
  bars.destroy();
  assert.equal(timers.size, 0);
  assert.equal(document.listenerCount('click'), 0);
  assert.equal(document.listenerCount('keydown'), 0);
  assert.equal(document.getElementById('transport-menu').hidden, true);
  _resetNotificationsForTest();
});

test('menu toggle dispatches actions and closes on Escape', () => {
  _resetNotificationsForTest();
  const document = fakeDocument(BAR_IDS);
  const seen = [];
  const bars = createTransportBars({
    document,
    actions: { help: () => seen.push('help') },
  });
  const menuBtn = document.getElementById('transport-menu-btn');
  const menu = document.getElementById('transport-menu');
  const item = document.createElement('button');
  item.dataset.transportAction = 'help';
  menu.appendChild(item);

  menuBtn.click();
  assert.equal(menu.hidden, false);
  assert.equal(menuBtn.getAttribute('aria-expanded'), 'true');

  menu.emitFake('click', { target: item });
  assert.deepEqual(seen, ['help']);
  assert.equal(menu.hidden, true);

  menuBtn.click();
  assert.equal(menu.hidden, false);
  document.emit('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  bars.destroy();
  _resetNotificationsForTest();
});

test('help button opens the fullscreen help overlay', () => {
  _resetNotificationsForTest();
  const document = fakeDocument([...BAR_IDS, 'help-btn']);
  const overlay = document.createElement('div');
  overlay.hidden = true;
  const close = document.createElement('button');
  document.elements.set('help-overlay', overlay);
  document.elements.set('help-close', close);
  const bars = createTransportBars({ document });
  document.getElementById('help-btn').click();
  assert.equal(overlay.hidden, false);
  bars.destroy();
  _resetNotificationsForTest();
});

test('bell opens the tray and marks notifications read', () => {
  _resetNotificationsForTest();
  const document = fakeDocument(BAR_IDS);
  recordNotification('line trip in the Hunter');
  assert.equal(getUnreadCount(), 1);
  const bars = createTransportBars({ document });
  const countEl = document.getElementById('notifications-count');
  assert.equal(countEl.textContent, '1');
  assert.equal(countEl.hidden, false);

  document.getElementById('notifications-btn').click();
  const list = document.getElementById('notifications-list');
  assert.equal(list.hidden, false);
  assert.equal(getUnreadCount(), 0);
  assert.equal(countEl.hidden, true);
  bars.destroy();
  _resetNotificationsForTest();
});

test('default menu actions fall back to notices, never throws', () => {
  _resetNotificationsForTest();
  const document = fakeDocument(BAR_IDS);
  const actions = transportMenuActions(document);
  assert.deepEqual(Object.keys(actions).sort(), [
    'attribution',
    'help',
    'nsw-views',
    'providers',
    'share',
  ]);
  actions.providers();
  actions.attribution();
  // Help needs the overlay (absent here); share clicks a missing button.
  actions.help();
  actions.share();
  // Only the two fallback notices were recorded.
  assert.equal(getUnreadCount(), 2);
  _resetNotificationsForTest();
});
