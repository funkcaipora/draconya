import { describe, expect, it, vi } from 'vitest';
import { bytesOf, SheetCache, sheetKey } from './cache.js';
import type { CachedSheet, SheetStore } from './cache.js';

/** Um armazenamento em memória, com um interruptor para simular navegador que recusa. */
class MemoryStore implements SheetStore {
  readonly sheets = new Map<string, CachedSheet>();
  failOn: 'none' | 'get' | 'put' | 'entries' = 'none';
  puts = 0;

  async get(key: string): Promise<CachedSheet | undefined> {
    if (this.failOn === 'get') throw new Error('QuotaExceededError');
    return this.sheets.get(key);
  }

  async put(key: string, sheet: CachedSheet): Promise<void> {
    if (this.failOn === 'put') throw new Error('QuotaExceededError');
    this.puts += 1;
    this.sheets.set(key, sheet);
  }

  async delete(key: string): Promise<void> { this.sheets.delete(key); }

  async entries(): Promise<readonly { key: string; bytes: number; usedAtMs: number }[]> {
    if (this.failOn === 'entries') throw new Error('QuotaExceededError');
    return [...this.sheets].map(([key, sheet]) => ({
      key, bytes: bytesOf(sheet), usedAtMs: sheet.usedAtMs,
    }));
  }
}

const sheet = (bytes: number) => ({
  width: 4, height: 4, pixels: new Uint8ClampedArray(bytes),
});

describe('sheetKey (FUN-19)', () => {
  it('inclui a versão do pacote junto do nome do arquivo', () => {
    // O hash no nome é imutável por construção, então a invalidação por conteúdo SUME. Mas
    // duas versões do pacote podem trazer folhas de mesmo nome com conteúdo diferente — e aí
    // o hash sozinho mentiria, servindo a arte da versão antiga.
    expect(sheetKey('1332', 'sprites-abc.bmp.lzma')).not.toBe(sheetKey('1333', 'sprites-abc.bmp.lzma'));
    expect(sheetKey('1332', 'sprites-abc.bmp.lzma')).toBe('1332/sprites-abc.bmp.lzma');
  });
});

describe('SheetCache (FUN-19)', () => {
  it('devolve o que guardou', async () => {
    const store = new MemoryStore();
    const cache = new SheetCache(store, { maxBytes: 1_000 });
    expect(await cache.put('a', sheet(100))).toBe(true);
    expect((await cache.get('a'))?.width).toBe(4);
  });

  it('devolve null para o que nunca viu', async () => {
    const cache = new SheetCache(new MemoryStore(), { maxBytes: 1_000 });
    expect(await cache.get('nunca-vista')).toBeNull();
  });

  it('DESPEJA o menos recentemente usado para caber', async () => {
    // Sem teto, o cache cresce até o navegador recusar — e aí o jogo passa a falhar ao
    // carregar folha nova, que é o oposto do que ele existe para fazer.
    let clock = 0;
    const store = new MemoryStore();
    const cache = new SheetCache(store, { maxBytes: 300, now: () => clock });

    clock = 1; await cache.put('velha', sheet(100));
    clock = 2; await cache.put('media', sheet(100));
    clock = 3; await cache.put('nova', sheet(100));
    // Toca a mais velha: ela deixa de ser a menos recente.
    clock = 4; await cache.get('velha');
    clock = 5; await cache.put('ultima', sheet(100));

    expect([...store.sheets.keys()].sort()).toEqual(['nova', 'ultima', 'velha']);
  });

  it('reescrever a MESMA folha não despeja as OUTRAS', async () => {
    // Sem excluir a própria chave da conta, o cache soma a folha que está entrando duas vezes
    // — a que já está lá e a que está chegando — e conclui que falta espaço. Aí despeja uma
    // folha alheia por nada, e a reconexão de um jogador esvazia o cache aos poucos.
    //
    // **Este teste já foi vácuo.** A primeira versão reescrevia a única folha do cache e
    // afirmava que ela continuava lá: com ou sem o defeito, ela continuava — o caminho errado
    // a apagava e regravava, chegando ao mesmo estado. Uma mutação sobreviveu por isso. O que
    // discrimina é ter OUTRA folha para perder.
    let clock = 0;
    const store = new MemoryStore();
    const cache = new SheetCache(store, { maxBytes: 200, now: () => clock });

    clock = 1; await cache.put('grande', sheet(150));
    clock = 2; await cache.put('pequena', sheet(50));
    clock = 3; await cache.put('pequena', sheet(50));

    expect([...store.sheets.keys()].sort()).toEqual(['grande', 'pequena']);
  });

  it('RECUSA folha maior que o teto, sem despejar nada antes', async () => {
    // Tentar guardá-la despejaria TUDO para depois falhar assim mesmo — o pior dos dois
    // mundos: perde-se o cache inteiro e não se ganha a folha.
    const store = new MemoryStore();
    const cache = new SheetCache(store, { maxBytes: 100 });
    await cache.put('cabe', sheet(50));
    expect(await cache.put('gigante', sheet(500))).toBe(false);
    expect(store.sheets.has('cabe')).toBe(true);
  });

  it('leitura que FALHA vira null, e o jogo continua', async () => {
    // Aba anônima, cota estourada, armazenamento bloqueado: normais, não excepcionais.
    // Nenhum deles pode impedir o jogo de abrir; paga-se o LZMA de novo, e mais nada.
    const store = new MemoryStore();
    const onDegraded = vi.fn();
    const cache = new SheetCache(store, { maxBytes: 1_000, onDegraded });
    store.failOn = 'get';
    expect(await cache.get('a')).toBeNull();
    expect(onDegraded).toHaveBeenCalledWith('leitura', expect.any(Error));
  });

  it('gravação que FALHA devolve false, e não estoura', async () => {
    // Quem chamou já tem os pixels na mão: o cache é atalho da PRÓXIMA vez, nunca do agora.
    const store = new MemoryStore();
    const onDegraded = vi.fn();
    const cache = new SheetCache(store, { maxBytes: 1_000, onDegraded });
    store.failOn = 'put';
    expect(await cache.put('a', sheet(10))).toBe(false);
    expect(onDegraded).toHaveBeenCalledWith('gravação', expect.any(Error));
  });

  it('falha ao LISTAR também degrada, em vez de derrubar a gravação', async () => {
    const store = new MemoryStore();
    const cache = new SheetCache(store, { maxBytes: 1_000 });
    store.failOn = 'entries';
    expect(await cache.put('a', sheet(10))).toBe(false);
  });

  it('avisa quando degrada, em vez de virar cache morto em silêncio', async () => {
    // Um cache que falha calado é indistinguível de um cache que funciona — e o sintoma é o
    // jogo lento para sempre, sem nada no console apontando para aqui.
    const store = new MemoryStore();
    const onDegraded = vi.fn();
    const cache = new SheetCache(store, { maxBytes: 10, onDegraded });
    await cache.put('gigante', sheet(500));
    expect(onDegraded).toHaveBeenCalledWith('folha maior que o teto do cache', null);
  });

  it('recusa teto não positivo na construção', async () => {
    // Zero faria toda gravação recusar em silêncio, e o cache pareceria funcionar.
    expect(() => new SheetCache(new MemoryStore(), { maxBytes: 0 })).toThrow(/precisa ser positivo/);
  });

  it('ler MARCA o uso, e é isso que faz o LRU ser LRU', async () => {
    let clock = 10;
    const store = new MemoryStore();
    const cache = new SheetCache(store, { maxBytes: 1_000, now: () => clock });
    await cache.put('a', sheet(10));
    clock = 99;
    await cache.get('a');
    // A gravação da marcação é sem `await` de propósito — esperar por ela atrasaria a leitura
    // por uma escrita que não importa se falhar. Dar uma volta na fila basta.
    await Promise.resolve();
    expect(store.sheets.get('a')?.usedAtMs).toBe(99);
  });
});
