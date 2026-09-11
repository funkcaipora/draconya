// Que peça de parede vai em cada tile bloqueado (FUN-105).
//
// Puro, como `camera.ts` e `keys.ts`: é uma pergunta sobre dois vizinhos, e a resposta é um
// dos quatro nomes de `WallSet`. O tilemap não guarda peça nenhuma — `#` é só "bloqueia" — e
// é assim que o Tibia monta muro: a arte de um tile de parede é decidida por quem está em
// volta dele.
//
// A regra é a do pacote, não uma que pareça simétrica no papel. O sprite de parede do Tibia
// tem 64×64 e espalha para CIMA e para a ESQUERDA do tile dono: a peça vertical é o trecho
// que liga o tile ao vizinho de NORTE, a horizontal é o trecho que liga ao de OESTE, o canto
// fecha os dois, e o poste é o pilar de um tile que não liga a nenhum dos dois. Por isso só
// norte e oeste entram na escolha — o vizinho de sul e o de leste desenham, cada um, o trecho
// que chega a este tile a partir do lado dele. É a tabela de vizinhança de meia-borda do
// Remere's Map Editor (`WallBrush::half_border_types`), reproduzida aqui como REGRA DE
// DOMÍNIO — qual peça cada par de vizinhos escolhe — e não como código: o RME é GPL, e o
// limite do ADR 0019 vale para ele como vale para TFS e Canary. Nada foi copiado.
//
// O defeito que a versão espelhada (norte OU sul, leste OU oeste) produzia é visual e
// silencioso: canto nas quatro quinas de todo retângulo, e um toco de muro saindo de cada
// ponta — porque a peça de canto do canto de cima-esquerda estende um trecho para cima e outro
// para a esquerda, em direção a tiles onde não há parede. A tela não quebra — só não parece
// um muro. Com uma peça só, o defeito é o outro: um corredor de dez tiles vira dez cantos.

import { isBlocked, type Tilemap } from '@draconya/content';

/** Os quatro nomes de `WallSet`, e é por eles que o viewport indexa a tabela. */
export type WallPiece = 'vertical' | 'horizontal' | 'corner' | 'pole';

/**
 * A peça do tile `(x, y)`, dada a parede ao NORTE e a OESTE dele — e só elas.
 *
 * `n` é "há parede ao norte"; `w`, "a oeste". Os dois juntos são o canto; norte só é a
 * vertical; oeste só é a horizontal; nenhum é o poste. Sul e leste NÃO entram: o trecho que
 * liga este tile ao vizinho de sul é desenhado pelo vizinho de sul (a vertical dele sobe até
 * aqui), e o trecho até o de leste é do vizinho de leste (a horizontal dele vem até aqui). É o
 * que faz o canto de cima-esquerda de todo retângulo sair como POSTE, e o de baixo-direita
 * como canto — e é isso que o pacote espera, porque cada sprite espalha para cima e para a
 * esquerda.
 *
 * Um T e uma cruz saem como canto ou como reta conforme o que têm ao norte e a oeste; os
 * braços de sul e leste são desenhados pelos tiles de lá. A diagonal não liga parede a
 * parede: um `#` cujo único vizinho está na diagonal é uma ponta solta, e desenhá-lo como
 * canto abriria um muro em direção a lugar nenhum.
 */
export function wallPiece(
  isWall: (x: number, y: number) => boolean, x: number, y: number,
): WallPiece {
  const n = isWall(x, y - 1);
  const w = isWall(x - 1, y);
  if (n && w) return 'corner';
  if (n) return 'vertical';
  if (w) return 'horizontal';
  return 'pole';
}

/**
 * O predicado de parede de um MAPA, para `wallPiece`: bloqueado E dentro do mapa.
 *
 * `isBlocked` diz que fora do mapa é bloqueado, e para MOVIMENTO é a resposta certa — ninguém
 * anda para fora da grade. Para a peça é a resposta errada: a borda de cima do mapa teria
 * "parede" ao norte em todo tile, e o muro inteiro sairia como canto em vez de correr de leste
 * a oeste. Fora do mapa não há parede a ligar, então não conta.
 */
export function wallsOf(map: Tilemap): (x: number, y: number) => boolean {
  return (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && isBlocked(map, x, y);
}
