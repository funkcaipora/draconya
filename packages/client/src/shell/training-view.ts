// O Treino em números e em intenções (#631, M44-13; ADR 0059), fora do componente para ser
// testável — o mesmo padrão de `charms-progress.ts` e `bestiary-progress.ts`.
//
// **Isto é apresentação, não regra.** Quem decide se uma compra, uma escolha de livro ou uma
// entrada no Treino é aceita é o servidor (`sim/purchase.ts`, `game/host.ts`); quem gasta o banco
// é a `api`, na volta. O que se calcula aqui é "quanto rende esta arma" e "quanto tempo tem o
// banco", a partir do que o servidor mandou (`training-state`) e do catálogo fixado na sessão
// (`catalogue.training`/`catalogue.items`, invariante 7) — e nada daqui volta pelo socket
// (invariante 4): as três funções `*Message` só dizem QUAL id o jogador escolheu.

import type { C2SMessage } from '@draconya/protocol';
import type { ItemDefinition, TrainingRegister, TrainingRules } from '../state/hud.js';

/** Uma exercise weapon que o personagem carrega, pronta para a linha da tela. */
export interface OwnedWeapon {
  readonly instanceId: string;
  readonly itemId: string;
  readonly name: string;
  readonly appearanceId: number | undefined;
  readonly skillId: string;
  /** As cargas RESTANTES (o overlay da instância, que o servidor manda em `training-state`). */
  readonly charges: number;
  /** O total da definição — `charges / totalCharges` é a barra. */
  readonly totalCharges: number;
  /** É a que o Treino em curso está gastando. */
  readonly active: boolean;
}

/** Uma exercise weapon à venda (`buy-item`, ADR 0059 d.2). */
export interface ShopWeapon {
  readonly itemId: string;
  readonly name: string;
  readonly appearanceId: number | undefined;
  readonly skillId: string;
  readonly charges: number;
  readonly price: number;
}

/** O nome da skill do livro: o do conteúdo, ou o id quando o livro não a traz (nunca inventado). */
export function skillNameOf(rules: TrainingRules | undefined, skillId: string): string {
  return rules?.offlineSkills.find((entry) => entry.skillId === skillId)?.name ?? skillId;
}

/**
 * As exercise weapons carregadas, na ordem em que o servidor as mandou, com o nome e a arte do
 * catálogo. Uma instância cujo item o catálogo não conhece ainda cai fora: sem definição não há
 * skill, total nem nome para mostrar, e uma linha sem eles seria uma arma que o jogador não sabe usar.
 */
export function ownedWeapons(
  training: TrainingRegister | null, items: readonly ItemDefinition[] | undefined,
): OwnedWeapon[] {
  if (training === null || items === undefined) return [];
  return training.weapons.flatMap((weapon) => {
    const definition = items.find((item) => item.id === weapon.itemId);
    if (definition?.exercise === undefined) return [];
    return [{
      instanceId: weapon.instanceId,
      itemId: weapon.itemId,
      name: definition.name,
      appearanceId: definition.appearanceId,
      skillId: definition.exercise.skillId,
      charges: weapon.charges,
      totalCharges: definition.exercise.charges,
      active: weapon.instanceId === training.activeInstanceId,
    }];
  });
}

/**
 * As exercise weapons à venda, da menor para a maior carga dentro de cada skill (a ordem do
 * catálogo do Tibia: comum, durable, lasting), agrupadas por skill na ordem do livro. Só o que
 * o servidor marcou como comprável (`buyPrice`).
 */
export function shopWeapons(
  items: readonly ItemDefinition[] | undefined, rules: TrainingRules | undefined,
): ShopWeapon[] {
  if (items === undefined) return [];
  const order = new Map((rules?.offlineSkills ?? []).map((entry, index) => [entry.skillId, index] as const));
  const rows = items.flatMap((item) => {
    if (item.exercise === undefined || item.buyPrice === undefined) return [];
    return [{
      itemId: item.id, name: item.name, appearanceId: item.appearanceId,
      skillId: item.exercise.skillId, charges: item.exercise.charges, price: item.buyPrice,
    }];
  });
  return rows.sort((a, b) => {
    const bySkill = (order.get(a.skillId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.skillId) ?? Number.MAX_SAFE_INTEGER);
    if (bySkill !== 0) return bySkill;
    if (a.skillId !== b.skillId) return a.skillId < b.skillId ? -1 : 1;
    return a.charges - b.charges || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  });
}

/**
 * O que `charges` cargas rendem no boneco: `tries` para as skills por ataque e `manaSpent` para o
 * magic level (`perCharge`, do catálogo — o servidor já aplicou o `rate` do boneco). A skill é
 * `mana` quando o livro a marca assim.
 */
export function chargeYield(
  charges: number, skillId: string, rules: TrainingRules | undefined,
): { readonly unit: 'tries' | 'mana'; readonly amount: number } | null {
  if (rules === undefined) return null;
  const isMana = rules.offlineSkills.find((entry) => entry.skillId === skillId)?.kind === 'mana';
  return isMana
    ? { unit: 'mana', amount: charges * rules.perCharge.manaSpent }
    : { unit: 'tries', amount: charges * rules.perCharge.tries };
}

/** "3 h 20 min", "45 min", "0 min" — o banco e os tetos, em palavras. Arredonda para minutos. */
export function formatBankTime(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** O banco de offline training como a tela o mostra: quanto tem, o teto e a razão da barra (0–1). */
export function bankView(
  training: TrainingRegister | null, rules: TrainingRules | undefined,
): { readonly bankMs: number; readonly capMs: number; readonly fraction: number } {
  const bankMs = training?.offlineBankMs ?? 0;
  const capMs = rules?.bankCapMs ?? 0;
  return { bankMs, capMs, fraction: capMs <= 0 ? 0 : Math.min(1, bankMs / capMs) };
}

/** O jogador tem gold para esta arma? O servidor decide de verdade; isto só habilita o botão. */
export function canAfford(gold: number, price: number): boolean {
  return gold >= price;
}

// As três intenções do Treino (invariante 4): só QUAL id — o resto é do servidor.
export const enterTrainingMessage = (itemInstanceId: string): C2SMessage =>
  ({ type: 'enter-training', itemInstanceId });
export const buyItemMessage = (itemId: string): C2SMessage => ({ type: 'buy-item', itemId });
/** `null` desmarca o livro. */
export const offlineSkillMessage = (skillId: string | null): C2SMessage =>
  ({ type: 'set-offline-training-skill', skillId });

/**
 * Manda a intenção e fecha o modal SÓ se ela foi enviada — mandar sem conexão é SILENCIOSO
 * (`packages/client/AGENTS.md`), e fechar por engano descartaria a escolha sem o jogador saber por
 * quê. O mesmo contrato de `attemptEnter` do `HuntsModal`.
 */
export function attemptTrainingIntent(
  message: C2SMessage, send: (message: C2SMessage) => boolean, onSent?: () => void,
): boolean {
  const sent = send(message);
  if (sent) onSent?.();
  return sent;
}
