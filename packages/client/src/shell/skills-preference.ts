// Preferência de visibilidade das linhas do painel Skills (RC-04, #317, kit v3
// Modals.jsx:295-301). É a primeira leitura/escrita de `localStorage` no cliente inteiro — a
// convenção e a guarda de falha ficam neste módulo, separadas do componente, pelo mesmo motivo
// que `bestiary-progress.ts` separa conta pura de tela: dá para testar sem montar React, e sem
// mockar `localStorage` dentro de um teste de renderização.
//
// Preferência de TELA, não estado de jogo (ADR 0030 decisão 5 / docs/design-system-plan.md:363
// "é conveniência de tela, não estado de jogo"): nunca passa pelo servidor, nunca pelo ledger,
// nunca é lida de volta por outro personagem ou por outra aba.

export const SKILL_ORDER = [
  'exp', 'level', 'hp', 'mana', 'capacity', 'speed', 'stamina', 'magic', 'melee', 'distance',
] as const;

export type SkillId = (typeof SKILL_ORDER)[number];

/** Rótulos idênticos ao kit (data.js:18) — "Hit Points"/"Mana"/"Speed"/"Magic Level" ficam em
 *  inglês de propósito, como no kit: são os termos clássicos do gênero, não tradução esquecida. */
export const SKILL_LABELS: Record<SkillId, string> = {
  exp: 'Experiência total',
  level: 'Level',
  hp: 'Hit Points',
  mana: 'Mana',
  capacity: 'Capacidade',
  speed: 'Speed',
  stamina: 'Stamina',
  magic: 'Magic Level',
  melee: 'Corpo a Corpo',
  distance: 'Distância',
};

const STORAGE_KEY = 'draconya:shell:skillsPanel:visible';

function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && (SKILL_ORDER as readonly string[]).includes(value);
}

/**
 * Lê a preferência salva. `typeof localStorage === 'undefined'` NUNCA lança — é o ambiente real
 * de `pnpm vitest run packages/client` (`vitest.config.ts`: `environment: 'node'`, sem
 * `jsdom`), não um caso raro de navegador. `localStorage.getItem` PODE lançar (aba anônima,
 * cota estourada, armazenamento bloqueado — a mesma classe de falha que
 * `packages/client/CLAUDE.md` já documenta para o cache de assets: "Falha do cache NUNCA é
 * falha do jogo"). Os dois casos caem no mesmo default: TODAS as dez linhas — nunca um painel
 * vazio na primeira visita.
 */
export function loadVisibleSkills(): readonly SkillId[] {
  try {
    if (typeof localStorage === 'undefined') return SKILL_ORDER;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return SKILL_ORDER;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return SKILL_ORDER;
    // ids desconhecidos (versão antiga, campo removido) são descartados; um array válido mas
    // VAZIO é preservado como está — é a escolha legítima de quem desmarcou tudo e salvou.
    return parsed.filter(isSkillId);
  } catch {
    return SKILL_ORDER;
  }
}

/** Grava a preferência. Falha de armazenamento é engolida — nunca é falha do jogo. */
export function saveVisibleSkills(ids: readonly SkillId[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Aba anônima, cota estourada: degrada para "não persiste nesta sessão", nunca quebra a tela.
  }
}

/**
 * `HH:MM`, o formato do kit para Stamina (data.js:18 — "41:40"; o Tibia mede stamina até
 * 42:00, e "41:40" é plausível dentro desse teto). Formato PRÓPRIO: a `duration()` de
 * `CharacterPanel.tsx` ("X h Y min") não serve — o kit não escreve unidade nenhuma aqui, só os
 * dois-pontos.
 */
export function staminaClock(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}
