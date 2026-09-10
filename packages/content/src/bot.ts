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

import type { BotCategory, BotConfig, BotLimits } from './schemas.js';
import { BOT_CATEGORIES, BOT_VOCABULARY_VERSION } from './schemas.js';

/**
 * Os problemas encontrados, em português e nomeando a categoria e o índice do slot.
 *
 * Lista vazia é "aceita". **Nunca devolve `true`/`false`**: o critério da FUN-73 é que regra
 * fora do vocabulário seja recusada com MOTIVO, e um booleano obriga quem chama a inventar a
 * mensagem — que é como "sua configuração é inválida" chega ao jogador sem dizer onde.
 */
export function validateBotConfig(config: BotConfig, limits: BotLimits): string[] {
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

  // AINDA NÃO checado: se `spellId`, `supplyId` e `itemId` existem. Os catálogos são M7 e M8,
  // e inventar a checagem antes deles é escrever contra um contrato que ninguém viu.
  //
  // **Quando existirem, a checagem entra AQUI**, e não na hora de executar a regra. O
  // mecanismo é o mesmo que `buildContent` já usa para `loot.items`: recusar o que não tem
  // catálogo. Uma regra que aponta magia inexistente e só falha ao ser disparada é o bot que
  // para de curar sem ninguém saber por quê — o formato exato que esta issue existe para
  // impedir.
  return problems;
}

/** Quantas regras cabem numa categoria, para o cliente desenhar os slots vazios. */
export function slotsFor(category: BotCategory, limits: BotLimits): number {
  return limits.slots[category];
}
