// O modal Personagem (#319, RC-06, ADR 0030 §3) substitui a seção fixa da coluna esquerda.
// Ele só lê dados que já chegam ao HUD; a aba Outfit espera a intenção de cor do épico E7.

import type { ReactNode } from 'react';
import type { C2SMessage } from '@draconya/protocol';
import { account } from '../account/store.js';
import { sendIntent } from '../net/current.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { blessingCost, hasBlessing } from './blessing-cost.js';
import { bonusPercent } from './bestiary-progress.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { VitalBar } from './ui/VitalBar.js';

/**
 * Promover a vocação (#566, ADR 0042 decisão 1). Sem payload — o servidor confere level, gold
 * e "ainda não promovido"; a única razão de exportar como função pura é a mesma de
 * `leaveHunt` em `HuntActions.tsx`: testável sem simular clique de DOM.
 */
export function promoteVocation(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'promote-vocation' });
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function count(value: number): string {
  return integer.format(Math.round(value));
}

function bonusText(value: number): string {
  return '+' + percentFormat.format(value) + ' %';
}

// Cada arquivo do shell mantém seu próprio formato de duração até uma consolidação deliberada.
function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return String(Math.floor(ms / 1_000)) + ' s';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? String(hours) + ' h ' + String(minutes) + ' min'
    : String(minutes) + ' min';
}

/** Caixa com título opcional, idêntica à leitura já usada pelo analisador. */
function Box({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="analyzer-box">
      {title !== undefined && <Kicker tone="muted">{title}</Kicker>}
      {children}
    </section>
  );
}

/** Linha rótulo/valor, também compartilhando a apresentação já consolidada do analisador. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="analyzer-line">
      <span>{label}</span><b>{value}</b>
    </p>
  );
}

export function CharacterModal({ onClose }: { onClose: () => void }) {
  const characterId = useHudSlice((state) => state.characterId);
  const level = useHudSlice((state) => state.level);
  const xp = useHudSlice((state) => state.xp);
  // Mesmo throttle das vitais existentes: em hunt estes dois campos mudam muitas vezes por segundo.
  const health = useHudSlice((state) => state.health, { throttleMs: 100 });
  const maxHealth = useHudSlice((state) => state.maxHealth);
  const mana = useHudSlice((state) => state.mana, { throttleMs: 100 });
  const maxMana = useHudSlice((state) => state.maxMana);
  const capacity = useHudSlice((state) => state.capacity);
  const staminaMs = useHudSlice((state) => state.staminaMs);
  const vocationId = useHudSlice((state) => state.vocationId);
  const promoted = useHudSlice((state) => state.promoted);
  const gold = useHudSlice((state) => state.gold);
  const vocation = useHudSlice((state) =>
    state.catalogue?.vocations.find((v) => v.id === state.vocationId) ?? null);
  // Promovido (#566, ADR 0042 decisão 1): troca pelo `promotion.name` — "Elite Knight" em vez
  // de "Knight" — quando o servidor confirmou.
  const vocationName = promoted ? vocation?.promotion?.name ?? vocation?.name ?? null : vocation?.name ?? null;
  // null significa que este servidor não configurou Bestiário, não que o bônus seja zero.
  const bestiaryConfig = useHudSlice((state) => state.catalogue?.bestiary ?? null);
  const bestiaryCounts = useHudSlice((state) => state.bestiary);
  const blessingsConfig = useHudSlice((state) => state.catalogue?.blessings ?? null);
  const blessingsMask = useHudSlice((state) => state.blessings);
  const characters = useStoreSlice(account, (state) => state.characters);
  const name = characters.find((character) => character.id === characterId)?.name
    ?? characterId ?? '—';

  // Mesma fórmula de Bestiary.tsx: a tela só apresenta o valor que o servidor já sustenta.
  const bestiaryBonus = bestiaryConfig === null
    ? null
    : bonusPercent(
      bestiaryCounts ?? {},
      bestiaryConfig.milestones,
      bestiaryConfig.xpBonusPercentPerMilestone,
    );

  return (
    <Modal open title="Personagem" onClose={onClose} width={620}>
      {/* Há uma aba só até existir intenção C2S para cor de Outfit. */}
      <Tabs items={['Personagem']} value="Personagem" className="character-modal-tabs" />
      <div className="character-modal-header">
        <Box>
          <div className="character-modal-identity">
            <span className="character-modal-portrait" aria-hidden="true">OUTFIT</span>
            <div>
              <h2 className="character-modal-name">{name}</h2>
              {/* O jogo não tem mundos: a identidade nunca acrescenta o realm de demonstração. */}
              <p className="character-modal-vocation">
                {vocationId !== null && (vocationName ?? vocationId) + ' · '}
                {'LV ' + String(level)}
              </p>
              <div className="character-modal-vitals">
                <VitalBar kind="hp" label="HP" value={health} max={maxHealth} />
                <VitalBar kind="mp" label="Mana" value={mana} max={maxMana} />
                {/* A curva de XP não chega ao cliente; experiência continua uma contagem simples. */}
                <Line label="Experiência" value={count(xp)} />
              </div>
            </div>
          </div>
        </Box>
        <Box>
          {/* Velocidade, Magic level e regeneração dependem de campos que ainda não chegam. */}
          <Line label="Capacidade" value={count(capacity) + ' oz'} />
          <Line label="Stamina" value={duration(staminaMs)} />
        </Box>
      </div>
      {/* Skills e detalhes de combate aguardam os sistemas que os tornam verdadeiros. */}
      {bestiaryBonus !== null && (
        <Box title="Progressão e bônus">
          {/* O dado real é um bônus global único; separar entrada/maestria inventaria estrutura. */}
          <Line label="Bestiário · Bônus de XP PvE" value={bonusText(bestiaryBonus)} />
        </Box>
      )}
      {/*
       * Promoção (#566, ADR 0042 decisão 1): tela de serviço, não NPC dialogável (ADR 0042
       * questão 2, já decidida). O clique só manda a INTENÇÃO — level, gold e "já promovido"
       * são conferidos pelo servidor (invariante 4); o `system-message` de recusa cobre o
       * resto. Some quando a vocação não promove, ou depois de já promovido.
       */}
      {!promoted && vocation?.promotion !== undefined && (
        <Box title="Promoção">
          <Line label="Vocação promovida" value={vocation.promotion.name} />
          <Line label="Requisito" value={'Level ' + count(vocation.promotion.minLevel)} />
          <Line label="Custo" value={count(vocation.promotion.price) + ' gold'} />
          <button
            type="button"
            className="character-modal-promote"
            disabled={level < vocation.promotion.minLevel || gold < vocation.promotion.price}
            onClick={() => { promoteVocation(sendIntent); }}
          >
            Promover
          </button>
        </Box>
      )}
      {/* Serviço de Cidade (#570, ADR 0052): a compra manda a INTENÇÃO (invariante 4) — preço,
          saldo e "já tem esta bênção" são conferidos pelo servidor; o botão só se desabilita
          aqui para não oferecer o que ele vai recusar de qualquer jeito. */}
      {blessingsConfig !== null && (
        <Box title="Bênçãos">
          <ul className="blessing-list">
            {blessingsConfig.list.map((blessing) => {
              const owned = hasBlessing(blessingsMask, blessing.order);
              const cost = blessingCost(level, blessing.enhanced, blessingsConfig.pricing);
              return (
                <li key={blessing.id} className="blessing-entry">
                  <span className="blessing-name">
                    {blessing.name}{blessing.enhanced ? ' ✦' : ''}
                  </span>
                  {owned
                    ? <span className="blessing-owned">Abençoado</span>
                    : (
                      <button
                        type="button"
                        className="blessing-buy"
                        disabled={gold < cost}
                        onClick={() => { sendIntent({ type: 'buy-blessing', blessingId: blessing.id }); }}
                      >
                        {cost === 0 ? 'Grátis' : count(cost) + ' gold'}
                      </button>
                    )}
                </li>
              );
            })}
          </ul>
        </Box>
      )}
    </Modal>
  );
}
