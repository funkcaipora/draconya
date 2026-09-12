import { useEffect } from 'react';
import { sendIntent } from '../net/current.js';
import { world } from '../state/world.js';
import { WalkKeys, directionOf, nextWalkDelay } from './walk-keys.js';

/** O foco está num campo de texto? Andar ali seria apagar o que o jogador digita. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Setas e WASD andam (FUN-122). A regra pura está em `walk-keys.ts`; isto é a casca: ouve a
 * JANELA — o canvas não tem foco —, ignora quem está digitando, e manda `walk` pela conexão
 * em curso (`sendIntent`, silencioso sem conexão, como todo botão).
 *
 * **A tecla presa repete no ritmo do passo, e a repetição é daqui.** Um `walk` sai no
 * `keydown`; o próximo sai quando o passo PRÓPRIO acabar — o `creature-move` do servidor,
 * lido do `world` no timer (ADR 0007: o `world` não avisa ninguém; quem quer saber, olha) —
 * ou, se nenhum passo chegou (parede à frente), 150 ms depois. É um `setTimeout` por passo,
 * não um `setInterval` cego: o intervalo é sempre o do último passo que o servidor de fato
 * deu. Soltar a tecla para no tile — o timer é cancelado, e o que já foi mandado termina.
 *
 * Perder o foco da janela solta tudo: o `keyup` de uma tecla presa durante um Alt+Tab nunca
 * chega, e sem isto o personagem andaria até a parede com ninguém segurando nada.
 */
export function useWalkKeys(): void {
  useEffect(() => {
    const keys = new WalkKeys();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sentAtMs = 0;

    const ownStep = () => (world.selfId === null ? null : world.creatures.get(world.selfId)?.step ?? null);
    const stop = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const send = (): void => {
      const direction = keys.active;
      if (direction === null) {
        stop();
        return;
      }
      sentAtMs = performance.now();
      sendIntent({ type: 'walk', direction });
      timer = setTimeout(tick, nextWalkDelay(sentAtMs, sentAtMs, null));
    };
    const tick = (): void => {
      timer = null;
      if (keys.active === null) return;
      // O passo próprio ainda está em curso: espera o que falta dele. Acabou, ou nunca veio:
      // é a vez do próximo.
      const delay = nextWalkDelay(performance.now(), sentAtMs, ownStep());
      if (delay > 1) {
        timer = setTimeout(tick, delay);
        return;
      }
      send();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (directionOf(event.code) === null) return;
      // A seta rolaria a página e o WASD nada faria; as duas coisas são "andar" aqui.
      event.preventDefault();
      if (event.repeat) return;
      const before = keys.active;
      const active = keys.press(event.code);
      // Direção nova (ou primeira): manda AGORA. Repetir a mesma tecla não muda o ritmo.
      if (active !== null && active !== before) {
        stop();
        send();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (directionOf(event.code) === null) return;
      const before = keys.active;
      const active = keys.release(event.code);
      if (active === null) {
        stop();
      } else if (active !== before) {
        // Voltou para a tecla que continua presa: o próximo passo já vai nessa direção.
        stop();
        send();
      }
    };
    const onBlur = (): void => {
      keys.clear();
      stop();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stop();
    };
  }, []);
}
