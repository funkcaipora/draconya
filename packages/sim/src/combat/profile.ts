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

/**
 * O perfil executa o estágio de Charms e as demais mudanças de resultado do #603 (ADR 0053 d.5)
 * — só o `combat-v4`. Diferente de `isV3OrLater`, este predicado NÃO cobre o `combat-v3`: um
 * personagem com charm atribuído numa sessão ainda fixada em `combat-v3` (conteúdo anterior ao
 * #603) não rola charm nenhum — o resultado dessa sessão não pode mudar no meio dela (invariante
 * 7), e o registro de Charms é do PERSONAGEM, não da versão de conteúdo.
 *
 * Cobre também o fim do Dodge do PRD: o resolver não rola o Dodge de `combat.player.dodgeChance`
 * neste perfil (o único Dodge é o charm, ADR 0053 d.5). O crítico base do jogador, ao contrário,
 * é conteúdo (`baseline.json` declara `modifiers.critical`) e não precisa deste predicado.
 */
export function hasCharmStage(compatibilityProfile: string | undefined): boolean {
  return compatibilityProfile === 'combat-v4';
}
