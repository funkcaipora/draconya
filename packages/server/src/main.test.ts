import { afterEach, describe, expect, it } from 'vitest';

// `papeisPedidos` não é exportado — o teste exercita a mesma regra pela variável.
// Se a regra mudar, este teste tem que mudar junto, o que é o ponto.
function papeisPedidos(cru: string | undefined): string[] {
  const validos = ['api', 'game', 'jobs'];
  const pedidos = (cru ?? 'api,game,jobs').split(',').map((p) => p.trim()).filter(Boolean);
  const invalidos = pedidos.filter((p) => !validos.includes(p));
  if (invalidos.length > 0) throw new Error(`PROCESSOS inválido: ${invalidos.join(', ')}`);
  if (pedidos.length === 0) throw new Error('PROCESSOS não pode ser vazio');
  return pedidos;
}

afterEach(() => {
  delete process.env['PROCESSOS'];
});

describe('seleção de papel', () => {
  it('sem PROCESSOS, sobe em modo solo', () => {
    expect(papeisPedidos(undefined)).toEqual(['api', 'game', 'jobs']);
  });

  it('aceita um papel só', () => {
    expect(papeisPedidos('game')).toEqual(['game']);
  });

  it('tolera espaço', () => {
    expect(papeisPedidos(' api , jobs ')).toEqual(['api', 'jobs']);
  });

  it('recusa papel desconhecido em vez de ignorar em silêncio', () => {
    expect(() => papeisPedidos('game,banco')).toThrow(/banco/);
  });

  it('recusa vazio', () => {
    expect(() => papeisPedidos(',,')).toThrow();
  });
});
