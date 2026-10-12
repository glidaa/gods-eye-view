/**
 * Left-stack panel quick row — LOCATION / DATA LAYERS / SCENES buttons
 * directly under the TRANSPORT bar. Each button delegates to its panel's
 * own disclosure toggle (collapse button or dock-tray toggle), so there is
 * exactly one behavior behind open/close no matter which control is used.
 * Pressed state re-syncs from the panels' collapsed classes on every
 * interaction, catching toggles made anywhere else (panel buttons, Escape).
 */

const QUICK_PANELS = ['location-bar', 'data-panel', 'scene-panel'];

function panelToggle(doc, panelId) {
  const panel = doc.getElementById?.(panelId);
  return (
    panel?.querySelector?.(
      `[data-collapse-target="${panelId}"], [data-dock-toggle-target="${panelId}"]`,
    ) || null
  );
}

function syncButtons(doc) {
  for (const panelId of QUICK_PANELS) {
    const button = doc.querySelector?.(`[data-quick-panel="${panelId}"]`);
    const panel = doc.getElementById?.(panelId);
    if (!button || !panel) continue;
    const open = !panel.classList.contains('collapsed');
    button.setAttribute('aria-pressed', String(open));
  }
}

export function createPanelQuickRow({
  document: doc = globalThis.document,
} = {}) {
  if (!doc?.getElementById) return null;
  const row = doc.getElementById('panel-quick-row');
  if (!row) return null;

  const onRowClick = (event) => {
    const button = event?.target?.closest?.('[data-quick-panel]');
    const panelId = button?.dataset?.quickPanel;
    if (!panelId) return;
    try {
      panelToggle(doc, panelId)?.click?.();
    } catch {
      /* A missing toggle is a no-op, never a throw. */
    }
    syncButtons(doc);
  };
  const onSettled = () => syncButtons(doc);

  row.addEventListener('click', onRowClick);
  doc.addEventListener?.('click', onSettled);
  doc.addEventListener?.('keydown', onSettled);
  syncButtons(doc);

  return {
    sync: () => syncButtons(doc),
    destroy() {
      row.removeEventListener?.('click', onRowClick);
      doc.removeEventListener?.('click', onSettled);
      doc.removeEventListener?.('keydown', onSettled);
    },
  };
}
