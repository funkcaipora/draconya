// Stance: o seletor de postura de luta (M30-03, #550; o primitivo que o ADR 0030 decisão 4
// admitiu e o ADR 0032 decisão 10 ligou à mecânica) — três botões, um marcado, como o kit
// desenha sob a capacidade do set: DEFENSIVA · BALANCEADA · ATACANTE.
//
// É um `radiogroup`: exatamente uma postura vale, e o papel diz isso a quem usa teclado ou
// leitor de tela — o kit só marcava com cor. `value` é a postura que o SERVIDOR confirmou
// (`player-stats.fightMode`), nunca a do clique: o cliente não antecipa nem calcula o efeito
// (invariante 4), e o botão só troca de marca quando a confirmação volta. Clicar no modo que já
// vale não manda nada. Quem decide O QUE sai no clique é quem monta a tela (`onChange`), como no
// `Slot` — o primitivo não conhece a mensagem.
//
// A dica de cada botão é QUALITATIVA de propósito: os fatores são do servidor (o cliente não
// tem regra de combate) e, no ofensivo, a defesa até muda com o instante do último golpe.

import type { FightModeName } from '@draconya/protocol';

export interface StanceProps {
  /** A postura em vigor, como o servidor a confirmou. */
  value: FightModeName;
  /** O jogador escolheu OUTRA postura que a atual. */
  onChange?: (mode: FightModeName) => void;
  disabled?: boolean;
  className?: string;
}

/** Na ordem do kit: da mais defensiva à mais ofensiva — a inversa da ordem do Canary. */
export const STANCE_OPTIONS: ReadonlyArray<{
  readonly mode: FightModeName;
  readonly label: string;
  readonly hint: string;
}> = [
  { mode: 'defense', label: 'Defensiva', hint: 'Postura defensiva: bate menos e se defende mais' },
  { mode: 'balanced', label: 'Balanceada', hint: 'Postura balanceada: meio-termo entre ataque e defesa' },
  { mode: 'attack', label: 'Atacante', hint: 'Postura atacante: bate mais forte e se defende menos' },
];

/** Glifos de 12 px, traço em `currentColor` — nenhuma arte do pacote de assets (invariante 6). */
function Glyph({ mode }: { mode: FightModeName }) {
  const common = {
    className: 'ui-stance-icon', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
  switch (mode) {
    // Escudo.
    case 'defense':
      return <svg {...common}><path d="M6 1.2 10 2.6v3c0 2.4-1.6 4-4 5.2C3.6 9.6 2 8 2 5.6v-3z" /></svg>;
    // Balança: travessão, coluna e os dois pratos.
    case 'balanced':
      return (
        <svg {...common}>
          <path d="M6 2v8M3 10h6M2 4h8M2 4l-1.2 3h2.4zM10 4l-1.2 3h2.4z" />
        </svg>
      );
    // Duas espadas cruzadas.
    case 'attack':
      return <svg {...common}><path d="M2 2l8 8M10 2l-8 8M1.6 3.4 3.4 1.6M8.6 10.4l1.8-1.8" /></svg>;
  }
}

export function Stance({ value, onChange, disabled = false, className }: StanceProps) {
  const classes = ['ui-stance', className ?? null].filter((v): v is string => v !== null).join(' ');
  return (
    <div role="radiogroup" aria-label="Postura de luta" className={classes}>
      {STANCE_OPTIONS.map(({ mode, label, hint }) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            disabled={disabled}
            className={`ui-stance-option${active ? ' ui-stance-option-active' : ''}`}
            onClick={() => { if (!active) onChange?.(mode); }}
          >
            <Glyph mode={mode} />
            <span className="ui-stance-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
