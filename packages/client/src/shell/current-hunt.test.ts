// packages/client/src/shell/current-hunt.test.ts
import { describe, expect, it } from 'vitest';
import { currentHunt, setCurrentHunt } from './current-hunt.js';

describe('currentHunt store (#325)', () => {
  it('sets and clears current hunt identity', () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    expect(currentHunt.get()).toEqual({ huntId: 'rat-cellars', difficulty: 'bold' });

    setCurrentHunt(null);
    expect(currentHunt.get()).toBeNull();
  });
});
