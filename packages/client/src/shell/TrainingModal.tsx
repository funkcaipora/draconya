// O Treino (#631, M44-13; ADR 0059): o livro do offline training, a loja mínima de exercise
// weapons e as armas que o personagem carrega. Aberto pelo pill "Treino" (`HuntActions`), só na
// Cidade — o Treino é uma sessão privada como a hunt, e a Cidade é o único lugar de onde se entra.
//
// **Tudo aqui é intenção** (invariante 4): comprar diz QUAL item (`buy-item`), treinar diz QUAL
// instância (`enter-training`), o livro diz QUAL skill (`set-offline-training-skill`). Preço,
// saldo, capacidade e o que a arma rende são do servidor; o que se mostra vem do `training-state`
// (as cargas restantes) e do catálogo fixado na sessão (`catalogue.training`, invariante 7). O
// gasto do banco NÃO acontece aqui nem no clique: é da `api`, na volta do personagem ao jogo.
//
// A lógica de apresentação é pura e exportada em `training-view.ts` (`prerender` roda sem DOM e
// sem eventos, então um clique real não dispara em teste — o limite que `HuntsModal.tsx` já contorna).

import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { TrainingRules } from '../state/hud.js';
import { ItemSprite } from './ItemSprite.js';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { Select } from './ui/Select.js';
import {
  attemptTrainingIntent, bankView, buyItemMessage, canAfford, chargeYield, enterTrainingMessage,
  formatBankTime, offlineSkillMessage, ownedWeapons, shopWeapons, skillNameOf,
} from './training-view.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "700 tries" / "60.000 de mana gasta" — o que as cargas rendem, na unidade da skill. */
function yieldText(charges: number, skillId: string, rules: TrainingRules): string {
  const yielded = chargeYield(charges, skillId, rules);
  if (yielded === null) return '';
  return yielded.unit === 'mana'
    ? `${integer.format(yielded.amount)} de mana gasta`
    : `${integer.format(yielded.amount)} tries`;
}

function WeaponSprite({ appearanceId, name }: { appearanceId: number | undefined; name: string }) {
  // `.item-sprite` é `position: absolute` sobre um ancestral de tamanho fixo (`.ui-slot` no
  // inventário, `.hunts-modal-sprite` na lista de hunts): este span é esse ancestral aqui.
  return (
    <span className="training-sprite">
      <ItemSprite appearanceId={appearanceId} name={name} />
    </span>
  );
}

export function TrainingModal({ onClose }: { onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const training = useHudSlice((state) => state.training);
  const gold = useHudSlice((state) => state.gold);
  const rules = catalogue?.training;

  if (catalogue === null || rules === undefined) {
    return (
      <Modal open title="Treino" onClose={onClose} width={560}>
        <p className="hunts-modal-empty">
          {catalogue === null ? 'Carregando…' : 'Este servidor não tem Treino.'}
        </p>
      </Modal>
    );
  }

  const bank = bankView(training, rules);
  const owned = ownedWeapons(training, catalogue.items);
  const shop = shopWeapons(catalogue.items, rules);
  const chosen = training?.offlineSkill ?? '';

  return (
    <Modal open title="Treino" onClose={onClose} width={640} height={560}
      footer={
        <span className="hunts-modal-footer-note">
          Cada golpe gasta uma carga, no ritmo do seu ataque · a arma some quando as cargas acabam
        </span>
      }>
      <div className="training-modal-body">
        <section className="training-section" aria-label="offline training">
          <Kicker tone="muted">Offline training</Kicker>
          <p className="training-note">
            {`Banco: ${formatBankTime(bank.bankMs)} de ${formatBankTime(bank.capMs)} — enche com o tempo `
              + 'que você passa em caçada ou treino. Na volta, o tempo fora treina a skill escolhida.'}
          </p>
          <div className="training-bank-bar" role="presentation">
            <span className="training-bank-fill" style={{ width: `${String(Math.round(bank.fraction * 100))}%` }} />
          </div>
          <label className="training-book">
            <span>Skill do livro</span>
            <Select
              size="sm"
              ariaLabel="Skill do offline training"
              value={chosen}
              options={[
                { value: '', label: 'Nenhuma' },
                ...rules.offlineSkills.map((entry) => ({ value: entry.skillId, label: entry.name })),
              ]}
              onChange={(value) => {
                attemptTrainingIntent(offlineSkillMessage(value === '' ? null : value), sendIntent);
              }}
            />
          </label>
          <p className="training-note training-note-faint">
            {`Carência de ${formatBankTime(rules.graceMs)} fora · gasto por volta: até `
              + `${formatBankTime(rules.spendCapMs.free)} (Free) ou ${formatBankTime(rules.spendCapMs.premium)} (Premium)`}
          </p>
        </section>

        <section className="training-section" aria-label="suas exercise weapons">
          <Kicker tone="muted">Suas exercise weapons</Kicker>
          {owned.length === 0
            ? <p className="hunts-modal-empty">Você não carrega nenhuma exercise weapon.</p>
            : (
              <ul className="training-list">
                {owned.map((weapon) => (
                  <li key={weapon.instanceId} className="training-row">
                    <WeaponSprite appearanceId={weapon.appearanceId} name={weapon.name} />
                    <span className="training-row-text">
                      <strong>{weapon.name}</strong>
                      <span className="entry-meta">
                        {`${skillNameOf(rules, weapon.skillId)} · ${integer.format(weapon.charges)}`
                          + `/${integer.format(weapon.totalCharges)} cargas`}
                      </span>
                      <span className="entry-meta">
                        {`Rende ${yieldText(weapon.charges, weapon.skillId, rules)}`}
                      </span>
                    </span>
                    <Button variant="primary" size="sm"
                      onClick={() => {
                        attemptTrainingIntent(enterTrainingMessage(weapon.instanceId), sendIntent, onClose);
                      }}>
                      Treinar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="training-section" aria-label="loja de exercise weapons">
          <Kicker tone="muted">Loja de exercise weapons</Kicker>
          {shop.length === 0
            ? <p className="hunts-modal-empty">Nada à venda por enquanto.</p>
            : (
              <ul className="training-list">
                {shop.map((weapon) => {
                  const affordable = canAfford(gold, weapon.price);
                  return (
                    <li key={weapon.itemId} className="training-row">
                      <WeaponSprite appearanceId={weapon.appearanceId} name={weapon.name} />
                      <span className="training-row-text">
                        <strong>{weapon.name}</strong>
                        <span className="entry-meta">
                          {`${skillNameOf(rules, weapon.skillId)} · ${integer.format(weapon.charges)} cargas`
                            + ` · ${yieldText(weapon.charges, weapon.skillId, rules)}`}
                        </span>
                      </span>
                      <Button variant="gold" size="sm" disabled={!affordable}
                        title={affordable ? `Comprar por ${integer.format(weapon.price)} gold` : 'Gold insuficiente'}
                        onClick={() => { attemptTrainingIntent(buyItemMessage(weapon.itemId), sendIntent); }}>
                        {`${integer.format(weapon.price)} gold`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      </div>
    </Modal>
  );
}
