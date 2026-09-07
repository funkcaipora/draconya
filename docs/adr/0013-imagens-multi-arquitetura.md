# 0013 — Imagens multi-arquitetura (amd64 e arm64)

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** build, CI, deploy, e a medição de custo da FUN-46

## Contexto

Três ambientes previsíveis do projeto puxam para arquiteturas diferentes:

- **Desenvolvimento** — Apple Silicon, `arm64`.
- **Validação sem custo** — Oracle Cloud Always Free, que é **exclusivamente ARM** (Ampere A1).
  As microinstâncias AMD que acompanham o tier são pequenas demais para o `game`.
- **VPS paga em São Paulo** — Hostinger, Vultr e Contabo são `x86_64`. VPS ARM no Brasil é rara.

Como a escolha de hospedagem é decidida por latência até São Paulo, e não por arquitetura, fixar
uma única arquitetura fecharia porta em algum dos três — ou obrigaria emulação em desenvolvimento.

A stack aguenta as duas sem trabalho extra: a única dependência nativa é o `uWebSockets.js`, que
publica binário pré-compilado para `linux/arm64`, e o `sim` — onde a lógica de jogo vive — é
TypeScript sem dependência, portanto indiferente à arquitetura por construção.

## Decisão

Publicar **imagens multi-arquitetura** (`linux/amd64` e `linux/arm64`) desde o primeiro Dockerfile,
via `docker buildx`. Desenvolvimento roda nativo em `arm64`; o destino de deploy fica livre.

## Alternativas

- **Só `amd64`** — descartada porque obrigaria emulação no desenvolvimento e fecharia a porta do
  Oracle Always Free, que é a rota de validação sem custo.
- **Só `arm64`** — descartada porque fecharia as VPS pagas em São Paulo, que são o destino provável
  quando houver jogadores de verdade.
- **Decidir depois** — descartada porque é justamente o tipo de decisão barata agora e cara depois:
  retrofitar multi-arch exige mexer no Dockerfile, no CI e na base de comparação da medição.

## Consequências

- O build de CI leva mais tempo. Em runner nativo `arm64` o custo é pequeno; com emulação QEMU,
  o build `arm64` fica sensivelmente mais lento. Vale usar runner nativo quando disponível.
- **A medição de custo da FUN-46 passa a ser dependente de arquitetura.** O tick da simulação é
  single-thread, então o que importa é desempenho por core — e um OCPU Ampere, um core de EPYC e
  um core M-series rendem valores diferentes. Medir no laptop e extrapolar para o servidor erra, e
  em direções distintas conforme o caso. **A medição precisa rodar na arquitetura de destino**, e
  o relatório precisa dizer em qual rodou.
- Toda dependência nativa nova passa a ter um requisito: precisa de binário para as duas
  arquiteturas, ou de compilação viável nas duas. Vale conferir isso **antes** de adicionar, não
  depois de o build de CI quebrar.

## Invariantes afetados

Nenhum diretamente. Reforça o invariante 1: `sim/` ser puro é o que torna a arquitetura irrelevante
onde ela mais poderia doer.
