import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HUD, appendCapped, createStore, hud, subscribeSlice } from './hud.js';

afterEach(() => {
  vi.useRealTimers();
  hud.set(() => INITIAL_HUD);
});

describe('store', () => {
  it('does not notify when the producer returns the same state', () => {
    const store = createStore({ a: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set((current) => current);

    expect(listener).not.toHaveBeenCalled();
  });

  it('lets a listener unsubscribe while being notified', () => {
    // Sem a cópia da lista na notificação, isto corrompe a iteração e o segundo ouvinte
    // simplesmente não é chamado — uma vez a cada tanto, dependendo da ordem.
    const store = createStore({ a: 1 });
    const second = vi.fn();
    const off = store.subscribe(() => off());
    store.subscribe(second);

    store.set(() => ({ a: 2 }));

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('slice subscription', () => {
  it('ignores a change outside the selected slice', () => {
    // "Fatia estreita" deixa de ser recomendação: a comparação acontece DEPOIS do seletor.
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.health, notified);

    hud.set((state) => ({ ...state, mana: 10 }));
    expect(notified).not.toHaveBeenCalled();

    hud.set((state) => ({ ...state, health: 5 }));
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribing', () => {
    const notified = vi.fn();
    const off = subscribeSlice(hud, (state) => state.health, notified);
    off();

    hud.set((state) => ({ ...state, health: 5 }));
    expect(notified).not.toHaveBeenCalled();
  });

  it('groups a burst into one leading and one trailing notice', () => {
    // Numa luta o HP muda dezenas de vezes por segundo numa barra que anda três pixels. O
    // primeiro aviso sai na hora — atrasar o início atrasaria a reação visível.
    vi.useFakeTimers();
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.health, notified, { throttleMs: 100 });

    for (let i = 1; i <= 30; i++) hud.set((state) => ({ ...state, health: i }));
    expect(notified).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(notified).toHaveBeenCalledTimes(2);
    // O agrupamento não perde atualização: quem lê chama o seletor e recebe o mais recente.
    expect(hud.get().health).toBe(30);
  });

  it('does not leave a timer behind when unsubscribed mid-window', () => {
    vi.useFakeTimers();
    const notified = vi.fn();
    const off = subscribeSlice(hud, (state) => state.health, notified, { throttleMs: 100 });

    hud.set((state) => ({ ...state, health: 1 }));
    hud.set((state) => ({ ...state, health: 2 }));
    off();
    vi.advanceTimersByTime(500);

    // Uma só: a de entrada. A agendada foi cancelada junto com a assinatura — senão o React
    // seria avisado sobre um componente que já saiu da tela.
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe('appendCapped', () => {
  it('keeps the newest lines and never mutates the previous array', () => {
    const first = ['a'];
    const second = appendCapped(first, 'b');
    expect(first).toEqual(['a']);
    expect(second).toEqual(['a', 'b']);
  });
});
