// As funções de formatação do Analisador, extraídas de Analyzer.tsx (FUN-83, #258) para serem
// compartilhadas com o AnalyzerModal (#315, R8-25): a janela e o modal mostram os MESMOS campos
// de `Aggregates` sob a MESMA regra de unidade — duplicar `gold()`/`rate()` nos dois arquivos
// faria "gp" divergir de um lado para o outro no primeiro ajuste feito só num deles.
//
// Puro: nenhuma função aqui lê estado, socket ou DOM — só formata o número que já chegou.

import { perHour } from '../state/hud.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** `1.234` — número inteiro com separador, que é como um jogador lê gold e XP. */
export function count(value: number): string {
  return integer.format(Math.round(value));
}

/** `2 h 13 min`. Segundos só aparecem no primeiro minuto, senão a linha pisca sem informar. */
export function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.floor(ms / 1_000)} s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/**
 * `00:04:13` — o formato do cabeçalho da janela (kit: `analyzerLive.session`, `Hud.jsx:183`).
 * Sempre com hora, minuto e segundo com dois dígitos, mesmo em sessões curtas ou longas: é um
 * relógio, não uma frase — ao contrário de `duration()`, que É uma frase e vive nas caixas.
 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** "—" para o que o servidor NÃO mandou (FUN-78) — zero é uma afirmação que ninguém fez. */
export function optionalCount(value: number | undefined): string {
  return value === undefined ? '—' : count(value);
}

/** "gp" é a unidade de gold do handoff inteiro (data.js:72, analyzerLive.sess — R4-18/#312). */
export function gold(value: number): string {
  return `${count(value)} gp`;
}

/** `perHour` já existe em `state/hud.ts` — reexportado em forma de string pronta pra `<Line>`. */
export function rate(value: number, elapsedMs: number): string {
  return `${count(perHour(value, elapsedMs))}/h`;
}

/** Mesma unidade "gp" de `gold()`, com o "/h" DEPOIS dela (R4-18/#312, DT-01 da spec da #312). */
export function goldRate(value: number, elapsedMs: number): string {
  return `${count(perHour(value, elapsedMs))} gp/h`;
}
