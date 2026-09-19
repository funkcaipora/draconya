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
// **A moldura é a janela flutuante (#315, RC-02).** O Analisador deixou de ser `Panel dock` da
// coluna direita e virou uma `FloatingWindow` sobre o mundo (ADR 0030 decisão 3), aberta e
// fechada pelo ícone "Analisador" do topo — o × FECHA de verdade (desmonta), porque janela
// flutuante não minimiza. Os números continuam nas duas caixas — "Sessão" e "Por hora" — sobre
// `Box`/`Line`, e o botão "⤢ Abrir completo" abre o `AnalyzerModal` com as dez linhas do kit.

import { useEffect, useState, type ReactNode } from 'react';
import type { Aggregates, NotableEvent, PartySpendingView, PartySummary } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { describeEvent } from './event-text.js';
import type { EventNames } from './event-text.js';
import { FloatingWindow } from './FloatingWindow.js';
import { IconButton } from './ui/IconButton.js';
import { Kicker } from './ui/Kicker.js';
import { xpBonusLabel, xpMultiplierLabel } from './party-loot-format.js';
import { AnalyzerModal } from './AnalyzerModal.js';
import {
  count, duration, formatClock, gold, goldRate, optionalCount, rate as ratePerHour,
} from './analyzer-format.js';

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
export function useElapsedMs(base: number, since: number, running: boolean): number {
  // `performance.now()`, e não `Date.now()`: `since` é o `receivedAtMs` que `applyMessage`
  // carimba com o relógio monotônico. Subtrair dele o relógio de calendário mostrava
  // "496968 h" — a época Unix em horas — na primeira vez que a janela abriu.
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { setNow(performance.now()); }, 1_000);
    return () => { clearInterval(timer); };
  }, [running]);
  if (!running || since <= 0) return base;
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
  return (
    <Box title="Sessão">
      <Line label="Tempo" value={duration(elapsedMs)} />
      <Line label="XP" value={count(aggregates.xpGained)} />
      <Line label="Gold" value={gold(aggregates.goldGained)} />
      <Line label="Gastos" value={gold(aggregates.goldSpent)} />
      <Line label="Saldo" value={gold(balance)} />
      <Line label="Mortos" value={count(aggregates.kills)} />
      <Line label="Loot" value={optionalCount(aggregates.itemsLooted)} />
      <Line label="Supplies" value={optionalCount(aggregates.suppliesUsed)} />
      <Line label="Maior golpe" value={optionalCount(aggregates.bestBasicHit)} />
      <Line label="Maior magia" value={optionalCount(aggregates.bestSpellHit)} />
      {/* Só aparece com morte — "Mortes: 0" afirmaria o que ninguém disse. `danger`: inspirado
          no `color(c)` do handoff (`Hud.jsx`, `c === "red"`). */}
      {aggregates.deaths > 0 && <Line label="Mortes" value={count(aggregates.deaths)} danger />}
    </Box>
  );
}

function HourBox({ aggregates, elapsedMs }: { aggregates: Aggregates; elapsedMs: number }) {
  const balance = aggregates.goldGained - aggregates.goldSpent;
  // Só as cinco que já tinham taxa. Loot, Supplies, Maior golpe, Maior magia e Mortes nunca
  // tiveram `rate()`, e continuam sem.
  return (
    <Box title="Por hora">
      <Line label="XP" value={ratePerHour(aggregates.xpGained, elapsedMs)} />
      <Line label="Gold" value={goldRate(aggregates.goldGained, elapsedMs)} />
      <Line label="Gastos" value={goldRate(aggregates.goldSpent, elapsedMs)} />
      <Line label="Saldo" value={goldRate(balance, elapsedMs)} />
      <Line label="Mortos" value={ratePerHour(aggregates.kills, elapsedMs)} />
    </Box>
  );
}

/**
 * A seção PARTY do analisador (§32, ADR 0033 d.11). Só monta com `analyzer.party` — ausência é
 * solo, ou nó `game` anterior ao #400, nunca "0 jogadores" (D8).
 *
 * "Sua XP" é o agregado do VIEWER (`aggregates.xpGained`), que o host manda por personagem; "Sua
 * parte" é `party-spending.estimatedShare` (DT-03), que já existia e era descartado — duplicá-lo
 * em `analyzer.party` faria as duas mensagens divergirem na primeira que atualizasse só uma.
 */
function PartyBox({ summary, aggregates, spending, me }: {
  summary: PartySummary; aggregates: Aggregates;
  spending: PartySpendingView | null; me: string | null;
}) {
  const mine = spending?.shares.find((share) => share.characterId === me);
  return (
    <Box title="Party">
      <Line label="Jogadores" value={count(summary.players)} />
      <Line label="Vocações únicas" value={count(summary.uniqueVocations)} />
      <Line label="Bônus de XP" value={xpBonusLabel(summary.xpPercent)} />
      <Line label="Multiplicador" value={xpMultiplierLabel(summary.xpPercent)} />
      <Line label="XP total" value={count(summary.totalXp)} />
      <Line label="Sua XP" value={count(aggregates.xpGained)} />
      <Line label="Rateio" value={summary.shareCosts ? 'Ativo' : 'Inativo'} />
      <Line label="Supplies totais" value={gold(summary.totalSupplies)} />
      {mine?.estimatedShare !== undefined && (
        <Line label="Sua parte" value={gold(mine.estimatedShare)} />
      )}
      <Line label="Divisão de lucro" value={summary.splitLoot ? 'Ativa' : 'Inativa'} />
      <Line label="Valor da bolsa" value={gold(summary.bagValue)} />
      <Line label="Peso da bolsa" value={`${summary.bagWeight.toLocaleString('pt-BR')} oz`} />
      <Line
        label="Venda automática"
        value={`${String(summary.autoSell.used)} / ${String(summary.autoSell.limit)}`}
      />
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
 * A janela flutuante do Analisador (#315, R4-14 — ADR 0030 decisão 3 reabre D6 do ADR 0029 só
 * para esta janela e a Party loot). `open` deixou de ser "não colapsado": agora é "montado". O
 * × FECHA de verdade (desmonta), porque uma janela flutuante que fecha não deixa cabeçalho para
 * trás — ao contrário do `Panel dock` de antes, que minimizava e mantinha a barra.
 *
 * `forceOpen` sobrevive da versão anterior: ao terminar a hunt (`analyzer.ended`), a janela
 * reabre sozinha mesmo se o jogador a tinha fechado.
 *
 * Sem sessão, ou na Cidade, a função retorna `null` — não é "removido pelo jogador", é "não há
 * sessão para analisar" (`analyzer.md`, "Ela não aparece na Cidade: a praça não credita nada").
 */
export function Analyzer({ open = false, onToggle }: { open?: boolean; onToggle?: () => void }) {
  const analyzer = useHudSlice((state) => state.analyzer);
  const partySpending = useHudSlice((state) => state.partySpending);
  const me = useHudSlice((state) => state.characterId);

  const [forceOpen, setForceOpen] = useState(false);
  useEffect(() => {
    if (analyzer.ended) setForceOpen(true);
  }, [analyzer.ended]);
  const isOpen = forceOpen || open;
  const handleClose = (): void => {
    setForceOpen(false);
    onToggle?.();
  };

  const [expandedOpen, setExpandedOpen] = useState(false);

  const { aggregates } = analyzer;
  const elapsedMs = useElapsedMs(
    aggregates?.durationMs ?? 0, analyzer.receivedAtMs, !analyzer.ended && aggregates !== null,
  );

  // Sem sessão, na Cidade, ou fechada: nada para desenhar. A ordem importa — testar `isOpen`
  // ANTES do `aggregates` trocaria "sem sessão" por "fechada" no teste de HTML vazio.
  if (aggregates === null || analyzer.sessionType === 'city' || !isOpen) return null;

  return (
    <FloatingWindow
      name="analyzer"
      className="ui-floating-window--analyzer"
      title="Analisador de caçada"
      // "Sessão" + relógio hh:mm:ss no cabeçalho (kit: Hud.jsx:190) — a segunda coluna do kit
      // ("Próximo level") fica de fora (RF-05): a curva de XP não trafega.
      meta={`Sessão ${formatClock(elapsedMs)}`}
      // (250, 12) é a coordenada do kit RELATIVA AO MUNDO, que no kit começa abaixo do topo de
      // 65px. No nosso Shell, `.shell` é tela cheia (inclusive por trás do topo), então a MESMA
      // posição visual exige somar a altura do topo: 12 + 65 = 77 (DT-02).
      initial={{ x: 250, y: 77 }}
      width={380}
      onClose={handleClose}
      actions={<IconButton title="Abrir completo" onClick={() => { setExpandedOpen(true); }}>⤢</IconButton>}
    >
      <SessionBox aggregates={aggregates} elapsedMs={elapsedMs} />
      <HourBox aggregates={aggregates} elapsedMs={elapsedMs} />
      {/* A caixa PARTY só existe com `analyzer.party` (solo, ou nó anterior, não a monta). */}
      {analyzer.party !== undefined && (
        <PartyBox
          summary={analyzer.party}
          aggregates={aggregates}
          spending={partySpending}
          me={me}
        />
      )}
      <Events events={analyzer.notableEvents} />
      <AnalyzerModal
        open={expandedOpen}
        onClose={() => { setExpandedOpen(false); }}
        aggregates={aggregates}
        elapsedMs={elapsedMs}
      />
    </FloatingWindow>
  );
}
