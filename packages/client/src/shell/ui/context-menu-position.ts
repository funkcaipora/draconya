// Posicionamento do ContextMenu (#764): função PURA que encaixa o menu na viewport.
//
// O bug do QA: `ContextMenu` desenha com `position: fixed` e `left/top` na coordenada de TELA
// do clique (`clientX`/`clientY`), mas o painel onde ele nasce (`.ui-panel-body`) tem um
// ancestral com `transform`, e `transform` cria BLOCO DE CONTENÇÃO para `position: fixed` — o
// menu fica fixo ao painel, não à janela. Medido: `style left:831px; top:563px` virava
// `rect x=1635` num viewport de 1024px de largura. `ContextMenu.tsx` resolve a metade
// estrutural com `createPortal` (o menu sai da árvore do painel); esta função resolve a outra
// metade, que existe mesmo com o portal: o clique perto da borda ainda pode nascer o menu para
// FORA da viewport, porque `x`/`y` são o clique, não o canto que cabe.
//
// Pura porque a decisão — onde o canto do menu cai — não depende de DOM: dado o ponto
// desejado, o tamanho MEDIDO do menu (`getBoundingClientRect`, só existe depois de montado) e
// o tamanho da viewport, o resultado é determinístico. `ContextMenu.tsx` é a única casca que
// mede e chama isto.

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Folga mínima até a borda da viewport — o mesmo respiro de 8px que o design system usa
 *  entre painel e borda (`docs/design-system.md`, espaçamento base). */
export const CONTEXT_MENU_VIEWPORT_MARGIN = 8;

/**
 * Ajusta o canto superior-esquerdo desejado do menu para que ele caiba inteiro na viewport.
 *
 * Encolhe primeiro pela direita/baixo (o canto nunca passa de `viewport − menuSize − margem`)
 * e só depois pela esquerda/cima (nunca menos que `margem`) — nessa ordem, porque um menu maior
 * que a viewport (tela minúscula) precisa grudar na margem esquerda/superior em vez de sair
 * negativo: as duas bordas erradas são ruins, mas só a segunda operação (`Math.max`) evita um
 * `left`/`top` negativo, então ela roda por último e vence.
 */
export function clampMenuPosition(
  desired: Point,
  menuSize: Size,
  viewport: Size,
  margin: number = CONTEXT_MENU_VIEWPORT_MARGIN,
): Point {
  const maxX = viewport.width - menuSize.width - margin;
  const maxY = viewport.height - menuSize.height - margin;
  const x = Math.max(margin, Math.min(desired.x, maxX));
  const y = Math.max(margin, Math.min(desired.y, maxY));
  return { x, y };
}
