import { createVoiceCommands as bindVoiceCommands } from './sessionCommands.js';
import { createVoiceChat } from './chat.js';
import { createRealtimeSession } from './realtimeSession.js';

/** Default composition; callers may supply another session adapter factory. */
export function createVoiceCommands(options) {
  return bindVoiceCommands({
    createChat: (hooks) => createVoiceChat(hooks),
    createSession: createRealtimeSession,
    ...options,
  });
}
