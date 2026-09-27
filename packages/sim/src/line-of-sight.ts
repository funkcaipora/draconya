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
 */
export function isSightClear(map: Tilemap, from: FloorPoint, to: FloorPoint): boolean {
  if (!sameFloor(from.z, to.z)) return false;
  if (from.x === to.x && from.y === to.y) return true;

  const z = from.z ?? to.z ?? map.z;
  const floor = map.floors.get(z);
  if (floor === undefined || floor.blocksSight === null) return true;
  const grid = floor.blocksSight;

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
    if (grid[y * map.width + x] === 1) return false;
  }
}
