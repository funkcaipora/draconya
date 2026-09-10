// Validação da configuração do bot contra o vocabulário e os limites (FUN-73, ADR 0002).
//
// O schema Zod (`botConfigSchema`) checa a FORMA de uma regra: condição conhecida, operador do
// conjunto, percentual no intervalo, ação com id não vazio. O que ele não consegue checar é o
// que depende do CONTEÚDO — quantos slots a categoria tem, e qual versão de vocabulário este
// servidor entende. É isso que mora aqui.
//
// A separação não é organizacional: o schema é reutilizável por qualquer camada que só precise
// saber se o JSON tem forma de regra, e a checagem de conteúdo exige o `bot/baseline.json`
// carregado, que nem todo chamador tem.

import type { Content } from './content.js';
import type { BotCategory, BotLimits } from './schemas.js';
import type { BotConfig } from './schemas.js';
import { BOT_CATEGORIES, BOT_VOCABULARY_VERSION } from './schemas.js';

/**
 * Os problemas encontrados, em português e nomeando a categoria e o índice do slot.
 *
 * Lista vazia é "aceita". **Nunca devolve `true`/`false`**: o critério da FUN-73 é que regra
 * fora do vocabulário seja recusada com MOTIVO, e um booleano obriga quem chama a inventar a
 * mensagem — que é como "sua configuração é inválida" chega ao jogador sem dizer onde.
 */
export function validateBotConfig(config: BotConfig, content: Content): string[] {
  const limits = content.bot;
  const problems: string[] = [];

  // A versão vem primeiro e não interrompe: uma configuração de vocabulário antigo pode ter
  // outros problemas, e listá-los todos de uma vez poupa o jogador de descobrir um por vez.
  if (config.version !== BOT_VOCABULARY_VERSION) {
    problems.push(
      `configuração na versão ${config.version} de vocabulário; este servidor entende `
        + `${BOT_VOCABULARY_VERSION}`,
    );
  }

  for (const category of BOT_CATEGORIES) {
    const rules = config[category];
    const slots = limits.slots[category];
    if (rules.length > slots) {
      problems.push(
        `categoria "${category}" tem ${rules.length} regras e só ${slots} slots`,
      );
    }
  }

  // A referência cruzada, que a FUN-73 deixou como gancho e a FUN-74 pôde preencher: os
  // catálogos de magia e supply agora existem.
  //
  // A checagem é AQUI, e não na hora de executar a regra. Uma regra que aponta magia
  // inexistente e só falha ao ser disparada é o bot que para de curar sem ninguém saber por
  // quê — o formato exato que este vocabulário existe para impedir.
  for (const category of BOT_CATEGORIES) {
    config[category].forEach((rule, slot) => {
      const where = `categoria "${category}", slot ${slot + 1}`;
      switch (rule.do.kind) {
        case 'spell':
          if (!content.spells.has(rule.do.spellId)) {
            problems.push(`${where}: magia "${rule.do.spellId}" não existe`);
          }
          return;
        case 'supply':
          if (!content.supplies.has(rule.do.supplyId)) {
            problems.push(`${where}: supply "${rule.do.supplyId}" não existe`);
          }
          return;
        case 'item':
          // O catálogo existe desde a FUN-76, e a referência é conferida — mas USAR um item
          // exige inventário, que é a FUN-82. Aceitar a regra agora faria o bot escolhê-la e o
          // atuador recusá-la em silêncio a cada avaliação: um slot morto que o jogador não
          // consegue explicar, que é o formato exato que este vocabulário existe para impedir.
          problems.push(
            content.items.has(rule.do.itemId)
              ? `${where}: usar item exige inventário, que ainda não existe`
              : `${where}: item "${rule.do.itemId}" não existe`,
          );
      }
    });
  }
  // Regra de saída também tem teto (FUN-86). Ela não é categoria — não age, encerra —, mas a
  // lista é avaliada a cada 250 ms e nada no schema impediria mil regras salvas.
  if (config.exit.length > limits.slots.exit) {
    problems.push(
      `${config.exit.length} regras de saída e só ${limits.slots.exit} slots`,
    );
  }

  // O anel apontado precisa existir, e precisa ser um anel (FUN-87). Uma máquina de estados
  // que aponta item inexistente é um slot avançado que nunca dispara — o formato de defeito
  // que este vocabulário existe para impedir.
  if (config.ringSwap !== undefined) {
    const ring = content.items.get(config.ringSwap.itemId);
    if (ring === undefined) {
      problems.push(`ringSwap: item "${config.ringSwap.itemId}" não existe`);
    } else if (ring.slot !== 'finger') {
      problems.push(
        `ringSwap: "${config.ringSwap.itemId}" não é anel — ele veste em `
          + `"${ring.slot ?? 'lugar nenhum'}"`,
      );
    }
  }

  // Targeting (FUN-85): os ids de `prioritize` e `ignore` são de MONSTRO, e valem contra o
  // catálogo inteiro — não contra a composição de uma hunt. A configuração é do personagem e
  // sobrevive à troca de hunt; recusar "priorize dragão" porque a hunt de ratos não tem dragão
  // seria a configuração deixar de valer ao mudar de lugar.
  //
  // Um id que não existe em catálogo nenhum, porém, é slot morto: a preferência nunca dispara
  // e nada diz por quê. É a mesma razão de recusar magia inexistente.
  for (const [field, ids] of [
    ['prioritize', config.targeting.prioritize],
    ['ignore', config.targeting.ignore],
  ] as const) {
    for (const id of ids) {
      if (content.monsters.has(id)) continue;
      problems.push(`targeting.${field}: monstro "${id}" não existe`);
    }
  }

  return problems;
}

/**
 * Quais recursos do bot AVANÇADO esta configuração usa (§13.2, FUN-81).
 *
 * Lista vazia é "cabe no bot básico". Devolve NOMES, não um booleano, pela mesma razão que
 * `validateBotConfig` devolve motivos: "seu bot exige level 50" sem dizer o quê deixa o
 * jogador procurando qual das trinta regras dele é a culpada.
 *
 * Separada de `validateBotConfig` de propósito: aquela responde "esta configuração é válida",
 * que não depende de quem a salvou; esta responde "este PERSONAGEM pode usá-la", que depende
 * do level. Juntar as duas obrigaria toda validação a carregar um level, inclusive as que
 * acontecem sem personagem nenhum na mão.
 */
export function advancedFeaturesUsed(config: BotConfig, limits: BotLimits): string[] {
  const { advancedOnly } = limits;
  const used = new Set<string>();

  // Lure e ring swap são avançados **por nome no §13.2**, e por isso não passam pela lista de
  // `advancedOnly`: o PRD os cita como o que o bot avançado tem. A lista existe para o recorte
  // que o PRD NÃO decidiu — e ela continua vazia por isso (FUN-81).
  //
  // A diferença importa: aqui seguir a especificação é fixar em código; lá seria inventar
  // balanceamento e disfarçá-lo de implementação.
  if (config.lure !== undefined) used.add('lure dinâmico');
  if (config.ringSwap !== undefined) used.add('troca de anel');

  for (const category of BOT_CATEGORIES) {
    for (const rule of config[category]) {
      if (advancedOnly.conditions.includes(rule.when.kind)) used.add(`condição "${rule.when.kind}"`);
    }
  }
  if (advancedOnly.targetPolicies.includes(config.targeting.policy)) {
    used.add(`alvo "${config.targeting.policy}"`);
  }
  if (advancedOnly.postures.includes(config.targeting.posture.kind)) {
    used.add(`postura "${config.targeting.posture.kind}"`);
  }
  return [...used];
}

/** Quantas regras cabem numa categoria, para o cliente desenhar os slots vazios. */
export function slotsFor(category: BotCategory, limits: BotLimits): number {
  return limits.slots[category];
}
