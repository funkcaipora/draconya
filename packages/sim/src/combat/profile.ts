// O predicado compartilhado "este perfil executa o mecanismo do combat-v3" (ADR 0040/0052).
//
// `combat-v4` (ADR 0052 decisão 7, #598) é o veículo único do endgame: ele SOMA em cima do
// `combat-v3`, nunca revoga — nenhuma issue do endgame até aqui derrubou mecanismo do v3, só
// acrescentou em cima. Todo lugar que hoje confere `compatibilityProfile === 'combat-v3'` para
// decidir "estágio novo ou o de sempre" precisa tratar `combat-v4` como o MESMO estágio novo,
// e é isso que este arquivo centraliza — em vez de espalhar `=== 'combat-v3' || === 'combat-v4'`
// pelos módulos de combate, com o risco real de esquecer um deles na próxima leitura.

/** O perfil executa o mecanismo `combat-v3` (bloqueio/mitigação do jogador, normal truncada,
 * elemento de arma, stairhop…) — direto no v3, ou herdado por um `combat-v4` que ainda não o
 * revogou. */
export function isV3OrLater(compatibilityProfile: string | undefined): boolean {
  return compatibilityProfile === 'combat-v3' || compatibilityProfile === 'combat-v4';
}
