// A casca de teclado (FUN-122) não tem teste de comportamento (é DOM/timer puro, como
// `useCorpseApproach.ts`) — só a fiação nova do #722 é presa aqui, por leitura de fonte, como
// `Viewport.test.ts` faz para o clique no mundo.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('useWalkKeys cancela um pedido de cadáver pendente ao andar (#722, ADR 0048 d.4)', () => {
  it('chama cancelCorpseApproach() no MESMO send() que manda o walk', async () => {
    const code = await readFile(new URL('./useWalkKeys.ts', import.meta.url), 'utf8');
    expect(code).toContain("import { cancelCorpseApproach } from './corpse-approach.js';");
    expect(code).toMatch(/sendIntent\(\{ type: 'walk', direction \}\);\s*\n[\s\S]*?cancelCorpseApproach\(\);/);
  });
});
