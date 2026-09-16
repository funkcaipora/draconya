import { useHudSlice } from '../state/useSlice.js';

/**
 * As barras de HP e mana, como no Tibia (FUN-108): duas barras horizontais, vermelha e azul,
 * com o número dentro. O trilho e o preenchimento são cor lisa desde #250 (ADR 0029 D4) — a
 * skin de pedra do pacote saiu inteira.
 *
 * **Desde #253 (ADR 0029 D3/D8), `<Vitals />` é montado no ALTO da coluna direita**
 * (`Shell.tsx`, primeiro filho de `.windows-right`), a 14 px — não mais entre o nome e o gold
 * na barra do topo (`TopBar.tsx`): o design não desenha HP/mana lá. Nenhuma linha de LÓGICA
 * deste arquivo muda com a mudança de lugar; só o CSS por baixo (`shell.css`) veste os tokens.
 *
 * O preenchimento é um elemento com a LARGURA da fração e a imagem no tamanho da barra
 * inteira, ancorada à esquerda: o que se vê é a barra cheia CORTADA na fração, como o
 * cliente do Tibia faz com o retângulo de recorte — a ponta esquerda fica, a direita some.
 *
 * `throttleMs` porque numa luta esses valores mudam dezenas de vezes por segundo numa barra
 * que anda três pixels: sem ele, cada golpe vira um render do React.
 */
function Bar({ label, value, max, kind }: {
  label: string; value: number; max: number; kind: 'hp' | 'mana';
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

  return (
    <div
      className={`bar bar-${kind}`}
      title={`${label} ${value}/${max}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className="bar-fill" style={{ width: `${(fraction * 100).toFixed(2)}%` }} />
      <span className="bar-label">{value}</span>
    </div>
  );
}

export function Vitals() {
  const health = useHudSlice((state) => state.health, { throttleMs: 100 });
  const maxHealth = useHudSlice((state) => state.maxHealth);
  const mana = useHudSlice((state) => state.mana, { throttleMs: 100 });
  const maxMana = useHudSlice((state) => state.maxMana);

  return (
    <div className="vitals">
      <Bar label="HP" value={health} max={maxHealth} kind="hp" />
      <Bar label="Mana" value={mana} max={maxMana} kind="mana" />
    </div>
  );
}
