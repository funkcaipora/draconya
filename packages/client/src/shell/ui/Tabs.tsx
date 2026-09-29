// Tabs (#246, ADR 0029 D2). role="tablist"/"tab" + aria-selected: o handoff (Tabs.jsx) não
// marca papel nenhum, só cor. Um consumidor com teclado (Cyclopedia, SV-08) precisa do papel
// certo desde já — DT-02.

export interface TabsProps {
  items: readonly string[];
  value: string;
  onChange?: (item: string) => void;
  /** pill = abas de seção de modal · underline = canais de chat */
  variant?: 'pill' | 'underline';
  className?: string;
}

export function Tabs({ items, value, onChange, variant = 'pill', className }: TabsProps) {
  const classes = ['ui-tabs', `ui-tabs-${variant}`, className ?? null]
    .filter((v): v is string => v !== null).join(' ');
  return (
    <nav role="tablist" className={classes}>
      {items.map((item) => {
        const active = item === value;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ui-tab${active ? ' ui-tab-active' : ''}`}
            onClick={() => { onChange?.(item); }}
          >
            {item}
          </button>
        );
      })}
    </nav>
  );
}
