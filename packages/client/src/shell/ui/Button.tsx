// Os nove primitivos de controle do design system (#246, ADR 0029 D2): props do .d.ts do
// handoff, estilo por classe sobre os tokens de DS-02. Hover/foco/pressionado são
// pseudo-classe CSS — nenhum useState aqui, ao contrário do protótipo (`Button.jsx` usava dois).

export interface ButtonProps {
  variant?: 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger' | 'text';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  type?: 'button' | 'submit';
  /** Tooltip nativo — também é onde um botão desabilitado explica POR QUE está desabilitado. */
  title?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  icon,
  type = 'button',
  title,
  onClick,
  children,
  className,
}: ButtonProps) {
  const classes = [
    'ui-button',
    `ui-button-${variant}`,
    `ui-button-${size}`,
    block ? 'ui-button-block' : null,
    className ?? null,
  ].filter((value): value is string => value !== null).join(' ');

  return (
    <button type={type} disabled={disabled} title={title} onClick={onClick} className={classes}>
      {icon}
      {children}
    </button>
  );
}
