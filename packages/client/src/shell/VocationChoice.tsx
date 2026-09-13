// A escolha de vocação (#154, ADR 0026 decisão 1).
//
// Sobreposição, como o bot: aparece quando o level chegou e ainda não há vocação, e some
// quando `vocationId` chega em `player-stats` — a confirmação é o estado, não uma mensagem.
// Recusa vira `system-message` no chat e NÃO fecha o diálogo. O level da escolha e as quatro
// vocações vêm do catálogo: nada de "8" aqui (a tela não pode ter o número em código).

import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import { ItemSprite } from './ItemSprite.js';

/**
 * O papel de cada vocação, em uma linha — o texto curto de `docs/product/onboarding.md`. É
 * apresentação por id: um id sem linha aqui mostra só o nome, e o jogo continua.
 */
const ROLE: Readonly<Record<string, string>> = {
  knight: 'Tanque: mais vida e capacidade, bate de perto.',
  paladin: 'Dano à distância: atira com bow e munição.',
  sorcerer: 'Dano mágico: a maior mana, magias de ataque.',
  druid: 'Suporte e cura: a maior mana, magias de cura.',
};

export function VocationChoice() {
  const level = useHudSlice((state) => state.level);
  const vocationId = useHudSlice((state) => state.vocationId);
  const catalogue = useHudSlice((state) => state.catalogue);
  // Sem catálogo, ou catálogo de um nó anterior (`vocationLevel` 0): sem diálogo. Um "0" aqui
  // abriria a escolha no level 1 para todo mundo — e um nó antigo recusaria cada clique.
  if (catalogue === null || catalogue.vocationLevel <= 0 || catalogue.vocations.length === 0) return null;
  if (vocationId !== null || level < catalogue.vocationLevel) return null;

  const itemsById = new Map(catalogue.items.map((item) => [item.id, item]));
  return (
    <div className="vocation-overlay" role="dialog" aria-label="escolha de vocação">
      <div className="vocation-body">
        <h2>Escolha a sua vocação</h2>
        <p className="quiet">A escolha é definitiva. Cada vocação recebe a arma dela; a machete vai para a mochila.</p>
        <ul className="vocation-cards">
          {catalogue.vocations.map((vocation) => {
            const weapon = itemsById.get(vocation.startingWeaponItemId);
            return (
              <li key={vocation.id}>
                <button
                  type="button"
                  className="vocation-card"
                  // INTENÇÃO (invariante 4): o cliente diz QUAL vocação; level, arma e slot
                  // são do servidor — a recusa vem como `system-message`.
                  onClick={() => { sendIntent({ type: 'choose-vocation', vocationId: vocation.id }); }}
                >
                  <strong>{vocation.name}</strong>
                  <span className="vocation-role">{ROLE[vocation.id] ?? ''}</span>
                  <span className="vocation-gains">
                    {`+${String(vocation.healthPerLevel)} HP · +${String(vocation.manaPerLevel)} mana · +${String(vocation.capacityPerLevel)} cap por level`}
                  </span>
                  <span className="vocation-weapon">
                    <ItemSprite appearanceId={weapon?.appearanceId} name={weapon?.name} />
                    <span>{weapon?.name ?? vocation.startingWeaponItemId}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
