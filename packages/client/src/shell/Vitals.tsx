import { useHudSlice } from '../state/useSlice.js';

/**
 * Indicador circular de HP e mana.
 *
 * `throttleMs` porque numa luta esses valores mudam dezenas de vezes por segundo numa barra
 * que anda três pixels: sem ele, cada golpe vira um render do React.
 */
function Ring({ label, value, max, color }: {
  label: string; value: number; max: number; color: string;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const radius = 22;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="ring" title={`${label} ${value}/${max}`}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-label={`${label} ${value} de ${max}`}>
        <circle cx="28" cy="28" r={radius} className="ring-track" />
        <circle
          cx="28" cy="28" r={radius} stroke={color} className="ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="ring-label">{value}</span>
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
      <Ring label="HP" value={health} max={maxHealth} color="#c25b4a" />
      <Ring label="Mana" value={mana} max={maxMana} color="#4a7fc2" />
    </div>
  );
}
