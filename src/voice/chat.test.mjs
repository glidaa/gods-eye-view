import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceChat } from './chat.js';
import { railFixture } from '../ui/railTestFixture.mjs';

function chatFixture(overrides = {}) {
  const f = railFixture();
  const sent = [];
  const listeners = new Set();
  let active = overrides.active ?? true;
  const chat = createVoiceChat({
    document: f.document,
    sendText: (text) => {
      sent.push(text);
      return true;
    },
    canSend: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides.createOptions,
  });
  const emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };
  return {
    ...f,
    chat,
    sent,
    emit,
    setActive: (value) => {
      active = value;
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function bubbles(f) {
  return f.chat.log.children.filter((child) =>
    child.className?.includes('gev-chat-msg'),
  );
}

function bubbleText(bubble) {
  return bubble.children[1]?.textContent;
}

test('voice transcripts mirror into the log with YOU/AGENT roles', () => {
  const f = chatFixture();
  f.emit({
    type: 'transcript',
    role: 'user',
    text: 'show London',
    final: true,
  });
  f.emit({
    type: 'transcript',
    role: 'assistant',
    text: 'Flying',
    final: false,
    responseId: 'r1',
  });
  f.emit({
    type: 'transcript',
    role: 'assistant',
    text: ' to London',
    final: false,
    responseId: 'r1',
  });
  f.emit({
    type: 'transcript',
    role: 'assistant',
    text: 'Flying to London',
    final: true,
    responseId: 'r1',
  });
  const rows = bubbles(f);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.role, 'user');
  assert.equal(bubbleText(rows[0]), 'show London');
  assert.equal(rows[1].dataset.role, 'assistant');
  assert.equal(bubbleText(rows[1]), 'Flying to London');
});

test('a new assistant response starts a new bubble after done', () => {
  const f = chatFixture();
  f.emit({ type: 'transcript', role: 'assistant', text: 'One', final: true });
  f.emit({ type: 'transcript', role: 'assistant', text: 'Two', final: true });
  const rows = bubbles(f);
  assert.equal(rows.length, 2);
  assert.equal(bubbleText(rows[0]), 'One');
  assert.equal(bubbleText(rows[1]), 'Two');
});

test('typed submit echoes locally and sends trimmed text', () => {
  const f = chatFixture();
  f.chat.input.value = '  zoom to Paris  ';
  f.chat.form.dispatchEvent(new Event('submit'));
  assert.deepEqual(f.sent, ['zoom to Paris']);
  assert.equal(f.chat.input.value, '');
  const rows = bubbles(f);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dataset.role, 'user');
  assert.equal(rows[0].dataset.origin, 'typed');
  assert.equal(bubbleText(rows[0]), 'zoom to Paris');
});

test('empty submit sends nothing and blank voice transcripts are ignored', () => {
  const f = chatFixture();
  f.chat.input.value = '   ';
  f.chat.form.dispatchEvent(new Event('submit'));
  f.emit({ type: 'transcript', role: 'user', text: '', final: true });
  f.emit({ type: 'transcript', role: 'assistant', text: '', final: false });
  assert.deepEqual(f.sent, []);
  assert.equal(bubbles(f).length, 0);
});

test('offline chat refuses to send and shows the voice-on hint', () => {
  const f = chatFixture({ active: false });
  f.emit({ type: 'state', state: 'idle' });
  assert.equal(f.chat.input.disabled, true);
  assert.equal(f.chat.submitText('hello'), false);
  assert.deepEqual(f.sent, []);
  const rows = bubbles(f);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dataset.role, 'system');
  assert.match(bubbleText(rows[0]), /Voice is off/);
  f.setActive(true);
  f.emit({ type: 'state', state: 'listening' });
  assert.equal(f.chat.input.disabled, false);
  assert.equal(f.chat.submitText('hello'), true);
  assert.deepEqual(f.sent, ['hello']);
});

test('a failed send keeps the echo and explains voice is off', () => {
  const f = railFixture();
  const chat = createVoiceChat({
    document: f.document,
    sendText: () => {
      throw new Error('GEV voice is not connected');
    },
    canSend: () => true,
  });
  assert.equal(chat.submitText('hello'), false);
  const rows = chat.log.children;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].dataset.role, 'system');
});

test('log trims to the message cap', () => {
  const f = chatFixture({ createOptions: { maxMessages: 3 } });
  for (let index = 0; index < 5; index++)
    f.emit({
      type: 'transcript',
      role: 'assistant',
      text: `msg${index}`,
      final: true,
    });
  const rows = bubbles(f);
  assert.equal(rows.length, 3);
  assert.equal(bubbleText(rows[0]), 'msg2');
  assert.equal(bubbleText(rows[2]), 'msg4');
});

test('chat starts with the log shut but the box, Send and mic visible', () => {
  const f = chatFixture({ active: false });
  assert.equal(f.chat.collapsed, true);
  assert.equal(f.chat.log.hidden, true);
  assert.equal(f.chat.form.hidden, false);
  assert.equal(f.chat.toggleButton.textContent, '+');
  assert.equal(f.chat.toggleButton.getAttribute('aria-expanded'), 'false');
  f.chat.toggleButton.dispatchEvent(new Event('click'));
  assert.equal(f.chat.collapsed, false);
  assert.equal(f.chat.log.hidden, false);
});

test('collapse toggle hides only the log; the input row never hides', () => {
  const f = chatFixture({ createOptions: { startCollapsed: false } });
  assert.equal(f.listenerCount, 1);
  f.chat.toggleButton.dispatchEvent(new Event('click'));
  assert.equal(f.chat.collapsed, true);
  assert.equal(f.chat.log.hidden, true);
  assert.equal(f.chat.form.hidden, false);
  assert.equal(f.chat.toggleButton.textContent, '+');
  f.chat.toggleButton.dispatchEvent(new Event('click'));
  assert.equal(f.chat.collapsed, false);
  f.chat.destroy();
  assert.equal(f.listenerCount, 0);
  f.emit({ type: 'transcript', role: 'user', text: 'late', final: true });
  assert.equal(bubbles(f).length, 0);
});

test('clicking in the row, focusing the box, or pressing the mic opens the log', () => {
  const toggles = [];
  const f = chatFixture({
    active: false,
    createOptions: { toggleVoice: () => toggles.push('toggle') },
  });
  assert.equal(f.chat.collapsed, true);
  // Clicking the (disabled) input row: capture-phase pointerdown.
  f.chat.form.dispatchEvent(new Event('pointerdown'));
  assert.equal(f.chat.collapsed, false);
  assert.equal(f.chat.log.hidden, false);

  f.chat.setCollapsed(true);
  f.chat.input.dispatchEvent(new Event('focus'));
  assert.equal(f.chat.collapsed, false);

  f.chat.setCollapsed(true);
  f.chat.micButton.click();
  assert.equal(f.chat.collapsed, false);
  assert.deepEqual(toggles, ['toggle']);
});

test('connecting voice opens the log once; a later collapse sticks', () => {
  const f = chatFixture({ active: false });
  assert.equal(f.chat.collapsed, true);
  f.setActive(true);
  f.emit({ type: 'state', state: 'listening' });
  assert.equal(f.chat.collapsed, false);
  f.chat.setCollapsed(true);
  f.emit({ type: 'state', state: 'listening' });
  assert.equal(f.chat.collapsed, true);
});

test('missing document or sendText throws', () => {
  assert.throws(() => createVoiceChat({ sendText: () => true }), TypeError);
  assert.throws(
    () => createVoiceChat({ document: railFixture().document }),
    TypeError,
  );
});

test('the mic sits right of Send, toggles voice, and tracks connection', () => {
  const toggles = [];
  const f = chatFixture({
    active: false,
    createOptions: { toggleVoice: () => toggles.push('toggle') },
  });
  const mic = f.chat.micButton;
  assert.ok(mic, 'a wired toggle renders the mic');
  // Normal-chat order: input, Send, mic.
  assert.deepEqual(
    f.chat.form.children.map((child) => child.className),
    ['gev-chat-input', 'gev-chat-send', 'gev-chat-mic'],
  );
  assert.equal(mic.getAttribute('type'), 'button');
  assert.equal(mic.getAttribute('aria-pressed'), 'false');
  assert.ok(!mic.classList.contains('on'));

  mic.click();
  assert.deepEqual(toggles, ['toggle']);

  f.setActive(true);
  f.emit({ type: 'state', state: 'listening' });
  assert.equal(mic.getAttribute('aria-pressed'), 'true');
  assert.ok(mic.classList.contains('on'));
});

test('a chat without a voice toggle renders no mic', () => {
  const f = chatFixture();
  assert.equal(f.chat.micButton, null);
  assert.deepEqual(
    f.chat.form.children.map((child) => child.className),
    ['gev-chat-input', 'gev-chat-send'],
  );
  assert.throws(
    () =>
      createVoiceChat({
        document: railFixture().document,
        sendText: () => true,
        toggleVoice: 'yes',
      }),
    TypeError,
  );
});
