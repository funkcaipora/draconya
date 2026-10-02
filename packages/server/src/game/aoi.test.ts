import { describe, expect, it } from 'vitest';
import { AreaOfInterest, floorRange, floorsSee } from './aoi.js';

const at = (x: number, y: number) => ({ x, y, z: 7 });

/** Célula de 10, `subscribe` 1 e `drop` 3 — os mesmos números da praça. */
const build = () => new AreaOfInterest({ cellSize: 10, subscribe: 1, drop: 3 });

describe('quem vê quem (FUN-33)', () => {
  it('dois perto se enxergam, e a relação é simétrica', () => {
    const aoi = build();
    aoi.enter('a', at(15, 15));
    const chegada = aoi.enter('b', at(16, 15));

    expect(chegada.appeared).toEqual(['a']);
    expect(aoi.visibleTo('a')).toEqual(['b']);
    expect(aoi.visibleTo('b')).toEqual(['a']);
  });

  it('dois LONGE não se enxergam — é o ponto inteiro', () => {
    // Sem isto, cada passo de cada um vai para todos os outros: 2.000 jogadores dando 2 passos
    // por segundo, cada passo para 2.000 pessoas, são 8 milhões de mensagens por segundo.
    const aoi = build();
    aoi.enter('a', at(5, 5));
    const chegada = aoi.enter('b', at(500, 500));

    expect(chegada.appeared).toEqual([]);
    expect(aoi.visibleTo('a')).toEqual([]);
  });

  it('o campo cobre a CÂMERA inteira, e é daí que o tamanho da célula vem', () => {
    // `VIEW_WIDTH` é 18 e `visibleTiles` põe uma tile de margem de cada lado: a tela alcança
    // 9,5 tiles para os lados. Menos que isso e aparece buraco onde deveria haver criatura —
    // alguém desenhado na tela de quem o servidor decidiu não avisar.
    //
    // O pior caso é o par colado em quinas opostas das suas células, que é onde uma célula de
    // distância cobre menos: aqui, x = 20 é a primeira coluna da célula 2.
    const aoi = build();
    aoi.enter('centro', at(20, 20));

    for (const [dx, dy] of [[-10, 0], [10, 0], [0, -10], [0, 10], [-10, -10], [10, 10]]) {
      const outro = `p${dx},${dy}`;
      aoi.enter(outro, at(20 + (dx ?? 0), 20 + (dy ?? 0)));
      expect(aoi.visibleTo('centro')).toContain(outro);
    }
  });

  it('quem sai some de quem ficou, dos dois lados', () => {
    const aoi = build();
    aoi.enter('a', at(15, 15));
    aoi.enter('b', at(16, 15));

    expect(aoi.leave('b').vanished).toEqual(['a']);
    expect(aoi.visibleTo('a')).toEqual([]);
    expect(aoi.visibleTo('b')).toEqual([]);
  });

  it('sair duas vezes não inventa mudança nenhuma', () => {
    const aoi = build();
    aoi.enter('a', at(15, 15));
    aoi.leave('a');
    expect(aoi.leave('a')).toEqual({ appeared: [], vanished: [] });
  });
});

describe('o passo, e o que ele custa (FUN-33)', () => {
  it('passo DENTRO da célula não muda visibilidade de ninguém', () => {
    // O caso comum, e o que sustenta o ganho: a maior parte dos passos não cruza fronteira, e
    // para eles a AOI não faz trabalho nenhum além de duas divisões.
    const aoi = build();
    aoi.enter('a', at(15, 15));
    aoi.enter('b', at(16, 15));

    expect(aoi.move('b', at(17, 15))).toEqual({ appeared: [], vanished: [] });
  });

  it('afastar-se o bastante faz os dois sumirem um do outro', () => {
    const aoi = build();
    aoi.enter('a', at(5, 5));
    aoi.enter('b', at(6, 5));

    expect(aoi.move('b', at(85, 5)).vanished).toEqual(['a']);
    expect(aoi.visibleTo('a')).toEqual([]);
    expect(aoi.visibleTo('b')).toEqual([]);
  });

  it('aproximar-se faz os dois aparecerem um para o outro', () => {
    const aoi = build();
    aoi.enter('a', at(5, 5));
    aoi.enter('b', at(85, 5));

    expect(aoi.move('b', at(6, 5)).appeared).toEqual(['a']);
    expect(aoi.visibleTo('a')).toEqual(['b']);
  });

  it('quem recebe o passo é uma LEITURA de conjunto, sem consulta de célula', () => {
    // É o que a simetria compra: no caminho quente — um `creature-move` por passo de cada um —
    // não há divisão, bloco de células nem busca. O conjunto já está pronto.
    const aoi = build();
    aoi.enter('perto', at(15, 15));
    aoi.enter('outro', at(16, 15));
    aoi.enter('longe', at(500, 500));

    expect(aoi.visibleTo('perto')).toEqual(['outro']);
    expect(aoi.visibleTo('longe')).toEqual([]);
  });
});

describe('HISTERESE na fronteira (FUN-33)', () => {
  it('oscilar em torno do limite NÃO gera appear/disappear', () => {
    // O cuidado que a issue nomeia. Com um limiar só, quem anda de um lado para o outro da
    // distância limite gera um par de mensagens por passo — e numa praça cheia isso é mais
    // tráfego do que a AOI economizou. A faixa entre `subscribe` e `drop` existe para isso.
    //
    // `a` fica na célula 0. `b` oscila entre a célula 1 (dentro de `subscribe`) e a 2 (faixa
    // morta): sem histerese, cada travessia seria um par.
    const aoi = build();
    aoi.enter('a', at(5, 5));
    aoi.enter('b', at(15, 5));
    expect(aoi.visibleTo('a')).toEqual(['b']);

    for (const x of [25, 15, 25, 15, 25, 15]) {
      expect(aoi.move('b', at(x, 5))).toEqual({ appeared: [], vanished: [] });
    }
    expect(aoi.visibleTo('a')).toEqual(['b']);
  });

  it('mas afastar-se DE VERDADE ainda derruba a visibilidade', () => {
    // A histerese não pode virar "nunca some": aí o conjunto cresce sem limite e a AOI deixa
    // de cortar o que veio cortar.
    const aoi = build();
    aoi.enter('a', at(5, 5));
    aoi.enter('b', at(15, 5));

    expect(aoi.move('b', at(25, 5))).toEqual({ appeared: [], vanished: [] });
    expect(aoi.move('b', at(35, 5)).vanished).toEqual(['a']);
    expect(aoi.visibleTo('a')).toEqual([]);
  });

  it('quem está na faixa morta e nunca foi visto NÃO passa a ser', () => {
    // O outro lado da mesma moeda: a faixa morta preserva o que já existia, não cria. Se ela
    // criasse, `drop` seria o único limiar de verdade e `subscribe` não faria nada.
    const aoi = build();
    aoi.enter('a', at(5, 5));
    aoi.enter('b', at(25, 5));

    expect(aoi.visibleTo('a')).toEqual([]);
  });

  it('limiares iguais são recusados na construção', () => {
    // Sem faixa morta não há histerese, e a AOI passaria a gastar mais do que economiza. É a
    // mesma recusa que `botRingSwapSchema` faz com os dois limiares do anel (FUN-87).
    expect(() => new AreaOfInterest({ subscribe: 1, drop: 1 })).toThrow(/dead band/);
    expect(() => new AreaOfInterest({ subscribe: 2, drop: 1 })).toThrow(/dead band/);
  });
});

describe('a borda do mapa (FUN-33)', () => {
  it('quem está na origem enxerga normalmente, e para de enxergar ao se afastar', () => {
    // O bloco de candidatos de quem está na borda alcança célula de índice NEGATIVO — `(0,-1)`
    // e vizinhas. Elas não existem, e o que este teste exige é que isso seja um não-evento, e
    // não uma exceção nem um vizinho fantasma.
    const aoi = build();
    aoi.enter('a', at(0, 0));
    aoi.enter('b', at(1, 1));
    expect(aoi.visibleTo('a')).toEqual(['b']);

    aoi.move('a', at(60, 60));
    expect(aoi.visibleTo('a')).toEqual([]);
    expect(aoi.visibleTo('b')).toEqual([]);
  });
});

describe('o custo não cresce com a população (FUN-33)', () => {
  it('numa praça grande, cada um enxerga os vizinhos e não a praça', () => {
    // É o critério da issue em forma de asserção: dobrar a população não pode dobrar quantos
    // recebem cada passo. Aqui, quinhentos espalhados num mapa de 200×200.
    const aoi = build();
    const total = 500;
    for (let i = 0; i < total; i++) {
      aoi.enter(`p${i}`, at((i * 17) % 200, Math.floor((i * 29) % 200)));
    }

    let sum = 0;
    let most = 0;
    for (let i = 0; i < total; i++) {
      const seen = aoi.visibleTo(`p${i}`).length;
      sum += seen;
      most = Math.max(most, seen);
    }

    // Sem AOI seriam 499 para cada um. O que importa é a ORDEM: dezenas, não centenas.
    expect(sum / total).toBeLessThan(total / 10);
    expect(most).toBeLessThan(total / 4);
    expect(sum).toBeGreaterThan(0);
  });
});

describe('a regra de andares do Canary (OW-22)', () => {
  // `Spectators::getSpectators`, canary/src/map/spectators.cpp:125-139, com `multifloor` ligado:
  // MAP_INIT_SURFACE_LAYER = 7, MAP_LAYER_VIEW_LIMIT = 2, MAP_MAX_LAYERS = 16.
  it('da superfície se veem os andares 0 a 7; o 6 alcança até o 8 e o 7 até o 9', () => {
    for (const z of [0, 1, 2, 3, 4, 5]) expect(floorRange(z)).toEqual([0, 7]);
    expect(floorRange(6)).toEqual([0, 8]);
    expect(floorRange(7)).toEqual([0, 9]);
  });

  it('do subsolo se veem dois andares para cada lado, presos em 0 e 15', () => {
    expect(floorRange(8)).toEqual([6, 10]);
    expect(floorRange(9)).toEqual([7, 11]);
    expect(floorRange(10)).toEqual([8, 12]);
    expect(floorRange(14)).toEqual([12, 15]);
    expect(floorRange(15)).toEqual([13, 15]);
  });

  it('é SIMÉTRICA para os 16 × 16 pares: se eu te enxergo, você me enxerga', () => {
    // É o que o resto do módulo promete — assimetria é um jogador na tela de alguém que não
    // aparece na dele. (O `canSee` de `creature.cpp:68-87` é assimétrico: de z 7 não se vê o 8,
    // de z 8 vê-se o 7. Aqui se decide quem avisa quem, nos dois sentidos.)
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) expect(floorsSee(a, b), `${String(a)} ↔ ${String(b)}`).toBe(floorsSee(b, a));
    }
  });

  it('a superfície não vê o subsolo fundo, e o subsolo não vê a superfície lá em cima', () => {
    expect(floorsSee(7, 9)).toBe(true);
    expect(floorsSee(7, 10)).toBe(false);
    expect(floorsSee(5, 8)).toBe(false);
    expect(floorsSee(6, 8)).toBe(true);
    expect(floorsSee(0, 8)).toBe(false);
    expect(floorsSee(9, 7)).toBe(true);
    expect(floorsSee(9, 6)).toBe(false);
    expect(floorsSee(10, 7)).toBe(false);
    expect(floorsSee(10, 12)).toBe(true);
    expect(floorsSee(10, 13)).toBe(false);
  });

  it('todo andar se vê a si mesmo, e todo par de superfície se vê', () => {
    for (let z = 0; z < 16; z++) expect(floorsSee(z, z)).toBe(true);
    for (let a = 0; a <= 7; a++) for (let b = 0; b <= 7; b++) expect(floorsSee(a, b)).toBe(true);
  });
});

describe('quem está em outro andar (OW-22)', () => {
  const on = (x: number, y: number, z: number) => ({ x, y, z });

  it('dois na MESMA célula, em andares que o Canary não deixa ver, não se enxergam', () => {
    // É o critério da issue: antes a célula ignorava `z`, e quem estava no porão aparecia para
    // quem estava na rua por cima dele — com o `creature-move` de cada passo.
    const aoi = build();
    aoi.enter('rua', on(15, 15, 7));
    const chegada = aoi.enter('porao', on(16, 15, 10));

    expect(chegada.appeared).toEqual([]);
    expect(aoi.visibleTo('rua')).toEqual([]);
    expect(aoi.visibleTo('porao')).toEqual([]);
  });

  it('e se enxergam quando o Canary deixa: do 7 se vê até o 9, do subsolo dois para cada lado', () => {
    const aoi = build();
    aoi.enter('rua', on(15, 15, 7));
    expect(aoi.enter('degrau', on(16, 15, 9)).appeared).toEqual(['rua']);
    expect(aoi.enter('fundo', on(17, 15, 11)).appeared).toEqual(['degrau']);

    expect(aoi.visibleTo('rua')).toEqual(['degrau']);
    expect([...aoi.visibleTo('degrau')].sort()).toEqual(['fundo', 'rua']);
    expect(aoi.visibleTo('fundo')).toEqual(['degrau']);
  });

  it('os andares de superfície são uma faixa só: do 0 ao 7 todos se veem', () => {
    const aoi = build();
    aoi.enter('torre', on(15, 15, 0));
    aoi.enter('rua', on(15, 16, 7));
    aoi.enter('sobrado', on(16, 15, 4));

    expect([...aoi.visibleTo('torre')].sort()).toEqual(['rua', 'sobrado']);
    expect([...aoi.visibleTo('rua')].sort()).toEqual(['sobrado', 'torre']);
  });

  it('descer a escada na mesma célula: some de quem não o vê mais, e volta ao subir', () => {
    // Trocar de andar reavalia ainda que x e y fiquem na mesma célula — a escada leva um tile
    // adiante, e a regra é por andar. Os dois lados recebem a mudança (a simetria).
    const aoi = build();
    aoi.enter('rua', on(15, 15, 7));
    aoi.enter('andarilho', on(16, 15, 7));

    expect(aoi.move('andarilho', on(16, 15, 10))).toEqual({ appeared: [], vanished: ['rua'] });
    expect(aoi.visibleTo('rua')).toEqual([]);
    expect(aoi.visibleTo('andarilho')).toEqual([]);

    expect(aoi.move('andarilho', on(16, 15, 9))).toEqual({ appeared: ['rua'], vanished: [] });
    expect(aoi.visibleTo('rua')).toEqual(['andarilho']);
  });

  it('o andar não tem faixa morta: perder a vista por andar é na hora, por perto que esteja', () => {
    const aoi = build();
    aoi.enter('rua', on(15, 15, 7));
    aoi.enter('andarilho', on(15, 16, 8));
    expect(aoi.visibleTo('rua')).toEqual(['andarilho']);

    // Do 8 para o 11: três andares de distância, e o 7 está fora do alcance do subsolo.
    expect(aoi.move('andarilho', on(15, 16, 11)).vanished).toEqual(['rua']);
  });

  it('trocar de andar dentro da mesma faixa não gera mensagem nenhuma', () => {
    // Do 7 para o 5 a faixa é a da superfície e todos continuam se vendo: sem appear nem disappear.
    const aoi = build();
    aoi.enter('a', on(15, 15, 7));
    aoi.enter('b', on(16, 15, 7));

    expect(aoi.move('b', on(16, 15, 5))).toEqual({ appeared: [], vanished: [] });
    expect(aoi.visibleTo('a')).toEqual(['b']);
  });

  it('a histerese de distância continua valendo no mesmo andar, no subsolo também', () => {
    const aoi = build();
    aoi.enter('a', on(5, 5, 9));
    aoi.enter('b', on(15, 5, 9));
    expect(aoi.visibleTo('a')).toEqual(['b']);

    for (const x of [25, 15, 25, 15]) {
      expect(aoi.move('b', on(x, 5, 9))).toEqual({ appeared: [], vanished: [] });
    }
    expect(aoi.move('b', on(35, 5, 9)).vanished).toEqual(['a']);
  });

  it('o recém-chegado encontra quem está em OUTRA faixa que ele alcança', () => {
    // Quem chega no 7 alcança as faixas do 8 e do 9, e a busca de candidatos tem de olhar nelas.
    const aoi = build();
    aoi.enter('porao', on(15, 15, 8));
    expect(aoi.enter('rua', on(16, 15, 7)).appeared).toEqual(['porao']);
  });

  it('quem sai libera a célula da faixa certa: ninguém fica como fantasma', () => {
    const aoi = build();
    aoi.enter('a', on(15, 15, 10));
    expect(aoi.leave('a')).toEqual({ appeared: [], vanished: [] });
    expect(aoi.occupiedCells).toBe(0);

    // Quem chega na mesma célula e andar não encontra o que saiu.
    expect(aoi.enter('b', on(15, 15, 10)).appeared).toEqual([]);
    expect(aoi.occupiedCells).toBe(1);
  });

  it('mudar de faixa move o ocupante de célula: nenhuma célula vazia fica registrada', () => {
    const aoi = build();
    aoi.enter('a', on(15, 15, 7));
    aoi.move('a', on(15, 15, 10));
    aoi.move('a', on(15, 15, 11));
    expect(aoi.occupiedCells).toBe(1);
    aoi.leave('a');
    expect(aoi.occupiedCells).toBe(0);
  });

  it('sem `z` vale o andar padrão do mapa (7): quem só tem x e y se enxerga como antes', () => {
    // A AOI nunca deve derrubar a sessão por um ponto sem andar — o `GridPoint` da Cidade de
    // andar único e as fixtures de teste não carregam `z`.
    const aoi = build();
    aoi.enter('a', { x: 15, y: 15 });
    expect(aoi.enter('b', { x: 16, y: 15 }).appeared).toEqual(['a']);
    expect([...aoi.enter('c', on(17, 15, 7)).appeared].sort()).toEqual(['a', 'b']);
  });

  it('a chave de célula não colide entre faixas nem entre células vizinhas', () => {
    // Uma ocupante por (célula, faixa): 16 andares × uma grade de células, todos no mesmo lugar do
    // mundo em x e y — se a chave colidisse, o número de células ocupadas seria menor.
    const aoi = new AreaOfInterest({ cellSize: 10, subscribe: 1, drop: 3 });
    let count = 0;
    for (const z of [3, 8, 9, 10, 11, 12, 13, 14, 15]) {
      for (const cell of [[0, 0], [0, 1], [1, 0], [-1, -1]] as const) {
        aoi.enter(`p${String(count++)}`, on(cell[0] * 10 + 5, cell[1] * 10 + 5, z));
      }
    }
    // Todo o 3 (superfície) está numa faixa; cada andar de subsolo na dele.
    expect(aoi.occupiedCells).toBe(count);
  });
});

describe('a busca por faixa não perde ninguém (OW-22)', () => {
  /**
   * O modelo ingênuo: a MESMA regra (andar, `subscribe`, histerese até `drop`), mas avaliada contra
   * TODOS os outros a cada passo, sem índice de célula nem faixa. Se a busca por candidatos da AOI
   * deixar de olhar em alguma faixa que o andar alcança, os dois divergem.
   */
  class Naive {
    readonly places = new Map<string, { x: number; y: number; z: number }>();
    readonly seen = new Map<string, Set<string>>();

    move(id: string, to: { x: number; y: number; z: number }): void {
      this.places.set(id, to);
      const mine = this.seen.get(id) ?? new Set<string>();
      this.seen.set(id, mine);
      const cell = (n: number) => Math.floor(n / 10);
      for (const [other, there] of this.places) {
        if (other === id) continue;
        const distance = Math.max(Math.abs(cell(there.x) - cell(to.x)), Math.abs(cell(there.y) - cell(to.y)));
        const wasSeen = mine.has(other);
        const sees = floorsSee(to.z, there.z) && (distance <= 1 || (wasSeen && distance <= 2));
        const theirs = this.seen.get(other) ?? new Set<string>();
        this.seen.set(other, theirs);
        if (sees) { mine.add(other); theirs.add(id); } else { mine.delete(other); theirs.delete(id); }
      }
    }
  }

  it('passos aleatórios por todos os andares: a AOI e o modelo ingênuo concordam a cada passo', () => {
    // Gerador congruencial: determinístico, sem `Math.random` no teste. Lê os bits ALTOS — os
    // baixos de um congruencial de módulo 2^31 têm período curto e dariam poucos andares.
    let state = 12_345;
    const next = (bound: number): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return Math.floor(state / 65_536) % bound;
    };
    const aoi = build();
    const model = new Naive();
    const ids = Array.from({ length: 30 }, (_, index) => `p${String(index)}`);
    for (const id of ids) {
      const place = { x: next(60), y: next(60), z: next(16) };
      aoi.enter(id, place);
      model.move(id, place);
    }
    for (let step = 0; step < 600; step++) {
      const id = ids[next(ids.length)] as string;
      const from = model.places.get(id) as { x: number; y: number; z: number };
      // Anda um tile, e de vez em quando sobe ou desce um andar.
      const to = {
        x: Math.min(59, Math.max(0, from.x + next(3) - 1)),
        y: Math.min(59, Math.max(0, from.y + next(3) - 1)),
        z: next(10) === 0 ? Math.min(15, Math.max(0, from.z + next(3) - 1)) : from.z,
      };
      aoi.move(id, to);
      model.move(id, to);
      for (const other of ids) {
        expect([...aoi.visibleTo(other)].sort(), `passo ${String(step)}, ${other}`)
          .toEqual([...(model.seen.get(other) ?? [])].sort());
      }
    }
  });
});
