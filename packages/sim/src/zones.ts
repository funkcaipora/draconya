// Zona por tile e `canLogout` (#831, OW-10, ADR 0060 d.6 e d.7).
//
// A regra do Tibia que diz ONDE o personagem pode sair e o que o tile em que ele pisa proíbe. É a
// base de três caminhos — o `logout` do mundo (OW-14), o x-log (a tentativa aos 60 s da perda de
// conexão, OW-14) e a entrada do mundo numa hunt idle (OW-20) — e do portão de combate no-pvp
// (OW-27), que lê a zona do atacante e do alvo. Nenhum deles existe ainda: aqui só estão as
// funções puras, e por isso nada do que o `sim` faz hoje muda. A Cidade e as hunts não consultam
// zona; a Cidade segue protect zone por construção (ADR 0004).
//
// **A camada é dado de `content`; a decisão é daqui.** `Floor.zones` guarda os bits do OTBM, já
// normalizados como o Canary carrega o mapa (`canary/src/io/iomap.cpp:165-177`), e `zoneFlagsAt`
// (`packages/content/src/map.ts`) os lê. Escolher o TIPO da zona a partir dos bits e decidir o que
// cada uma proíbe é regra de jogo, e regra de jogo mora no `sim` (ADR 0060 d.8).
//
// **A coordenada é a do mapa**, a mesma de `isBlocked` e do `CharacterRuntime.position` dentro de
// uma sessão — local ao recorte, não a absoluta do Tibia que o `characters.world_x/y/z` persiste
// (ADR 0060 d.3.b). Quem tem a absoluta traduz antes, com `absoluteToLocal`. `z` ausente é o andar
// padrão do mapa (`FloorPoint`), como em todo leitor de tile do pacote.
//
// **Sem dado, sem restrição.** Mapa sem a camada `zones` no andar, andar que o mapa não tem e
// ponto fora da grade são, todos, tile NORMAL — o mesmo "ausente é livre" de `speed` e
// `blocksSight`, e o que mantém toda hunt de hoje (que nunca teve a camada) bit a bit. O Canary
// recusa o logout de quem não está num tile (`player.cpp:6967-6970`); aqui um personagem sempre
// pisa num tile da sessão em que está, e recusar por posição fora da grade prenderia quem caiu
// numa posição inválida sem nenhuma saída (o idle kick seria o único teto) — por isso não se
// recusa.

import { ZONE_FLAG, zoneFlagsAt } from '@draconya/content';
import type { Tilemap } from '@draconya/content';
import type { CharacterRuntime } from './character.js';
import { isInFight } from './combat/in-fight.js';
import type { FloorPoint } from './monster/step.js';

/**
 * Os tipos de zona do Canary (`ZoneType_t`, `canary/src/items/items_definitions.hpp:479-485`),
 * em ordem de PRECEDÊNCIA — a de `Tile::getZoneType` (`canary/src/items/tile.hpp:188-199`).
 *
 * `'pvp'` é o tile de arena (`PVPZONE`) como o Canary o chama. O ADR 0060 d.8 trata arena como
 * no-pvp no primeiro corte (o dono pediu mundo sem PvP), e essa divergência é do portão de
 * combate (OW-27), que lê `'pvp'` e o recusa como o `'nopvp'` — `zoneAt` continua dizendo o que o
 * mapa diz, sem decidir por ninguém.
 */
export type ZoneType = 'protection' | 'nopvp' | 'pvp' | 'nologout' | 'normal';

/** O nome de um bit de zona (`ZONE_FLAG`): `protection`, `noPvp`, `noLogout` ou `pvpZone`. */
export type ZoneFlagName = keyof typeof ZONE_FLAG;

/**
 * O tipo de zona do tile, com a precedência do Canary (`Tile::getZoneType`): PZ, depois no-pvp,
 * depois arena, depois no-logout, depois normal. Um tile PZ que também é no-logout é
 * `'protection'` — o tipo esconde o no-logout, e é por isso que `canLogout` lê o BIT
 * (`hasZoneFlag`), não o tipo: no Canary o no-logout é testado primeiro e nunca perde para a PZ
 * (`player.cpp:6972-6978`). Ler o tipo para decidir saída reabriria a saída num tile `P`.
 */
export function zoneAt(map: Tilemap, point: FloorPoint): ZoneType {
  const flags = zoneFlagsAt(map, point.x, point.y, point.z);
  if ((flags & ZONE_FLAG.protection) !== 0) return 'protection';
  if ((flags & ZONE_FLAG.noPvp) !== 0) return 'nopvp';
  if ((flags & ZONE_FLAG.pvpZone) !== 0) return 'pvp';
  if ((flags & ZONE_FLAG.noLogout) !== 0) return 'nologout';
  return 'normal';
}

/**
 * O tile tem esta marca de zona (`Tile::hasFlag`)? Os bits somam — `noLogout` vale por cima de
 * qualquer zona, inclusive PZ —, e este é o jeito de perguntar por um deles sem a precedência de
 * `zoneAt`. Mapa sem a camada, andar ausente e ponto fora da grade devolvem `false`.
 */
export function hasZoneFlag(map: Tilemap, point: FloorPoint, flag: ZoneFlagName): boolean {
  return (zoneFlagsAt(map, point.x, point.y, point.z) & ZONE_FLAG[flag]) !== 0;
}

/** Por que o Tibia recusa a saída: `YOUCANNOTLOGOUTHERE` e `YOUMAYNOTLOGOUTDURINGAFIGHT`. */
export type LogoutRefusal = 'no-logout-tile' | 'in-fight';

export type LogoutVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LogoutRefusal };

/**
 * O que `canLogout` lê do personagem: onde ele pisa e o carimbo do último golpe dado ou
 * recebido. `CharacterRuntime` cumpre, e um teste não precisa montar um.
 */
export type LogoutSubject = Pick<CharacterRuntime, 'position' | 'lastCombatActionAtMs'>;

// Veredictos sem alocação: a função é consultada a cada tentativa de saída de cada personagem
// do mundo, e o resultado nunca é mutado por quem o recebe.
const LOGOUT_OK: LogoutVerdict = Object.freeze({ ok: true });
const LOGOUT_REFUSED_NO_LOGOUT_TILE: LogoutVerdict = Object.freeze({
  ok: false, reason: 'no-logout-tile',
});
const LOGOUT_REFUSED_IN_FIGHT: LogoutVerdict = Object.freeze({ ok: false, reason: 'in-fight' });

/**
 * Pode sair agora? É `Player::canLogout` (`canary/src/creatures/players/player.cpp:6960-6979`),
 * na ordem em que o Canary avalia:
 *
 *  1. tile com no-logout: NUNCA, nem na PZ (`'no-logout-tile'`);
 *  2. tile PZ: SEMPRE, em luta ou não;
 *  3. qualquer outro tile (normal, no-pvp, arena): só fora de combate (`'in-fight'`).
 *
 * É a regra única dos três caminhos de saída (logout, x-log e entrada em hunt idle), e a ORDEM é
 * contrato: a recusa por tile vence a por luta (quem está num tile no-logout e em luta lê
 * `'no-logout-tile'`, como a mensagem do Canary em `protocolgame.cpp:1151-1162`), e a PZ só
 * isenta da luta, nunca do tile.
 *
 * **Só `isInFight` no lugar de "sem pz-lock e sem `INFIGHT`".** O pz-lock do Canary
 * (`isPzLocked`) vem de agredir outro jogador, e no mundo `no-pvp` isso não existe: monstro só dá
 * `INFIGHT` (`player.cpp:4487-4503`, contra o `pzlock` de `player.cpp:6468-6520`), de modo que
 * sempre se pode fugir para a PZ. E `isInFight` é a definição ÚNICA de "em combate" do `sim`
 * (#625), com a aproximação documentada nela — uma segunda fórmula aqui seria a divergência que
 * ela existe para evitar.
 *
 * `nowMs` é o relógio LÓGICO da sessão (invariantes 1 e 2), nunca o de parede: o veredicto do
 * mesmo estado é o mesmo a 1 Hz e a 10 Hz. A função só LÊ — não toca o personagem (invariante 9)
 * nem consome sorteio — e quem age sobre o veredicto (encerrar a sessão, mandar `logout-refused`,
 * reagendar o x-log para quando a janela de luta vence) é o ruleset do mundo (OW-13, OW-14).
 */
export function canLogout(character: LogoutSubject, map: Tilemap, nowMs: number): LogoutVerdict {
  const { position } = character;
  const flags = zoneFlagsAt(map, position.x, position.y, position.z);
  if ((flags & ZONE_FLAG.noLogout) !== 0) return LOGOUT_REFUSED_NO_LOGOUT_TILE;
  if ((flags & ZONE_FLAG.protection) !== 0) return LOGOUT_OK;
  return isInFight(nowMs, character.lastCombatActionAtMs) ? LOGOUT_REFUSED_IN_FIGHT : LOGOUT_OK;
}
