// packages/client/src/shell/tokens.test.ts
//
// tokens.css e fonts.css não são componentes React — não há o que fazer prerender. O que se
// verifica aqui é texto: as invariantes do #245 (D1, ADR 0029) que um editor descuidado quebra
// em silêncio — um @import de volta, uma URL de CDN, um número não corrigido.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const tokensCss = read('./tokens.css');
const fontsCss = read('./fonts.css');
const shellCss = read('./shell.css');
const uiCss = read('./ui.css');

describe('tokens.css', () => {
  it('nunca usa @import (D1 — sem fonte por CDN)', () => {
    expect(tokensCss).not.toMatch(/@import/);
  });

  it('corrige os números do handoff (#245, plano §1)', () => {
    expect(tokensCss).toMatch(/--hud-topbar-h:\s*65px/);
    expect(tokensCss).toMatch(/--panel-title-h:\s*34px/);
    expect(tokensCss).toMatch(/--slot-size-action:\s*36px/);
    expect(tokensCss).toMatch(/--slot-size-equipment:\s*30px/);
    expect(tokensCss).toMatch(/--slot-size-container:\s*26px/);
    expect(tokensCss).not.toMatch(/--hud-bottom-h/);
  });
});

describe('fonts.css', () => {
  it('aponta para arquivo local em /fonts/, nunca para CDN', () => {
    expect(fontsCss).toMatch(/url\(['"]\/fonts\/cinzel-latin\.woff2['"]\)/);
    expect(fontsCss).toMatch(/url\(['"]\/fonts\/plex-sans-latin\.woff2['"]\)/);
    expect(fontsCss).toMatch(/url\(['"]\/fonts\/jetbrains-mono-latin\.woff2['"]\)/);
    expect(fontsCss).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('serve JetBrains Mono nos quatro pesos reais que o HUD usa (#302, R0-03)', () => {
    expect(fontsCss).toMatch(/url\(['"]\/fonts\/jetbrains-mono-500-latin\.woff2['"]\)/);
    expect(fontsCss).toMatch(/url\(['"]\/fonts\/jetbrains-mono-600-latin\.woff2['"]\)/);
    expect(fontsCss).toMatch(/url\(['"]\/fonts\/jetbrains-mono-700-latin\.woff2['"]\)/);
    // um @font-face por peso, nunca uma faixa — o arquivo 400 é estático, não teria os outros pesos
    const jetbrainsBlocks = fontsCss.match(/@font-face\s*\{[^}]*JetBrains Mono[^}]*\}/g) ?? [];
    expect(jetbrainsBlocks).toHaveLength(4);
    for (const weight of ['400', '500', '600', '700']) {
      expect(jetbrainsBlocks.some((block) => new RegExp(`font-weight:\\s*${weight};`).test(block))).toBe(true);
    }
  });

  it('amplia IBM Plex Sans para a faixa real do arquivo variável (#302, R0-13)', () => {
    expect(fontsCss).toMatch(/IBM Plex Sans[\s\S]*?font-weight:\s*100 700;/);
  });
});

describe('shell.css', () => {
  it('importa tokens.css e fonts.css antes de qualquer outra regra', () => {
    expect(shellCss).toMatch(/@import\s+['"]\.\/tokens\.css['"]/);
    expect(shellCss).toMatch(/@import\s+['"]\.\/fonts\.css['"]/);
  });

  it('body usa os tokens do design system', () => {
    expect(shellCss).toMatch(/--font-body/);
    expect(shellCss).toMatch(/--text-primary/);
    expect(shellCss).toMatch(/--bg-app/);
  });
});

describe('reset (#301, R0-01)', () => {
  it('aplica box-sizing: border-box universal logo após o último @import', () => {
    const resetRule = '*, *::before, *::after { box-sizing: border-box; }';
    expect(shellCss).toContain(resetRule);
    expect(shellCss.indexOf(resetRule)).toBeGreaterThan(shellCss.lastIndexOf('@import'));
  });
});

describe(':focus-visible dourado (#301)', () => {
  it('aplica o anel dourado nos seis primitivos interativos', () => {
    const selectors = [
      '\\.ui-button:focus-visible',
      '\\.ui-icon-button:focus-visible',
      '\\.ui-select:focus-visible',
      '\\.ui-slot:focus-visible',
      '\\.ui-switch:focus-visible',
      '\\.ui-tab:focus-visible',
    ];
    for (const selector of selectors) {
      const regex = new RegExp(
        `${selector}\\s*\\{[^}]*outline:\\s*2px solid var\\(--focus-ring\\);\\s*outline-offset:\\s*2px;`,
      );
      expect(uiCss).toMatch(regex);
    }
  });

  it('ui-checkbox-box usa outline-offset de 2px, não 1px', () => {
    expect(uiCss).toMatch(
      /\.ui-checkbox-box:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);\s*outline-offset:\s*2px;/,
    );
    expect(uiCss).not.toMatch(/\.ui-checkbox-box:focus-visible\s*\{[^}]*outline-offset:\s*1px;/);
  });

  it('ui-select mantém outline: 0 na base e ganha :focus-visible próprio', () => {
    expect(uiCss).toMatch(/\.ui-select\s*\{[^}]*outline:\s*0;/);
    expect(uiCss).toMatch(
      /\.ui-select:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);\s*outline-offset:\s*2px;/,
    );
  });
});

describe('Button fidelidade (#303, R0-04)', () => {
  it('primary, gold, ghost e text declaram font-size: 12px', () => {
    for (const variant of ['primary', 'gold', 'ghost', 'text']) {
      const regex = new RegExp(`\\.ui-button-${variant}\\s*\\{[^}]*font-size:\\s*12px;`);
      expect(uiCss).toMatch(regex);
    }
  });

  it('apenas primary e gold aumentam para 14px em size="lg"', () => {
    expect(uiCss).toMatch(/\.ui-button-primary\.ui-button-lg\s*\{\s*font-size:\s*14px;\s*\}/);
    expect(uiCss).toMatch(/\.ui-button-gold\.ui-button-lg\s*\{\s*font-size:\s*14px;\s*\}/);
    expect(uiCss).not.toMatch(/ui-button-ghost\.ui-button-lg/);
    expect(uiCss).not.toMatch(/ui-button-text\.ui-button-lg/);
  });

  it('pesos de fonte correspondem ao kit: secondary/danger 500, ghost/text 400', () => {
    expect(uiCss).toMatch(/\.ui-button-secondary\s*\{[^}]*font-weight:\s*500;/);
    expect(uiCss).toMatch(/\.ui-button-danger\s*\{[^}]*font-weight:\s*500;/);
    expect(uiCss).toMatch(/\.ui-button-ghost\s*\{[^}]*font-weight:\s*400;/);
    expect(uiCss).toMatch(/\.ui-button-text\s*\{[^}]*font-weight:\s*400;/);
  });
});

describe('IconButton fidelidade (#303, R0-05)', () => {
  it('ui-icon-button-lg mede 36px com estilo do kit', () => {
    expect(uiCss).toMatch(/\.ui-icon-button-lg\s*\{[^}]*width:\s*36px;\s*height:\s*36px;/);
    expect(uiCss).toMatch(/\.ui-icon-button-lg\s*\{[^}]*background:\s*var\(--ash-1\);/);
    expect(uiCss).toMatch(/\.ui-icon-button-lg\s*\{[^}]*border-color:\s*var\(--gold-1\);/);
  });

  it('ui-icon-button-lg ativo ganha borda gold-4 e brightness', () => {
    expect(uiCss).toMatch(/\.ui-icon-button-lg\.ui-icon-button-active\s*\{[^}]*border-color:\s*var\(--gold-4\);/);
    expect(uiCss).toMatch(/\.ui-icon-button-lg\.ui-icon-button-active\s*\{[^}]*filter:\s*brightness\(1\.16\);/);
  });
});

describe('Checkbox fidelidade (#303, R0-07)', () => {
  it('usa custom property --checkbox-size com fallback 15px e font-size calc', () => {
    expect(uiCss).toMatch(/\.ui-checkbox-box\s*\{[^}]*width:\s*var\(--checkbox-size,\s*15px\);/);
    expect(uiCss).toMatch(/\.ui-checkbox-box\s*\{[^}]*height:\s*var\(--checkbox-size,\s*15px\);/);
    expect(uiCss).toMatch(/\.ui-checkbox-box\s*\{[^}]*font-size:\s*calc\(var\(--checkbox-size,\s*15px\)\s*-\s*4px\);/);
  });
});
