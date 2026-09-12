import {
  cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from './load.js';
import { floorChangeAt, isBlocked } from './map.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

describe('loadContent', () => {
  it('carrega o conteúdo real do repositório', () => {
    const content = loadContent(DATA);
    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.hunts.size).toBeGreaterThan(0);
    expect(content.vocations.size).toBe(4);
    expect(content.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it('carrega o Bestiário real: cinco marcos crescentes e +1 % por marco (FUN-113, §18)', () => {
    // Opcional no `buildContent` (fixture), obrigatório no conteúdo de verdade: sem ele o
    // abate conta e nunca vale nada. Mutação que mata: apagar `bestiary/` de `load.ts`.
    const content = loadContent(DATA);
    expect(content.bestiary?.milestones).toEqual([10_000, 25_000, 50_000, 100_000, 200_000]);
    expect(content.bestiary?.xpBonusPercentPerMilestone).toBe(1);
  });

  it('o conteúdo real tem o bot padrão do personagem novo, e mana para a primeira magia (FUN-114)', () => {
    // O MVP é "hunt + magias + poção funcionando" no PRIMEIRO minuto: sem isto o personagem
    // novo entrava só no golpe básico até abrir a tela do bot, e sem mana até o level 4.
    const content = loadContent(DATA);
    const config = content.bot.defaultConfig;
    expect(config?.heal.map((rule) => rule.do)).toEqual([{ kind: 'spell', spellId: 'heal' }]);
    expect(config?.potion.map((rule) => rule.do)).toEqual([{ kind: 'supply', supplyId: 'health-potion' }]);
    expect(config?.attack.map((rule) => rule.do)).toEqual([{ kind: 'spell', spellId: 'strike' }]);
    // E dá para lançar qualquer uma das duas magias no level 1.
    const costs = [...content.spells.values()].map((spell) => spell.manaCost);
    expect(content.progression.startingMana).toBeGreaterThanOrEqual(Math.min(...costs));
  });

  it('subpasta ausente é conjunto vazio, não erro', () => {
    // O conteúdo cresce por partes; a validação de referência cruzada pega o que faltar.
    const semMonstros = join(dirname(fileURLToPath(import.meta.url)), '..', 'data-parcial');
    expect(() => loadContent(DATA)).not.toThrow();
    expect(semMonstros).toBeTruthy();
  });

  it('city/city.json ausente é erro: a Cidade não pode subir sem mapa (FUN-120)', () => {
    // "Subpasta ausente é conjunto vazio" vale para o que cresce por partes; a Cidade não é
    // uma parte — sem ela ninguém tem onde nascer, e o boot não acusava nada.
    const dir = mkdtempSync(join(tmpdir(), 'content-'));
    try {
      cpSync(DATA, dir, { recursive: true });
      rmSync(join(dir, 'city'), { recursive: true, force: true });
      expect(() => loadContent(dir)).toThrow(/city\/city\.json ausente/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('a Cidade é Thais: entrada no templo, andável, e cada escada tem a volta (FUN-120)', () => {
    // O mapa importado é gerado; o que é AUTORADO — entrada e escadas — é o que este teste
    // prende. Uma escada sem a volta é um andar de onde ninguém desce.
    const content = loadContent(DATA);
    const city = content.city;
    if (city === undefined) throw new Error('o conteúdo real não tem Cidade');
    expect(city.id).toBe('thais');
    expect(city.entryPoint).toEqual({ x: 94, y: 88, z: 7 });
    expect(isBlocked(city, 94, 88, 7)).toBe(false);
    expect(content.citySettings?.stepDurationMs).toBe(150);

    const raw = JSON.parse(readFileSync(join(DATA, 'maps', 'thais.json'), 'utf8')) as {
      floorChanges: Array<{ from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }>;
    };
    expect(raw.floorChanges.length).toBeGreaterThanOrEqual(2);
    for (const change of raw.floorChanges) {
      expect(floorChangeAt(city, change.from.x, change.from.y, change.from.z)).toEqual(change.to);
      expect(isBlocked(city, change.to.x, change.to.y, change.to.z)).toBe(false);
      // A volta: uma escada no andar de chegada, encostada no tile de chegada, que leva de
      // volta ao andar de origem.
      const back = raw.floorChanges.find((other) => other.from.z === change.to.z
        && other.to.z === change.from.z
        && Math.max(Math.abs(other.from.x - change.to.x), Math.abs(other.from.y - change.to.y)) <= 1);
      expect(back, `escada ${JSON.stringify(change)} sem volta`).toBeDefined();
    }
    // A escada do depot, como o Huntera a mostrou (§14): subir em (75,73,7) chega em (75,72,6)
    // e descer de (75,73,6) chega em (75,74,7).
    expect(floorChangeAt(city, 75, 73, 7)).toEqual({ x: 75, y: 72, z: 6 });
    expect(floorChangeAt(city, 75, 73, 6)).toEqual({ x: 75, y: 74, z: 7 });
  });

  it('reporta o Druida como valor em aberto', () => {
    expect(loadContent(DATA).openValues.some((v) => v.startsWith('vocation/druid'))).toBe(true);
  });
});

describe('a tabela de aparências é a ÚNICA dona dos ids (FUN-94)', () => {
  it('carrega a tabela real e resolve as entidades do repositório com ela', () => {
    const content = loadContent(DATA);
    // `rat.json` não tem outfitId nenhum; o monstro montado tem. É a indireção funcionando
    // sobre o conteúdo de verdade, e não só sobre fixture.
    expect(content.monsters.get('rat')?.outfitId).toBeGreaterThan(0);
    for (const item of content.items.values()) {
      expect(item.appearanceId).toBeGreaterThan(0);
    }
  });

  it('carries the real spell, supply and hit effects, all as ids (FUN-109)', () => {
    // O contrato que o `game` lê para transformar o que o `sim` emite em `effect` e
    // `missile` no fio. Os números são do pacote 1332 e foram conferidos visualmente; o que
    // se prende aqui é que o arquivo REAL passa pelo schema e pela referência cruzada — e
    // que `strike` tem projétil, porque é a única magia à distância do catálogo.
    // Mutação que mata: trocar `"missile": 5` por `"missile": 6` em `baseline.json`.
    const content = loadContent(DATA);
    expect(content.appearances?.spells['strike']).toEqual({ effect: 12, missile: 5 });
    expect(content.appearances?.supplies['health-potion']).toEqual({ effect: 14 });
    expect(content.appearances?.hits.melee).toBe(1);
    // Toda magia e todo supply do repositório TÊM efeito. Não é regra do carregador — magia
    // muda é válida —, é o estado do conteúdo hoje, e a asserção existe para a magia nova
    // que nascer sem efeito ser uma decisão, e não um esquecimento.
    for (const id of content.spells.keys()) {
      expect(content.appearances?.spells[id]?.effect, `spell "${id}"`).toBeGreaterThan(0);
    }
    for (const id of content.supplies.keys()) {
      expect(content.appearances?.supplies[id]?.effect, `supply "${id}"`).toBeGreaterThan(0);
    }
  });

  it('o pacote que a tabela cita tem inventário em packs/, e a tabela passa por ele (FUN-21)', () => {
    // É o que faz o CI conferir os ids sem ter o pacote: `packs/<pack>.json` é a sombra dele
    // no repositório. Apagar a pasta desligaria a conferência em silêncio — `buildContent`
    // só a roda quando há inventário —, e este teste é o que impede isso.
    const content = loadContent(DATA);
    const pack = content.appearances?.pack;
    expect(pack).toBeTruthy();
    expect(readdirSync(join(DATA, 'packs'))).toContain(`${pack}.json`);
    expect(content.pack?.id).toBe(pack);
  });

  it('o CARREGADOR leva o inventário até a conferência: um id fora dele reprova pelo loadContent (FUN-21)', () => {
    // O teste acima prende que o arquivo existe; este prende que `load.ts` o LÊ. Sem ele,
    // apagar a linha `packs:` do carregador deixaria a suíte verde com a conferência
    // desligada — a mutação que sobreviveu na revisão. O conteúdo real é copiado e um id
    // que o pacote 1332 não tem entra na tabela; o resto do repositório fica como está.
    const copy = mkdtempSync(join(tmpdir(), 'draconya-content-'));
    try {
      cpSync(DATA, copy, { recursive: true });
      const table = join(copy, 'appearances', 'baseline.json');
      const text = readFileSync(table, 'utf8');
      expect(text).toMatch(/"rat": 21/);
      writeFileSync(table, text.replace('"rat": 21', '"rat": 999999'));
      expect(() => loadContent(copy))
        .toThrow('appearances.monsters.rat: outfit 999999 não existe no pacote tibia-1332');
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('nenhum arquivo de entidade guarda id de aparência por conta própria', () => {
    // Mesma ideia da varredura de arte abaixo, e pela mesma razão: o schema já recusa a chave
    // solta, mas a mensagem dele ("chave não reconhecida") não diz PARA ONDE o campo foi. Esta
    // varredura diz — e cobre pasta nova de graça, como a de arte cobriu `items/`.
    const ofensores: string[] = [];
    for (const pasta of readdirSync(DATA)) {
      if (pasta === 'appearances') continue;
      for (const arquivo of readdirSync(join(DATA, pasta))) {
        const texto = readFileSync(join(DATA, pasta, arquivo), 'utf8');
        if (/"(appearanceId|outfitId)"\s*:/.test(texto)) ofensores.push(`${pasta}/${arquivo}`);
      }
    }
    // Se este teste reprovou: o id saiu do arquivo da entidade na FUN-94 e vive em
    // `data/appearances/baseline.json`, uma linha por id de conteúdo.
    expect(ofensores).toEqual([]);
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
