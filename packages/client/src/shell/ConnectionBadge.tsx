import { useHudSlice } from '../state/useSlice.js';

const LABEL = {
  idle: 'desconectado',
  connecting: 'conectando',
  connected: 'conectado',
  reconnecting: 'reconectando',
  failed: 'falhou',
} as const;

/**
 * O estado da conexão precisa estar na tela, sobre o mundo desde a RC-13.
 *
 * Um jogo idle silencioso é indistinguível de um jogo travado: sem isto, o jogador não tem
 * como saber se a hunt está rendendo ou se o socket caiu há dez minutos.
 */
export function ConnectionBadge() {
  const connection = useHudSlice((state) => state.connection);
  // A latência muda a cada pong; com throttle, uma casa de milissegundo não vira render.
  const latencyMs = useHudSlice((state) => state.latencyMs, { throttleMs: 1_000 });

  return (
    <span className="world-status-connection" role="status">
      <i className={'world-status-dot world-status-dot-' + connection} aria-hidden="true" />
      {LABEL[connection]}
      {connection === 'connected' && latencyMs !== null
        ? ' · ' + String(Math.round(latencyMs)) + ' ms'
        : ''}
    </span>
  );
}
