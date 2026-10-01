// O estado do Treino em curso (#631, M44-13; ADR 0059), no lugar das pills de caçada: a exercise
// weapon, a skill que ela treina e as cargas que restam — as de `training-state`, reenviadas a cada
// golpe — e o botão de parar.
//
// Mora à parte de `HuntActions` porque o Treino não caça: não tem "Detalhes da caçada", nem regras
// de saída, nem o botão partido de sair. `Parar treino` é o `leave-hunt` de toda sessão privada: o
// servidor devolve o personagem à Cidade, e a arma guarda o que sobrou (o overlay da instância).

import type { C2SMessage } from '@draconya/protocol';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import { ownedWeapons, skillNameOf } from './training-view.js';

/**
 * Manda `leave-hunt` (opcode 10) — o MESMO opcode de sair de qualquer sessão privada (o Treino não
 * tem opcode de saída próprio). Exportada para teste direto: `prerender` não dispara clique.
 */
export function stopTraining(send: (message: C2SMessage) => boolean): boolean {
  return send({ type: 'leave-hunt' });
}

export function TrainingStatus() {
  const training = useHudSlice((state) => state.training);
  const items = useHudSlice((state) => state.catalogue?.items);
  const rules = useHudSlice((state) => state.catalogue?.training);
  const active = ownedWeapons(training, items).find((weapon) => weapon.active);
  return (
    <div className="hunt-actions">
      <span className="hunt-pill training-status" role="status">
        <span aria-hidden="true">⚒</span>
        {active === undefined
          ? ' Treinando'
          : ` Treinando ${skillNameOf(rules, active.skillId)} · ${String(active.charges)}/${String(active.totalCharges)} cargas`}
      </span>
      {/* `.hunt-pill-danger` é a METADE ESQUERDA de um botão partido; `.training-stop` fecha os
          4 cantos, porque aqui não há o chevron de regras ao lado. */}
      <button type="button" className="hunt-pill hunt-pill-danger training-stop"
        onClick={() => { stopTraining(sendIntent); }}>
        <span aria-hidden="true">↩</span> Parar treino
      </button>
    </div>
  );
}
