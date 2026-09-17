import { useHudSlice } from '../state/useSlice.js';

/**
 * As barras de HP e mana, como no Tibia (FUN-108): duas barras horizontais, vermelha e azul,
 * com o número dentro. Gradiente de dois tons por kind e trilho neutro desde #304
 * (ADR 0030, R0-08/R6-10) — a skin de pedra do pacote (ADR 0029 D4) e a cor sólida (D1
 * mal-aplicado) saíram, o vidro ferro-forjado do kit entrou.
 *
 * **Desde #253 (ADR 0029 D3/D8), <Vitals /> é montado no ALTO da coluna direita**
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
 *
 * O texto é "valor / máximo" em pt-BR, como o kit (`VitalBar.jsx:4`, R6-01) — não só o valor
 * cru. O `Intl.NumberFormat` é local a este arquivo, o mesmo padrão de TopBar.tsx/
 * Analyzer.tsx/EquipmentPanel.tsx/CharacterModal.tsx/Bestiary.tsx (DT-01: não há módulo
 * compartilhado ainda, decisão registrada em CharacterModal.tsx).
 */
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function Bar({ label, value, max, kind }: {
  label: string; value: number; max: number; kind: 'hp' | 'mana';
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const text = `${integer.format(value)} / ${integer.format(max)}`;

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
      <span className="bar-label">{text}</span>
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
