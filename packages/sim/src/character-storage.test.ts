import { describe, expect, it } from 'vitest';
import {
  UNSET_STORAGE_VALUE, isCharacterStorageMap, readCharacterStorage,
} from './character-storage.js';

describe('isCharacterStorageMap', () => {
  it('accepts an empty map', () => {
    expect(isCharacterStorageMap({})).toBe(true);
  });

  it('accepts integer values, including zero and negative numbers other than -1', () => {
    expect(isCharacterStorageMap({ 'quest:rat-cellars': 0, 'quest:step': -5 })).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(isCharacterStorageMap(null)).toBe(false);
    expect(isCharacterStorageMap('nope')).toBe(false);
    expect(isCharacterStorageMap([1, 2])).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(isCharacterStorageMap({ '': 1 })).toBe(false);
  });

  it('rejects a non-integer value', () => {
    expect(isCharacterStorageMap({ key: 1.5 })).toBe(false);
    expect(isCharacterStorageMap({ key: Number.NaN })).toBe(false);
    expect(isCharacterStorageMap({ key: '1' })).toBe(false);
  });

  it('rejects the unset sentinel as a stored value', () => {
    expect(isCharacterStorageMap({ key: UNSET_STORAGE_VALUE })).toBe(false);
  });
});

describe('readCharacterStorage', () => {
  it('reads a clean map as-is', () => {
    expect(readCharacterStorage({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('drops crooked entries instead of failing the whole read', () => {
    expect(readCharacterStorage({
      good: 3,
      empty: '',
      bad: 'nope',
      unset: UNSET_STORAGE_VALUE,
      '': 9,
    })).toEqual({ good: 3 });
  });

  it('returns undefined for a non-object, and for a map with nothing left after cleaning', () => {
    expect(readCharacterStorage(null)).toBeUndefined();
    expect(readCharacterStorage([1, 2])).toBeUndefined();
    expect(readCharacterStorage({ bad: 'nope' })).toBeUndefined();
    expect(readCharacterStorage({})).toBeUndefined();
  });
});
