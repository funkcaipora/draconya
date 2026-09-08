import { describe, expect, it } from 'vitest';
import { createCitySessionFactory } from './sessions.js';

describe('city session factory', () => {
  it('starts from progress carried by the authenticated ticket', () => {
    const session = createCitySessionFactory('v-test')('p1', { level: 17, xp: 93_000 });

    expect(session.participants[0]?.level).toBe(17);
    expect(session.participants[0]?.xp).toBe(93_000);
  });

  it('uses new-character progress for a legacy claim without initialization', () => {
    const session = createCitySessionFactory('v-test')('p1');

    expect(session.participants[0]?.level).toBe(1);
    expect(session.participants[0]?.xp).toBe(0);
  });
});
