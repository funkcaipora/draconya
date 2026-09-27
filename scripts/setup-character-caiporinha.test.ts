import { describe, expect, it } from 'vitest';
import { loadContent } from '../packages/content/src/load.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SET, TOP_SETS_BY_VOCATION } from './setup-character-caiporinha.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const content = loadContent(resolve(REPO_ROOT, 'packages', 'content', 'data'));

describe('setup-character-caiporinha', () => {
  it('todos os itens do TOP_SETS_BY_VOCATION existem no conteúdo e batem com o slot', () => {
    for (const [vocation, pieces] of Object.entries(TOP_SETS_BY_VOCATION)) {
      expect(pieces.length).toBeGreaterThanOrEqual(7);
      for (const piece of pieces) {
        const item = content.items.get(piece.itemId);
        expect(item, `item ${piece.itemId} de ${vocation} deve existir no catálogo`).toBeDefined();
        expect(item?.slot, `slot de ${piece.itemId} deve ser ${piece.slot}`).toBe(piece.slot);
      }
    }
  });

  it('o DEFAULT_SET possui equipamentos válidos em todos os slots principais', () => {
    const slots = DEFAULT_SET.map((p) => p.slot);
    expect(slots).toContain('head');
    expect(slots).toContain('chest');
    expect(slots).toContain('legs');
    expect(slots).toContain('feet');
    expect(slots).toContain('hand');
    expect(slots).toContain('shield');
    expect(slots).toContain('back');
  });
});
