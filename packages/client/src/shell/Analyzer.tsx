// A janela do analisador (§16.1, §16.2, FUN-83).
//
// **HUD em DOM, mundo em canvas** (`docs/technical-architecture.md` §13). Isto é texto e número,
// então é DOM — e nada aqui toca `world`.
//
// Duas telas, uma janela só. Durante a hunt ela mostra o que está rendendo; ao voltar de um
// período offline, mostra o mesmo mais a lista curta de eventos notáveis. É de propósito: são a
// mesma pergunta em dois momentos, e duas janelas divergiriam na terceira mudança.
//
// **Nada aqui pede `session-state`.** Os agregados chegam em `analyzer` quando mudam (FUN-110)
// e a janela lê a store; pedir em laço para atualizar um número seria tráfego de volta gerado
// por tráfego de entrada — o mesmo erro que o `walk` recusado em silêncio evita do outro lado.
//
// **A moldura é o design system (#258, DS-15).** A janela deixou de ser uma seção que a barra
// monta e desmonta e virou um `Panel dock` FIXO na coluna da direita, como `BotPanel`/
// `EquipmentPanel` já são desde #161/#162 (D6 — "Fixo... nunca removido"). Os números, que eram
// uma lista solta de linhas, viraram duas caixas — "Sessão" e "Por hora" — sobre `Box`/`Line`,
// inspiradas em `Sec`/`Rows` do handoff (`Hud.jsx`, `AnalyzerWindow`). A matemática (`perHour`,
// o "—" do campo opcional, o relógio local) não mudou uma linha.

import { useEffect, useState, type ReactNode } from 'react';
import { perHour } from '../state/hud.js';
import type { Aggregates, NotableEvent } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { describeEvent } from './event-text.js';
import type { EventNames } from './event-text.js';
import { Panel } from './ui/Panel.js';
import { Kicker } from './ui/Kicker.js';

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
 * O relógio local que faz o tempo de hunt andar entre duas entregas — `session-state` ou
 * `analyzer` (FUN-110), que recarimba o instante junto com os números.
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

/** Uma caixa com título mono (`Sec` do handoff — `Hud.jsx`, linha 188). */
function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="analyzer-box">
      <Kicker tone="muted">{title}</Kicker>
      {children}
    </section>
  );
}

/**
 * Uma linha rótulo/valor (`Line` do handoff — `Modals.jsx`, linha 3). Sem taxa embutida: a taxa
 * é a OUTRA caixa, nunca uma terceira coluna na mesma linha (diferença em relação ao `Row` de
 * antes desta task).
 */
function Line({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <p className={`analyzer-line${danger === true ? ' analyzer-line-danger' : ''}`}>
      <span>{label}</span><b>{value}</b>
    </p>
  );
}

function SessionBox({ aggregates, elapsedMs }: { aggregates: Aggregates; elapsedMs: number }) {
  const balance = aggregates.goldGained - aggregates.goldSpent;
  // "—" e não zero para o que o servidor NÃO mandou (FUN-78): zero é uma afirmação, e um nó
  // antigo em deploy em rolagem simplesmente não afirmou nada sobre estes campos.
  const optional = (value: number | undefined): string => (value === undefined ? '—' : count(value));
  // "gp" é a unidade de gold do handoff inteiro (data.js:72, analyzerLive.sess — R4-18).
  const gold = (value: number): string => `${count(value)} gp`;
  return (
    <Box title="Sessão">
      <Line label="Tempo" value={duration(elapsedMs)} />
      <Line label="XP" value={count(aggregates.xpGained)} />
      <Line label="Gold" value={gold(aggregates.goldGained)} />
      <Line label="Gastos" value={gold(aggregates.goldSpent)} />
      <Line label="Saldo" value={gold(balance)} />
      <Line label="Mortos" value={count(aggregates.kills)} />
      <Line label="Loot" value={optional(aggregates.itemsLooted)} />
      <Line label="Supplies" value={optional(aggregates.suppliesUsed)} />
      <Line label="Maior golpe" value={optional(aggregates.bestBasicHit)} />
      <Line label="Maior magia" value={optional(aggregates.bestSpellHit)} />
      {/* Só aparece com morte — "Mortes: 0" afirmaria o que ninguém disse. `danger`: inspirado
          no `color(c)` do handoff (`Hud.jsx`, `c === "red"`). */}
      {aggregates.deaths > 0 && <Line label="Mortes" value={count(aggregates.deaths)} danger />}
    </Box>
  );
}

function HourBox({ aggregates, elapsedMs }: { aggregates: Aggregates; elapsedMs: number }) {
  const balance = aggregates.goldGained - aggregates.goldSpent;
  const rate = (value: number): string => `${count(perHour(value, elapsedMs))}/h`;
  // Mesma unidade "gp" da caixa "Sessão" (R4-18); o "/h" continua depois dela, como no kit
  // ("Gold/h", "1.133.402 gp" — data.js:72, hour): a unidade vem antes da taxa, nunca depois.
  const goldRate = (value: number): string => `${count(perHour(value, elapsedMs))} gp/h`;
  // Só as cinco que já tinham taxa antes desta task. Loot, Supplies, Maior golpe, Maior magia e
  // Mortes nunca tiveram `rate()`, e continuam sem.
  return (
    <Box title="Por hora">
      <Line label="XP" value={rate(aggregates.xpGained)} />
      <Line label="Gold" value={goldRate(aggregates.goldGained)} />
      <Line label="Gastos" value={goldRate(aggregates.goldSpent)} />
      <Line label="Saldo" value={goldRate(balance)} />
      <Line label="Mortos" value={rate(aggregates.kills)} />
    </Box>
  );
}

/**
 * A lista de eventos notáveis, com os nomes do catálogo. Exportada para o teste: é aqui que o
 * id do evento vira nome, e um teste de `describeEvent` com um mapa montado à mão não prova
 * que ESTE mapa é montado (achado da revisão da FUN-113).
 */
export function Events({ events }: { events: readonly NotableEvent[] }) {
  // Os nomes de hunt e supply vêm do catálogo: o evento carrega o id, e o id é o que o
  // conteúdo fixou na sessão — a tradução para o nome é apresentação (FUN-110).
  const catalogue = useHudSlice((state) => state.catalogue);
  if (events.length === 0) return null;
  const names: EventNames = {
    hunts: new Map(catalogue?.hunts.map((hunt) => [hunt.id, hunt.name]) ?? []),
    supplies: new Map(catalogue?.bot.supplies.map((supply) => [supply.id, supply.name]) ?? []),
    monsters: new Map(catalogue?.monsters.map((monster) => [monster.id, monster.name]) ?? []),
    // O bônus por marco (FUN-113) só entra quando o catálogo o trouxe: a chave ausente é
    // "não sei", e `exactOptionalPropertyTypes` não deixa escrever `undefined` no lugar.
    ...(catalogue?.bestiary === undefined
      ? {}
      : { percentPerMilestone: catalogue.bestiary.xpBonusPercentPerMilestone }),
  };
  return (
    <ul className="analyzer-events">
      {/* Do mais recente para o mais antigo: a tela de retorno responde "o que aconteceu",
          e a resposta começa pelo fim. */}
      {[...events].reverse().slice(0, 12).map((event, index) => (
        <li key={`${event.atMs}-${event.type}-${String(index)}`}>
          <span className="analyzer-event-time">{duration(event.atMs)}</span>
          {describeEvent(event, names)}
        </li>
      ))}
    </ul>
  );
}

/**
 * O painel do analisador (#258). `collapsed`/`onToggle` como `BotPanel`/`EquipmentPanel`
 * (#161/#162): a barra do topo MINIMIZA, nunca desmonta (D6 — "Fixo... nunca removido").
 *
 * A exceção que continua: sem sessão, ou na Cidade, a função retorna `null` — não é "removido
 * pelo jogador" (o que D6 proíbe), é "não há sessão para analisar" (`analyzer.md`, "Ela não
 * aparece na Cidade: a praça não credita nada"). Mudar essa regra está fora do escopo (§12 da
 * spec da #258).
 */
export function Analyzer({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const analyzer = useHudSlice((state) => state.analyzer);

  // "Reabre sozinho ao encerrar" (comportamento de antes desta task) preservado como override
  // LOCAL por cima do `collapsed` externo: no instante em que `ended` vira `true`, força aberto
  // uma vez; depois disso quem manda de novo é a barra do topo de novo.
  const [forceOpen, setForceOpen] = useState(false);
  useEffect(() => {
    if (analyzer.ended) setForceOpen(true);
  }, [analyzer.ended]);
  const effectiveCollapsed = forceOpen ? false : collapsed;
  const handleToggle = (): void => {
    setForceOpen(false);
    onToggle?.();
  };

  const { aggregates } = analyzer;
  const elapsedMs = useElapsedMs(
    aggregates?.durationMs ?? 0, analyzer.receivedAtMs, !analyzer.ended && aggregates !== null,
  );

  // Sem sessão não há o que analisar. A Cidade também não: ela não credita nada (§37), e uma
  // janela de "0 XP, 0 gold" na praça é ruído com aparência de informação.
  if (aggregates === null || analyzer.sessionType === 'city') return null;

  // Aberta, o tempo já está na primeira linha da caixa "Sessão": repetir no cabeçalho é dizer o
  // mesmo número duas vezes na mesma janela. `exactOptionalPropertyTypes` não deixa passar
  // `undefined` explícito onde `meta` é opcional (mesmo padrão de `BotPanel.tsx`).
  const meta = analyzer.ended ? 'encerrada' : (effectiveCollapsed ? duration(elapsedMs) : undefined);
  const metaProps = meta === undefined ? {} : { meta };

  return (
    <Panel
      dock
      title="Analisador de caçada"
      className="analyzer"
      collapsed={effectiveCollapsed}
      onToggle={handleToggle}
      {...metaProps}
    >
      <SessionBox aggregates={aggregates} elapsedMs={elapsedMs} />
      <HourBox aggregates={aggregates} elapsedMs={elapsedMs} />
      <Events events={analyzer.notableEvents} />
    </Panel>
  );
}
