// Switch (#246, ADR 0029 D2). role="switch" + aria-checked já eram assim no handoff — RuleRow
// (bot vBot, #162) usa o mesmo par de atributos nos painéis do bot, então esta migração não
// muda contrato de a11y, só o LUGAR onde o interruptor mora (DS-12 troca o consumo, não este
// componente).

export interface SwitchProps {
  on: boolean;
  onChange?: (on: boolean) => void;
  title?: string;
  /** gold = configurações · traffic = regra de bot (verde ligado, vermelho desligado) */
  tone?: 'gold' | 'traffic';
  disabled?: boolean;
}

export function Switch({ on, onChange, title, tone = 'gold', disabled = false }: SwitchProps) {
  const classes = ['ui-switch', `ui-switch-${tone}`, on ? 'ui-switch-on' : 'ui-switch-off'].join(' ');
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={classes}
      onClick={() => { onChange?.(!on); }}
    >
      <span className="ui-switch-knob" />
    </button>
  );
}
