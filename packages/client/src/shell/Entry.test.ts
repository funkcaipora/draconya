import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Entry } from './Entry.js';
import { account, INITIAL_ACCOUNT } from '../account/store.js';

// A tela de entrada (#248, ADR 0029 D7/D8): o design vestido sobre as três fases que a FUN-97
// já tinha. `prerender` roda o componente sem DOM — o `useEffect` de `refresh()` não roda em
// SSR, então nenhum teste aqui bate na rede de verdade.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Entry));
  return new Response(prelude).text();
}

beforeEach(() => {
  account.set(() => INITIAL_ACCOUNT);
});

describe('Entry', () => {
  it('checking: só o texto de espera, sem botão (RF-01)', async () => {
    const html = await render();
    expect(html).toContain('Verificando sua sessão');
    expect(html).not.toContain('<button');
  });

  it('anonymous: login sem senha e sem nenhum campo (RF-02)', async () => {
    account.set((state) => ({ ...state, phase: 'anonymous' }));
    const html = await render();
    expect(html).toContain('ENTRAR');
    expect(html).toContain('Criar conta');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('<input');
  });

  it('ready: grade de personagens com vocação colorida e estado traduzido (RF-03)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null },
        { id: 'c2', name: 'Sem Voc', level: 1, xp: 0, gold: 0, vocation: null, state: 'hunt', sessionId: null },
      ],
    }));
    const html = await render();
    expect(html).toContain('Aldric');
    expect(html).toContain('entry-vocation-knight');
    expect(html).toContain('Cavaleiro');
    expect(html).toContain('Lv 12 · na cidade');
    expect(html).toContain('Lv 1 · numa hunt');
    expect(html).toContain('+ NOVO PERSONAGEM');
    expect(html).toContain('Trocar de conta');
  });

  it('ready: personagem sem vocação mostra "—", sem classe de cor (RF-03, caso de borda)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c2', name: 'Sem Voc', level: 1, xp: 0, gold: 0, vocation: null, state: 'hunt', sessionId: null },
      ],
    }));
    const html = await render();
    expect(html).toContain('—');
    expect(html).not.toContain('entry-vocation-');
  });

  it('ready: id de vocação desconhecido mostra o id cru, sem classe de cor (RF-03, caso de borda)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c3', name: 'Novo Voc', level: 1, xp: 0, gold: 0, vocation: 'necromancer', state: 'city', sessionId: null },
      ],
    }));
    const html = await render();
    expect(html).toContain('necromancer');
    expect(html).not.toContain('entry-vocation-necromancer');
  });

  it('erro do servidor em --blood-7, nas duas fases logadas (RF-07)', async () => {
    account.set((state) => ({ ...state, phase: 'anonymous', error: 'Não foi possível falar com o servidor.' }));
    expect(await render()).toContain('class="entry-error"');

    account.set((state) => ({ ...state, phase: 'ready', error: 'Nome inválido: de 2 a 30 letras, espaço, apóstrofo ou hífen.' }));
    expect(await render()).toContain('class="entry-error"');
  });

  it('busy: cartões e o cartão de criar ficam desabilitados (RF-08)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      busy: true,
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null },
      ],
    }));
    const html = await render();
    // O cartão do personagem e o cartão "+ NOVO PERSONAGEM" são os dois `<button disabled`
    // da grade — o botão "Trocar de conta" (`Button` primitivo) não entra nessa contagem porque
    // não desabilita por `busy` (é uma troca de conta, não uma chamada em duplicidade).
    const disabledButtons = html.match(/<button[^>]*disabled/g) ?? [];
    expect(disabledButtons.length).toBeGreaterThanOrEqual(2);
  });
});
