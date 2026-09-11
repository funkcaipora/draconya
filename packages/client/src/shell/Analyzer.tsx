// A janela do analisador (§16.1, §16.2, FUN-83).
//
// **HUD em DOM, mundo em canvas** (`docs/technical-architecture.md` §13). Isto é texto e número,
// então é DOM — e nada aqui toca `world`.
//
// Duas telas, uma janela só. Durante a hunt ela mostra o que está rendendo; ao voltar de um
// período offline, mostra o mesmo mais a lista curta de eventos notáveis. É de propósito: são a
// mesma pergunta em dois momentos, e duas janelas divergiriam na terceira mudança.
//
// **Nada aqui pede `session-state`.** Os agregados chegam pelo lote do ciclo e a janela lê a
// store; pedir em laço para atualizar um número seria tráfego de volta gerado por tráfego de
// entrada — o mesmo erro que o `walk` recusado em silêncio evita do outro lado.

import { useEffect, useState } from 'react';
import { perHour } from '../state/hud.js';
import type { Aggregates, NotableEvent } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';

/** Como cada tipo de evento notável aparece para o jogador. */
const EVENT_TEXT: Record<string, string> = {
  'entered-city': 'Voltou para a cidade',
  death: 'Morreu',
  ended: 'Sessão encerrada',
  'stamina-exhausted': 'Stamina esgotada',
  'level-up': 'Subiu de level',
  'backpack-full': 'Mochila cheia',
  'out-of-gold': 'Gold acabou',
  'ring-equipped': 'Equipou o anel',
  'ring-removed': 'Tirou o anel',
};

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** `1.234` — número inteiro com separador, que é como um jogador lê gold e XP. */
const count = (value: number): string => integer.format(Math.round(value));

/** `2 h 13 min`. Segundos só aparecem no primeiro minuto, senão a linha pisca sem informar. */
function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.floor(ms / 1_000)} s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/**
 * O relógio local que faz o tempo de hunt andar entre dois `session-state`.
 *
 * **Só o TEMPO anda.** XP, gold e abates são sempre o último número que o servidor mandou —
 * extrapolar qualquer um deles mostraria progresso que talvez não tenha acontecido, e o jogador
 * veria o valor ANDAR PARA TRÁS na atualização seguinte.
 *
 * Consequência assumida: entre duas atualizações o "por hora" cai devagar, porque o numerador
 * está parado e o denominador anda. É o lado certo para errar — melhor uma taxa levemente
 * pessimista que se corrige do que uma otimista inventada aqui.
 */
function useElapsedMs(base: number, since: number, running: boolean): number {
  // `performance.now()`, e não `Date.now()`: `since` é o `receivedAtMs` que `applyMessage`
  // carimba com o relógio monotônico. Subtrair dele o relógio de calendário mostrava
  // "496968 h" — a época Unix em horas — na primeira vez que a janela abriu.
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { setNow(performance.now()); }, 1_000);
    return () => { clearInterval(timer); };
  }, [running]);
  if (!running) return base;
  return base + Math.max(0, now - since);
}

function Row({ label, value, rate }: {
  label: string; value: string; rate?: string;
}) {
  return (
    <div className="analyzer-row">
      <span className="analyzer-label">{label}</span>
      <span className="analyzer-value">{value}</span>
      {rate !== undefined && <span className="analyzer-rate">{rate}</span>}
    </div>
  );
}

function Numbers({ aggregates, elapsedMs }: {
  aggregates: Aggregates; elapsedMs: number;
}) {
  const balance = aggregates.goldGained - aggregates.goldSpent;
  // `—` e não zero para o que o servidor NÃO mandou (FUN-78): zero é uma afirmação, e um nó
  // antigo em deploy em rolagem simplesmente não afirmou nada sobre estes campos.
  const optional = (value: number | undefined): string => (
    value === undefined ? '—' : count(value)
  );
  const rate = (value: number): string => `${count(perHour(value, elapsedMs))}/h`;

  return (
    <div className="analyzer-numbers">
      <Row label="Tempo" value={duration(elapsedMs)} />
      <Row label="XP" value={count(aggregates.xpGained)} rate={rate(aggregates.xpGained)} />
      <Row label="Gold" value={count(aggregates.goldGained)} rate={rate(aggregates.goldGained)} />
      <Row label="Gastos" value={count(aggregates.goldSpent)} rate={rate(aggregates.goldSpent)} />
      <Row label="Saldo" value={count(balance)} rate={rate(balance)} />
      <Row label="Mortos" value={count(aggregates.kills)} rate={rate(aggregates.kills)} />
      <Row label="Loot" value={optional(aggregates.itemsLooted)} />
      <Row label="Supplies" value={optional(aggregates.suppliesUsed)} />
      <Row label="Maior golpe" value={optional(aggregates.bestBasicHit)} />
      <Row label="Maior magia" value={optional(aggregates.bestSpellHit)} />
      {aggregates.deaths > 0 && <Row label="Mortes" value={count(aggregates.deaths)} />}
    </div>
  );
}

function Events({ events }: { events: readonly NotableEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="analyzer-events">
      {/* Do mais recente para o mais antigo: a tela de retorno responde "o que aconteceu",
          e a resposta começa pelo fim. */}
      {[...events].reverse().slice(0, 12).map((event, index) => (
        <li key={`${event.atMs}-${event.type}-${String(index)}`}>
          <span className="analyzer-event-time">{duration(event.atMs)}</span>
          {EVENT_TEXT[event.type] ?? event.type}
          {event.detail !== undefined && event.detail !== '' && ` · ${event.detail}`}
        </li>
      ))}
    </ul>
  );
}

export function Analyzer() {
  const analyzer = useHudSlice((state) => state.analyzer);
  // **Minimizada por padrão** (§16.1): a janela existe durante a hunt inteira, e uma hunt idle
  // não precisa dela aberta ocupando a tela. Ao encerrar, ela abre sozinha — aí o extrato é a
  // notícia, e escondê-lo seria a sessão sumir em silêncio.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (analyzer.ended) setOpen(true);
  }, [analyzer.ended]);

  const { aggregates } = analyzer;
  const elapsedMs = useElapsedMs(
    aggregates?.durationMs ?? 0, analyzer.receivedAtMs, !analyzer.ended && aggregates !== null,
  );

  // Sem sessão não há o que analisar. A Cidade também não: ela não credita nada (§37), e uma
  // janela de "0 XP, 0 gold" na praça é ruído com aparência de informação.
  if (aggregates === null || analyzer.sessionType === 'city') return null;

  return (
    <section className={`analyzer${open ? '' : ' analyzer-minimized'}`} aria-label="analisador">
      <header className="analyzer-head">
        <button
          type="button"
          className="analyzer-toggle"
          aria-expanded={open}
          onClick={() => { setOpen((value) => !value); }}
        >
          {open ? '▾' : '▸'} Analisador
        </button>
        {/* Aberta, o tempo já está na primeira linha do corpo: repetir no cabeçalho é dizer
            o mesmo número duas vezes na mesma janela. */}
        <span className="analyzer-summary">
          {analyzer.ended ? 'encerrada' : (open ? '' : duration(elapsedMs))}
        </span>
      </header>
      {open && (
        <div className="analyzer-body">
          <Numbers aggregates={aggregates} elapsedMs={elapsedMs} />
          <Events events={analyzer.notableEvents} />
        </div>
      )}
    </section>
  );
}
