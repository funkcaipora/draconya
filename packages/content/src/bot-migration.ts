// A migração v1 → v2 do vocabulário do bot (AB-03, ADR 0032 d.1).
//
// PURA: sem I/O, sem relógio, sem RNG, sem leitura de catálogo. A ordem da saída é função só da
// entrada. Quem confere item e magia contra o conteúdo é `validateBotConfigV2`, depois.
//
// **Idempotente:** uma config já na v2 volta apenas parseada (o parse materializa os defaults de
// forma estável). O curto-circuito de `version === 2` vem ANTES do parse v1 porque o v1 não
// conhece `sets`, e o parse v1 descartaria o v2 em silêncio — produzindo uma config vazia.

import {
  BOT_HOTKEYS, BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION,
  botConfigV1Schema, botConfigV2Schema, botSlotSchema, BOT_CATEGORIES,
} from './schemas.js';
import type { BotAutomation, BotConfigV2, BotSlot } from './schemas.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A detecção de "já é v2", compartilhada com o `server` (#424): o host precisa dela para saber
 * se uma config que veio no ticket é dado NOVO a persistir (v1 migrada) ou já o vocabulário
 * atual (v2 intacta). Uma segunda definição divergiria na primeira mudança de versão.
 */
export function isBotConfigV2(raw: unknown): boolean {
  return isRecord(raw) && raw['version'] === BOT_VOCABULARY_VERSION;
}

/**
 * Converte uma configuração v1 salva para o vocabulário v2, de forma determinística.
 *
 * A ordem da migração é cura → poções → ataque → runas → suporte (a ordem de `BOT_CATEGORIES`),
 * preservando `enabled`, a condição e a ordem interna de cada categoria. O excedente acima de
 * 24 regras continua no conjunto 2, na mesma ordem: nada é descartado (DT-04).
 *
 * `supplyId` permanece `supplyId` — o suprimento voltou a ser ABSTRATO (gold no uso, ADR 0026
 * d.3), e a v1 já usava o mesmo token. `ringSwap` vira a automação `swap-ring`.
 */
export function migrateBotConfigV1(raw: unknown): BotConfigV2 {
  // Idempotência ANTES do parse v1: o v1 não conhece `sets`, e o objeto v1 descartaria o v2 em
  // silêncio (zod remove chave desconhecida por padrão), produzindo uma config vazia.
  if (isBotConfigV2(raw)) {
    return botConfigV2Schema.parse(raw);
  }

  const v1 = botConfigV1Schema.parse(raw);

  // 1) Categorias na ordem do v1 (que já é cura → poções → ataque → runas → suporte),
  //    preservando a ordem interna de cada categoria.
  const flat: BotSlot[] = [];
  for (const category of BOT_CATEGORIES) {
    for (const rule of v1[category]) {
      // A v2 só tem `spell` e `supply`. O `supply` v1 vira `supply` v2 (o suprimento voltou a
      // ser abstrato); um `item` v1 — que só existiu no vocabulário M18 — vira `supply` pelo
      // mesmo id, porque os consumíveis daquele modelo tinham o id do suprimento. Item de
      // equipamento nunca foi ação de slot válida (o atuador não existe), e o juiz v2 recusa.
      const action = rule.do.kind === 'item'
        ? { kind: 'supply' as const, supplyId: rule.do.itemId }
        : rule.do;
      flat.push(botSlotSchema.parse({
        ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
        do: action,
        when: [rule.when],       // a condição única da v1 vira a lista E de um
        auto: true,              // a chave automática nasce ligada (o manual é o extra)
        target: rule.target,     // alvo de party preservado (§26-30, ADR 0035 d.10)
      }));
    }
  }
  // A v1 permite 3+4+10+10+10 = 37 regras, e o v2 tem 24 slots por conjunto: o excedente
  // continua no conjunto 2, na mesma ordem. Nada é descartado (ADR 0032, alternativa "v2 sem
  // migração" foi rejeitada justamente para não perder configuração).
  if (flat.length > BOT_SET_COUNT * BOT_SLOTS_PER_SET) {
    throw new Error('config v1 acima de 96 regras: impossível pelo schema v1');
  }

  // 2) Teclas em sequência, reiniciando a cada conjunto. 22 teclas para 24 slots: os dois
  //    últimos de cada conjunto ficam sem tecla — o schema aceita `hotkey` ausente (DT-02).
  const slots: (BotSlot | null)[] = [];
  flat.forEach((slot, index) => {
    const withinSet = index % BOT_SLOTS_PER_SET;
    const key = BOT_HOTKEYS[withinSet];
    slots.push(key === undefined ? slot : botSlotSchema.parse({ ...slot, hotkey: key }));
  });
  while (slots.length % BOT_SLOTS_PER_SET !== 0) slots.push(null);

  const sets: BotConfigV2['sets'] = [];
  for (let i = 0; i < BOT_SET_COUNT; i += 1) {
    const slice = slots.slice(i * BOT_SLOTS_PER_SET, (i + 1) * BOT_SLOTS_PER_SET);
    sets.push({
      slots: slice.length === BOT_SLOTS_PER_SET
        ? slice
        : [...slice, ...Array<null>(BOT_SLOTS_PER_SET - slice.length).fill(null)],
    });
  }

  // 3) ringSwap vira a automação swap-ring; o gatilho novo "≥ N alvos" não existia na v1.
  const automations: BotAutomation[] = v1.ringSwap === undefined ? [] : [{
    model: 'swap-ring',
    params: {
      itemId: v1.ringSwap.itemId,
      manaFloor: v1.ringSwap.manaFloor,
      restorePrevious: v1.ringSwap.restorePrevious,
    },
    enter: [{ kind: 'hp', op: '<', percent: v1.ringSwap.equipBelow }],
    exit: [{ kind: 'hp', op: '>', percent: v1.ringSwap.removeAbove }],
  }];

  return botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION,
    activeSet: 0,
    sets,
    automations,
    stance: 'balanced',
    targeting: v1.targeting,   // intactos
    exit: v1.exit,
    follow: v1.follow,         // #406: quem seguir, intacto
    ...(v1.lure === undefined ? {} : { lure: v1.lure }),
  });
}
