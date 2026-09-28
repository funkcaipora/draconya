// Linha de visão (#553, ADR 0019 — referência §9 "Map, Tile e regras espaciais").
//
// O Canary decide LOS de combate varrendo, tile a tile, a linha entre origem e destino
// (`Map::checkSightLine`/`isSightClear`, `src/map/map.cpp`), reprovando se algum tile NO MEIO do
// trajeto bloqueia projétil (`CONST_PROP_BLOCKPROJECTILE`, a flag `unsight` do pacote de
// aparências — ver `scripts/import-map.ts`). Os dois EXTREMOS nunca contam como obstáculo: quem
// atira e quem é atingido não bloqueiam a própria linha. Toda chamada de COMBATE do Canary passa
// `floorCheck: true`, ou seja, andar diferente é SEMPRE bloqueado — o ramo de "atravessar andar"
// existe só para arremesso livre de item, que o Draconya não tem (fora do escopo desta task).
//
// O algoritmo de varredura em si (`checkSightLine`) é uma variante de Wu com acumulador de erro
// em ponto fixo — implementação específica do TFS, e por isso NÃO é traduzida aqui (ADR 0019:
// nunca copiar código GPL). O que segue é um midpoint-line (Bresenham) comum, que decide o MESMO
// resultado qualitativo: bloqueado quando algum tile ENTRE os extremos tem `blocksSight`.

import type { Tilemap } from '@draconya/content';
import { sameFloor } from './monster/step.js';
import type { FloorPoint } from './monster/step.js';

/**
 * Há linha de visão livre de `from` até `to` (#553)?
 *
 * Andar diferente é SEMPRE bloqueado (`sameFloor`, a mesma régua de todo portão de combate que
 * compara `FloorPoint` — `chooseTarget`, `selectTarget`/`countTargets`, `abilityTargets`). `z`
 * ausente em qualquer lado é "andar padrão do mapa" (monstro sem `z`, hunt de andar único),
 * como `isBlocked`/`groundSpeed` já tratam.
 *
 * Mapa sem a camada `sight` neste andar (nenhum mapa reimportado ainda — RF-02 da spec)
 * devolve sempre `true`: "sem dado, sem restrição", o mesmo comportamento que `speed` ausente
 * já usa para velocidade de chão. É o que mantém todo mapa de hoje bit a bit até a reimportação.
 *
 * `blocksProjectileAt` (#560, `CONST_PROP_BLOCKPROJECTILE`) é o campo de tile bloqueante — Magic
 * Wall, Wild Growth — consultado no MESMO passeio, tile a tile: um campo assim tapa a visão como
 * a geometria do mapa tapa, e os dois extremos continuam de fora (quem atira e quem é atingido
 * nunca bloqueiam a própria linha, mesmo em cima de um campo). AUSENTE (não uma função que
 * sempre devolve falso — a distinção importa para o atalho abaixo) é o comportamento de antes
 * desta issue, e o que preserva todo chamador que ainda não tem `Fields` à mão (a maioria dos
 * testes deste arquivo, e qualquer LOS fora de uma hunt).
 */
export function isSightClear(
  map: Tilemap, from: FloorPoint, to: FloorPoint,
  blocksProjectileAt?: (x: number, y: number, z: number) => boolean,
): boolean {
  if (!sameFloor(from.z, to.z)) return false;
  if (from.x === to.x && from.y === to.y) return true;

  const z = from.z ?? to.z ?? map.z;
  const floor = map.floors.get(z);
  const grid = floor === undefined ? null : floor.blocksSight;
  // Sem camada de `sight` E sem campo para consultar: nada pode bloquear, e o atalho poupa o
  // passeio inteiro — é o caminho de TODO mapa de hoje, ainda não reimportado (RF-02 da spec).
  if (grid === null && blocksProjectileAt === undefined) return true;

  // Midpoint-line: percorre os tiles entre os dois extremos, um passo por iteração. Os
  // extremos em si nunca são conferidos — só o que fica ENTRE eles.
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x === to.x && y === to.y) return true; // chegou ao destino: o próprio alvo não bloqueia
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    if (grid !== null && grid[y * map.width + x] === 1) return false;
    if (blocksProjectileAt !== undefined && blocksProjectileAt(x, y, z)) return false;
  }
}
