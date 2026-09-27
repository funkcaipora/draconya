import { useEffect } from 'react';
import { sendIntent } from '../net/current.js';
import { aimTracker } from '../state/aim.js';
import { bot } from '../bot/store.js';
import { slotForHotkey } from './action-bar.js';

/** O foco está num campo de texto? Disparar ali seria apagar o que o jogador digita. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * A tecla de um slot dispara `use-slot` (AB-10, ADR 0032 d.3; Shift+dígito/F, ADR 0049 decisão
 * 1). A regra pura está em `action-bar.ts`; isto é a casca no molde de `useWalkKeys`: ouve a
 * JANELA — o canvas não tem foco —, ignora quem está digitando e Ctrl/Alt/Meta, e manda a
 * intenção pela conexão em curso (`sendIntent`, silencioso sem conexão, como todo botão).
 * `shiftKey` SOZINHO compõe a tecla (`shift+1`…`shift+F12`); com outro modificador junto, a
 * tecla não é do jogo.
 *
 * A store é lida no DISPARO, nunca no render: o conjunto ativo pode ter mudado desde a
 * montagem, e o atalho tem que usar o de agora. O cliente só manda intenção (invariante 4) —
 * quem decide elegibilidade, consome estoque e inicia cooldown é o servidor. A tecla NUNCA
 * arma mira (DT-01 da spec da #725): mesmo um slot de aliado dispara direto, com o recipiente
 * default (o próprio lançador) — mirar um aliado específico é gesto de CLIQUE.
 */
export function useActionKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Esc cancela a mira em curso (RF-08, ADR 0049 decisão 2) sem mandar nada — vale mesmo
      // com foco num campo de texto, e não depende de conjunto/slot nenhum.
      if (event.code === 'Escape') { aimTracker.cancelAim(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat || typing(event.target)) return;
      const draft = bot.get().draft;
      const next = slotForHotkey(draft.sets, draft.activeSet, event.code, event.shiftKey);
      if (next === null) return;
      // A tecla é do jogo: sem isto, F1 abriria a ajuda do navegador em vez de lançar.
      event.preventDefault();
      sendIntent({ type: 'use-slot', set: next.set, slot: next.slot });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, []);
}
