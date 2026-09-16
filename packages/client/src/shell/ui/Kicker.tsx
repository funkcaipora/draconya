// Kicker (#246, ADR 0029 D2) — o mais simples dos nove, ponto de partida da migração.

export interface KickerProps {
  children: React.ReactNode;
  tone?: 'gold' | 'muted';
  className?: string;
}

export function Kicker({ children, tone = 'gold', className }: KickerProps) {
  const classes = ['ui-kicker', `ui-kicker-${tone}`, className ?? null]
    .filter((v): v is string => v !== null).join(' ');
  return <span className={classes}>{children}</span>;
}
