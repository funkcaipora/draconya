import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKILL_ORDER, loadVisibleSkills, saveVisibleSkills, staminaClock } from './skills-preference.js';

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

  it('keeps an explicit empty selection but removes unknown stored values', () => {
    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '[]' }));
    expect(loadVisibleSkills()).toEqual([]);

    vi.stubGlobal('localStorage', storageOf({ [STORAGE_KEY]: '["hp","unknown",7,"mana"]' }));
    expect(loadVisibleSkills()).toEqual(['hp', 'mana']);
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
