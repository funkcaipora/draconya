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
          // Catálogo de ITEM continua sendo M8. Recusar tudo é o mesmo que `buildContent` faz
          // com `loot.items`: melhor um slot recusado no boot que um crédito fantasma.
          problems.push(
            `${where}: item "${rule.do.itemId}" — não existe catálogo de itens ainda`,
          );
      }
    });
  }
  return problems;
}

/** Quantas regras cabem numa categoria, para o cliente desenhar os slots vazios. */
export function slotsFor(category: BotCategory, limits: BotLimits): number {
  return limits.slots[category];
}
