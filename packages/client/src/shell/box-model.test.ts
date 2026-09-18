// packages/client/src/shell/box-model.test.ts
//
// Trava por texto as correções de geometria decorrentes do reset universal (#301, ADR 0030, R0-01):
// 1. O reset *, *::before, *::after { box-sizing: border-box; } posicionado após os @import.
// 2. Os filhos do .topbar-icon-button (.topbar-icon-img e .topbar-icon-glyph) ajustados de 36px
//    para 32px (36 - 2px borda - 2px padding), evitando vazamento de 2px por lado.
// 3. .entry-card não declara box-sizing isolado, herdando o border-box do reset universal (#287).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const shellCss = read('./shell.css');

describe('box-model (#301, R0-01)', () => {
  it('posiciona o reset universal após os @import em shell.css', () => {
    const resetIndex = shellCss.indexOf('*, *::before, *::after { box-sizing: border-box; }');
    const lastImportIndex = shellCss.lastIndexOf('@import');
    expect(resetIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(lastImportIndex);
  });

  it('ajusta .topbar-icon-img e .topbar-icon-glyph para 32px', () => {
    expect(shellCss).toMatch(/\.topbar-icon-img\s*\{[^}]*width:\s*32px;\s*height:\s*32px;/);
    expect(shellCss).toMatch(/\.topbar-icon-glyph\s*\{[^}]*width:\s*32px;\s*height:\s*32px;/);
    expect(shellCss).not.toMatch(/\.topbar-icon-img\s*\{[^}]*width:\s*36px/);
    expect(shellCss).not.toMatch(/\.topbar-icon-glyph\s*\{[^}]*width:\s*36px/);
  });

  it('.entry-card não declara box-sizing próprio (herda border-box do reset)', () => {
    const match = shellCss.match(/\.entry-card\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const block = match?.[1] ?? '';
    expect(block).not.toMatch(/box-sizing/);
  });
});
