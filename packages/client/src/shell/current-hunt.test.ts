import { beforeEach, describe, expect, it } from 'vitest';
import { currentHunt, setCurrentHunt } from './current-hunt.js';

describe('currentHunt', () => {
  beforeEach(() => {
    setCurrentHunt(null);
  });

  it('remembers the successful local enter intent and clears it on exit', () => {
    const next = { huntId: 'rat-cellars', difficulty: 'bold' };
    setCurrentHunt(next);
    expect(currentHunt.get()).toEqual(next);

    setCurrentHunt(null);
    expect(currentHunt.get()).toBeNull();
  });
});
