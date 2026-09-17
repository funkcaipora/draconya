// IconButton (#246, ADR 0029 D2): botão quadrado de glifo — janela do topo, "–" de minimizar
// do Panel (#247), "×" do Modal (#247). O handoff tinha `size?: number` livre em pixels; DT-05
// proíbe prop de objeto CSS ("nunca prop de objeto CSS"), então um pixel solto não vira
// `style` — vira variante fechada por classe, como o `Button` já faz com `size`. `md` (19px) é
// o default do handoff; `sm` cobre o HUD mais denso quando um consumidor precisar; `lg` (36px,
// R0-05) é o tamanho da barra de navegação do topo.

export interface IconButtonProps {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export function IconButton({
  children,
  size = 'md',
  title,
  active = false,
  disabled = false,
  onClick,
  className,
}: IconButtonProps) {
  const classes = [
    'ui-icon-button',
    `ui-icon-button-${size}`,
    active ? 'ui-icon-button-active' : null,
    className ?? null,
  ].filter((value): value is string => value !== null).join(' ');

  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
