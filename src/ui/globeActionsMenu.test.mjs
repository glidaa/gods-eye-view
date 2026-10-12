import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobeActionsMenu } from './globeActionsMenu.js';

class FakeElement extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.hidden = true;
    this.attributes = new Map();
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  closest() {
    return null;
  }

  click() {
    this.dispatchEvent(new Event('click'));
  }
}

function fakeDocument() {
  const listeners = new Map();
  const document = {
    elements: new Map(),
    getElementById: (id) => document.elements.get(id) || null,
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
  for (const id of ['globe-actions-btn', 'globe-actions-menu']) {
    const el = new FakeElement(document);
    el.id = id;
    document.elements.set(id, el);
  }
  return document;
}

test('createGlobeActionsMenu returns null when the chrome is absent', () => {
  assert.equal(
    createGlobeActionsMenu({ document: { getElementById: () => null } }),
    null,
  );
  assert.equal(createGlobeActionsMenu({ document: null }), null);
});

test('globe menu toggles, closes on item, outside click and Escape', () => {
  const document = fakeDocument();
  const menu = createGlobeActionsMenu({ document });
  assert.ok(menu);
  assert.equal(menu.open, false);
  const btn = document.getElementById('globe-actions-btn');
  const panel = document.getElementById('globe-actions-menu');

  btn.click();
  assert.equal(menu.open, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');

  // An action click inside the menu closes it (the action's own binding
  // still fires — this module never intercepts the event).
  panel.dispatchEvent(new Event('click'));
  assert.equal(menu.open, false);

  btn.click();
  assert.equal(menu.open, true);
  document.emit('click', { target: { closest: () => null } });
  assert.equal(menu.open, false);

  btn.click();
  // Clicks inside the nav (the toggle itself bubbling up) keep it open.
  document.emit('click', { target: { closest: () => ({}) } });
  assert.equal(menu.open, true);
  document.emit('keydown', { key: 'Escape' });
  assert.equal(menu.open, false);

  menu.destroy();
  assert.equal(document.listenerCount('click'), 0);
  assert.equal(document.listenerCount('keydown'), 0);
});
