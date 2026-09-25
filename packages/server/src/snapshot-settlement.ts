// Liquida um snapshot de sessão como extrato — sem precisar reconstruir a sessão (#527).
//
// Existe porque o `game` já fazia isto (`SessionHost#creditUnrestorable`, para um snapshot que
// não bate a versão de conteúdo, FUN-28) mas só de dentro do próprio processo, no meio de
// `#resume`. Dois lugares fora do `game` precisam da MESMA operação — creditar o que o
// snapshot tem e nada além, nunca reconstruir a simulação — e nenhum dos dois tem (nem deveria
// ter) o resto do runtime de jogo:
//
//   - `POST /api/party/:id/start` (#527): recusa formar a hunt nova de um membro que ainda tem
//     um snapshot resumível de OUTRA sessão, em vez de deixar o `game` "resolver" escolhendo a
//     sessão errada (ver `game/host.ts`, `#createAndRegister` — um ticket de party nunca pode
//     retomar snapshot de sessão diferente da do ticket).
//   - `pnpm dev:dragon-party --reset` (#527): destrava a party local liquidando o snapshot de
//     cada personagem pelo MESMO caminho — nunca apagando a chave do Redis às cegas, que jogaria
//     fora XP, gold e itens que a sessão drenada tinha acumulado.
//
// É só a metade "vira extrato" — quem chama decide se apaga o snapshot depois (`game/host.ts`
// só apaga se isto NÃO lançar; o `--reset` faz o mesmo). Ver `docs/product/party.md`.

import type { CarriedItem, InventoryState, SessionSnapshot } from '@draconya/sim';
import type { BoxedItem } from './loot-box.js';
import type { ReceiptStore } from './receipts.js';

export interface SettleSnapshotOptions {
  readonly characterId: string;
  readonly accountId: string;
  readonly receipts: Pick<ReceiptStore, 'save'>;
}

/** O layout de equipamento como o extrato o leva: `slot → instanceId`. */
function equipmentOfState(inventory: InventoryState): Record<string, string> {
  const equipped: Record<string, string> = {};
  for (const [slot, item] of Object.entries(inventory.equipped)) {
    if (item !== undefined) equipped[slot] = item.instanceId;
  }
  return equipped;
}

/** Onde cada instância está DENTRO dos containers: `instanceId → lugar`. O equipado não entra. */
function layoutOfState(
  inventory: InventoryState,
): Record<string, { container: 'backpack' | 'satchel'; index: number }> {
  const layout: Record<string, { container: 'backpack' | 'satchel'; index: number }> = {};
  inventory.backpack.forEach((item, index) => { if (item !== null) layout[item.instanceId] = { container: 'backpack', index }; });
  (inventory.satchel ?? []).forEach((item, index) => { if (item !== null) layout[item.instanceId] = { container: 'satchel', index }; });
  return layout;
}

/**
 * Os itens que a sessão criou e que o personagem tem em mãos — o id determinístico
 * (`sessionId:n`) é o que permite reconhecê-los sem lista à parte.
 */
function acquiredByState(inventory: InventoryState, sessionId: string): BoxedItem[] {
  const prefix = `${sessionId}:`;
  const born = (item: CarriedItem | null | undefined): item is CarriedItem =>
    item !== null && item !== undefined && item.instanceId.startsWith(prefix);
  return [
    ...inventory.backpack.filter(born),
    ...(inventory.satchel ?? []).filter(born),
    ...Object.values(inventory.equipped).filter(born),
  ];
}

/**
 * Credita o que UM personagem tem no snapshot como se a sessão dele tivesse acabado agora.
 *
 * `seq` é `ledgerSeq + 1` — a MESMA regra do caminho normal (`Session#receipts`), e é ela que
 * torna isto idempotente: se aquela sessão já tinha creditado esse `seq`, a chave única do
 * ledger (invariante 10) recusa o segundo, e ninguém recebe duas vezes. Um snapshot que
 * sobreviveu a uma liquidação parcial anterior não credita de novo por isto ser chamado outra
 * vez — é create ou não-cria, nunca soma.
 *
 * Lança se `receipts.save` falhar — quem chama decide o que fazer com o snapshot (o `game`
 * mantém o snapshot de pé para a próxima tentativa; o `--reset` também não apaga na falha).
 */
export async function settleSnapshotAsReceipt(
  snapshot: SessionSnapshot,
  options: SettleSnapshotOptions,
): Promise<void> {
  const owner = snapshot.participants.find((participant) => participant.id === options.characterId);
  await options.receipts.save({
    sessionId: snapshot.id,
    characterId: options.characterId,
    accountId: options.accountId,
    // `drain` porque foi o servidor (ou quem opera `--reset`) que encerrou, não o jogador — a
    // mesma família de "sua sessão foi encerrada por manutenção".
    reason: 'drain',
    seq: snapshot.ledgerSeq + 1,
    // Os agregados DELE (#187); snapshot anterior só tem a soma, que era dele.
    aggregates: snapshot.aggregatesByCharacter?.[options.characterId] ?? snapshot.aggregates,
    notableEvents: snapshot.notableEvents,
    ...(owner?.staminaMs === undefined || owner.staminaMs === null
      ? {}
      : {
        staminaMs: owner.staminaMs,
        staminaUpdatedAtMs: owner.staminaUpdatedAtMs ?? 0,
      }),
    // Skills e Bestiário são ABSOLUTOS e monotônicos (o ledger funde pelo maior) — sem eles
    // aqui a progressão da sessão inteira sumia: XP creditada, mas o abate 9 999 voltava a 5 000.
    ...(owner?.skills === undefined ? {} : { skills: owner.skills }),
    ...(owner?.bestiary === undefined ? {} : { bestiary: owner.bestiary }),
    ...(owner?.ammo === undefined ? {} : { ammo: owner.ammo }),
    // Estoque de supply/munição do loot (#520), pela mesma razão da munição escolhida.
    ...(owner?.supplyStock === undefined ? {} : { supplyStock: owner.supplyStock }),
    ...(owner?.ammunitionStock === undefined ? {} : { ammunitionStock: owner.ammunitionStock }),
    // Vocação e o que a sessão criou (#154): sem isto, um item equipado numa sessão liquidada
    // por fora se perdia, e a arma de vocação com ele.
    ...(owner?.vocationId === undefined || owner.vocationId === null ? {} : { vocation: owner.vocationId }),
    ...(owner?.inventory === undefined ? {} : {
      equipment: equipmentOfState(owner.inventory),
      layout: layoutOfState(owner.inventory),
      acquired: acquiredByState(owner.inventory, snapshot.id),
    }),
    ...(owner?.lootBox === undefined || owner.lootBox.length === 0 ? {} : { lootBox: owner.lootBox }),
  });
}
