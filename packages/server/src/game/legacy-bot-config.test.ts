import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession } from '@draconya/sim';
import type { Session } from '@draconya/sim';
import { SessionHost } from './host.js';
import { createBotConfigLoader } from './sessions.js';
import { FakeSocket } from './testing.js';
import { createLogger } from '../log.js';

// A pergunta do revisor, antes de mesclar o #780: um personagem JÁ SALVO com o slot apontando
// para `strike` (removida no #596) — o boot da sessão falha? a config é recusada inteira? Este
// arquivo prova a resposta CORRETA (ADR 0014): a sessão sobe, o personagem entra na hunt, e só
// o slot com a magia morta esvazia — o resto da configuração (aqui, um ataque real do Knight)
// continua valendo. Usa o CONTEÚDO REAL (`packages/content/data`), não fixture sintética: o
// bug só existe contra o catálogo de verdade, onde `strike` de fato não existe mais.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};
const logger = createLogger('silent', 'test');

describe('config de bot já persistida referenciando magia removida (#596, ADR 0014)', () => {
  it('a sessão SOBE, o slot com "strike" esvazia, e o resto da configuração sobrevive', async () => {
    const content = real();
    // Confirma a premissa: `strike` de fato não existe mais no catálogo real — senão este
    // teste provaria coisa nenhuma.
    expect(content.spells.has('strike')).toBe(false);
    // E que a magia usada no slot de sobrevivência EXISTE de verdade (Knight, level 1).
    expect(content.spells.has('lesser-front-sweep')).toBe(true);

    const saved: unknown[] = [];
    const sessions: Session[] = [];
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: content.version, logger,
      loadBotConfig: createBotConfigLoader(content),
      saveBotConfig: async (_characterId, config) => { saved.push(config); },
      createSession: (characterId) => {
        const session = createHuntSession({
          id: `hunt-${characterId}`, content, huntId: 'rotworm-caves', difficulty: 'cautious', createdAtMs: 0,
        });
        session.enter(new CharacterRuntime({
          id: characterId, position: { x: 0, y: 0, z: 8 },
          health: 200, maxHealth: 200, mana: 100, maxMana: 100,
          level: 8, xp: 0, vocationId: 'knight', goldDelta: 0, alive: true, cooldowns: {},
        }));
        sessions.push(session);
        return session;
      },
    });

    // A configuração v1 de um personagem antigo: cura pela magia genérica que o #596 removeu,
    // ataque por uma magia REAL do Knight que continua no catálogo.
    const legacyConfig = {
      version: 1,
      heal: [{ when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'strike' } }],
      potion: [],
      attack: [{ when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'lesser-front-sweep' } }],
      rune: [], support: [],
    };

    // A pergunta central: isto não pode lançar, e o personagem precisa ENTRAR na hunt.
    const result = await host.prepare('hero', { level: 8, xp: 0, botConfig: legacyConfig }, 'account-1');
    expect(result.created).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.participants.some((p) => p.id === 'hero')).toBe(true);

    // A config sanitizada é dado NOVO (a magia morta some do que fica gravado) — persistida
    // pelo caminho write-behind do ADR 0028, como toda migração v1→v2.
    expect(saved).toHaveLength(1);

    // A prova fina: o slot de cura (o que tinha `strike`) esvaziou; o de ataque (magia real)
    // sobrevive intacto. Confere pelo que o `session-state` de fato manda ao cliente — o
    // mesmo caminho que a tela do bot lê.
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'hero');
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const state = socket.received().filter((m) => m.type === 'session-state').at(-1) as
      { botConfig?: { sets: Array<{ slots: Array<{ do: { kind: string; spellId?: string } } | null> }> } } | undefined;
    const slots = state?.botConfig?.sets[0]?.slots;
    expect(slots?.[0]).toBeNull();
    expect(slots?.[1]?.do).toEqual({ kind: 'spell', spellId: 'lesser-front-sweep' });
  });
});
