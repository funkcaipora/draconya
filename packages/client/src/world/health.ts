// A barra de vida sobre a criatura, em números (FUN-23).
//
// Puro, como `camera.ts`: cor e largura são aritmética, e é a parte que erra em silêncio —
// uma divisão por `maxHealth` zero não lança, devolve `NaN`, e a barra some sem nada acusar.
// O Pixi só desenha o que sai daqui.

/** A barra tem o tamanho da do Tibia: 27×4 com contorno de 1 px, e 25×2 de preenchimento. */
export const HEALTH_BAR_WIDTH = 27;
export const HEALTH_BAR_HEIGHT = 4;
export const HEALTH_FILL_WIDTH = HEALTH_BAR_WIDTH - 2;
export const HEALTH_FILL_HEIGHT = HEALTH_BAR_HEIGHT - 2;

/**
 * A faixa de cor por porcentagem, do mais cheio para o mais vazio.
 *
 * São DADOS: é a tabela que os clientes Open Tibia usam, e o jogador do gênero já sabe ler
 * — verde é seguro, amarelo é "olha", vermelho é "poção". A borda é `>`: 92 % exatos já é a
 * segunda faixa, e é assim no cliente.
 */
const HEALTH_COLORS: ReadonlyArray<readonly [above: number, color: number]> = [
  [92, 0x00bc00], [60, 0x50a150], [30, 0xa1a100], [8, 0xbf0a0a], [3, 0x910f0f],
];
const HEALTH_COLOR_LAST = 0x850c0c;

/** A porcentagem de vida, de 0 a 100. `maxHealth` zero é 0, não `NaN`. */
export function healthPercent(health: number, maxHealth: number): number {
  if (maxHealth <= 0 || health <= 0) return 0;
  return Math.min(100, (health / maxHealth) * 100);
}

/** A cor da barra e do nome para uma porcentagem de vida. */
export function healthColor(percent: number): number {
  for (const [above, color] of HEALTH_COLORS) {
    if (percent > above) return color;
  }
  return HEALTH_COLOR_LAST;
}

/**
 * Quantos pixels do preenchimento ficam acesos.
 *
 * Presa nos dois extremos: vida acima do máximo — um buff que subiu o máximo e a mensagem
 * ainda não chegou — não passa da barra cheia, e `maxHealth` zero não divide. Arredonda
 * para CIMA: uma criatura com 1 de vida em mil mostra um pixel, porque barra vazia diz
 * "morta", e 1 de vida não é morta.
 */
export function healthWidth(health: number, maxHealth: number, fullWidth: number): number {
  if (maxHealth <= 0 || health <= 0 || fullWidth <= 0) return 0;
  return Math.min(fullWidth, Math.ceil((health / maxHealth) * fullWidth));
}
