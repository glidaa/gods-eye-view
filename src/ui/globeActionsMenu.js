/**
 * Globe actions menu — the top-center nav collapsed into one button with a
 * dropdown. The five action buttons keep their ids, order, labels and
 * bindings; this module only owns the dropdown open/close behavior
 * (toggle, close on item click, outside click, and Escape).
 */

export function createGlobeActionsMenu({
  document: doc = globalThis.document,
} = {}) {
  if (!doc?.getElementById) return null;
  const btn = doc.getElementById('globe-actions-btn');
  const menu = doc.getElementById('globe-actions-menu');
  if (!btn || !menu) return null;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const onToggle = () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  };
  const onMenuClick = () => close();
  const onDocumentClick = (event) => {
    const target = event?.target;
    if (target?.closest?.('#top-center-actions')) return;
    close();
  };
  const onKey = (event) => {
    if (event?.key === 'Escape') close();
  };

  btn.addEventListener('click', onToggle);
  menu.addEventListener('click', onMenuClick);
  doc.addEventListener?.('click', onDocumentClick);
  doc.addEventListener?.('keydown', onKey);

  return {
    get open() {
      return menu.hidden === false;
    },
    destroy() {
      btn.removeEventListener?.('click', onToggle);
      menu.removeEventListener?.('click', onMenuClick);
      doc.removeEventListener?.('click', onDocumentClick);
      doc.removeEventListener?.('keydown', onKey);
      close();
    },
  };
}
