import { describe, expect, it } from 'vitest';
import { ITEM_SLOTS } from '@draconya/content';
import { applyUiSkin, SLOT_IMAGES, slotVariable, UI_SKIN, uiImageUrl } from './ui.js';
import type { SkinTarget } from './ui.js';

/** Um `style` que anota o que recebeu. É tudo que `applyUiSkin` toca num `HTMLElement`. */
function fakeRoot(): SkinTarget & { readonly set: Map<string, string>; readonly removed: string[] } {
  const set = new Map<string, string>();
  const removed: string[] = [];
  return {
    set,
    removed,
    style: {
      setProperty(name, value) { set.set(name, value); },
      removeProperty(name) { removed.push(name); return set.get(name) ?? ''; },
    },
  };
}

describe('uiImageUrl (FUN-108)', () => {
  it('monta o caminho da biblioteca de UI dentro do pacote', () => {
    // O caminho é o de `docs/asset-library.md`: `library/ui/<árvore do Qt>`, e as imagens
    // vivem em `images/`. Mutação que mata: qualquer segmento a menos ou trocado no prefixo
    // (`library/ui/background.png`, `ui/images/…`) — o `toBe` compara a string inteira.
    expect(uiImageUrl('/things/1332', 'background.png'))
      .toBe('/things/1332/library/ui/images/background.png');
  });

  it('tolera a barra final do base, sem dobrar', () => {
    // `.env` escrito à mão vem dos dois jeitos. Mutação que mata: concatenar sem o `replace`.
    expect(uiImageUrl('/things/1332/', 'background.png'))
      .toBe('/things/1332/library/ui/images/background.png');
  });

  it('tolera MAIS de uma barra final, e é por isso que o regex tem `+`', () => {
    // `https://cdn.example/things/1332//` é o que sai de colar uma origem com barra numa
    // variável que já tinha barra. Mutação que mata: `/\/$/` no lugar de `/\/+$/` — tiraria
    // uma barra só e a URL sairia com `//library`, que o nginx serve mas o cache não deduplica.
    expect(uiImageUrl('/things/1332//', 'background.png'))
      .toBe('/things/1332/library/ui/images/background.png');
  });

  it('funciona com URL absoluta', () => {
    expect(uiImageUrl('https://cdn.example/things/1332', 'containerslot.png'))
      .toBe('https://cdn.example/things/1332/library/ui/images/containerslot.png');
  });

  it('sem pacote é null, nunca uma URL relativa que dá 404', () => {
    // Mutação que mata: devolver `library/ui/images/x.png` quando `base` falta — o CSS
    // ganharia uma variável apontando para um 404, e a cor lisa de fallback não entraria.
    expect(uiImageUrl(undefined, 'background.png')).toBeNull();
    expect(uiImageUrl('', 'background.png')).toBeNull();
  });
});

describe('SLOT_IMAGES (FUN-108)', () => {
  it('é ESTA tabela, os dez pares, e nenhum outro', () => {
    // A tabela inteira, literal, porque cada linha é uma decisão conferida contra o pacote:
    // `hand` é a MÃO ESQUERDA (a arma), `shield` a direita, `ammo` é o cinto (`hip`), e
    // `chest` é `torso`. Um `toBe` por linha deixaria passar a linha trocada que ninguém
    // afirmou. Mutações que mata: `head` ↔ `neck`, as duas mãos trocadas, `chest` apontando
    // para `inventory-chest.png` (não existe no pacote), qualquer par a mais ou a menos.
    expect(SLOT_IMAGES).toEqual({
      head: 'inventory-head.png',
      neck: 'inventory-neck.png',
      chest: 'inventory-torso.png',
      legs: 'inventory-legs.png',
      feet: 'inventory-feet.png',
      hand: 'inventory-left-hand.png',
      shield: 'inventory-right-hand.png',
      finger: 'inventory-finger.png',
      ammo: 'inventory-hip.png',
      // As costas (ADR 0026, #151): o PNG existe no pacote com este nome exato.
      back: 'inventory-back.png',
    });
  });
});

describe('UI_SKIN (FUN-108)', () => {
  it('é ESTA tabela: as oito fixas, nesta ordem, e depois um ícone por slot de content', () => {
    // Literal e completa, porque o defeito desta tabela é silencioso: uma variável apontando
    // para o arquivo errado desenha a coisa errada sem erro nenhum. As escolhas que já
    // foram conferidas pixel a pixel e que o literal prende:
    //   - `--ui-mana-bar` é `mana-bar-filled.png`, o PREENCHIMENTO; o trilho
    //     (`hitpoints-manapoints-bar-border.png`, a calha vazia) é `--ui-bar-track`;
    //   - `--ui-frame` é a moldura de 3 px e `--ui-frame-up` a de 2 px;
    //   - `--ui-slot` é `containerslot.png`, não o fundo de pedra.
    // Mutações que mata: hp ↔ mana; mana → trilho; frame ↔ frame-up; slot → background;
    // uma entrada a menos, a mais, ou fora de ordem; tirar o `...ITEM_SLOTS.map`.
    expect(UI_SKIN).toEqual([
      { variable: '--ui-background', image: 'background.png' },
      { variable: '--ui-background-dark', image: 'background-dark.png' },
      { variable: '--ui-frame', image: '3pixel-frame-borderimage.png' },
      { variable: '--ui-frame-up', image: '2pixel-up-frame-borderimage.png' },
      { variable: '--ui-slot', image: 'containerslot.png' },
      { variable: '--ui-bar-track', image: 'hitpoints-manapoints-bar-border.png' },
      { variable: '--ui-hp-bar', image: 'hitpoints-bar-filled.png' },
      { variable: '--ui-mana-bar', image: 'mana-bar-filled.png' },
      { variable: '--ui-slot-head', image: 'inventory-head.png' },
      { variable: '--ui-slot-neck', image: 'inventory-neck.png' },
      { variable: '--ui-slot-chest', image: 'inventory-torso.png' },
      { variable: '--ui-slot-legs', image: 'inventory-legs.png' },
      { variable: '--ui-slot-feet', image: 'inventory-feet.png' },
      { variable: '--ui-slot-hand', image: 'inventory-left-hand.png' },
      { variable: '--ui-slot-shield', image: 'inventory-right-hand.png' },
      { variable: '--ui-slot-finger', image: 'inventory-finger.png' },
      { variable: '--ui-slot-ammo', image: 'inventory-hip.png' },
      { variable: '--ui-slot-back', image: 'inventory-back.png' },
    ]);
  });

  it('os ícones de slot são derivados de ITEM_SLOTS, não copiados', () => {
    // O literal acima prende o CONTEÚDO; este prende a ORIGEM: um slot novo em `content`
    // aparece aqui sem ninguém lembrar (e quebra o literal, que é o aviso para conferir a
    // imagem). Mutação que mata: trocar o `...ITEM_SLOTS.map` por nove linhas escritas à mão —
    // este teste continua passando hoje, mas `slotVariable` renomeada só quebra aqui.
    for (const slot of ITEM_SLOTS) {
      expect(UI_SKIN.find((entry) => entry.variable === slotVariable(slot))?.image)
        .toBe(SLOT_IMAGES[slot]);
    }
    expect(UI_SKIN.length).toBe(8 + ITEM_SLOTS.length);
  });

  it('não repete variável', () => {
    expect(new Set(UI_SKIN.map((entry) => entry.variable)).size).toBe(UI_SKIN.length);
  });
});

describe('applyUiSkin (FUN-108)', () => {
  it('com pacote, define cada variável como url("…") no root', () => {
    const root = fakeRoot();
    applyUiSkin(root, '/things/1332');
    expect(root.set.size).toBe(UI_SKIN.length);
    expect(root.set.get('--ui-background'))
      .toBe('url("/things/1332/library/ui/images/background.png")');
    expect(root.set.get('--ui-slot-chest'))
      .toBe('url("/things/1332/library/ui/images/inventory-torso.png")');
    expect(root.removed).toEqual([]);
  });

  it('sem pacote, não define nenhuma e REMOVE todas', () => {
    // O CSS cai no `var(--ui-x, <cor lisa>)`. Mutação que mata: `return` cedo sem remover —
    // a segunda chamada, sem pacote, deixaria a pedra de uma chamada anterior.
    const root = fakeRoot();
    applyUiSkin(root, '/things/1332');
    applyUiSkin(root, undefined);
    expect(root.removed).toEqual(UI_SKIN.map((entry) => entry.variable));
    expect(root.removed.length).toBe(UI_SKIN.length);
  });

  it('sem pacote e sem nada aplicado antes, não define nada', () => {
    // Mutação que mata: definir `url("null")` — `uiImageUrl` devolvendo null interpolado.
    const root = fakeRoot();
    applyUiSkin(root, undefined);
    expect(root.set.size).toBe(0);
  });
});
