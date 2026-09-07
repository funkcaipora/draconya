# Draconya

MMORPG de navegador em grade de tiles, **server-authoritative e idle-first**.

A hunt — o loop principal de progressão — é uma sessão que vive no servidor e continua rodando
com o navegador fechado. O jogador monta o equipamento, configura as regras de um bot oficial,
escolhe uma caçada e sai; o servidor simula. Conteúdo manual (quest, boss, guild war) é
instanciado à parte, exige o jogador presente, e reaproveita o mesmo motor de movimento por tile.

A frase que define o produto: **é o Tibia jogado com bot, com o bot oficializado.** A habilidade
se reparte de forma explícita — posicionamento e foco são do jogador, reação é da máquina. Como
todo mundo tem o mesmo bot, a luta não é decidida por quem comprou o script melhor.

**Status:** Fase 1 (espinha dorsal). O monorepo está de pé; os pacotes são esqueletos.

---

## Começando

```bash
pnpm install
pnpm check        # lint + typecheck + test + docs-check
```

| Comando | O que faz |
|---|---|
| `pnpm build` | `tsc -b` nas bibliotecas + `vite build` no cliente |
| `pnpm typecheck` | compila sem emitir, via referências de projeto |
| `pnpm test` | Vitest em todos os pacotes |
| `pnpm lint` | ESLint, incluindo as fronteiras de import entre pacotes |
| `pnpm docs-check` | valida a documentação estrutural |
| `pnpm --filter @draconya/client dev` | sobe o cliente em modo de desenvolvimento |

Requisitos: Node 22+ e pnpm (via corepack).

**Antes do primeiro commit**, ligue os hooks de git:

```bash
git config core.hooksPath .githooks
```

Sem isso, o validador de mensagem de commit não roda fora do Claude Code.

---

## Pacotes

| Pacote | Responsabilidade |
|---|---|
| `packages/protocol` | Opcodes, tipos de mensagem e codec de frame. Fonte única das tabelas cliente/servidor. |
| `packages/content` | Dados de jogo versionados: monstros, hunts, itens, magias, vocações, preços, flags. Nunca arte. |
| `packages/sim` | Motor de simulação **puro**: sessão, tick, combate, movimento, IA, bot. Sem I/O. |
| `packages/server` | Processos `api` (HTTP), `game` (WebSocket, hospeda sessões) e `jobs` (agendador). |
| `packages/client` | React + PixiJS v8 + Vite. HUD em DOM, mundo em canvas. |
| `packages/tools` | Importadores, scripts e o cliente sintético de carga. |

As fronteiras de import entre eles são **regra de lint**, não convenção — ver
[`docs/fronteiras.md`](docs/fronteiras.md). Cada pacote tem um `AGENTS.md` com propósito,
fronteiras, invariantes locais e armadilhas conhecidas.

---

## Documentação

| Documento | O que é | Natureza |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | O norte: os onze invariantes inegociáveis, stack, padrão de commit | vivo |
| [`docs/arquitetura-tecnica.md`](docs/arquitetura-tecnica.md) | Arquitetura e plano do MVP em 15 épicos e 7 fases | vivo |
| [`docs/arquitetura.md`](docs/arquitetura.md) | Restrições do motor: o que é barato, caro ou impossível | vivo |
| [`docs/fronteiras.md`](docs/fronteiras.md) | Quem pode importar quem, e por quê | normativo |
| [`docs/adr/`](docs/adr/) | Decisões técnicas com contexto, alternativas e consequências | append-only |
| [`docs/produto/`](docs/produto/) | Documentação funcional por sistema: o que existe de fato | vivo |
| [`docs/prd-v0.9.md`](docs/prd-v0.9.md) | O PRD do jogo | instantâneo |
| [`docs/plano-harness.md`](docs/plano-harness.md) | Como a documentação e os padrões são mantidos | vivo |
| [`docs/infraestrutura.md`](docs/infraestrutura.md) | Fornecedores, recursos e custo estimado em três estágios | vivo |

A distinção que mais importa: o **PRD é um instantâneo** do que se pretendia numa data, com
itens em aberto espalhados. `docs/produto/` é o documento **vivo** — o que o código faz hoje,
com os parâmetros de balanceamento e o caminho onde cada um mora.

---

## Contribuindo

**Commit:**

```
<tipo>(<escopo>): <descrição no imperativo> (FUN-nn)

tipo:   feat | fix | refactor | perf | docs | test | chore
escopo: sim | protocol | content | server | client | tools | docs
```

A referência `(FUN-nn)` aponta a issue no Linear e é obrigatória, exceto em `chore` e `docs`.
O formato é validado por hook — nas duas pontas, dentro e fora do Claude Code.

**Branch:** use a que o Linear gera para a issue (`funkcaipora/fun-25-...`), que fecha o
vínculo entre commit, PR e issue sem trabalho manual.

**Antes de fechar uma issue:** `pnpm check` verde, e o `AGENTS.md` do pacote atualizado se alguma
fronteira ou armadilha mudou. Decisão de arquitetura vira ADR; sistema que sai do papel atualiza
`docs/produto/`.

---

## Licença e assets

Código sob licença a definir. **O pacote de assets usado no MVP vem do cliente Tibia** e não
é redistribuído neste repositório — ver [ADR 0008](docs/adr/0008-assets-do-cliente-tibia-com-indirecao.md),
que registra o risco assumido e a indireção por `appearanceId` que mantém a troca barata.
