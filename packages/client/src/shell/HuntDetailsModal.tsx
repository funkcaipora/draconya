// "Detalhes da caçada" completo (#325, #349, SV-13). O modal que mostra tamanhos de pull,
// criaturas, loot possível e descrição da hunt ativa — aberto pela pill no topo da tela de
// caçada. A identidade da hunt ativa (SV-05) chega em `hud.huntId`/`hud.difficulty`, gravados
// por `session-state` e `instance-enter` — o servidor diz qual é, mesmo para quem reanexou
// numa hunt já em andamento, sem depender de lembrança nenhuma desta aba do navegador.
//
// "Seu recorde" é uma decisão de produto permanente: XP/h e gp/h não são métricas oficiais.

import { useHudSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import type { HuntListing, ItemDefinition, MonsterListing } from '../state/hud.js';
import { ItemSprite } from './ItemSprite.js';
import { splitLootOf } from './party-loot-format.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { StatRow } from './ui/StatRow.js';

/** Os três tamanhos de pull (FUN-123), em palavras iguais às do seletor de hunts. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

export interface PullSize {
  readonly id: string;
  readonly monsterCount: number;
}

/**
 * Os tamanhos de pull com contagem de monstros (SV-19), na ordem de `hunt.difficulties` —
 * não na ordem de `difficultyDetails`, que é só o catálogo bruto. Dificuldade sem entrada em
 * `difficultyDetails` (nó anterior à SV-19, que manda a lista vazia) é FILTRADA: sem número,
 * não há "Ousado · N" para mostrar aqui — o seletor de hunts é quem cai para só o nome.
 */
export function pullSizesOf(hunt: HuntListing): readonly PullSize[] {
  const byId = new Map(hunt.difficultyDetails.map((detail) => [detail.id, detail] as const));
  return hunt.difficulties
    .map((difficultyId) => byId.get(difficultyId))
    .filter((detail): detail is PullSize => detail !== undefined);
}

export function pullSizeLabel({ id, monsterCount }: PullSize): string {
  return `${DIFFICULTY_TEXT[id] ?? id} · ${String(monsterCount)}`;
}

/**
 * Os monstros da hunt, na ordem de `hunt.monsters` (SV-02). Monstro sem entrada em
 * `catalogue.monsters` é FILTRADO — o catálogo bruto pode ter um id que o conteúdo removeu.
 */
export function monstersOf(
  hunt: HuntListing, monsters: readonly MonsterListing[],
): MonsterListing[] {
  const byId = new Map(monsters.map((monster) => [monster.id, monster] as const));
  return hunt.monsters
    .map((entry) => byId.get(entry.id))
    .filter((monster): monster is MonsterListing => monster !== undefined);
}

/**
 * Os itens de loot possível da hunt, na ordem de `hunt.loot` (SV-02). Sem gold e sem raridade
 * — produto decidiu que XP/h e loot rate não são métricas oficiais. Item sem entrada em
 * `catalogue.items` é FILTRADO.
 */
export function lootItemsOf(
  hunt: HuntListing, items: readonly ItemDefinition[],
): ItemDefinition[] {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  return hunt.loot
    .map((entry) => byId.get(entry.itemId))
    .filter((item): item is ItemDefinition => item !== undefined);
}

/**
 * Sem outfit no catálogo de monstros (`catalogue.monsters[]` nunca traz um — só id e nome), o
 * lugar do sprite segue como placeholder tracejado do kit, como a Cyclopedia já faz para o
 * mesmo caso (`CyclopediaModal.tsx`, `EntrySprite`). Inventar um id de outfit aqui desenharia
 * uma criatura que pode não ser a certa.
 */
function MonsterPlaceholderSprite() {
  return <span className="hunt-details-monster-sprite" aria-hidden="true" />;
}

function MonsterRow({ monster }: { monster: MonsterListing }) {
  return (
    <div className="hunt-details-monster">
      <MonsterPlaceholderSprite />
      <strong>{monster.name}</strong>
      {monster.health !== undefined && <span>{`Vida ${String(monster.health)}`}</span>}
      {monster.experience !== undefined && <span>{`Exp ${String(monster.experience)}`}</span>}
    </div>
  );
}

function LootRow({ item }: { item: ItemDefinition }) {
  return (
    <div className="hunt-details-loot-item">
      <span className="hunt-details-loot-sprite">
        <ItemSprite appearanceId={item.appearanceId} name={item.name} />
      </span>
      <span>{item.name}</span>
    </div>
  );
}

/** O `Modal` só monta este corpo aberto, então não há assinatura de HUD durante a hunt inteira. */
function HuntDetailsBody() {
  const catalogue = useHudSlice((state) => state.catalogue);
  const huntId = useHudSlice((state) => state.huntId);
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const hunt = huntId === null ? null : (catalogue?.hunts.find((entry) => entry.id === huntId) ?? null);

  if (hunt === null) {
    return (
      <p className="hunt-details-modal-empty">
        Não foi possível identificar a caçada atual.
      </p>
    );
  }

  const pulls = pullSizesOf(hunt);
  const monsters = monstersOf(hunt, catalogue?.monsters ?? []);
  const lootItems = lootItemsOf(hunt, catalogue?.items ?? []);

  // A configuração de loot do líder (#405, ADR 0035 D2): só existe com party e `splitLoot`
  // ligado — sem bolsa compartilhada não há o que configurar, e o item cai direto na mochila
  // de quem matou, como no solo. `loot` ausente é nó anterior ao #400: some a seção inteira.
  const loot = partyView?.loot;
  const leader = partyView !== null && partyView.leaderId === me;
  const collect = loot?.collect ?? null;
  const autoSell = loot?.autoSell ?? [];
  const isCollected = (itemId: string): boolean => collect === null || collect.includes(itemId);
  const send = (patch: { collect?: string[] | null; autoSell?: string[] }): void => {
    sendIntent({ type: 'party-settings', ...patch });
  };

  return (
    <div className="hunt-details-modal-grid">
      <div className="hunt-details-col-left">
        <h2 className="hunt-details-modal-name">{hunt.name}</h2>
        <section className="hunt-details-modal-info">
          <Kicker tone="muted">Sobre esta caçada</Kicker>
          <StatRow label="Nível recomendado" value={`${String(hunt.recommendedLevel)}+`} bar={false} />
          <StatRow
            label="Dificuldades"
            value={hunt.difficulties.map((difficulty) => DIFFICULTY_TEXT[difficulty] ?? difficulty).join(' · ')}
            bar={false}
          />
        </section>
        {pulls.length > 0 && (
          <>
            <Kicker tone="muted" className="hunt-details-kicker">Tamanhos de pull</Kicker>
            {/* Um `span` por pull, não uma string com espaços: o HTML colapsa espaço, e
                "Cauteloso · 2 Ousado · 5" vira uma frase sem fronteira entre os três. */}
            <p className="hunt-details-pulls">
              {pulls.map((pull) => (
                <span key={pull.id} className="hunt-details-pull">{pullSizeLabel(pull)}</span>
              ))}
            </p>
          </>
        )}
        {monsters.length > 0 && (
          <>
            <Kicker tone="muted" className="hunt-details-kicker">Criaturas</Kicker>
            <div className="hunt-details-monsters">
              {monsters.map((monster) => <MonsterRow key={monster.id} monster={monster} />)}
            </div>
          </>
        )}
        {hunt.description !== undefined && <p className="hunt-details-desc">{hunt.description}</p>}
      </div>
      <div className="hunt-details-col-right">
        {lootItems.length > 0 && (
          <section className="hunt-details-modal-info">
            <Kicker tone="muted">Loot possível</Kicker>
            <div className="hunt-details-loot">
              {lootItems.map((item) => <LootRow key={item.id} item={item} />)}
            </div>
          </section>
        )}
        {partyView !== null && splitLootOf(partyView) && loot !== undefined && (
          <section className="hunt-details-modal-info">
            <Kicker tone="muted">Configuração de loot da party</Kicker>
            <div className="hunt-details-loot-config">
              {lootItems.map((item) => {
                const collected = isCollected(item.id);
                const sold = autoSell.includes(item.id);
                // D2: `value: 0` (ou ausente) é ignorado pelo servidor — não oferecer o
                // controle evita a recusa.
                const sellable = item.value !== undefined && item.value > 0;
                return (
                  <div key={item.id} className="hunt-details-loot-config-row">
                    <span>{item.name}</span>
                    <Checkbox
                      label="PEGAR"
                      size={13}
                      checked={collected}
                      disabled={!leader}
                      onChange={(checked) => {
                        if (!leader) return;
                        // `collect === null` é "coleta tudo": desmarcar UM vira a lista
                        // explícita de todos MENOS ele, nunca uma lista vazia por engano.
                        const next = collect === null
                          ? lootItems.map((entry) => entry.id).filter((id) => id !== item.id)
                          : checked
                            ? [...collect, item.id]
                            : collect.filter((id) => id !== item.id);
                        send({
                          collect: next,
                          autoSell: checked ? autoSell : autoSell.filter((id) => id !== item.id),
                        });
                      }}
                    />
                    <Checkbox
                      label="VENDER"
                      size={13}
                      checked={sold}
                      disabled={!leader || !collected || !sellable}
                      onChange={(checked) => {
                        if (!leader) return;
                        send({
                          autoSell: checked
                            ? [...autoSell, item.id]
                            : autoSell.filter((id) => id !== item.id),
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <p className="entry-meta">
              {`Venda automática: ${String(autoSell.length)} / ${String(loot.autoSellLimit)}`}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export function HuntDetailsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Detalhes da caçada"
      onClose={onClose}
      width={680}
      footer={(
        <Button variant="secondary" size="sm" className="hunt-details-modal-close" onClick={onClose}>
          Fechar
        </Button>
      )}
    >
      <HuntDetailsBody />
    </Modal>
  );
}
