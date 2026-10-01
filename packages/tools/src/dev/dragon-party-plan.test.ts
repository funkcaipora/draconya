// O preset da party de dragões (#526) com o familiar de vocação (#599, M38-02, ADR 0057 d.4 —
// "familiar pronto → invocar"): cada vocação ganha a magia do Canary com a condição "sem invocação
// viva", no grupo `support` da barra, e o resto do preset segue de pé.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@draconya/content/load';
import { validateBotConfigV2 } from '@draconya/content';
import type { Content } from '@draconya/content';
import { botConfigFor, DRAGON_PARTY_MEMBERS, type DragonPartyVocation } from './dragon-party-plan.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

const VOCATIONS = DRAGON_PARTY_MEMBERS.map((member) => member.vocationId);

const familiarSlots = (content: Content, vocationId: DragonPartyVocation) =>
  botConfigFor(content, vocationId).sets[0]?.slots.filter((slot) =>
    slot !== null && slot.do.kind === 'spell' && slot.do.spellId.endsWith('-familiar')) ?? [];

describe('o familiar no preset da party de dragões (#599)', () => {
  it.each(VOCATIONS)('%s: UMA regra com a magia da vocação e a condição "sem invocação viva"', (vocationId) => {
    const slots = familiarSlots(real(), vocationId);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      do: { kind: 'spell', spellId: `summon-${vocationId}-familiar` },
      when: [{ kind: 'summons', op: '<=', count: 0 }],
      auto: true,
    });
    // A magia é do grupo `support` do conteúdo — o mesmo grupo de bot da haste.
    expect(real().spells.get(`summon-${vocationId}-familiar`)?.group).toBe('support');
  });

  it.each(VOCATIONS)('%s: a config inteira continua válida contra o conteúdo real', (vocationId) => {
    expect(validateBotConfigV2(botConfigFor(real(), vocationId), real())).toEqual([]);
  });

  it('conteúdo sem a magia (branch que ainda não a integrou) perde só a regra, não o bot', () => {
    const without: Content = { ...real(), spells: new Map([...real().spells].filter(([id]) => !id.endsWith('-familiar'))) };
    for (const vocationId of VOCATIONS) {
      expect(familiarSlots(without, vocationId)).toHaveLength(0);
      // A haste (a regra vizinha, no mesmo grupo) segue no lugar.
      expect(botConfigFor(without, vocationId).sets[0]?.slots.some((slot) =>
        slot !== null && slot.do.kind === 'spell' && slot.do.spellId === `haste-${vocationId}`)).toBe(true);
    }
  });
});
