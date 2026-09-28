// "Escolha uma caçada" (#259, ADR 0029 D6). UMA coluna desde o #584 (ADR 0039, fim do pull por
// dificuldade): a coluna de detalhe (tamanhos de pull) saiu — a composição de monstros já
// aparece na linha da lista e, com mais detalhe, em "Detalhes da caçada"
// (`HuntDetailsModal.tsx`), aberto à parte. A formação embutida SAIU (#503, DT-01/DT-02 de
// #499) — a party tem superfície própria em `PartyModal.tsx`, e daqui saem só as DUAS pontes:
// "Encontrar Party" (abre a busca filtrada pela hunt selecionada, pelo `onFindParty`) e
// "Iniciar com o time" (configure-then-start do líder, via `party-start.ts` — nunca `enter-hunt`
// solo).
//
// Sem abas (Treino/Quests/Arena/Bosses não existem, D8), com busca só por NOME (#324). "Loot
// possível" e a grade de criaturas ficam fora daqui de propósito (D8) — existem em "Detalhes da
// caçada" (`HuntDetailsModal.tsx`, #349, SV-13), a tela certa para olhar uma hunt já escolhida;
// esta é a de ESCOLHER.
//
// **A lógica de seleção é pura e exportada** (`resolveSelection`, `enterHuntMessage`,
// `attemptEnter`, `findPartyDecision`): `prerender` (`react-dom/static`) roda a árvore sem DOM e
// sem eventos, então um clique real não dispara em teste — o mesmo limite que
// `VocationChoice.test.ts` já contorna. Em vez de inspecionar código-fonte por string, aqui a
// decisão em si é uma função comum, testável direto (o padrão de `resolveChosenVocationId`).

import { useState } from 'react';
import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import type { HuntListing } from '../state/hud.js';
import { party, partyActions } from '../party/store.js';
import { startWithTeam } from './party-start.js';
import { OutfitSprite } from './OutfitSprite.js';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';

/**
 * As hunts cujo nome contém `query`, sem diferenciar maiúsculas de minúsculas.
 *
 * A busca por criatura do kit não entra: `catalogue.hunts[]` ainda não tem `monsters[]`. Busca
 * vazia devolve a lista inteira na mesma ordem; não há ordenação por relevância inventada aqui.
 */
export function filterHunts(hunts: readonly HuntListing[], query: string): HuntListing[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') return [...hunts];
  return hunts.filter((hunt) => hunt.name.toLowerCase().includes(normalizedQuery));
}

/**
 * A hunt EFETIVA dada a seleção do jogador (RF-03).
 *
 * Sem `selectedId` na lista (reconexão trocou o catálogo com o modal aberto — §7 da spec), cai
 * em `hunts[0]`. Não há mais eixo de dificuldade a resolver desde o #584 (ADR 0039, fim do pull
 * por dificuldade) — a hunt nasce dos spawns reais, sem escolha de tamanho.
 */
export function resolveSelection(
  hunts: readonly HuntListing[], selectedId: string | null,
): { hunt: HuntListing | null } {
  return { hunt: hunts.find((h) => h.id === selectedId) ?? hunts[0] ?? null };
}

/** A intenção `enter-hunt`, ou `null` quando a seleção não chega a formar uma (RF-04). */
export function enterHuntMessage(hunt: HuntListing | null): C2SMessage | null {
  if (hunt === null) return null;
  return { type: 'enter-hunt', huntId: hunt.id };
}

/**
 * Manda a intenção e fecha o modal SÓ se ela foi enviada (RF-04).
 *
 * Mandar sem conexão é SILENCIOSO (`packages/client/AGENTS.md`): `send` devolve `false`, e o
 * modal fica aberto com a seleção intacta — fechar por engano descartaria a escolha sem o
 * jogador saber por quê.
 */
export function attemptEnter(
  message: C2SMessage | null, send: (message: C2SMessage) => boolean, onClose: () => void,
): boolean {
  const entered = message !== null && send(message);
  if (entered) onClose();
  return entered;
}

/**
 * A ponte "Encontrar Party" (RF-02): a busca da party é aberta filtrada pela hunt selecionada,
 * pelo ID dela — nunca pelo nome (o id é o que o servidor casa, e o nome pode se repetir).
 */
export function findPartyDecision(selected: HuntListing | null): { enabled: boolean; huntId: string | null } {
  return selected === null
    ? { enabled: false, huntId: null }
    : { enabled: true, huntId: selected.id };
}

function HuntRow({ hunt, level, selected, onSelect }: {
  hunt: HuntListing; level: number; selected: boolean; onSelect: () => void;
}) {
  // Level recomendado é CONSELHO, não trava (§14.3, docs/product/hunt.md) — quem decide se a
  // entrada vale é o servidor; a linha só fica em âmbar.
  const below = level > 0 && level < hunt.recommendedLevel;
  return (
    <li className={`hunts-modal-row${selected ? ' hunts-modal-row-selected' : ''}`}>
      <button type="button" onClick={onSelect}>
        {/* `.item-sprite` (herdada de `ItemSprite`) é `position: absolute` sobre um ancestral de
            tamanho fixo — o mesmo contrato que `.ui-slot` cumpre em outro lugar. Este span é
            esse ancestral aqui, do lado da lista de hunts. */}
        <span className="hunts-modal-sprite">
          <OutfitSprite outfitId={hunt.outfitIds[0]} name={hunt.name} />
        </span>
        <span className="hunts-modal-row-text">
          <strong>{hunt.name}</strong>
          <span className={below ? 'hunt-warn' : 'entry-meta'}>{`level ${String(hunt.recommendedLevel)}+`}</span>
          <span className="entry-meta">
            {hunt.monsters.length === 0
              ? `${String(hunt.lootDrops)} drops de loot`
              : `${hunt.monsters.map((m) => m.name).join(' · ')} · ${String(hunt.lootDrops)} drops de loot`}
          </span>
        </span>
      </button>
    </li>
  );
}

export function HuntsModal({ hunting, onClose, onFindParty }: {
  hunting: boolean;
  onClose: () => void;
  /** Abre a instância ÚNICA do `PartyModal` em `search`, filtrada pela hunt selecionada. */
  onFindParty?: (huntId: string) => void;
}) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const me = useHudSlice((state) => state.characterId);
  const formation = useStoreSlice(party, (state) => state.party);
  const partyBusy = useStoreSlice(party, (state) => state.busy);
  const partyError = useStoreSlice(party, (state) => state.error);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const hunts = catalogue?.hunts ?? [];
  const visibleHunts = filterHunts(hunts, query);
  const { hunt: selected } = resolveSelection(hunts, selectedId);

  const enter = (): void => {
    const message = enterHuntMessage(selected);
    attemptEnter(message, sendIntent, onClose);
  };

  const findParty = findPartyDecision(selected);
  // "Iniciar com o time" só existe com party EM FORMAÇÃO (RF-03) — depois do start a party é a
  // sessão de hunt, e os eixos de rateio vivem no rodapé de `PartyMembers`.
  const teamStart = startWithTeam(formation, me ?? '', selected?.id ?? null);
  // RF-03: patch null = a configuração já confere — o configure é PULADO, e só o start sai.
  const startTeam = (): void => {
    if (!teamStart.enabled) return;
    const started = teamStart.patch !== null
      ? partyActions.configure(teamStart.patch)
      : Promise.resolve();
    void started.then(() => partyActions.start());
  };

  return (
    <Modal open title="Escolha uma caçada" onClose={onClose} width={860} height={560}
      footer={
        <>
          {partyError !== null && <span className="system-error">{partyError}</span>}
          <span className="hunts-modal-footer-note">
            {hunting
              ? 'Trocar de caçada é sair e entrar de novo · a instância atual é encerrada'
              : 'Level recomendado é conselho, não trava'}
          </span>
          {formation !== null && formation.state === 'forming' && (
            <Button variant="secondary" size="sm" disabled={!teamStart.enabled || partyBusy}
              title={teamStart.reason ?? 'Configura e inicia a caçada com a party inteira'}
              onClick={startTeam}>
              Iniciar com o time
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={!findParty.enabled || onFindParty === undefined}
            title={findParty.enabled ? `Buscar party para ${selected?.name ?? ''}` : 'Selecione uma caçada'}
            onClick={() => { if (findParty.huntId !== null) onFindParty?.(findParty.huntId); }}>
            Encontrar Party
          </Button>
          <Button variant="primary" size="sm" disabled={selected === null} onClick={enter}>
            {hunting ? 'Trocar de caçada' : 'Entrar na caçada'}
          </Button>
        </>
      }>
      {catalogue === null
        ? <p className="hunts-modal-empty">Carregando…</p>
        : hunts.length === 0
          ? <p className="hunts-modal-empty">Nenhuma caçada disponível neste servidor.</p>
          : (
            <div className="hunts-modal-body">
              <div className="hunts-modal-list-col">
                <Input
                  size="sm"
                  className="hunts-modal-search"
                  placeholder="⌕ Buscar uma caçada ou criatura"
                  aria-label="Buscar uma caçada ou criatura"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); }}
                />
                <Kicker tone="muted">{`${String(visibleHunts.length)} caçadas disponíveis`}</Kicker>
                <ul className="hunts-modal-list" aria-label="hunts">
                  {visibleHunts.map((hunt) => (
                    <HuntRow key={hunt.id} hunt={hunt} level={level} selected={hunt.id === selected?.id}
                      onSelect={() => { setSelectedId(hunt.id); }} />
                  ))}
                </ul>
              </div>
            </div>
          )}
    </Modal>
  );
}
