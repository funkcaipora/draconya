import { describe, expect, it } from 'vitest';
import { createLogger } from './log.js';

describe('createLogger', () => {
  it('names the process roles apart from the emitting role', () => {
    // Cada papel loga por um filho com `role`. Se a base do logger raiz também se chamasse
    // `role`, o pino serializaria a chave duas vezes na mesma linha — e qual valor sobrevive
    // depende do parser, justamente no campo pelo qual se filtra log por papel.
    const root = createLogger('info', 'api+game+jobs');

    expect(root.bindings()).toEqual({ processes: 'api+game+jobs' });
    expect(root.child({ role: 'api' }).bindings()).toEqual({
      processes: 'api+game+jobs',
      role: 'api',
    });
  });
});
