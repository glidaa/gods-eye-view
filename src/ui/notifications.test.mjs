import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NOTIFICATIONS,
  recordNotification,
  getNotifications,
  getUnreadCount,
  markNotificationsRead,
  bindNotificationCenter,
  renderNotificationCenter,
  _resetNotificationsForTest,
} from './notifications.js';

class FakeElement {
  constructor(tag, document) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this._text = '';
    this.className = '';
    this.hidden = false;
    this.attributes = new Map();
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

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function fakeDocument() {
  const document = {
    createElement: (tag) => new FakeElement(tag, document),
  };
  return document;
}

test('recordNotification ignores blank input and caps the tray', () => {
  _resetNotificationsForTest();
  assert.equal(recordNotification('   '), null);
  assert.equal(recordNotification(null), null);
  assert.deepEqual(getNotifications(), []);
  for (let i = 0; i < MAX_NOTIFICATIONS + 5; i += 1) {
    recordNotification(`notice ${i}`);
  }
  const items = getNotifications();
  assert.equal(items.length, MAX_NOTIFICATIONS);
  assert.equal(items[0].text, `notice ${MAX_NOTIFICATIONS + 4}`);
  assert.equal(getUnreadCount(), MAX_NOTIFICATIONS);
  _resetNotificationsForTest();
});

test('opening the bell marks notifications read', () => {
  _resetNotificationsForTest();
  recordNotification('first');
  recordNotification('second');
  assert.equal(getUnreadCount(), 2);
  markNotificationsRead();
  assert.equal(getUnreadCount(), 0);
  assert.equal(getNotifications().length, 2);
  _resetNotificationsForTest();
});

test('bindNotificationCenter renders badge, empty state and rows', () => {
  _resetNotificationsForTest();
  const document = fakeDocument();
  const listEl = document.createElement('div');
  const countEl = document.createElement('span');
  bindNotificationCenter({ listEl, countEl });
  assert.equal(countEl.textContent, '0');
  assert.equal(countEl.hidden, true);
  assert.equal(listEl.children.length, 1);
  assert.match(listEl.children[0].textContent, /No notifications/);

  recordNotification('power line trip', new Date('2026-10-05T01:02:03Z'));
  assert.equal(countEl.textContent, '1');
  assert.equal(countEl.hidden, false);
  assert.equal(listEl.children.length, 1);
  const row = listEl.children[0];
  assert.equal(row.className, 'transport-notice');
  assert.equal(row.children[0].textContent, 'power line trip');
  assert.match(row.children[1].textContent, /^\d\d:\d\d:\d\d$/);

  bindNotificationCenter({});
  recordNotification('unbound still recorded');
  assert.equal(getNotifications().length, 2);
  _resetNotificationsForTest();
});

test('renderNotificationCenter tolerates elements without a document', () => {
  _resetNotificationsForTest();
  const countEl = { textContent: '', hidden: true };
  const listEl = { textContent: '', ownerDocument: null, children: [] };
  bindNotificationCenter({ listEl, countEl });
  recordNotification('plain text row');
  assert.match(listEl.textContent, /plain text row/);
  renderNotificationCenter();
  _resetNotificationsForTest();
});
