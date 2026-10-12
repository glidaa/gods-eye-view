/**
 * Notification center backing the TRANSPORT bar bell. Every toast the app
 * shows is also recorded here (capped), so transient notices stay readable
 * after they fade. The bell badge counts unread items; opening the list
 * marks them read.
 */

export const MAX_NOTIFICATIONS = 20;

let _items = [];
let _unread = 0;
let _listEl = null;
let _countEl = null;
let _sequence = 0;

/**
 * Record a notification.
 * @param {string} text - Notice text (toast copy).
 * @param {Date} [at] - Timestamp (defaults to now).
 * @returns {{ id: number, text: string, at: Date }|null} The item, or null for blank input.
 */
export function recordNotification(text, at = new Date()) {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  _sequence += 1;
  const item = { id: _sequence, text: clean, at };
  _items.unshift(item);
  if (_items.length > MAX_NOTIFICATIONS) _items.length = MAX_NOTIFICATIONS;
  _unread = Math.min(_unread + 1, MAX_NOTIFICATIONS);
  renderNotificationCenter();
  return item;
}

/** @returns {Array<{ id: number, text: string, at: Date }>} Newest first. */
export function getNotifications() {
  return [..._items];
}

/** @returns {number} Unread count. */
export function getUnreadCount() {
  return _unread;
}

export function markNotificationsRead() {
  _unread = 0;
  renderNotificationCenter();
}

/**
 * Bind the rendered list + badge. Idempotent; re-renders on every record.
 * @param {{ listEl?: object|null, countEl?: object|null, document?: object }} [elements]
 * @returns {void}
 */
export function bindNotificationCenter({ listEl = null, countEl = null } = {}) {
  _listEl = listEl || null;
  _countEl = countEl || null;
  renderNotificationCenter();
}

function formatNoticeTime(at) {
  try {
    const date = at instanceof Date ? at : new Date(at);
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  } catch {
    return '';
  }
}

/** Re-render the bound list + badge from current state. */
export function renderNotificationCenter() {
  if (_countEl) {
    _countEl.textContent = String(_unread);
    _countEl.hidden = _unread === 0;
  }
  if (!_listEl) return;
  const doc = _listEl.ownerDocument;
  _listEl.textContent = '';
  if (!_items.length) {
    if (doc?.createElement) {
      const empty = doc.createElement('div');
      empty.className = 'transport-notice transport-notice-empty';
      empty.textContent = 'No notifications yet';
      _listEl.appendChild(empty);
    } else {
      _listEl.textContent = 'No notifications yet';
    }
    return;
  }
  for (const item of _items) {
    if (!doc?.createElement) {
      _listEl.textContent += `${item.text}\n`;
      continue;
    }
    const row = doc.createElement('div');
    row.className = 'transport-notice';
    row.setAttribute('role', 'menuitem');
    const body = doc.createElement('span');
    body.textContent = item.text;
    const time = doc.createElement('span');
    time.className = 'transport-notice-time';
    time.textContent = formatNoticeTime(item.at);
    row.appendChild(body);
    row.appendChild(time);
    _listEl.appendChild(row);
  }
}

/** Test seam: clear items, unread count and bindings. */
export function _resetNotificationsForTest() {
  _items = [];
  _unread = 0;
  _listEl = null;
  _countEl = null;
  _sequence = 0;
}
