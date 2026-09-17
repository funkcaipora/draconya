import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SKILL_ORDER,
  loadVisibleSkills,
  saveVisibleSkills,
  staminaClock,
} from './skills-preference.js';

describe('skills-preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('SKILL_ORDER', () => {
    it('has 10 entries in exact specified order', () => {
      expect(SKILL_ORDER).toEqual([
        'exp', 'level', 'hp', 'mana', 'capacity', 'speed', 'stamina', 'magic', 'melee', 'distance',
      ]);
      expect(SKILL_ORDER).toHaveLength(10);
    });
  });

  describe('staminaClock', () => {
    it('formats stamina in HH:MM clock format without units', () => {
      // 0 ms -> '0:00'
      expect(staminaClock(0)).toBe('0:00');
      // 1 min (60_000 ms) -> '0:01'
      expect(staminaClock(60_000)).toBe('0:01');
      // 1 h (3_600_000 ms) -> '1:00'
      expect(staminaClock(3_600_000)).toBe('1:00');
      // 41 h 40 min (150_000_000 ms = 2500 min, o valor "41:40" do kit data.js:18) -> '41:40'
      expect(staminaClock(150_000_000)).toBe('41:40');
      // 42 h (151_200_000 ms, teto do Tibia) -> '42:00'
      expect(staminaClock(151_200_000)).toBe('42:00');
    });
  });

  describe('loadVisibleSkills', () => {
    it('returns 6 legacy saved ids without automatically injecting the 4 new ones', () => {
      const legacyIds = ['exp', 'level', 'hp', 'mana', 'capacity', 'stamina'];
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(JSON.stringify(legacyIds)),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual(legacyIds);
    });
    it('returns SKILL_ORDER when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
    });

    it('returns SKILL_ORDER when storage key is not set (null)', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
    });

    it('preserves an empty array when user deselected all skills', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue('[]'),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual([]);
    });

    it('returns SKILL_ORDER when stored JSON is malformed', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue('{"invalid_json'),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
    });

    it('returns SKILL_ORDER when stored JSON is not an array', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue('{"exp": true}'),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
    });

    it('filters out unknown ids and keeps valid skill ids', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(JSON.stringify(['hp', 'unknown_skill', 'mana', 123])),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual(['hp', 'mana']);
    });

    it('returns SKILL_ORDER when getItem throws', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => {
          throw new Error('Access denied');
        }),
        setItem: vi.fn(),
      });
      expect(loadVisibleSkills()).toEqual(SKILL_ORDER);
    });
  });

  describe('saveVisibleSkills', () => {
    it('saves visible skills and allows round-trip loading', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value);
        }),
      });

      saveVisibleSkills(['hp', 'mana', 'level']);
      expect(loadVisibleSkills()).toEqual(['hp', 'mana', 'level']);
    });

    it('does not throw when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => {
        saveVisibleSkills(['hp']);
      }).not.toThrow();
    });

    it('does not throw when setItem throws (quota exceeded / private mode)', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(),
        setItem: vi.fn(() => {
          throw new Error('QuotaExceededError');
        }),
      });
      expect(() => {
        saveVisibleSkills(['hp']);
      }).not.toThrow();
    });
  });
});
