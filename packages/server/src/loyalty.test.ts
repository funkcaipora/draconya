import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../content/src/load.js';
import { accountAgeDays, createLoyaltyBonusResolver, loyaltyBonusPercentFor } from './loyalty.js';

// A tabela REAL do conteúdo (`loyalty/baseline.json`), e não uma cópia: o teste prende a
// tabela do Canary que o boot carrega.
const config = (() => {
  const content = loadContent(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'data'));
  if (content.loyalty === undefined) throw new Error('loyalty/baseline.json não carregou');
  return content.loyalty;
})();

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const bornDaysAgo = (days: number, extraMs = 0): Date => new Date(NOW - days * DAY - extraMs);

describe('idade da conta (Account::getAccountAgeInDays)', () => {
  it('conta dias INTEIROS: é o piso da divisão inteira do Canary', () => {
    expect(accountAgeDays(bornDaysAgo(0), NOW)).toBe(0);
    expect(accountAgeDays(bornDaysAgo(0, DAY - 1), NOW)).toBe(0);
    expect(accountAgeDays(bornDaysAgo(1), NOW)).toBe(1);
    expect(accountAgeDays(bornDaysAgo(359, DAY - 1), NOW)).toBe(359);
    expect(accountAgeDays(bornDaysAgo(360), NOW)).toBe(360);
  });

  it('relógio da conta à frente do da api: zero dias, nunca negativo', () => {
    expect(accountAgeDays(new Date(NOW + 5 * DAY), NOW)).toBe(0);
  });
});

describe('o bônus que a api põe no ticket (#628, ADR 0052 d.5)', () => {
  it('a tabela do conteúdo é a do Canary: 10 degraus de 360 em 360 pontos, de 5 % a 50 %', () => {
    expect(config.pointsPerCreationDay).toBe(1);
    expect(config.tiers.map((tier) => tier.minPoints)).toEqual(
      [360, 720, 1080, 1440, 1800, 2160, 2520, 2880, 3240, 3600],
    );
    expect(config.tiers.map((tier) => tier.percent)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  });

  it('abaixo do primeiro degrau não há bônus — o ticket do caso comum não carrega nada', () => {
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(0), NOW)).toBeUndefined();
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(359, DAY - 1), NOW)).toBeUndefined();
  });

  it('no dia 360 entra o primeiro degrau, e cada 360 dias sobe outro até 50 %', () => {
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(360), NOW)).toBe(5);
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(719), NOW)).toBe(5);
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(720), NOW)).toBe(10);
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(3599), NOW)).toBe(45);
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(3600), NOW)).toBe(50);
    expect(loyaltyBonusPercentFor(config, bornDaysAgo(20_000), NOW)).toBe(50);
  });

  it('sistema desligado (loyaltyEnabled = false) nunca põe bônus no ticket', () => {
    expect(loyaltyBonusPercentFor({ ...config, enabled: false }, bornDaysAgo(3600), NOW)).toBeUndefined();
  });

  it('o resolver lê o carimbo da conta pelo id e usa o relógio injetado', async () => {
    const asked: string[] = [];
    const repository = {
      getAccountCreatedAt: async (accountId: string) => {
        asked.push(accountId);
        return accountId === 'veterana' ? bornDaysAgo(1100) : null;
      },
    };
    const resolver = createLoyaltyBonusResolver({ repository, config, now: () => NOW });

    expect(await resolver('veterana')).toBe(15);
    // Conta que não existe (a posse do personagem já foi conferida, então não deveria): o lado
    // seguro é não dar bônus, nunca lançar.
    expect(await resolver('fantasma')).toBeUndefined();
    expect(asked).toEqual(['veterana', 'fantasma']);
  });

  it('o mesmo instante de emissão fixa o degrau: 359 dias e 1 hora depois, ainda não vale', async () => {
    const created = bornDaysAgo(359, 23 * 3_600_000);
    const at = (nowMs: number) => createLoyaltyBonusResolver({
      repository: { getAccountCreatedAt: async () => created }, config, now: () => nowMs,
    })('a1');
    // 359 dias e 23 h: ainda 359.
    expect(await at(NOW)).toBeUndefined();
    // Uma hora depois completa o dia 360 — mas só um ticket NOVO enxerga (a sessão já fixou o dela).
    expect(await at(NOW + 3_600_000)).toBe(5);
  });
});
