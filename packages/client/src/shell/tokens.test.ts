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

describe('ui.css (VitalBar)', () => {
  it('usa --grad-vital-track no trilho e --grad-vital-<kind> no preenchimento (#304, R0-08)', () => {
    expect(uiCss).toMatch(/\.ui-vital-track\s*\{[^}]*background:\s*var\(--grad-vital-track\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="hp"\]\s*\{[^}]*background:\s*var\(--grad-vital-hp\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="mp"\]\s*\{[^}]*background:\s*var\(--grad-vital-mp\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="exp"\]\s*\{[^}]*background:\s*var\(--grad-vital-exp\);/);
    expect(uiCss).toMatch(/\.ui-vital-fill\[data-kind="stamina"\]\s*\{[^}]*background:\s*var\(--grad-vital-stamina\);/);
  });
});

describe('slots e set fidelidade (#307)', () => {
  it('container-grid usa 6 colunas de 26px (RF-04)', () => {
    expect(shellCss).toMatch(/\.container-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*26px\);/);
  });

  it('equipment usa padding de 6px (RF-07)', () => {
    expect(shellCss).toMatch(/\.equipment\s*\{[^}]*padding:\s*6px;/);
  });

  it('capacity usa letter-spacing de 0.08em e não impõe max-width (RF-08)', () => {
    expect(shellCss).toMatch(/\.capacity\s*\{[^}]*letter-spacing:\s*0\.08em;/);
    expect(shellCss).not.toMatch(/\.capacity\s*\{[^}]*max-width:/);
  });

  it('ui-slot-count e slot-count usam gold-5, mono 500 6.5px, e sem text-shadow (RF-10)', () => {
    expect(uiCss).toMatch(/\.ui-slot-count[^}]*color:\s*var\(--gold-5\);/);
    expect(uiCss).toMatch(/\.ui-slot-count[^}]*font:\s*500 6\.5px var\(--font-mono\);/);
    expect(uiCss).not.toMatch(/\.ui-slot-count[^}]*text-shadow:/);
  });

  it('shell.css não contém regras de moldura manual de slot', () => {
    expect(shellCss).not.toMatch(/^\.slot\s*\{/m);
    expect(shellCss).not.toMatch(/^\.slot-empty-place\s*\{/m);
    expect(shellCss).not.toMatch(/^\.slot-button\s*\{/m);
    expect(shellCss).not.toMatch(/^\.slot-count\s*\{/m);
  });
});

describe('TopBar fidelidade (#306)', () => {
  it('aplica moldura de 4 lados, vinheta e sombra interna em .topbar (RF-01)', () => {
    expect(shellCss).toMatch(/\.topbar\s*\{[^}]*border:\s*1px solid var\(--gold-1\);/);
    expect(shellCss).toMatch(/\.topbar\s*\{[^}]*border-top-color:\s*var\(--ash-3\);/);
    expect(shellCss).toMatch(/\.topbar\s*\{[^}]*border-bottom-color:\s*var\(--gold-3\);/);
    expect(shellCss).toMatch(/\.topbar\s*\{[^}]*linear-gradient\(90deg,\s*rgba\(38,\s*27,\s*25,\s*0\.6\)/);
    expect(shellCss).toMatch(/\.topbar\s*\{[^}]*box-shadow:[^}]*inset 0 -1px rgba\(201,\s*162,\s*77,\s*0\.1\);/);
  });

  it('aplica borda dourada e glow no disco da moeda, e sombras no pill de gold (RF-02)', () => {
    expect(shellCss).toMatch(/\.topbar-gold\s*\{[^}]*padding:\s*0 6px 0 9px;/);
    expect(shellCss).toMatch(/\.topbar-gold\s*\{[^}]*box-shadow:\s*inset 0 1px rgba\(255,\s*255,\s*255,\s*0\.05\),\s*0 1px 2px #000;/);
    expect(shellCss).toMatch(/\.topbar-coin\s*\{[^}]*border:\s*1px solid #ffd66b;/);
    expect(shellCss).toMatch(/\.topbar-coin\s*\{[^}]*box-shadow:\s*0 0 7px rgba\(215,\s*164,\s*38,\s*0\.4\);/);
  });

  it('aplica brilho dourado no wordmark DRACONYA (RF-03)', () => {
    expect(shellCss).toMatch(
      /\.topbar-wordmark b\s*\{[^}]*text-shadow:\s*0 1px #000,\s*0 0 18px rgba\(201,\s*162,\s*77,\s*0\.25\);/,
    );
  });

  it('aplica gradiente radial e anéis internos no retrato (RF-04)', () => {
    expect(shellCss).toMatch(
      /\.topbar-portrait\s*\{[^}]*radial-gradient\(circle at 50% 42%,\s*#3a301c 0 18%,\s*transparent 19%\)/,
    );
    expect(shellCss).toMatch(
      /\.topbar-portrait\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--ash-1\),\s*inset 0 0 0 3px rgba\(208,\s*163,\s*75,\s*0\.25\),\s*0 1px 4px #000;/,
    );
  });

  it('remove completamente o rótulo e item sob o ícone (RF-05)', () => {
    expect(shellCss).not.toMatch(/\.topbar-icon-label/);
    expect(shellCss).not.toMatch(/\.topbar-nav-item/);
  });
});

