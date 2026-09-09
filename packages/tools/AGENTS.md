# @draconya/tools

## Propósito

Ferramentas de desenvolvimento e operação: importadores (tilemap, rota, pacote de assets do
cliente Tibia), o cliente sintético de carga e scripts de manutenção.

## Fronteiras

**Pode importar:** todos os pacotes. É o topo da pilha e não tem restrição.
**Não pode ser importado por:** `client`. `server` pode, para scripts operacionais.

## Invariantes locais

- Nada aqui roda em produção no caminho do jogador. Se virar dependência de runtime do `server`
  num caminho quente, mudou de pacote.
- O cliente sintético de carga fala o **protocolo**, não o DOM. É o que permite medir 5.000 sessões
  desanexadas sem navegador.
- `src/harness/` testa os hooks do harness (`.githooks/commit-msg`,
  `.claude/hooks/validate-commit.sh`), que continuam morando onde o git e o Claude Code os
  procuram. O teste mora aqui porque o vitest só coleta `packages/*/src/**/*.test.ts` e este é o
  pacote de ferramentas de desenvolvimento — não porque os hooks pertençam a `tools/`.

## Como testar

```
pnpm vitest run packages/tools
```

## Armadilhas conhecidas

- O cliente de carga precisa cobrir os dois modos: anexado (mede bytes/s e atraso de tick) e
  desanexado (abre a sessão e some). Só o segundo valida a projeção de custo do projeto.
- **`pnpm bench:hunts` só vale com a máquina junto.** O tick é single-thread, então quem decide é
  desempenho por core (ADR 0013); o relatório imprime plataforma, CPU e versão do Node por isso.
  Medir no laptop e extrapolar para o servidor erra.
- **O aquecimento do JIT não é detalhe:** o mesmo cenário mediu 51 µs pequeno e 12 µs grande. O
  aquecimento é contado em *ticks de sessão*, não em ticks do laço, e cenário pequeno demais sai
  com aviso.
- **Observador de GC é `{ type: 'gc' }`, nunca `{ entryTypes: ['gc'] }`.** A segunda forma é
  aceita sem reclamar e não entrega entrada nenhuma no Node 24 — o relatório dizia "0 ms de GC" e
  não media coisa alguma.

Issues: FUN-45 (cliente de carga), FUN-46 (cenário frio).
