// A apresentação da linha "DPS · total / HPS · total" do painel da party (#431, ADR 0032 d.14).
//
// Puro: formata o número que o servidor mandou (invariante 4), nunca recalcula a janela de 60 s.
// A taxa (`dps`/`hps`) vem pronta do `sim`; o cliente só arredonda para a linha caber.

/**
 * O número compacto do kit: "723", "135.7k", "1.2M". Um decimal só e ponto decimal, como a
 * captura de referência mostra ("135.7k"), e nunca separador de milhar — o total de dano é um
 * valor grosso, e "135.700" empurraria a linha para fora do painel.
 */
export function compactPerformance(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * A taxa (DPS/HPS) em inteiro: a janela já a suavizou, e uma casa decimal piscando a cada golpe
 * chamaria mais atenção que o número. `Math.round` — 0,5 vira 1, como o resto do HUD.
 */
export function performanceRate(rate: number): string {
  return String(Math.round(rate));
}