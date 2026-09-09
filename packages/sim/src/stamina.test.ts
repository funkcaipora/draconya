import type { Stamina } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { drainStamina, isExhausted, materializeStamina, recoveredStaminaMs } from './stamina.js';

const HOUR = 3_600_000;
const rules: Stamina = { id: 'baseline', maxMs: 24 * HOUR, recoveryRatio: 1 };

const hero = (staminaMs: number | null, updatedAtMs = 0): CharacterRuntime =>
  new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 150, maxHealth: 150, mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
    staminaMs, staminaUpdatedAtMs: updatedAtMs, goldDelta: 0, alive: true, cooldowns: {},
  });

describe('recuperação fora de hunt', () => {
  it('lê certo depois de horas sem nenhum tick ter rodado', () => {
    // O ponto inteiro do desenho: nada decrementa, nada incrementa, ninguém roda. O valor de
    // agora é calculado quando alguém pergunta, e um personagem parado custa zero.
    expect(recoveredStaminaMs(10 * HOUR, 0, 5 * HOUR, rules)).toBe(15 * HOUR);
  });

  it('aplica o teto na LEITURA, não só na escrita', () => {
    // Parado três dias, o personagem não pode ler 72 horas. Aplicar o teto só na escrita
    // funciona enquanto alguém escreve — e o caso inteiro desta função é ninguém ter escrito.
    expect(recoveredStaminaMs(20 * HOUR, 0, 72 * HOUR, rules)).toBe(24 * HOUR);
  });

  it('relógio para trás não devolve stamina', () => {
    // Acontece com ajuste de horário e com NTP. Deixar a subtração passar daria stamina de
    // graça a quem mexesse no relógio, se um dia o instante viesse de fora do servidor.
    expect(recoveredStaminaMs(2 * HOUR, 10 * HOUR, 5 * HOUR, rules)).toBe(2 * HOUR);
  });

  it('segue a taxa do conteúdo, sem número nenhum em código', () => {
    const lenta: Stamina = { ...rules, recoveryRatio: 0.5 };
    expect(recoveredStaminaMs(0, 0, 10 * HOUR, lenta)).toBe(5 * HOUR);
  });
});

describe('materializar', () => {
  it('fixa o valor e o instante, que é o que entra no snapshot', () => {
    const character = hero(10 * HOUR, 0);
    materializeStamina(character, 3 * HOUR, rules);
    expect(character.staminaMs).toBe(13 * HOUR);
    expect(character.staminaUpdatedAtMs).toBe(3 * HOUR);
  });

  it('não inventa stamina para quem não a tem rastreada', () => {
    // Sessão gravada antes da FUN-39. Rodar sem teto é preferível a cobrar de alguém uma
    // stamina que nunca foi medida.
    const character = hero(null, 0);
    materializeStamina(character, 10 * HOUR, rules);
    expect(character.staminaMs).toBeNull();
    expect(isExhausted(character)).toBe(false);
  });
});

describe('consumo dentro da hunt', () => {
  it('cai 1:1 com o tempo simulado', () => {
    const character = hero(HOUR);
    drainStamina(character, 60_000, rules);
    expect(character.staminaMs).toBe(HOUR - 60_000);
  });

  it('NÃO mexe no instante de materialização', () => {
    // Aquele campo é o marco da recuperação FORA da hunt. Mexer nele aqui faria o tempo de
    // hunt contar duas vezes: uma consumindo, outra recuperando.
    const character = hero(HOUR, 1234);
    drainStamina(character, 60_000, rules);
    expect(character.staminaUpdatedAtMs).toBe(1234);
  });

  it('para no zero em vez de ficar negativa', () => {
    const character = hero(1000);
    drainStamina(character, 10_000, rules);
    expect(character.staminaMs).toBe(0);
    expect(isExhausted(character)).toBe(true);
  });

  it('avisa uma única vez que zerou', () => {
    // Quem chama usa este retorno para registrar o evento notável. Se ele repetisse, a lista
    // curta da tela de retorno viraria a mesma linha centenas de vezes.
    const character = hero(1000);
    expect(drainStamina(character, 10_000, rules)).toBe(true);
    expect(drainStamina(character, 10_000, rules)).toBe(false);
  });

  it('personagem sem stamina rastreada não consome nada', () => {
    const character = hero(null);
    expect(drainStamina(character, 10_000, rules)).toBe(false);
    expect(character.staminaMs).toBeNull();
  });
});
