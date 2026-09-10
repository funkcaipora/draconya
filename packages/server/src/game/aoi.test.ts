import { describe, expect, it } from 'vitest';
import { AreaOfInterest } from './aoi.js';

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
