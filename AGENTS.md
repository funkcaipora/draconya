# Draconya

MMORPG de navegador em grade de tiles, server-authoritative e idle-first. A hunt — o loop
principal de progressão — é uma sessão que vive no servidor e continua rodando com o navegador
fechado: o jogador entra, direciona o bot, e sair não interrompe nada. Conteúdo manual (quest,
boss, guild war) é instanciado à parte, exige o jogador presente, e reaproveita o mesmo motor de
movimento e ação por tile que a hunt usa.

## Os onze invariantes inegociáveis

Isto é o norte de arquitetura em forma operacional. Toda decisão futura é medida contra esta
lista, e violar qualquer item exige um ADR (`docs/adr/`) explicando por quê.

Skill é invocada, hook é imposto. Esta lista vive num `CLAUDE.md` — carregado sempre, sem
depender de alguém lembrar de invocar nada — porque é a única camada em que uma regra deste peso
pode morar (ver `docs/plano-harness.md` §1).

1. **`sim/` é puro** — sem I/O, sem framework, sem rede, sem banco, sem relógio global.
   Por quê: é o que permite testar a simulação sem infraestrutura, rodar num cliente sintético de
   carga, e trocar a camada de servidor sem reescrever a lógica de jogo.

2. **Nada é escrito "por tick"** — todo cálculo recebe `dtMs`. É o que permite rodar a 1 Hz
   desanexado com resultado idêntico.

3. **O resultado da simulação não depende de haver alguém assistindo.** Cai a apresentação, nunca
   a matemática.
   Por quê: o jogo é idle-first — a hunt é o modo default e precisa sobreviver ao navegador
   fechado, não só tolerar uma reconexão.

4. **O cliente só manda intenção.** Nunca dano, posição resolvida, loot, XP ou resultado de
   transação.
   Por quê: o servidor é autoritativo. Um cliente comprometido não fabrica resultado se nunca é
   ele quem calcula o resultado.

5. **Opcodes vivem só em `protocol/`**, num arquivo, como fonte única das duas tabelas.
   Por quê: evita que cliente e servidor divirjam sobre o que um opcode significa.

6. **`content/` nunca contém arte** — só `appearanceId` e `outfitId`.
   Por quê: troca de pacote de assets vira remapeamento de ids, não reescrita de conteúdo. Importa
   porque o pacote de assets atual (cliente Tibia) carrega risco jurídico — ver
   `docs/arquitetura-tecnica.md` §8 e §13.1.

7. **A versão de conteúdo é fixada na sessão** e não muda no meio dela.
   Por quê: sem isso, um deploy no meio de milhares de hunts desanexadas produz resultado
   inconsistente e impossível de auditar.

8. **Todo personagem está sempre em exatamente uma sessão**, cidade inclusive.
   Por quê: transforma "estado exclusivo" de regra policiada em propriedade estrutural — não
   existe lugar onde o personagem esteja em dois estados ao mesmo tempo.

9. **Estado quente só é escrito pela sessão dona.** Nenhum outro processo toca.
   Por quê: é também o mecanismo de controle de concorrência do gold — não precisa de lock
   adicional porque nunca há duas fontes de escrita ao mesmo tempo.

10. **Movimentação de valor passa pelo ledger** com `(session_id, seq)` único. Retry nunca
    duplica.

11. **A automação é legítima** — "parece bot" nunca é sinal de punição.
    Por quê: o motor de bot server-side é funcionalidade central de um jogo idle-first. O que
    precisa de defesa é multiconta e RMT, não automação.

## Stack

- **Node 22** + **uWebSockets.js**, em três processos: `api` (stateless, HTTP), `game` (stateful,
  hospeda sessões via WebSocket) e `jobs` (singleton com lock — agendador e reconciliação)
- **PostgreSQL** (verdade durável) + **Redis** (diretório de sessões, leases, filas, snapshots
  quentes)
- Cliente **React** + **PixiJS v8** + **Vite** — HUD em DOM, mundo em canvas, store de jogo fora
  do React
- **TypeScript ponta a ponta**, monorepo em **pnpm workspaces**

## Mapa do repositório

- `packages/protocol` — opcodes, tipos de mensagem e codec de frame; fonte única das tabelas
  cliente/servidor
- `packages/content` — dados de jogo versionados: monstros, hunts, itens, magias, vocações, prey,
  livraria, supply, economia, flags. Nunca arte.
- `packages/sim` — motor de simulação puro: combate, movimento, bot. Sem I/O; roda em qualquer
  runtime, inclusive num cliente sintético de carga.
- `packages/server` — processos `api` / `game` / `jobs`; persistência, diretório de sessão e
  roteamento
- `packages/client` — React + PixiJS v8 + Vite
- `packages/tools` — scripts de importação (tilemap, rota, assets do cliente Tibia) e o cliente
  sintético de carga

## Padrão de commit e branch

```
<tipo>(<escopo>): <descrição no imperativo> (FUN-nn)

tipo:   feat | fix | refactor | perf | docs | test | chore
escopo: sim | protocol | content | server | client | tools | docs
```

Exemplo: `feat(sim): tick por dtMs em vez de contador (FUN-25)`

`(FUN-nn)` é obrigatório em todo commit, exceto tipo `chore` e `docs`. Um hook recusa o commit que
não bater: `.claude/hooks/valida-commit.sh` dentro do Claude Code, `.githooks/commit-msg` para
commit feito fora dele (git de linha de comando ou GUI).

**Branch:** a que o Linear já gera (`funkcaipora/fun-25-...`). Fecha o link automático entre
commit, PR e issue sem trabalho manual.

## Documentação

- `docs/arquitetura.md` — restrições do motor impostas pelo design do jogo (instantâneo)
- `docs/arquitetura-tecnica.md` — arquitetura de sistema e plano do MVP, épicos e fases
  (instantâneo)
- `docs/plano-harness.md` — por que este harness (CLAUDE.md, hooks, skills, CI) tem esta forma
- `docs/adr/` — uma decisão técnica por arquivo: contexto, decisão, alternativas, consequências
- `docs/produto/` — o que cada sistema faz de fato, hoje. Vivo; diverge do PRD quando a
  implementação decidiu diferente, e marca o porquê

## Ao trabalhar aqui

- **Sempre existe um `AGENTS.md` dentro do pacote que você está editando.** Leia antes de mudar
  qualquer coisa lá — ele define propósito, fronteiras de import e armadilhas conhecidas daquele
  pacote específico. "`sim/` não pode importar de `server/`" está lá, e também é regra de lint.
- **Decisão de arquitetura vira ADR** em `docs/adr/`. Se ela muda um dos onze invariantes acima,
  este arquivo é atualizado no mesmo commit — senão o norte descrito aqui e o código divergem.
- **Sistema do PRD que sai do papel atualiza `docs/produto/<sistema>.md`.** O PRD é o instantâneo
  do que se pretendia numa data; `docs/produto/` é o que existe de fato, incluindo os parâmetros
  de balanceamento e onde eles moram em `content/`.
- **Antes de abrir PR ou fechar issue:** `pnpm check` (lint, typecheck, test, docs-check).

## Sobre este arquivo e o CLAUDE.md

`AGENTS.md` é o arquivo real; `CLAUDE.md` é um symlink para ele, na raiz e em cada pacote. O
projeto é executado por mais de uma ferramenta — Claude Code lê `CLAUDE.md`, Codex lê `AGENTS.md`
— e manter dois arquivos com o mesmo conteúdo é como as duas versões divergem sem ninguém
perceber. Um arquivo, dois nomes.

Se você estiver no Claude Code, existem skills em `.claude/skills/` que automatizam os rituais
acima: `/adr`, `/modulo`, `/conformidade`, `/produto` e `/entregar`. Em qualquer outra ferramenta,
os mesmos arquivos servem como checklist legível — a regra vale igual, muda só quem executa.
