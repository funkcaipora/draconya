// A decisão de "Iniciar com o time" (RF-03), PURA — o padrão de `resolveSelection`/`dropIntent`:
// `prerender` não dispara clique, então a decisão em si é função testável direto, e o componente
// só a desenha.
//
// **Ela decide APRESENTAÇÃO, nunca resultado** (invariante 4): nada aqui calcula dano, vaga ou
// XP, e NENHUMA decisão manda a intenção de hunt solo — o início da party vai por HTTP
// (`configure` + `start`), e a entrada na hunt segue sendo o ticket oferecido à conexão de
// sempre. O patch é montado do ESTADO REAL da party (`minLevel`, `vocationTargets`,
// `shareCosts`, `splitLoot`), com caçada e dificuldade da seleção — nada inventado, nada de
// estado "aguardando aprovação" (a aprovação pré-start não existe mais desde a #501).

import type { PartyConfigInput, PartyView } from '../party/api.js';

export interface StartWithTeamDecision {
  readonly enabled: boolean;
  /** Explicação do botão desabilitado, em palavras. `null` quando habilitado. */
  readonly reason: string | null;
  /**
   * O patch do `configure` antes do `start` — `null` quando a configuração da party JÁ confere
   * com a seleção, e só o `start` precisa sair.
   */
  readonly patch: PartyConfigInput | null;
}

/**
 * A party está EM FORMAÇÃO e há seleção de caçada?
 *
 * Só a party em formação oferece o início: depois do `start` a party é a sessão de hunt, e os
 * eixos em tempo de hunt ficam no rodapé de `PartyMembers`.
 */
export function startWithTeam(
  current: PartyView | null, me: string, huntId: string | null, difficulty: string | null,
): StartWithTeamDecision {
  if (current === null) {
    return { enabled: false, reason: 'Você não está numa party.', patch: null };
  }
  if (current.state !== 'forming') {
    return { enabled: false, reason: 'A party já está caçando.', patch: null };
  }
  if (current.leaderId !== me) {
    return { enabled: false, reason: 'Só o líder inicia com o time.', patch: null };
  }
  if (current.members.length < 2) {
    return { enabled: false, reason: 'Uma party precisa de pelo menos dois.', patch: null };
  }
  if (huntId === null || difficulty === null) {
    return { enabled: false, reason: 'Escolha a caçada e o tamanho do pull.', patch: null };
  }
  const sameTarget = current.huntId === huntId && current.difficulty === difficulty;
  // O patch é o estado REAL, pass-through: os eixos e a composição configurados não mudam por
  // causa do início — só a caçada e o pull da seleção entram. `minLevel ?? 1` é o piso que o
  // servidor aceita, para a sala configurada sobreviver ao primeiro `publish`.
  const patch: PartyConfigInput | null = sameTarget ? null : {
    huntId,
    difficulty,
    minLevel: current.minLevel ?? 1,
    vocationTargets: current.vocationTargets,
    shareCosts: current.shareCosts,
    splitLoot: current.splitLoot,
  };
  return { enabled: true, reason: null, patch };
}
