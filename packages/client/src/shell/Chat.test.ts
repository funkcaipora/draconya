import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Chat } from './Chat.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { ChatLine, SystemLine } from '../state/hud.js';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Chat, { onClose: () => {} }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
});

describe('Chat', () => {
  it('renders inside a Panel titled CHAT, with a close button', async () => {
    const html = await render();
    expect(html).toContain('CHAT');
    // O `Panel` (DS-04) só desenha o botão fechar quando `onClose` chega — aqui só se confere
    // que `Chat.tsx` o repassa (RF-01).
    expect(html).toContain('title="fechar"');
  });

  it('shows the placeholder "—" with no chat lines and no system messages (RF-06)', async () => {
    const html = await render();
    expect(html).toContain('chat-quiet');
    expect(html).toContain('—');
  });

  it('colors a warning system message with chat-system-warning and an error with chat-system-error (RF-04)', async () => {
    const systemMessages: readonly SystemLine[] = [
      { level: 'warning', text: 'bot-config inválido', atMs: 1 },
      { level: 'error', text: 'sessão encerrada', atMs: 2 },
    ];
    hud.set((state) => ({ ...state, systemMessages }));
    const html = await render();
    expect(html).toContain('chat-system-warning');
    expect(html).toContain('bot-config inválido');
    expect(html).toContain('chat-system-error');
    expect(html).toContain('sessão encerrada');
    // Com mensagem, o placeholder de vazio some.
    expect(html).not.toContain('chat-quiet');
  });

  it('renders chat lines with author and text', async () => {
    const chat: readonly ChatLine[] = [
      { channel: 'say', author: 'Rashid', text: 'Bom dia', atMs: 1 },
    ];
    hud.set((state) => ({ ...state, chat }));
    const html = await render();
    expect(html).toContain('Rashid');
    expect(html).toContain('Bom dia');
  });
});
