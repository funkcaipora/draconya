import { describe, expect, it } from 'vitest';
import { describeEvent, describeEvents } from './event-text.js';

const names = {
  hunts: new Map([['rat-cellars', 'Rat Cellars']]),
  supplies: new Map([['mana-potion', 'Poção de Mana']]),
  monsters: new Map([['rat', 'Rato']]),
  hazardZones: new Map([['gardens', 'Gnomprona Gardens']]),
  percentPerMilestone: 1,
};

describe('describeEvent (FUN-110)', () => {
  it('traduz TODOS os tipos que o sim grava — nenhum sai como id cru', () => {
    // A lista está ao vivo desde a FUN-110, e `entered-hunt · rat-cellars/cautious` era a
    // primeira linha que todo jogador via. Mutação que mata: apagar um `case`.
    const lines = [
      // #584 (ADR 0039, fim do pull por dificuldade): o `detail` ainda traz `huntId/difficulty`
      // (o `sim` não mudou o formato do evento), mas a dificuldade não é mais mostrada.
      ['entered-hunt', 'rat-cellars/cautious', 'Entrou em Rat Cellars'],
      ['entered-city', 'c1', 'Voltou para a cidade'],
      ['level-up', '4', 'Subiu de level · 4'],
      ['level-down', '9 → 8', 'Perdeu level · 9 → 8'],
      ['xp-penalty', '1200', 'Perdeu 1200 XP'],
      ['skill-up', 'melee/11', 'Corpo a corpo subiu para 11'],
      ['skill-up', 'distance/11', 'Distância subiu para 11'],
      ['bestiary-milestone', 'rat/1', 'Bestiário: Rato · marco 1 (+1 % XP)'],
      ['hazard-level-up', 'gardens/4', 'Hazard: Gnomprona Gardens · nível 4 liberado'],
      ['hazard-level-up', 'ally/gardens/4', 'ally · Hazard: Gnomprona Gardens · nível 4 liberado'],
      ['death', 'c1', 'Morreu'],
      ['stamina-exhausted', 'c1', 'Stamina esgotada'],
      ['backpack-full', 'c1', 'Mochila cheia'],
      ['supply-unaffordable', 'mana-potion', 'Gold acabou para Poção de Mana'],
      ['exit-rule', 'hp-below', 'Saiu por regra · hp-below'],
      ['ring-equipped', 'life-ring', 'Equipou o anel'],
      ['ring-removed', '', 'Tirou o anel'],
      ['difficulty-changed', 'cautious → hero', 'Dificuldade mudou · cautious → hero'],
      ['advance-truncated', '90000', 'Tempo parado descartado'],
      ['ended', 'manual-exit', 'Sessão encerrada · saiu da hunt'],
    ] as const;
    for (const [type, detail, expected] of lines) {
      expect(describeEvent({ atMs: 0, type, detail }, names), type).toBe(expected);
    }
  });

  it('sem catálogo, o id fica no lugar do nome — estável, e não vazio', () => {
    expect(describeEvent({ atMs: 0, type: 'entered-hunt', detail: 'rat-cellars/cautious' }))
      .toBe('Entrou em rat-cellars');
    expect(describeEvent({ atMs: 0, type: 'supply-unaffordable', detail: 'mana-potion' }))
      .toBe('Gold acabou para mana-potion');
  });

  it('o marco do Bestiário sem catálogo diz o id e o marco, e NÃO inventa o bônus (FUN-113)', () => {
    // "+1 %" de cabeça seria afirmar um número que o servidor não mandou — a mesma regra do
    // "—" nos agregados opcionais. Com o percentual do catálogo, ele entra por extenso.
    expect(describeEvent({ atMs: 0, type: 'bestiary-milestone', detail: 'rat/3' }))
      .toBe('Bestiário: rat · marco 3');
    expect(describeEvent(
      { atMs: 0, type: 'bestiary-milestone', detail: 'rat/3' },
      { percentPerMilestone: 0.5 },
    )).toBe('Bestiário: rat · marco 3 (+0,5 % XP)');
  });

  it('tipo que este cliente não conhece sai como veio: pior que frase feia é sumir com o evento', () => {
    expect(describeEvent({ atMs: 0, type: 'boss-spawned', detail: 'dragon' })).toBe('boss-spawned · dragon');
    expect(describeEvent({ atMs: 0, type: 'boss-spawned' })).toBe('boss-spawned');
  });
});

describe('a perda de item na morte no extrato (#571)', () => {
  const itemNames = { items: new Map([['backpack', 'Backpack'], ['gem', 'Gem'], ['amulet-of-loss', 'Amulet of Loss'], ['bag', 'Bag']]) };
  const lost = (itemId: string, quantity: number, owner = 'hero') =>
    ({ atMs: 5, type: 'item-lost-on-death', detail: `${itemId}/${String(quantity)}/i:${itemId}/${owner}` });

  it('cada tipo que o sim grava na perda sai em palavras, com o nome do catálogo', () => {
    expect(describeEvent(lost('backpack', 1), itemNames)).toBe('Perdeu na morte · Backpack');
    expect(describeEvent(lost('gem', 12), itemNames)).toBe('Perdeu na morte · Gem ×12');
    expect(describeEvent({ atMs: 0, type: 'item-loss-protected', detail: 'blessings' }, itemNames))
      .toBe('Nenhum item perdido · protegido pelas bênçãos');
    expect(describeEvent({ atMs: 0, type: 'item-loss-protected', detail: 'amulet-of-loss' }, itemNames))
      .toBe('Nenhum item perdido · Amulet of Loss protegeu');
    expect(describeEvent({ atMs: 0, type: 'loss-amulet-consumed', detail: 'amulet-of-loss' }, itemNames))
      .toBe('Amulet of Loss consumido');
    expect(describeEvent({ atMs: 0, type: 'backpack-replaced', detail: 'bag' }, itemNames))
      .toBe('Ganhou Bag nova, sem mochila');
    // Sem catálogo o id fica no lugar do nome — estável, e não vazio.
    expect(describeEvent(lost('gem', 1))).toBe('Perdeu na morte · gem');
  });

  it('uma mochila perdida com vinte itens vira UMA linha, e não some o resto do extrato atrás dela', () => {
    const events = [
      { atMs: 1, type: 'entered-hunt', detail: 'rat-cellars/cautious' },
      { atMs: 4, type: 'death', detail: 'hero' },
      lost('backpack', 1), lost('gem', 12), lost('bag', 1), lost('gem', 1), lost('backpack', 1),
      lost('gem', 3), lost('gem', 2),
      { atMs: 9, type: 'ended', detail: 'death' },
    ];

    const lines = describeEvents(events, itemNames, 'hero');

    // A linha agrupada fica na posição da PRIMEIRA perda, com os cinco primeiros nomeados e o
    // resto resumido — mutação que mata: uma linha por instância.
    expect(lines.map((line) => line.type)).toEqual(['entered-hunt', 'death', 'item-lost-on-death', 'ended']);
    expect(lines[2]?.text).toBe('Perdeu na morte · Backpack, Gem ×12, Bag, Gem, Backpack (+2)');
    expect(lines[2]?.atMs).toBe(5);
  });

  it('o item que OUTRO membro da party perdeu não aparece na tela de quem ficou', () => {
    const events = [lost('backpack', 1, 'ana'), lost('gem', 2, 'hero')];
    expect(describeEvents(events, itemNames, 'hero').map((line) => line.text))
      .toEqual(['Perdeu na morte · Gem ×2']);
    // Só a perda alheia: não sobra linha nenhuma, nem uma vazia.
    expect(describeEvents([lost('backpack', 1, 'ana')], itemNames, 'hero')).toEqual([]);
    // Sem dono no `detail` (nó anterior) a linha é de quem olha, como sempre foi.
    expect(describeEvents([{ atMs: 0, type: 'item-lost-on-death', detail: 'gem/2' }], itemNames, 'hero')
      .map((line) => line.text)).toEqual(['Perdeu na morte · Gem ×2']);
  });

  it('sem perda nenhuma a lista é a de sempre, uma linha por evento e na mesma ordem', () => {
    const events = [{ atMs: 0, type: 'entered-city' }, { atMs: 1, type: 'death', detail: 'hero' }];
    expect(describeEvents(events, {}, 'hero').map((line) => line.text)).toEqual(['Voltou para a cidade', 'Morreu']);
  });
});

describe('a party no extrato (#197)', () => {
  it('reads the level-up of a companion and the bag settlement', () => {
    expect(describeEvent({ atMs: 0, type: 'level-up', detail: '9' })).toBe('Subiu de level · 9');
    expect(describeEvent({ atMs: 0, type: 'level-up', detail: 'ana/9' })).toBe('ana subiu de level · 9');
    expect(describeEvent({ atMs: 0, type: 'party-settlement', detail: '130/3' })).toBe('Bolsa vendida: 130 gold para 3');
  });
});
