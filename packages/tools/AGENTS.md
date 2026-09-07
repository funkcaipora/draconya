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

## Como testar

```
pnpm vitest run packages/tools
```

## Armadilhas conhecidas

- O cliente de carga precisa cobrir os dois modos: anexado (mede bytes/s e atraso de tick) e
  desanexado (abre a sessão e some). Só o segundo valida a projeção de custo do projeto.

Issues: FUN-45 (cliente de carga), FUN-46 (cenário frio).
