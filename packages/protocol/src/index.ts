export * from './messages.js';
export * from './types.js';
export * from './codec.js';

/**
 * Versão do contrato. AINDA NÃO É NEGOCIADA: o handshake do socket é o ticket na query
 * string (FUN-12), que acontece antes de qualquer frame do protocolo, então a versão teria
 * de viajar ou na resposta do ticket ou no primeiro frame. Escolher entre as duas é decisão
 * do shell do cliente (FUN-24), que é quem vai ter de lidar com a recusa.
 */
export const PROTOCOL_VERSION = '0.2.0' as const;
