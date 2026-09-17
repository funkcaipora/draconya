// "Escolha uma caçada" (#259, ADR 0029 D6). A party de formação mora na coluna direita — ADR
// 0027: propor uma hunt É escolher uma hunt. Sem abas (Treino/Quests/Arena/Bosses não existem,
// D8), sem busca (fora do contrato desta issue), sem "Loot possível" nem grade de criaturas
// (D8 — `catalogue.hunts[]` não tem `monsters` nem `loot`; ver M15 SV-02/SV-13).
//
// **A lógica de seleção é pura e exportada** (`resolveSelection`, `enterHuntMessage`,
// `attemptEnter`): `prerender` (`react-dom/static`) roda a árvore sem DOM e sem eventos, então
// um clique real não dispara em teste — o mesmo limite que `VocationChoice.test.ts` já
// contorna. Em vez de inspecionar código-fonte por string, aqui a decisão em si é uma função
// comum, testável direto (o padrão de `resolveChosenVocationId`).

import { useState } from 'react';
import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { HuntListing } from '../state/hud.js';
import { OutfitSprite } from './OutfitSprite.js';
import { PartyPanel } from './PartyPanel.js';
import { setCurrentHunt } from './current-hunt.js';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';

/** Os três tamanhos de pull do Huntera (FUN-123), em palavras — os mesmos de `event-text.ts`. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

/**
 * O rótulo do botão de pull — "Ousado · 4" como o Huntera mostra (kit: Modals.jsx:52,
 * `{n} · {c}`; SV-19). `difficultyDetails` é PARALELO a `difficulties` e opcional (deploy em
 * rolagem — um catálogo de um nó `game` anterior à SV-19 chega com a lista vazia): sem
 * contagem para esta dificuldade, o rótulo cai para só o nome, nunca "· undefined".
 */
export function pullLabel(hunt: HuntListing, difficulty: string): string {
  const label = DIFFICULTY_TEXT[difficulty] ?? difficulty;
  const count = hunt.difficultyDetails.find((detail) => detail.id === difficulty)?.monsterCount;
  return count === undefined ? label : `${label} · ${String(count)}`;
}

/**
 * A hunt e a dificuldade EFETIVAS dadas a seleção do jogador (RF-03).
 *
 * Sem `selectedId` na lista (reconexão trocou o catálogo com o modal aberto — §7 da spec), cai
 * em `hunts[0]`. Sem `pull`, ou com um `pull` que não pertence mais à hunt selecionada (troca de
 * hunt zera a seleção de pull), cai na primeira dificuldade DELA.
 */
export function resolveSelection(
  hunts: readonly HuntListing[], selectedId: string | null, pull: string | null,
): { hunt: HuntListing | null; difficulty: string | null } {
  const hunt = hunts.find((h) => h.id === selectedId) ?? hunts[0] ?? null;
  const difficulty = pull !== null && hunt !== null && hunt.difficulties.includes(pull)
    ? pull
    : (hunt?.difficulties[0] ?? null);
  return { hunt, difficulty };
}

/** A intenção `enter-hunt`, ou `null` quando a seleção não chega a formar uma (RF-04). */
export function enterHuntMessage(
  hunt: HuntListing | null, difficulty: string | null,
): Extract<C2SMessage, { type: 'enter-hunt' }> | null {
  if (hunt === null || difficulty === null) return null;
  return { type: 'enter-hunt', huntId: hunt.id, difficulty };
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
            {`${String(hunt.difficulties.length)} tamanhos de pull · ${String(hunt.lootDrops)} drops de loot`}
          </span>
        </span>
      </button>
    </li>
  );
}

export function HuntsModal({ hunting, onClose }: { hunting: boolean; onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pull, setPull] = useState<string | null>(null);

  const hunts = catalogue?.hunts ?? [];
  const { hunt: selected, difficulty } = resolveSelection(hunts, selectedId, pull);

  const enter = (): void => {
    const message = enterHuntMessage(selected, difficulty);
    if (attemptEnter(message, sendIntent, onClose) && message !== null) {
      setCurrentHunt({ huntId: message.huntId, difficulty: message.difficulty });
    }
  };

  return (
    <Modal open title="Escolha uma caçada" onClose={onClose} width={860} height={560}
      footer={
        <>
          <span className="hunts-modal-footer-note">
            {hunting
              ? 'Trocar de caçada é sair e entrar de novo · a instância atual é encerrada'
              : 'Level recomendado é conselho, não trava'}
          </span>
          <Button variant="primary" size="sm" disabled={selected === null || difficulty === null} onClick={enter}>
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
              <ul className="hunts-modal-list" aria-label="hunts">
                {hunts.map((hunt) => (
                  <HuntRow key={hunt.id} hunt={hunt} level={level} selected={hunt.id === selected?.id}
                    onSelect={() => { setSelectedId(hunt.id); setPull(null); }} />
                ))}
              </ul>
              {selected !== null && (
                <div className="hunts-modal-detail">
                  <h2>{selected.name}</h2>
                  <Kicker tone="muted">Tamanho do pull</Kicker>
                  <div className="hunts-modal-pulls" aria-label="tamanho do pull">
                    {selected.difficulties.map((d) => (
                      <Button key={d} variant={d === difficulty ? 'primary' : 'secondary'} size="sm"
                        onClick={() => { setPull(d); }}>
                        {pullLabel(selected, d)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {/* A formação da party (ADR 0027 decisão 8): mesmo componente de sempre, com a
                  mesma prop `hunts` — nada muda no comportamento dela nesta issue. */}
              <PartyPanel hunts={hunts} />
            </div>
          )}
    </Modal>
  );
}
