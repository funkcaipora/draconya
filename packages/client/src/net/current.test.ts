import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendIntent, setConnection } from './current.js';

beforeEach(() => { setConnection(null); });

describe('mandar intenção sem o socket passar por props (FUN-79)', () => {
  it('entrega à conexão registrada', () => {
    const send = vi.fn();
    setConnection({ send });

    expect(sendIntent({ type: 'enter-hunt', huntId: 'rat', difficulty: 'cautious' })).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: 'enter-hunt', huntId: 'rat', difficulty: 'cautious',
    });
  });

  it('sem conexão, é SILENCIOSO — e diz que não mandou', () => {
    // O botão pode ser clicado no instante entre uma queda e a volta. Derrubar a tela por isso
    // transformaria um piscar de rede em erro de jogo; a reconexão reanexa à MESMA sessão
    // (ADR 0001), então o que se perde é o clique, não o estado.
    expect(() => sendIntent({ type: 'leave-hunt' })).not.toThrow();
    expect(sendIntent({ type: 'leave-hunt' })).toBe(false);
  });

  it('desregistrar impede o envio para uma conexão morta', () => {
    const send = vi.fn();
    setConnection({ send });
    setConnection(null);

    expect(sendIntent({ type: 'leave-hunt' })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
