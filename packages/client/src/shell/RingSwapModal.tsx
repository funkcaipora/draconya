// O modal "Ring swap" (FUN-87, M15 SV-17; ADR 0030, captura 27-modal-swap-ring.png) — a tela
// do mecanismo `#applyRingSwap` que já roda no `sim`.
import { useState } from 'react';
import type { BotConfig } from '@draconya/content';
import type { ItemDefinition } from '../state/hud.js';
import { setRingSwap } from '../bot/store.js';
import { fingerRings } from '../bot/ring-swap.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';
import { Slot } from './ui/Slot.js';
import { Button } from './ui/Button.js';

function clampPercent(raw: number): number {
  if (Number.isNaN(raw)) return 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

type RingSwapConfig = NonNullable<BotConfig['ringSwap']>;

export function RingSwapModal({ initial, items, onClose }: {
  initial: BotConfig['ringSwap'] | undefined;
  items: readonly ItemDefinition[];
  onClose: () => void;
}) {
  const rings = fingerRings(items);
  const [ring, setRing] = useState<RingSwapConfig>(
    initial ?? {
      itemId: rings[0]?.id ?? '', equipBelow: 50, removeAbove: 60, manaFloor: 10, restorePrevious: true,
    },
  );
  const bad = ring.removeAbove <= ring.equipBelow;
  const selected = rings.find((item) => item.id === ring.itemId);

  return (
    <Modal
      open
      onClose={onClose}
      title="Ring swap"
      width={520}
      meta="Bot avançado"
      footer={
        <>
          <span className="ring-swap-hint">
            {bad
              ? 'Retirar precisa ser maior que equipar — sem faixa morta o anel troca a cada golpe.'
              : 'Salvar manda agora · quem decide é o servidor'}
          </span>
          <span className="ring-swap-actions">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            {/* Desabilitado com faixa inválida ou sem anel: o servidor recusaria (`botConfigSchema`
                exige `removeAbove > equipBelow`), e o modal fecharia como se tivesse salvo. */}
            <Button
              variant="primary"
              size="sm"
              disabled={bad || selected === undefined}
              onClick={() => { setRingSwap(ring); onClose(); }}
            >
              Salvar
            </Button>
          </span>
        </>
      }
    >
      <div className="ring-swap-header">
        <Slot
          size={36} kind="item" dashed
          empty={selected === undefined}
          {...(selected !== undefined ? { label: selected.name.slice(0, 6).toUpperCase() } : {})}
        />
        <span>
          <b className="ring-swap-name">{selected?.name ?? 'Nenhum anel neste servidor ainda'}</b>
          <small className="ring-swap-note">Anel do slot &quot;dedo&quot;</small>
        </span>
      </div>
      <div className="ring-swap-columns">
        <div className="ring-swap-box">
          <Kicker tone="muted">Equipar quando</Kicker>
          <Input
            label="HP abaixo de" size="sm" type="number" min={0} max={100}
            value={String(ring.equipBelow)}
            onChange={(event) => { setRing({ ...ring, equipBelow: clampPercent(Number(event.target.value)) }); }}
          />
          <p className="ring-swap-aside">E mana ≥ piso de mana</p>
        </div>
        <div className="ring-swap-box">
          <Kicker tone="muted">Retirar quando</Kicker>
          <Input
            label="HP acima de" size="sm" type="number" min={0} max={100}
            value={String(ring.removeAbove)}
            onChange={(event) => { setRing({ ...ring, removeAbove: clampPercent(Number(event.target.value)) }); }}
          />
          <Input
            label="Ou mana abaixo de (piso)" size="sm" type="number" min={0} max={100}
            value={String(ring.manaFloor)}
            onChange={(event) => { setRing({ ...ring, manaFloor: clampPercent(Number(event.target.value)) }); }}
          />
        </div>
      </div>
      <div className="ring-swap-row">
        <Select
          label="Anel" size="md"
          options={rings.map((item) => ({ value: item.id, label: item.name }))}
          value={ring.itemId}
          onChange={(value) => { setRing({ ...ring, itemId: value }); }}
        />
        <Select
          label="Ao retirar" size="md"
          options={[
            { value: 'restore', label: 'Restaurar o anel anterior' },
            { value: 'empty', label: 'Deixar o dedo vazio' },
          ]}
          value={ring.restorePrevious ? 'restore' : 'empty'}
          onChange={(value) => { setRing({ ...ring, restorePrevious: value === 'restore' }); }}
        />
      </div>
      <div className="ring-swap-diagram">
        <span>sem anel<small>{`HP < ${String(ring.equipBelow)} % e mana ≥ ${String(ring.manaFloor)} %`}</small></span>
        <span className="ring-swap-diagram-arrow">⇄</span>
        <span>com anel<small>{`HP > ${String(ring.removeAbove)} % ou mana < ${String(ring.manaFloor)} %`}</small></span>
      </div>
    </Modal>
  );
}
