export * from './mensagens.js';
export * from './tipos.js';
export * from './codec.js';

/** Versão do protocolo. O `authenticate` a envia; o servidor recusa incompatível. */
export const VERSAO_DO_PROTOCOLO = '0.1.0' as const;
