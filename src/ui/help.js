/**
 * Fullscreen help overlay — everything the app can do and how to ask for
 * it. Opened from the TRANSPORT menu; ESC, backdrop click, or the close
 * button dismisses. Bindings install once, on first open.
 */

function elements(doc) {
  if (!doc?.getElementById) return null;
  const overlay = doc.getElementById('help-overlay');
  const close = doc.getElementById('help-close');
  if (!overlay || !close) return null;
  return { overlay, close };
}

function ensureBound(doc, els) {
  if (!els || els.overlay.dataset.helpBound === 'true') return;
  els.overlay.dataset.helpBound = 'true';
  els.close.addEventListener('click', () => closeHelp(doc));
  els.overlay.addEventListener('click', (event) => {
    if (event?.target === els.overlay) closeHelp(doc);
  });
  doc.addEventListener?.('keydown', (event) => {
    if (event?.key !== 'Escape') return;
    const current = doc.getElementById?.('help-overlay');
    if (current && !current.hidden) closeHelp(doc);
  });
}

/**
 * Open the help overlay.
 * @param {object} [doc] - Document (defaults to global).
 * @returns {boolean} Whether the overlay opened.
 */
export function openHelp(doc = globalThis.document) {
  const els = elements(doc);
  if (!els) return false;
  ensureBound(doc, els);
  els.overlay.hidden = false;
  try {
    els.close.focus?.();
  } catch {
    /* Focus is optional in non-interactive fixtures. */
  }
  return true;
}

/**
 * Close the help overlay.
 * @param {object} [doc] - Document (defaults to global).
 * @returns {boolean} Whether the overlay closed (false when absent).
 */
export function closeHelp(doc = globalThis.document) {
  const els = elements(doc);
  if (!els) return false;
  els.overlay.hidden = true;
  return true;
}

/**
 * Whether the help overlay is currently open.
 * @param {object} [doc] - Document (defaults to global).
 * @returns {boolean}
 */
export function isHelpOpen(doc = globalThis.document) {
  return elements(doc)?.overlay.hidden === false;
}
