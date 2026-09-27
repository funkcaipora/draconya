import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SKILL_LABELS, SKILL_ORDER, loadVisibleSkills, saveVisibleSkills, staminaClock,
} from './skills-preference.js';

const STORAGE_KEY = 'draconya:shell:skillsPanel:visible';

function storageOf(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('skills preference', () => {
  it('has the thirteen kit rows, in the fixed order SV-10/#568 specifies', () => {
    expect(SKILL_ORDER).toEqual([
      'exp', 'level', 'hp', 'mana', 'capacity', 'speed', 'stamina', 'magic',
      'fist', 'club', 'sword', 'axe', 'distance',
    ]);
  });

  it('labels the rows SV-10/#568 add with the kit\'s classic terms', () => {
    expect(SKILL_LABELS.speed).toBe('Speed');
    expect(SKILL_LABELS.magic).toBe('Magic Level');
    expect(SKILL_LABELS.fist).toBe('Punho');
    expect(SKILL_LABELS.club).toBe('Maça');
    expect(SKILL_LABELS.sword).toBe('Espada');
    expect(SKILL_LABELS.axe).toBe('Machado');
    expect(SKILL_LABELS.distance).toBe('Distância');
  });

  it('uses every skill by default when storage is unavailable or absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadVisibleSkills()).toEqual(SKILL_ORDER);

    vi.stubGlobal('localStorage', storageOf());
    expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
  });

  it('round-trips the selected ids without changing their saved order', () => {
    const storage = storageOf();
    vi.stubGlobal('localStorage', storage);

    saveVisibleSkills(['mana', 'exp']);

    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '["mana","exp"]');
    expect(loadVisibleSkills()).toEqual(['mana', 'exp']);
  });

  it('round-trips the ids SV-10/#568 add, same as any other id', () => {
    const storage = storageOf();
    vi.stubGlobal('localStorage', storage);

    saveVisibleSkills(['speed', 'magic', 'fist', 'club', 'sword', 'axe', 'distance']);

    expect(storage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY, '["speed","magic","fist","club","sword","axe","distance"]',
    );
    expect(loadVisibleSkills()).toEqual(['speed', 'magic', 'fist', 'club', 'sword', 'axe', 'distance']);
  });

  it('keeps an explicit empty selection but removes unknown stored values', () => {
    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '[]' }));
    expect(loadVisibleSkills()).toEqual([]);

    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '["hp","unknown",7,"mana"]' }));
    expect(loadVisibleSkills()).toEqual(['hp', 'mana']);
  });

  it('loads a pre-SV-10 six-id selection as-is, without injecting the new rows', () => {
    // Quem salvou a preferência antes desta issue tinha só as seis linhas antigas; o filtro por
    // id conhecido não pode inventar "speed"/"magic"/"fist"/"club"/"sword"/"axe"/"distance" que a
    // pessoa não marcou.
    const legacySelection = ['exp', 'level', 'hp', 'mana', 'capacity', 'stamina'];
    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: JSON.stringify(legacySelection) }));
    expect(loadVisibleSkills()).toEqual(legacySelection);
  });

  it('drops a pre-#568 "melee" id as unknown, without crashing or reviving the old row', () => {
    // #568: quem salvou a preferência ANTES desta issue podia ter "melee" marcado — a skill não
    // existe mais em SKILL_ORDER, e o filtro por id conhecido a descarta como qualquer id
    // desconhecido (RF-06), sem lançar exceção.
    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '["hp","melee","distance"]' }));
    expect(loadVisibleSkills()).toEqual(['hp', 'distance']);
  });

  it('falls back to every skill when storage is malformed, non-list, or throws', () => {
    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '{not json' }));
    expect(loadVisibleSkills()).toEqual(SKILL_ORDER);

    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '"hp"' }));
    expect(loadVisibleSkills()).toEqual(SKILL_ORDER);

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    });
    expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
    expect(() => { saveVisibleSkills(['hp']); }).not.toThrow();
  });

  it('formats stamina as a compact hours and minutes clock', () => {
    expect(staminaClock(0)).toBe('0:00');
    expect(staminaClock(151_200_000)).toBe('42:00');
    expect(staminaClock(5_460_000)).toBe('1:31');
  });
});
