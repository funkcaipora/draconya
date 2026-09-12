// A skin da interface: de onde vem cada imagem de UI e como ela chega ao CSS (FUN-108).
//
// A moldura, o fundo de pedra, o slot e as barras vêm do MESMO pacote que os sprites —
// `things/<versão>/library/ui/images/`, servido pelo caminho de `VITE_THINGS_URL`. A arte
// nunca é versionada (ADR 0008) e nunca passa por `content/` (invariante 6): quem sabe o
// caminho é o CLIENTE, e ele o entrega ao CSS por variável, não por `url()` fixo na folha.
//
// **Sem pacote, nenhuma variável existe** e cada regra cai no `var(--ui-x, <cor lisa>)` da
// folha de estilo: o jogo abre igual, só sem pedra. É a regra do mundo, aplicada à casca —
// arte que não carrega nunca é a razão de a tela não abrir.
//
// Os números medidos nos PNGs (pixel a pixel, não a olho) ficam em `shell.css`, ao lado da
// regra que os usa: `border-image-slice` da moldura, o quadrado do slot, o tamanho da barra.

import { ITEM_SLOTS } from '@draconya/content';
import type { ItemSlot } from '@draconya/content';

/** Onde as imagens de UI moram dentro do pacote, relativo a `VITE_THINGS_URL`. */
const UI_IMAGES_PATH = 'library/ui/images';

/**
 * O ícone cinza de cada lugar do corpo, vazio. Os nomes são os do pacote, e o mapa é por
 * `ItemSlot` — um slot novo em `content` sem imagem aqui é erro de tipo, não um quadrado
 * sem ícone que ninguém nota.
 *
 * `hand` é a arma (mão esquerda no pacote) e `shield` a mão direita; `ammo` é o cinto
 * (`hip`), que no pacote é onde a munição e a bolsa ficam; `back` é a mochila (ADR 0026).
 */
export const SLOT_IMAGES: Readonly<Record<ItemSlot, string>> = {
  head: 'inventory-head.png',
  neck: 'inventory-neck.png',
  chest: 'inventory-torso.png',
  legs: 'inventory-legs.png',
  feet: 'inventory-feet.png',
  hand: 'inventory-left-hand.png',
  shield: 'inventory-right-hand.png',
  finger: 'inventory-finger.png',
  ammo: 'inventory-hip.png',
  back: 'inventory-back.png',
};

/** Uma variável CSS e a imagem do pacote que a preenche. */
export interface SkinEntry {
  readonly variable: string;
  readonly image: string;
}

/**
 * A tabela inteira: variável → arquivo. É UMA lista, e o CSS a consome por nome — a
 * segunda fonte de verdade seria a folha de estilo, e as duas divergiriam no primeiro
 * arquivo renomeado.
 *
 * Sobre as barras: `hitpoints-manapoints-bar-border.png` é o TRILHO (a calha vazia, meio
 * azulada em cima e cinza embaixo), não o preenchimento da mana — o preenchimento é
 * `mana-bar-filled.png`, que existe com alfa nas pontas. Foi conferido pixel a pixel.
 */
export const UI_SKIN: readonly SkinEntry[] = [
  { variable: '--ui-background', image: 'background.png' },
  { variable: '--ui-background-dark', image: 'background-dark.png' },
  { variable: '--ui-frame', image: '3pixel-frame-borderimage.png' },
  { variable: '--ui-frame-up', image: '2pixel-up-frame-borderimage.png' },
  { variable: '--ui-slot', image: 'containerslot.png' },
  { variable: '--ui-bar-track', image: 'hitpoints-manapoints-bar-border.png' },
  { variable: '--ui-hp-bar', image: 'hitpoints-bar-filled.png' },
  { variable: '--ui-mana-bar', image: 'mana-bar-filled.png' },
  ...ITEM_SLOTS.map((slot) => ({ variable: slotVariable(slot), image: SLOT_IMAGES[slot] })),
];

/** A variável do ícone vazio de um slot: `--ui-slot-head`, `--ui-slot-hand`… */
export function slotVariable(slot: ItemSlot): string {
  return `--ui-slot-${slot}`;
}

/**
 * A URL de uma imagem de UI, ou `null` sem pacote.
 *
 * `null`, e não uma URL relativa que dá 404: sem `VITE_THINGS_URL` a resposta certa é "não
 * há arte", e quem chama decide o que fazer com isso (aqui, não definir a variável). A barra
 * final do `base` é tolerada porque `.env` escrito à mão vem dos dois jeitos.
 */
export function uiImageUrl(base: string | undefined, name: string): string | null {
  if (base === undefined || base === '') return null;
  return `${base.replace(/\/+$/, '')}/${UI_IMAGES_PATH}/${name}`;
}

/** O mínimo de `HTMLElement` que a skin toca. `document.documentElement` satisfaz por estrutura. */
export interface SkinTarget {
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
  };
}

/**
 * Define (ou remove) as variáveis da skin em `root` — uma chamada, ao montar a casca.
 *
 * Com pacote, cada variável recebe `url("…")`; sem pacote, cada uma é REMOVIDA, e não
 * deixada como estava: a função é a única dona dessas variáveis, e "aplicar sem pacote"
 * precisa produzir a tela de cor lisa mesmo que alguém a tenha chamado antes com um.
 */
export function applyUiSkin(root: SkinTarget, base: string | undefined): void {
  for (const { variable, image } of UI_SKIN) {
    const url = uiImageUrl(base, image);
    if (url === null) root.style.removeProperty(variable);
    else root.style.setProperty(variable, `url("${url}")`);
  }
}
