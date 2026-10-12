import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelQuickRow } from './panelQuickRow.js';

class FakeElement extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.clicked = 0;
    this._classes = new Set();
  }

  get classList() {
    const classes = this._classes;
    return {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    };
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

  querySelector(selector) {
    const match = selector.match(
      /\[data-(?:collapse-target|dock-toggle-target)="([^"]+)"\]/,
    );
    if (match)
      return (
        this.children.find((child) => child.toggleTarget === match[1]) || null
      );
    return null;
  }

  closest(selector) {
    if (selector === '[data-quick-panel]')
      return this.dataset.quickPanel ? this : null;
    return null;
  }

  click() {
    this.clicked += 1;
    this.dispatchEvent(new Event('click'));
  }
}

function fakeDocument() {
  const listeners = new Map();
  const document = {
    elements: new Map(),
    getElementById: (id) => document.elements.get(id) || null,
    querySelector: (selector) => {
      const match = selector.match(/\[data-quick-panel="([^"]+)"\]/);
      if (!match) return null;
      const row = document.elements.get('panel-quick-row');
      return (
        row?.children.find((child) => child.dataset.quickPanel === match[1]) ||
        null
      );
    },
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
    createElement: () => new FakeElement(document),
  };
  const row = new FakeElement(document);
  row.id = 'panel-quick-row';
  document.elements.set('panel-quick-row', row);
  for (const panelId of ['location-bar', 'data-panel', 'scene-panel']) {
    const button = new FakeElement(document);
    button.dataset.quickPanel = panelId;
    row.appendChild(button);
    const panel = new FakeElement(document);
    panel.id = panelId;
    panel.classList.add('collapsed');
    const toggle = new FakeElement(document);
    toggle.toggleTarget = panelId;
    panel.appendChild(toggle);
    panel.toggle = toggle;
    document.elements.set(panelId, panel);
  }
  return document;
}

test('createPanelQuickRow returns null when the row is absent', () => {
  assert.equal(
    createPanelQuickRow({ document: { getElementById: () => null } }),
    null,
  );
  assert.equal(createPanelQuickRow({ document: null }), null);
});

test('quick buttons delegate to panel toggles and track open state', () => {
  const document = fakeDocument();
  const quick = createPanelQuickRow({ document });
  assert.ok(quick);
  const dataButton = document.querySelector('[data-quick-panel="data-panel"]');
  const dataPanel = document.getElementById('data-panel');
  assert.equal(dataButton.getAttribute('aria-pressed'), 'false');

  // A quick click delegates to the panel's own toggle (dispatched on the
  // row, as a bubbled button click would).
  const row = document.getElementById('panel-quick-row');
  const click = new Event('click');
  Object.defineProperty(click, 'target', { value: dataButton });
  row.dispatchEvent(click);
  assert.equal(dataPanel.toggle.clicked, 1);

  // Pressed state follows the panel, however it was toggled.
  dataPanel.classList.remove('collapsed');
  document.emit('click', { target: dataPanel.toggle });
  assert.equal(dataButton.getAttribute('aria-pressed'), 'true');
  dataPanel.classList.add('collapsed');
  document.emit('keydown', { key: 'Escape' });
  assert.equal(dataButton.getAttribute('aria-pressed'), 'false');

  quick.destroy();
  assert.equal(document.listenerCount('click'), 0);
  assert.equal(document.listenerCount('keydown'), 0);
});
