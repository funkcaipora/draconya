import { describe, expect, it } from 'vitest';
import { GameMetrics, TICK_LAG_BUDGET_MS } from './metrics.js';

const scrape = async (metrics: GameMetrics): Promise<string> => metrics.registry.metrics();

describe('métricas do nó de jogo (FUN-47)', () => {
  it('sai em formato consultável, com o nó identificado', async () => {
    // Sem o nó no rótulo padrão, somar o cluster e olhar uma máquina viram a mesma leitura —
    // e é justamente uma máquina saturada no meio de dez saudáveis que se quer achar.
    const metrics = new GameMetrics('node-a');
    metrics.observeTick('hunt', 12, 0);

    const text = await scrape(metrics);
    expect(text).toContain('draconya_tick_duration_us_bucket');
    expect(text).toContain('node_id="node-a"');
  });

  it('o custo de tick é HISTOGRAMA, não média', async () => {
    // A média esconde a cauda, e é a cauda que satura o nó: uma instância patológica no p99
    // derruba o marco de 10 Hz de todas as outras do mesmo processo.
    const metrics = new GameMetrics('n');
    for (const us of [10, 12, 15, 20_000]) metrics.observeTick('hunt', us, 0);

    const text = await scrape(metrics);
    // A faixa de 25 µs pega três das quatro; a quarta só aparece no `+Inf`.
    expect(text).toMatch(/draconya_tick_duration_us_bucket\{[^}]*le="25"[^}]*\} 3/);
    expect(text).toMatch(/draconya_tick_duration_us_count\{[^}]*\} 4/);
  });

  it('conta o tick que estourou o orçamento, separado do histograma', async () => {
    // O histograma responde "como está a distribuição"; o contador responde "isso já
    // aconteceu?", que é a pergunta de um alerta.
    const metrics = new GameMetrics('n');
    metrics.observeTick('hunt', 10, TICK_LAG_BUDGET_MS - 1);
    metrics.observeTick('hunt', 10, TICK_LAG_BUDGET_MS + 1);

    expect(await scrape(metrics))
      .toMatch(/draconya_tick_lag_budget_exceeded_total\{[^}]*type="hunt"[^}]*\} 1/);
  });

  it('a contagem de sessões ZERA o que sumiu, em vez de congelar o último valor', async () => {
    // Sem o reset, "as hunts pararam" aparece no painel como "as hunts continuam iguais" —
    // a leitura mais perigosa possível.
    const metrics = new GameMetrics('n');
    metrics.observeSessions(new Map([['hunt|true', 3], ['city|false', 1]]));
    metrics.observeSessions(new Map([['city|false', 1]]));

    const text = await scrape(metrics);
    expect(text).not.toMatch(/draconya_sessions_active\{[^}]*type="hunt"/);
    expect(text).toMatch(/draconya_sessions_active\{[^}]*type="city"[^}]*\} 1/);
  });

  it('não tem rótulo por personagem nem por sessão', async () => {
    // Milhares de valores de rótulo matam qualquer backend de métrica, e o custo aparece no
    // Prometheus — longe daqui, com quem paga sem ligar uma coisa à outra.
    const metrics = new GameMetrics('n');
    metrics.observeTick('hunt', 10, 0);
    metrics.observeSessions(new Map([['hunt|true', 1]]));
    metrics.observeFrame(2, 100);
    metrics.observeReattach(5);
    metrics.observeSlots(2);

    const text = await scrape(metrics);
    for (const forbidden of ['character_id', 'characterId', 'session_id', 'sessionId']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('conta mensagens e bytes depois do lote, que é o que saiu no fio', async () => {
    const metrics = new GameMetrics('n');
    metrics.observeFrame(3, 240);
    metrics.observeFrame(1, 40);

    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_messages_sent_total\{[^}]*\} 4/);
    expect(text).toMatch(/draconya_bytes_sent_total\{[^}]*\} 280/);
  });

  it('traz heap, event loop e GC de graça', async () => {
    // Depois da FUN-46, a pausa de GC é o número operacional que merece atenção: 100 ms a
    // 10 Hz é um tick perdido para todas as sessões anexadas ao mesmo tempo.
    expect(await scrape(new GameMetrics('n'))).toContain('nodejs_gc_duration_seconds');
  });
});
