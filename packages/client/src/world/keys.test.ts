import { describe, expect, it } from 'vitest';
import type { Creature } from '../state/world.js';
import {
  creatureKey, effectKey, effectKeysOf, groundCell, groundKey, missileKey,
} from './keys.js';
import { DEFAULT_OUTFIT_COLORS, paintOf } from './outfit-colors.js';

describe('groundKey (FUN-23)', () => {
  it('x=5 e x=1 num padrão de largura 4 são a MESMA chave', () => {
    // É o que faz um chão de 4×4 gerar dezesseis texturas, e não uma por tile.
    const pattern = { width: 4, height: 4 };
    expect(groundKey(355, 5, 0, pattern)).toBe(groundKey(355, 1, 0, pattern));
    expect(groundKey(355, 0, 7, pattern)).toBe(groundKey(355, 0, 3, pattern));
  });

  it('células diferentes do padrão são chaves diferentes', () => {
    const pattern = { width: 4, height: 4 };
    expect(groundKey(355, 1, 0, pattern)).not.toBe(groundKey(355, 2, 0, pattern));
    expect(groundKey(355, 0, 1, pattern)).not.toBe(groundKey(355, 0, 2, pattern));
    // E a largura é a largura, a altura é a altura: (1, 0) não é (0, 1).
    expect(groundKey(355, 1, 0, pattern)).not.toBe(groundKey(355, 0, 1, pattern));
  });

  it('a largura é a largura e a altura é a altura', () => {
    // Num padrão de 4×2, x=1 e x=3 são quadros diferentes, e y=1 e y=3 são o mesmo. Com os
    // eixos trocados os dois fatos se invertem — e num padrão quadrado ninguém percebe.
    const pattern = { width: 4, height: 2 };
    expect(groundKey(355, 1, 0, pattern)).not.toBe(groundKey(355, 3, 0, pattern));
    expect(groundKey(355, 0, 1, pattern)).toBe(groundKey(355, 0, 3, pattern));
  });

  it('padrão {1, 1} dá UMA chave para qualquer tile', () => {
    const pattern = { width: 1, height: 1 };
    const keys = new Set([
      groundKey(9, 0, 0, pattern), groundKey(9, 17, 3, pattern), groundKey(9, 40, 40, pattern),
    ]);
    expect(keys.size).toBe(1);
  });

  it('o id entra na chave: dois objetos na mesma célula não colidem', () => {
    const pattern = { width: 1, height: 1 };
    expect(groundKey(9, 0, 0, pattern)).not.toBe(groundKey(10, 0, 0, pattern));
  });

  it('a célula nunca é negativa', () => {
    // `%` em JavaScript devolve negativo para negativo, e `-1` seria uma célula que o padrão
    // não tem — o pacote cairia no quadro 0 e a chave diria outra coisa.
    expect(groundCell(-1, -1, { width: 4, height: 2 })).toEqual({ x: 3, y: 1 });
    expect(groundCell(-1, -1, { width: 1, height: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('creatureKey (FUN-23)', () => {
  const colors = { head: 78, body: 69, legs: 58, feet: 76 };

  it('com cores e sem cores NÃO colidem', () => {
    expect(creatureKey(128, 'south', false, 0, colors))
      .not.toBe(creatureKey(128, 'south', false, 0));
  });

  it('cores diferentes são chaves diferentes — cada um dos quatro canais', () => {
    // Um canal por vez: variar só os pés deixava passar uma chave que esquecesse a cabeça,
    // o corpo ou as pernas. Mutação que mata: tirar qualquer canal do trecho de cores.
    const keys = new Set([
      creatureKey(128, 'south', false, 0, colors),
      creatureKey(128, 'south', false, 0, { ...colors, head: 0 }),
      creatureKey(128, 'south', false, 0, { ...colors, body: 0 }),
      creatureKey(128, 'south', false, 0, { ...colors, legs: 0 }),
      creatureKey(128, 'south', false, 0, { ...colors, feet: 0 }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('o id do outfit entra na chave', () => {
    // Sem ele toda criatura com a mesma direção e fase dividiria uma textura: um rato e um
    // jogador virando o mesmo desenho. Mutação que mata: tirar `appearanceId` do template.
    expect(creatureKey(128, 'south', false, 0, colors))
      .not.toBe(creatureKey(21, 'south', false, 0, colors));
  });

  it('parado fase 0 e andando fase 0 são chaves diferentes', () => {
    expect(creatureKey(128, 'south', false, 0, colors))
      .not.toBe(creatureKey(128, 'south', true, 0, colors));
  });

  it('direção e fase entram na chave', () => {
    expect(creatureKey(128, 'south', true, 1, colors))
      .not.toBe(creatureKey(128, 'north', true, 1, colors));
    expect(creatureKey(128, 'south', true, 1, colors))
      .not.toBe(creatureKey(128, 'south', true, 2, colors));
  });
});

describe('as cores da criatura na chave (FUN-104)', () => {
  // `creatureTexture` (`viewport.ts`) é uma closure dentro de `mountViewport`, que precisa de
  // um `Application` do Pixi — WebGL, que o vitest em Node não tem, e nenhum teste do pacote
  // monta. Por isso a decisão "as dela ou as de reserva" mora em `paintOf`, que é o que se
  // testa aqui, e o viewport só a chama. E o tipo: `Creature.colors` é o `OutfitColors` do
  // PROTOCOLO, e `creatureKey` recebe o de `assets/outfit.ts` — se os dois divergirem um dia,
  // é esta linha que para de compilar.
  const base: Creature = {
    id: 1, appearanceId: 128, name: 'me', health: 1, maxHealth: 1,
    position: { x: 0, y: 0, z: 7 }, step: null,
  };

  it('uma criatura com cores é pintada com as SUAS, e pede a chave delas', () => {
    // Mutação que mata: `paintOf` devolver `DEFAULT_OUTFIT_COLORS` sempre — todo mundo com
    // a roupa de personagem novo, e a tela não acusa porque continua pintada.
    const own = { head: 114, body: 3, legs: 40, feet: 95 };
    expect(paintOf({ ...base, colors: own })).toBe(own);
    expect(creatureKey(128, 'south', false, 0, paintOf({ ...base, colors: own })))
      .not.toBe(creatureKey(128, 'south', false, 0, DEFAULT_OUTFIT_COLORS));
  });

  it('uma criatura sem cores é pintada com as de reserva — nunca pede o quadro cru', () => {
    // Sem cores na chave o quadro pintado cairia na entrada do quadro cru, e o primeiro a
    // chegar ganharia. Mutação que mata: `paintOf` devolver `creature.colors` sem o `??`.
    expect(paintOf(base)).toBe(DEFAULT_OUTFIT_COLORS);
    expect(creatureKey(21, 'south', false, 0, paintOf(base)))
      .not.toBe(creatureKey(21, 'south', false, 0));
  });
});

describe('effectKey (FUN-106)', () => {
  it('a fase entra na chave: um efeito de três fases são três texturas', () => {
    // Mutação que mata: tirar `phase` do template — todo quadro do efeito viraria o primeiro.
    expect(effectKey(12, 0)).not.toBe(effectKey(12, 1));
  });

  it('o id entra na chave', () => {
    expect(effectKey(12, 0)).not.toBe(effectKey(13, 0));
  });

  it('as quatro famílias têm PREFIXOS distintos: efeito não colide com objeto, outfit nem projétil', () => {
    // Quatro registros SEPARADOS no pacote: o efeito 1 e o objeto 1 são bitmaps diferentes, e
    // o livro de texturas só tem a chave para os distinguir — e o que distingue é o PREFIXO,
    // porque o resto são números que se repetem entre famílias. Comparar chaves inteiras não
    // prova nada: `object:1:0:0` tem quatro segmentos e `effect:1:0` três, então as duas nunca
    // colidiriam mesmo com o mesmo prefixo (este teste já foi assim, e não matava nada). O que
    // se afirma é o primeiro segmento de cada família, com os MESMOS números nas quatro.
    // Mutação que mata: trocar `effect:` por `object:` em `effectKey`, ou `missile:` por
    // `outfit:` em `missileKey`.
    const familyOf = (key: string) => key.slice(0, key.indexOf(':'));
    const families = [
      groundKey(1, 0, 0, { width: 1, height: 1 }),
      creatureKey(1, 'north', false, 0),
      effectKey(1, 0),
      missileKey(1, 0, 0),
    ].map(familyOf);
    expect(new Set(families).size).toBe(4);
  });
});

describe('effectKeysOf (FUN-106)', () => {
  it('é uma chave por fase, da 0 à última, na ordem em que tocam', () => {
    // É o que o viewport pede ao livro quando o efeito nasce. Perder a última fase é ela
    // voltar a piscar; perder a primeira é o efeito nascer invisível por um quadro a mais.
    // Mutação que mata: `phase < phaseCount - 1`, ou começar em `phase = 1`.
    expect(effectKeysOf(12, 3)).toEqual(['effect:12:0', 'effect:12:1', 'effect:12:2']);
  });

  it('sem fases, nenhuma chave', () => {
    expect(effectKeysOf(12, 0)).toEqual([]);
  });
});

describe('missileKey (FUN-106)', () => {
  it('é pela CÉLULA do padrão: três tiles a leste e um tile a leste são a MESMA chave', () => {
    // A mesma razão de `groundKey`: dar a cada delta sua chave pediria o mesmo bitmap ao
    // pacote uma vez por distância de tiro. Mutação que mata: pôr `dx`/`dy` crus na chave.
    expect(missileKey(5, 3, 0)).toBe(missileKey(5, 1, 0));
    expect(missileKey(5, 2, -4)).toBe(missileKey(5, 1, -1));
    // E a célula é por OCTANTE: (3, 1) é quase horizontal e divide a chave com (1, 0), não
    // com a diagonal. Mutação que mata: `missileCell` pelo sinal de cada eixo.
    expect(missileKey(5, 3, 1)).toBe(missileKey(5, 1, 0));
    expect(missileKey(5, 3, 1)).not.toBe(missileKey(5, 1, 1));
  });

  it('as nove células do padrão são nove chaves', () => {
    // Leste e sul, leste e oeste, e o parado do meio: cada célula é um bitmap diferente no
    // pacote, e uma chave que colapsasse duas desenharia o projétil de costas. (Trocar os
    // eixos entre si na chave NÃO é defeito — continua injetiva — e por isso não é testado.)
    // Mutação que mata: `missileCell` sem o sentido negativo (oeste vira "nenhum").
    const keys = new Set<string>();
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) keys.add(missileKey(5, dx, dy));
    expect(keys.size).toBe(9);
  });

  it('o id entra na chave', () => {
    expect(missileKey(5, 1, 0)).not.toBe(missileKey(6, 1, 0));
  });
});
