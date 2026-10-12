/**
 * Bottom chat dock for the voice agent.
 *
 * Mirrors everything said out loud (voice transcripts flow in as session
 * events) and accepts typed messages for when the operator cannot talk.
 * Typed messages ride the same agent turn as voice via `sendText`, so the
 * voice session must be active — the input stays disabled until it is.
 *
 * The input row (box + Send + mic) is always visible so the chat is never a
 * mystery strip; only the conversation log collapses. Clicking anywhere in
 * the row, focusing the box, pressing the mic, or connecting voice opens
 * the log.
 *
 * DOM is built with createElement only (no innerHTML, no selectors) so the
 * repository's instrumented DOM fixture can drive it in unit tests.
 */
const DEFAULT_MAX_MESSAGES = 100;
const OFFLINE_HINT = 'Voice is off — turn voice ON first, then type here.';

function isConnectedState(state) {
  return state !== 'idle' && state !== 'connecting' && state !== 'error';
}

export function createVoiceChat({
  document: doc = globalThis.document,
  sendText,
  canSend = () => false,
  subscribe,
  toggleVoice = null,
  maxMessages = DEFAULT_MAX_MESSAGES,
  startCollapsed = true,
} = {}) {
  if (!doc || typeof doc.createElement !== 'function')
    throw new TypeError('Voice chat requires a document');
  if (typeof sendText !== 'function')
    throw new TypeError('Voice chat requires sendText');
  if (subscribe !== undefined && typeof subscribe !== 'function')
    throw new TypeError('Voice chat subscribe must be a function');
  if (toggleVoice !== null && typeof toggleVoice !== 'function')
    throw new TypeError('Voice chat toggleVoice must be a function');

  const build = (tag, className, text = '') => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const root = build('div', 'gev-chat-dock');
  root.id = 'gev-chat-dock';
  root.dataset.status = 'idle';

  const header = build('div', 'gev-chat-header');
  const kicker = build('span', 'gev-chat-kicker', 'AGENT CHAT');
  const status = build('span', 'gev-chat-status', 'VOICE OFF');
  status.setAttribute('aria-live', 'polite');
  const toggle = build('button', 'gev-chat-toggle', '–');
  toggle.setAttribute('type', 'button');
  toggle.setAttribute('aria-label', 'Collapse agent chat');
  toggle.setAttribute('aria-expanded', 'true');
  header.appendChild(kicker);
  header.appendChild(status);
  header.appendChild(toggle);

  const log = build('div', 'gev-chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Agent conversation');

  const form = build('form', 'gev-chat-form');
  const input = build('input', 'gev-chat-input');
  input.setAttribute('type', 'text');
  input.setAttribute('placeholder', OFFLINE_HINT);
  input.setAttribute('aria-label', 'Type a message to the agent');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('maxlength', '2000');
  input.disabled = true;
  const send = build('button', 'gev-chat-send', 'SEND');
  send.setAttribute('type', 'submit');
  send.setAttribute('aria-label', 'Send chat message');
  send.disabled = true;
  // Normal-chat layout: the mic sits right of Send and toggles the same
  // voice session the dock button owns. Rendered only when the host wires
  // a toggle — a chat without voice has no mic to show.
  let mic = null;
  if (toggleVoice) {
    mic = build('button', 'gev-chat-mic');
    mic.setAttribute('type', 'button');
    mic.setAttribute('aria-label', 'Toggle voice');
    mic.setAttribute('aria-pressed', 'false');
    const micIcon = doc.createElement('img');
    micIcon.setAttribute('src', '/mic.svg');
    micIcon.setAttribute('alt', '');
    micIcon.setAttribute('aria-hidden', 'true');
    mic.appendChild(micIcon);
    mic.addEventListener('click', () => {
      setCollapsed(false);
      toggleVoice();
    });
  }
  form.appendChild(input);
  form.appendChild(send);
  if (mic) form.appendChild(mic);

  root.appendChild(header);
  root.appendChild(log);
  root.appendChild(form);
  if (doc.body) doc.body.appendChild(root);

  let collapsed = Boolean(startCollapsed);
  let openBubble = null;
  let destroyed = false;
  let wasConnected = false;
  if (collapsed) {
    log.hidden = true;
    toggle.textContent = '+';
    toggle.setAttribute('aria-label', 'Expand agent chat');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function scrollToLatest() {
    try {
      log.scrollTop = log.scrollHeight;
    } catch {
      /* Non-visual DOM fixtures may not implement scroll geometry. */
    }
  }

  function trimLog() {
    while (log.children.length > maxMessages) log.children[0].remove();
  }

  function appendMessage({ role, text, origin }) {
    const bubble = build('div', `gev-chat-msg gev-chat-msg-${role}`);
    bubble.dataset.role = role;
    if (origin) bubble.dataset.origin = origin;
    const label = build(
      'span',
      'gev-chat-role',
      role === 'user' ? 'YOU' : role === 'assistant' ? 'AGENT' : 'SYSTEM',
    );
    const body = build('span', 'gev-chat-text', text);
    bubble.appendChild(label);
    bubble.appendChild(body);
    log.appendChild(bubble);
    trimLog();
    scrollToLatest();
    return { bubble, body };
  }

  function closeOpenBubble() {
    openBubble = null;
  }

  function appendAssistantChunk(event) {
    if (!event.final && !event.text) return;
    const key = event.responseId || event.itemId || 'live';
    if (!openBubble || openBubble.key !== key) {
      if (!event.text) return;
      const { body } = appendMessage({ role: 'assistant', text: '' });
      openBubble = { key, body };
    }
    if (event.final) {
      if (event.text) openBubble.body.textContent = event.text;
      closeOpenBubble();
    } else if (event.text) {
      openBubble.body.textContent += event.text;
      scrollToLatest();
    }
  }

  function setStatus(state, detail) {
    const connected =
      typeof state === 'string' ? isConnectedState(state) : canSend();
    root.dataset.status = state || (connected ? 'listening' : 'idle');
    status.textContent =
      detail || (connected ? 'CONNECTED' : 'VOICE OFF — TURN VOICE ON TO CHAT');
    input.disabled = !connected;
    input.setAttribute(
      'placeholder',
      connected ? 'Type to the agent…' : OFFLINE_HINT,
    );
    send.disabled = !connected;
    if (mic) {
      mic.setAttribute('aria-pressed', String(connected));
      mic.classList.toggle('on', connected);
    }
    // Pressing the mic connects voice a moment later; opening the log on
    // that transition is what "click talk, chat starts" means. Only the
    // transition expands — a deliberate mid-session collapse is respected.
    if (connected && !wasConnected && collapsed) setCollapsed(false);
    wasConnected = connected;
  }

  function submitText(raw) {
    const text = String(raw ?? '').trim();
    if (!text || destroyed) return false;
    if (!canSend()) {
      appendMessage({ role: 'system', text: OFFLINE_HINT });
      setStatus();
      return false;
    }
    appendMessage({ role: 'user', text, origin: 'typed' });
    let delivered = false;
    try {
      delivered = sendText(text) !== false;
    } catch {
      delivered = false;
    }
    if (!delivered) {
      appendMessage({ role: 'system', text: OFFLINE_HINT });
      setStatus();
      return false;
    }
    return true;
  }

  function handleSessionEvent(event) {
    if (destroyed || !event || typeof event.type !== 'string') return;
    if (event.type === 'transcript') {
      if (event.role === 'user') {
        if (event.final && event.text) {
          closeOpenBubble();
          appendMessage({ role: 'user', text: event.text, origin: 'voice' });
        }
      } else if (event.role === 'assistant') {
        appendAssistantChunk(event);
      }
      return;
    }
    if (event.type === 'state') {
      closeOpenBubble();
      setStatus(event.state, event.detail);
      return;
    }
    if (event.type === 'interruption' || event.type === 'completion') {
      closeOpenBubble();
    }
  }

  function setCollapsed(next) {
    collapsed = Boolean(next);
    log.hidden = collapsed;
    form.hidden = false;
    toggle.textContent = collapsed ? '+' : '–';
    toggle.setAttribute(
      'aria-label',
      collapsed ? 'Expand agent chat' : 'Collapse agent chat',
    );
    toggle.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) {
      scrollToLatest();
      try {
        input.focus();
      } catch {
        /* Focus is optional in non-interactive fixtures. */
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault?.();
    if (submitText(input.value)) input.value = '';
  });
  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  input.addEventListener('focus', () => setCollapsed(false));
  // A disabled input swallows its own clicks, so catch the press on the way
  // down: clicking anywhere in the row (box, Send, mic) opens the log.
  // Capture matters — bubble listeners on the form never see presses on a
  // disabled control.
  form.addEventListener(
    'pointerdown',
    (event) => {
      if (event?.button != null && event.button !== 0) return;
      setCollapsed(false);
    },
    true,
  );

  const unsubscribe =
    typeof subscribe === 'function' ? subscribe(handleSessionEvent) : null;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    closeOpenBubble();
    try {
      if (typeof unsubscribe === 'function') unsubscribe();
    } catch {
      /* Listener teardown must not break disposal. */
    }
    root.remove();
  }

  setStatus();
  return {
    root,
    log,
    input,
    form,
    sendButton: send,
    micButton: mic,
    toggleButton: toggle,
    handleSessionEvent,
    appendMessage,
    submitText,
    setStatus,
    setCollapsed,
    get collapsed() {
      return collapsed;
    },
    destroy,
  };
}
