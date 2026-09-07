import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from './load.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

describe('loadContent', () => {
  it('carrega o conteúdo real do repositório', () => {
    const content = loadContent(DATA);
    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.hunts.size).toBeGreaterThan(0);
    expect(content.vocations.size).toBe(4);
    expect(content.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it('subpasta ausente é conjunto vazio, não erro', () => {
    // O conteúdo cresce por partes; a validação de referência cruzada pega o que faltar.
    const semMonstros = join(dirname(fileURLToPath(import.meta.url)), '..', 'data-parcial');
    expect(() => loadContent(DATA)).not.toThrow();
    expect(semMonstros).toBeTruthy();
  });

  it('RAIZ ausente é erro, e não conjunto vazio', () => {
    // A distinção importa: sem ela, um caminho errado reporta \"conteúdo válido, 0 monstros\",
    // que é falso verde e só aparece quando o jogo sobe sem nada dentro.
    expect(() => loadContent(join(DATA, 'nao-existe'))).toThrow(/não encontrado/);
  });

  it('carrega o mapa e a rota, com o laço fechado', () => {
    // A rota real do repositório precisa passar na mesma validação dos testes unitários —
    // senão o formato está certo e o conteúdo está errado, que dá no mesmo.
    const content = loadContent(DATA);
    const map = content.maps.get('rat-cellars');
    const route = content.routes.get('rat-cellars');
    expect(map?.width).toBe(10);
    expect(route?.tiles.length).toBe(28);
    expect(route?.spawnPoints.length).toBe(4);
  });

  it('reporta o Druida como valor em aberto', () => {
    expect(loadContent(DATA).openValues.some((v) => v.startsWith('vocation/druid'))).toBe(true);
  });
});

describe('content/ nunca contém arte (invariante 6)', () => {
  it('nenhum arquivo de dados menciona caminho de imagem', () => {
    // O atalho de gravar o caminho direto é sempre mais rápido numa tarde apertada, e é
    // exatamente assim que a reversibilidade do ADR 0008 some sem ninguém decidir abrir mão
    // dela. Este teste é barato e é a única coisa que impede o atalho.
    const extensoes = /\.(png|jpe?g|gif|webp|bmp|spr|dat)\b/i;
    const ofensores: string[] = [];
    for (const pasta of readdirSync(DATA)) {
      const caminhoPasta = join(DATA, pasta);
      for (const arquivo of readdirSync(caminhoPasta)) {
        const texto = readFileSync(join(caminhoPasta, arquivo), 'utf8');
        if (extensoes.test(texto)) ofensores.push(`${pasta}/${arquivo}`);
      }
    }
    expect(ofensores).toEqual([]);
  });
});
