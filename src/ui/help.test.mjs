import test from 'node:test';
import assert from 'node:assert/strict';
import { openHelp, closeHelp, isHelpOpen } from './help.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.hidden = true;
    this.dataset = {};
    this.focused = 0;
  }

  focus() {
    this.focused += 1;
  }
}

function fakeDocument({ withOverlay = true } = {}) {
  const listeners = new Map();
  const overlay = new FakeElement();
  const close = new FakeElement();
  const document = {
    overlay,
    close,
    getElementById: (id) => {
      if (!withOverlay) return null;
      if (id === 'help-overlay') return overlay;
      if (id === 'help-close') return close;
      return null;
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    listenerCount: (type) => listeners.get(type)?.size || 0,
    emit: (type, event) => {
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
      // Mirror real-DOM bubbling: overlay listeners hear close-button clicks.
      if (type === 'click' && event?.target === close)
        close.dispatchEvent(new Event('click'));
    },
  };
  overlay.dispatchClick = (target) => {
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: target });
    overlay.dispatchEvent(event);
  };
  return document;
}

test('openHelp returns false when the overlay is absent', () => {
  const document = fakeDocument({ withOverlay: false });
  assert.equal(openHelp(document), false);
  assert.equal(isHelpOpen(document), false);
  assert.equal(closeHelp(document), false);
});

test('help opens, focuses close, and binds once', () => {
  const document = fakeDocument();
  assert.equal(openHelp(document), true);
  assert.equal(isHelpOpen(document), true);
  assert.equal(document.overlay.hidden, false);
  assert.equal(document.close.focused, 1);
  assert.equal(document.listenerCount('keydown'), 1);
  openHelp(document);
  assert.equal(document.listenerCount('keydown'), 1);
  assert.equal(closeHelp(document), true);
  assert.equal(isHelpOpen(document), false);
});

test('close button, backdrop click and Escape dismiss help', () => {
  const document = fakeDocument();
  openHelp(document);

  // Clicks inside the card (target is not the overlay) keep it open.
  document.overlay.dispatchClick({ texts: 'card' });
  assert.equal(isHelpOpen(document), true);

  // Backdrop click (target is the overlay) closes it.
  document.overlay.dispatchClick(document.overlay);
  assert.equal(isHelpOpen(document), false);

  openHelp(document);
  document.emit('keydown', { key: 'Enter' });
  assert.equal(isHelpOpen(document), true);
  document.emit('keydown', { key: 'Escape' });
  assert.equal(isHelpOpen(document), false);

  openHelp(document);
  document.close.dispatchEvent(new Event('click'));
  assert.equal(isHelpOpen(document), false);
});
