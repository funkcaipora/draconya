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

  it('define os gradientes de vitais do kit e o trilho neutro (#304, R0-08/R6-10)', () => {
    expect(tokensCss).toMatch(/--grad-vital-hp:\s*linear-gradient\(180deg,\s*#d95a55,\s*#a52a2f\);/);
    expect(tokensCss).toMatch(/--grad-vital-mp:\s*linear-gradient\(180deg,\s*#6f86d8,\s*#3d5ec8\);/);
    expect(tokensCss).toMatch(/--grad-vital-exp:\s*linear-gradient\(180deg,\s*#e2c47a,\s*#a8823e\);/);
    expect(tokensCss).toMatch(/--grad-vital-stamina:\s*linear-gradient\(180deg,\s*#7dc78a,\s*#4d9a5a\);/);
    expect(tokensCss).toMatch(/--grad-vital-track:\s*linear-gradient\(180deg,\s*var\(--ash-4\),\s*var\(--ash-3\)\);/);

    // Tokens de cor sólida e trilho colorido saíram (RF-06, DT-03)
    expect(tokensCss).not.toMatch(/--vital-hp:/);
    expect(tokensCss).not.toMatch(/--vital-mp:/);
    expect(tokensCss).not.toMatch(/--vital-exp:/);
    expect(tokensCss).not.toMatch(/--vital-stamina:/);
    expect(tokensCss).not.toMatch(/--vital-hp-track:/);
    expect(tokensCss).not.toMatch(/--vital-mp-track:/);
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

  it('aplica gradiente neutro no trilho .bar e gradiente por tipo em .bar-fill (#304, R6-10)', () => {
    expect(shellCss).toMatch(/\.bar\s*\{[^}]*background:\s*var\(--grad-vital-track\);/);
    expect(shellCss).not.toMatch(/\.bar-hp\s*\{[^}]*background:\s*var\(--vital-hp-track\);/);
    expect(shellCss).not.toMatch(/\.bar-mana\s*\{[^}]*background:\s*var\(--vital-mp-track\);/);
    expect(shellCss).toMatch(/\.bar-hp\s+\.bar-fill\s*\{[^}]*background:\s*var\(--grad-vital-hp\);/);
    expect(shellCss).toMatch(/\.bar-mana\s+\.bar-fill\s*\{[^}]*background:\s*var\(--grad-vital-mp\);/);
    expect(shellCss).toMatch(/\.bar-fill\s*\{[^}]*box-shadow:\s*inset 0 1px rgba\(255,255,255,\.18\),\s*inset 0 -1px rgba\(0,0,0,\.3\);/);
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

describe('ui.css (VitalBar)', () => {
  it('usa --grad-vital-track no trilho e --grad-vital-<kind> no preenchimento (#304, R0-08)', () => {
    expect(uiCss).toMatch(/\.ui-vital-track\s*\{[^}]*background:\s*var\(--grad-vital-track\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="hp"\]\s*\{[^}]*background:\s*var\(--grad-vital-hp\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="mp"\]\s*\{[^}]*background:\s*var\(--grad-vital-mp\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="exp"\]\s*\{[^}]*background:\s*var\(--grad-vital-exp\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="stamina"\]\s*\{[^}]*background:\s*var\(--grad-vital-stamina\);/);
  });
});
