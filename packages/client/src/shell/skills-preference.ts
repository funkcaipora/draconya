// A preferência do painel Skills é exclusivamente de tela: não representa estado do personagem
// nem passa pelo servidor. Falhar ao ler ou gravar armazenamento nunca pode esconder o painel.

export const SKILL_ORDER = [
  'exp', 'level', 'hp', 'mana', 'capacity', 'speed', 'stamina', 'magic', 'melee', 'distance',
] as const;

export type SkillId = (typeof SKILL_ORDER)[number];

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

/** Lê só identificadores conhecidos; uma lista vazia é uma escolha válida do jogador. */
export function loadVisibleSkills(): readonly SkillId[] {
  try {
    if (typeof localStorage === 'undefined') return SKILL_ORDER;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return SKILL_ORDER;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return SKILL_ORDER;
    return parsed.filter(isSkillId);
  } catch {
    return SKILL_ORDER;
  }
}

/** A preferência é aplicada na hora; a persistência só ajuda a próxima abertura da tela. */
export function saveVisibleSkills(ids: readonly SkillId[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Armazenamento bloqueado, cota cheia ou privado: a sessão atual continua funcionando.
  }
}

/** Mostra stamina no relógio compacto que o painel Skills do Tibia usa. */
export function staminaClock(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return String(hours) + ':' + String(minutes).padStart(2, '0');
}
