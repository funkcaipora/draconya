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
import type { BotAutomation, BotConfig, BotConfigV2, ItemSlot } from './schemas.js';
import { BOT_CATEGORIES, BOT_VOCABULARY_VERSION_V1 } from './schemas.js';

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
  if (config.version !== BOT_VOCABULARY_VERSION_V1) {
    problems.push(
      `configuração na versão ${config.version} de vocabulário; este servidor entende `
        + `${BOT_VOCABULARY_VERSION_V1}`,
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
          // O catálogo existe desde a FUN-76, e o inventário existe desde a FUN-82 (#160) — mas
          // não há ATUADOR que execute usar um item. Aceitar a regra agora faria o bot
          // escolhê-la e o atuador recusá-la em silêncio a cada avaliação: um slot morto que o
          // jogador não consegue explicar, que é o formato exato que este vocabulário existe
          // para impedir.
          problems.push(
            content.items.has(rule.do.itemId)
              ? `${where}: usar item exige um atuador, que ainda não existe`
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
 * O juiz do vocabulário v2 (AB-03).
 *
 * Espelha a v1, trocando categoria por conjunto/slot e validando a ação contra `content.items`
 * (consumível) e `content.spells`. As automações são conferidas por id de item — nunca por
 * sprite (invariante 6). `targeting`, `exit` e `lure` repetem a validação da v1.
 *
 * A faixa morta do `swap-ring` é a relação `enter`/`exit` de HP; como no v1, o schema não a
 * consegue checar sozinho — quem valida é o motor do AB-07. Aqui a referência é só existência.
 */
export function validateBotConfigV2(config: BotConfigV2, content: Content): string[] {
  const problems: string[] = [];

  config.sets.forEach((set, setIndex) => {
    set.slots.forEach((slot, slotIndex) => {
      if (slot === null) return;
      const where = `conjunto ${setIndex + 1}, slot ${slotIndex + 1}`;
      if (slot.do.kind === 'spell' && !content.spells.has(slot.do.spellId)) {
        problems.push(`${where}: magia "${slot.do.spellId}" não existe`);
      }
      if (slot.do.kind === 'supply' && !content.supplies.has(slot.do.supplyId)) {
        problems.push(`${where}: supply "${slot.do.supplyId}" não existe`);
      }
    });
  });

  const automationItems = (automation: BotAutomation): readonly (readonly [string, ItemSlot])[] => {
    switch (automation.model) {
      case 'renew-ring':
      case 'swap-ring':
        return [[automation.params.itemId, 'finger']];
      case 'renew-amulet':
        return [[automation.params.itemId, 'neck']];
      // A munição é abstrata (ADR 0026 d.3): `swap-ammo-by-targets` aponta ids do catálogo de
      // munição, conferidos à parte — não são itens e não têm slot de equipamento.
      case 'swap-ammo-by-targets':
        return [];
      case 'swap-weapon-shield-by-hp':
        return [
          [automation.params.oneHanded, 'hand'],
          [automation.params.shield, 'shield'],
          [automation.params.twoHanded, 'hand'],
        ];
    }
  };
  config.automations.forEach((automation, index) => {
    // A troca de munição aponta o catálogo de MUNIÇÃO, e a referência é só existência — a
    // família é decidida no motor, não na configuração.
    if (automation.model === 'swap-ammo-by-targets') {
      for (const id of [automation.params.ammoA, automation.params.ammoB]) {
        if (!content.ammunition.has(id)) {
          problems.push(`automação ${index + 1} (${automation.model}): munição "${id}" não existe`);
        }
      }
    }
    for (const [id, slot] of automationItems(automation)) {
      const item = content.items.get(id);
      if (item === undefined) {
        problems.push(`automação ${index + 1} (${automation.model}): item "${id}" não existe`);
        continue;
      }
      // Trocar o modelo sem trocar o SLOT do item é o erro que só apareceria na hunt: a
      // automação tentaria vestir um anel no colo e o inventário recusaria em silêncio a cada
      // ciclo. Aqui a recusa tem modelo, item e slot esperado.
      if (item.slot !== slot) {
        problems.push(
          `automação ${index + 1} (${automation.model}): "${id}" não veste em "${slot}" `
            + `(veste em "${item.slot ?? 'lugar nenhum'}")`,
        );
      }
    }
  });

  // Targeting (FUN-85): ids de MONSTRO, conferidos contra o catálogo inteiro — a configuração
  // é do personagem e sobrevive à troca de hunt.
  for (const [field, ids] of [
    ['prioritize', config.targeting.prioritize],
    ['ignore', config.targeting.ignore],
  ] as const) {
    for (const id of ids) {
      if (content.monsters.has(id)) continue;
      problems.push(`targeting.${field}: monstro "${id}" não existe`);
    }
  }

  // Regra de saída também tem teto (FUN-86), e o teto continua vindo do conteúdo.
  if (config.exit.length > content.bot.slots.exit) {
    problems.push(`${config.exit.length} regras de saída e só ${content.bot.slots.exit} slots`);
  }

  return problems;
}
