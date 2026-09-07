export * from './messages.js';
export * from './types.js';
export * from './codec.js';

/** Versão do contrato. A negociação no handshake será integrada ao WebSocket na FUN-13. */
export const PROTOCOL_VERSION = '0.2.0' as const;
