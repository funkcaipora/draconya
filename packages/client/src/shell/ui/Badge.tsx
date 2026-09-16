// Badge (#246, ADR 0029 D2). `tone` é união fechada — o handoff aceita `string` solto, e essa
// folga não é levada adiante: um tom desconhecido recusa em tempo de build (§7 da spec).

export type BadgeTone = 'gold' | 'haste' | 'exp' | 'blood' | 'fire' | 'energy' | 'ice' | 'earth' | 'holy' | 'muted';

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ tone = 'gold', dot = true, children, className }: BadgeProps) {
  const classes = ['ui-badge', `ui-badge-${tone}`, className ?? null]
    .filter((v): v is string => v !== null).join(' ');
  return (
    <span className={classes}>
      {dot && <i className="ui-badge-dot" />}
      {children}
    </span>
  );
}
