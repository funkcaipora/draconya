// IconButton (#246, ADR 0029 D2): botão quadrado de glifo — janela do topo, "–" de minimizar
// do Panel (#247), "×" do Modal (#247). O handoff tinha `size?: number` livre em pixels; DT-05
// proíbe prop de objeto CSS ("nunca prop de objeto CSS"), então um pixel solto não vira
// `style` — vira variante fechada por classe, como o `Button` já faz com `size`. `md` (19px) é
// o default do handoff; `sm` cobre o HUD mais denso quando um consumidor precisar; `lg` (36px,
// R0-05) é o tamanho da barra de navegação do topo.
//
// `active` NÃO tem default (#306): o `<button>` só ganha `aria-pressed` quando o dono passa um
// booleano — "–"/"×"/"⚙" do Panel, que não têm estado de pressionado, continuam sem o
// atributo (React omite `aria-pressed={undefined}`); `TopBar` e "Ordenar" do `BattlePanel`, que
// alternam, ganham `aria-pressed="true"/"false"`, como o `TopBar` fazia antes de migrar para cá.

export interface IconButtonProps {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  'data-window'?: string;
}

export function IconButton({
  children,
  size = 'md',
  title,
  active,
  disabled = false,
  onClick,
  className,
  'data-window': dataWindow,
}: IconButtonProps) {
  const classes = [
    'ui-icon-button',
    `ui-icon-button-${size}`,
    active ? 'ui-icon-button-active' : null,
    className ?? null,
  ].filter((value): value is string => value !== null).join(' ');

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={classes}
      data-window={dataWindow}
    >
      {children}
    </button>
  );
}
