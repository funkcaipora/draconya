import { useState } from 'react';
import type { BotConfig, BotPosture, BotTargetPolicy } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import type { MonsterListing } from '../state/hud.js';
import {
  bot,
  setIgnore,
  setLure,
  setPosture,
  setPrioritize,
  setTargetingPolicy,
} from '../bot/store.js';
import { Modal } from './ui/Modal.js';
import { Input } from './ui/Input.js';
import { Select } from './ui/Select.js';
import { Badge } from './ui/Badge.js';
import { Kicker } from './ui/Kicker.js';
import { Button } from './ui/Button.js';

const POLICY_OPTIONS: ReadonlyArray<{ value: BotTargetPolicy; label: string }> = [
  { value: 'nearest', label: 'Mais próximo' },
  { value: 'lowest-hp', label: 'Menor HP' },
  { value: 'highest-hp', label: 'Maior HP' },
];

const POSTURE_OPTIONS: ReadonlyArray<{ value: BotPosture['kind']; label: string; hint: string }> = [
  { value: 'stand', label: 'Parado', hint: 'percorre a rota e deixa o monstro vir' },
  { value: 'follow', label: 'Seguir', hint: 'persegue até o alcance da arma' },
  { value: 'keep-distance', label: 'Manter distância', hint: 'aproxima se longe, recua se perto' },
];

/** O que o botão ⌖ do kit promete (Hud.jsx:80-81, "mín 4 · máx 8") para quem nunca tocou. */
const DEFAULT_LURE: NonNullable<BotConfig['lure']> = { min: 4, max: 8 };

function monsterName(monsters: readonly MonsterListing[], id: string): string {
  return monsters.find((monster) => monster.id === id)?.name ?? id;
}

export function LureTargetingModal({ onClose }: { onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const lure = useStoreSlice(bot, (state) => state.draft.lure) ?? DEFAULT_LURE;
  const targeting = useStoreSlice(bot, (state) => state.draft.targeting);
  const [lastDistance, setLastDistance] = useState(
    targeting.posture.kind === 'keep-distance' ? targeting.posture.tiles : 2,
  );

  if (catalogue === null) return null;
  const advancedFromLevel = catalogue.bot.advancedFromLevel;
  const locked = level < advancedFromLevel;
  const bad = lure.max < lure.min;
  const monsters = catalogue.monsters;
  const available = (except: readonly string[]): readonly MonsterListing[] =>
    monsters.filter((monster) => !except.includes(monster.id));

  return (
    <Modal
      open
      onClose={onClose}
      title="Lure e alvo"
      width={620}
      meta={`Bot avançado · LV ${String(advancedFromLevel)}+`}
      footer={
        <>
          <span className="lure-footer-hint">
            {bad
              ? 'Máximo precisa ser maior ou igual ao mínimo'
              : 'Priorizado ganha antes da política · ignorar vence priorizar'}
          </span>
          <span className="lure-footer-actions">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={onClose}>Salvar</Button>
          </span>
        </>
      }
    >
      {locked && (
        <p className="lure-locked">
          {`Bot avançado a partir do level ${String(advancedFromLevel)}. A configuração fica salva; o servidor recusa até lá.`}
        </p>
      )}
      <div className="lure-columns">
        <section className="lure-box">
          <Kicker tone="muted">Lure dinâmico</Kicker>
          <Input
            label="Parar ao juntar (máx)"
            size="sm"
            type="number"
            min={1}
            max={30}
            value={String(lure.max)}
            onChange={(event) => { setLure({ ...lure, max: Number(event.target.value) }); }}
          />
          <Input
            label="Voltar a correr abaixo de (mín)"
            size="sm"
            type="number"
            min={1}
            max={30}
            value={String(lure.min)}
            onChange={(event) => { setLure({ ...lure, min: Number(event.target.value) }); }}
          />
          <div className="lure-hysteresis">
            <span>correndo</span>
            <span className="lure-hysteresis-arrow">⇄</span>
            <span>lutando</span>
          </div>
          <p className="lure-hint">
            {`Entre ${String(lure.min)} e ${String(lure.max)} a máquina não muda de estado. Conta no raio de busca do bot, ignorando a lista "ignorar".`}
          </p>
        </section>
        <section className="lure-box">
          <Kicker tone="muted">Escolher o alvo</Kicker>
          <Select
            label="Política"
            size="md"
            options={POLICY_OPTIONS}
            value={targeting.policy}
            onChange={(value) => { setTargetingPolicy(value as BotTargetPolicy); }}
          />
          <Kicker tone="muted">Priorizar</Kicker>
          <div className="lure-badge-row">
            {targeting.prioritize.map((id) => (
              <Badge key={id} tone="blood" dot={false}>
                {monsterName(monsters, id)}
                <button
                  type="button"
                  className="lure-badge-remove"
                  aria-label={`remover ${monsterName(monsters, id)} de priorizar`}
                  onClick={() => { setPrioritize(targeting.prioritize.filter((existing) => existing !== id)); }}
                >
                  ×
                </button>
              </Badge>
            ))}
            <Select
              size="sm"
              value=""
              options={[
                { value: '', label: '+' },
                ...available(targeting.prioritize).map((monster) => ({ value: monster.id, label: monster.name })),
              ]}
              onChange={(id) => { if (id) setPrioritize([...targeting.prioritize, id]); }}
            />
          </div>
          <Kicker tone="muted">Ignorar</Kicker>
          <div className="lure-badge-row">
            {targeting.ignore.map((id) => (
              <Badge key={id} tone="muted" dot={false}>
                {monsterName(monsters, id)}
                <button
                  type="button"
                  className="lure-badge-remove"
                  aria-label={`remover ${monsterName(monsters, id)} de ignorar`}
                  onClick={() => { setIgnore(targeting.ignore.filter((existing) => existing !== id)); }}
                >
                  ×
                </button>
              </Badge>
            ))}
            <Select
              size="sm"
              value=""
              options={[
                { value: '', label: '+' },
                ...available(targeting.ignore).map((monster) => ({ value: monster.id, label: monster.name })),
              ]}
              onChange={(id) => { if (id) setIgnore([...targeting.ignore, id]); }}
            />
          </div>
        </section>
        <section className="lure-box">
          <Kicker tone="muted">Follow · postura</Kicker>
          <div className="lure-posture-list">
            {POSTURE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`lure-posture-option${targeting.posture.kind === option.value ? ' lure-posture-selected' : ''}`}
                onClick={() => {
                  setPosture(
                    option.value === 'keep-distance'
                      ? { kind: 'keep-distance', tiles: lastDistance }
                      : { kind: option.value },
                  );
                }}
              >
                {option.label}
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
          {targeting.posture.kind === 'keep-distance' && (
            <Input
              label="Distância (tiles)"
              size="sm"
              type="number"
              min={2}
              max={8}
              value={String(targeting.posture.tiles)}
              onChange={(event) => {
                const tiles = Number(event.target.value);
                setLastDistance(tiles);
                setPosture({ kind: 'keep-distance', tiles });
              }}
            />
          )}
        </section>
      </div>
    </Modal>
  );
}
