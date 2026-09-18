// "Detalhes da caçada" (#325, #349, SV-13). O modal que mostra criaturas, loot e descrição da
// hunt ativa — aberto pela pill no topo da tela de caçada.

import type { Catalogue, HuntListing } from '../state/hud.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { currentHunt } from './current-hunt.js';
import { DIFFICULTY_TEXT } from './HuntsModal.js';
import { ItemSprite } from './ItemSprite.js';
import { OutfitSprite } from './OutfitSprite.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { StatRow } from './ui/StatRow.js';

export interface PullSize { readonly id: string; readonly monsterCount: number }

/**
 * Os monstros da hunt, na ordem de `hunt.monsters` (RF-01).
 * Monstro sem entrada em `catalogue.monsters` é FILTRADO.
 */
export function monstersOf(
  hunt: HuntListing, monsters: readonly Catalogue['monsters'][number][],
): Catalogue['monsters'][number][] {
  const byId = new Map(monsters.map((m) => [m.id, m] as const));
  const ids: string[] = (hunt as { monsterIds?: string[] }).monsterIds ?? hunt.monsters.map((m) => m.id);
  return ids
    .map((id) => byId.get(id))
    .filter((m): m is Catalogue['monsters'][number] => m !== undefined);
}

/**
 * Os itens de loot possível da hunt, na ordem de `hunt.loot` (RF-03).
 * Sem ouro e sem raridade. Item sem entrada em `catalogue.items` é FILTRADO.
 */
export function lootItemsOf(
  hunt: HuntListing, items: readonly Catalogue['items'][number][],
): Catalogue['items'][number][] {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const ids: string[] = (hunt.loot as Array<{ itemId: string } | string>).map((entry) =>
    typeof entry === 'string' ? entry : entry.itemId,
  );
  return ids
    .map((id) => byId.get(id))
    .filter((i): i is Catalogue['items'][number] => i !== undefined);
}

/**
 * Os tamanhos de pull com contagem de monstros (RF-02), na ordem de `hunt.difficulties`.
 */
export function pullSizesOf(hunt: HuntListing): readonly PullSize[] {
  const details = hunt.difficultyDetails ?? [];
  const byId = new Map(details.map((d) => [d.id, d] as const));
  return hunt.difficulties
    .map((diffId) => byId.get(diffId))
    .filter((d): d is PullSize => d !== undefined);
}

export function pullSizeLabel({ id, monsterCount }: PullSize): string {
  return `${DIFFICULTY_TEXT[id] ?? id} · ${String(monsterCount)}`;
}

export function HuntDetailsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const known = useStoreSlice(currentHunt, (state) => state);
  const hunt = known !== null ? (catalogue?.hunts.find((h) => h.id === known.huntId) ?? null) : null;
  const monsters = catalogue?.monsters ?? [];
  const items = catalogue?.items ?? [];
  const pulls = hunt !== null ? pullSizesOf(hunt) : [];
  const huntMonsters = hunt !== null ? monstersOf(hunt, monsters) : [];
  const lootItems = hunt !== null ? lootItemsOf(hunt, items) : [];

  return (
    <Modal open={open} title="Detalhes da caçada" onClose={onClose} width={680}
      footer={<Button variant="secondary" size="sm" className="hunt-details-modal-close" onClick={onClose}>Fechar</Button>}>
      {hunt === null ? (
        <p className="hunt-details-modal-empty">
          Esta caçada foi aberta antes desta sessão do navegador — o servidor ainda não diz qual
          é ela (chega com a issue de protocolo SV-05). Saia e reentre pela lista de caçadas para
          ver os detalhes desta vez.
        </p>
      ) : (
        <div className="hunt-details-modal-grid">
          <div className="hunt-details-col-left">
            <h2 className="hunt-details-modal-name">{hunt.name}</h2>
            <section className="hunt-details-modal-info">
              <Kicker tone="muted">Sobre esta caçada</Kicker>
              <StatRow label="Nível recomendado" value={`${String(hunt.recommendedLevel)}+`} bar={false} />
              <StatRow label="Dificuldades"
                value={hunt.difficulties.map((d) => DIFFICULTY_TEXT[d] ?? d).join(' · ')} bar={false} />
            </section>
            {pulls.length > 0 && (
              <>
                <Kicker tone="muted" className="hunt-details-kicker">Tamanhos de pull</Kicker>
                <p className="hunt-details-pulls">{pulls.map(pullSizeLabel).join('   ')}</p>
              </>
            )}
            {huntMonsters.length > 0 && (
              <>
                <Kicker tone="muted" className="hunt-details-kicker">Criaturas</Kicker>
                <div className="hunt-details-monsters">
                  {huntMonsters.map((monster) => (
                    <div key={monster.id} className="hunt-details-monster">
                      <span className="hunt-details-monster-sprite">
                        <OutfitSprite outfitId={(monster as { outfitId?: number }).outfitId} name={monster.name} />
                      </span>
                      <strong>{monster.name}</strong>
                      {monster.health !== undefined && <span>{`Vida ${monster.health.toLocaleString('pt-BR')}`}</span>}
                      {monster.experience !== undefined && <span>{`Exp ${monster.experience.toLocaleString('pt-BR')}`}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
            {hunt.description !== undefined && <p className="hunt-details-desc">{hunt.description}</p>}
          </div>
          <div className="hunt-details-col-right">
            <section className="hunt-details-modal-info">
              <Kicker tone="muted">Loot possível</Kicker>
              <div className="hunt-details-loot">
                {lootItems.map((item) => (
                  <div key={item.id} className="hunt-details-loot-item">
                    <span className="hunt-details-loot-sprite">
                      <ItemSprite appearanceId={item.appearanceId} name={item.name} />
                    </span>
                    <span>{item.name}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
