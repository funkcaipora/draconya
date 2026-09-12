# Plano — harness e skills do Draconya

Como garantir que a arquitetura, os padrões de commit e a documentação sobrevivam a seis meses
de implementação, com boa parte do código escrito por agente.

---

## 1. A distinção que define o plano

**Skill é invocada. Hook é imposto. Lint e CI são inegociáveis.**

Uma skill só roda quando o modelo decide invocá-la ou quando você digita `/name`. Isso a torna
ótima para *procedimento* — "como escrever um ADR", "como criar um módulo" — e péssima para
*garantia*. Se a regra precisa valer sempre, ela tem que estar numa camada que não depende de
alguém lembrar.

Daí as três camadas:

| Camada | Natureza | Serve para | Custa |
|---|---|---|---|
| **CLAUDE.md hierárquico** | contexto passivo, sempre carregado | o agente saber as regras sem precisar perguntar | tokens em toda sessão |
| **Skills** | procedimento invocável | rituais recorrentes com formato definido | nada até serem usadas |
| **Hooks, lint e CI** | imposição | as regras que não podem ser puladas | atrito quando erram |

Errar a camada é o erro comum: virar 15 skills que ninguém invoca, enquanto a regra que
importava — "`sim/` não pode importar I/O" — continua sendo violada porque nada a verifica.

---

## 2. Camada 1 — CLAUDE.md hierárquico

### 2.1 Raiz: `CLAUDE.md`

O norte. Curto o suficiente para ser lido inteiro toda sessão. Conteúdo:

- **O que é o Draconya**, em um parágrafo
- **Os invariantes inegociáveis** (abaixo) — esta é a parte que mais importa
- Stack e mapa do repositório
- Padrão de commit e de branch
- Ponteiros: `docs/technical-architecture.md`, `docs/adr/`, `docs/product/`, PRD

### 2.2 Os invariantes

Esta lista é o "norte de arquitetura" transformado em algo operacional. Toda decisão futura é
medida contra ela, e violar qualquer item exige um ADR que explique por quê.

1. **`sim/` é puro** — sem I/O, sem framework, sem rede, sem banco, sem relógio global.
2. **Nada é escrito "por tick"** — todo cálculo recebe `dtMs`. É o que permite rodar a 1 Hz
   desanexado com resultado idêntico.
3. **O resultado da simulação não depende de haver alguém assistindo.** Cai a apresentação,
   nunca a matemática.
4. **O cliente só manda intenção.** Nunca dano, posição resolvida, loot, XP ou resultado de transação.
5. **Opcodes vivem só em `protocol/`**, num arquivo, como fonte única das duas tabelas.
6. **`content/` nunca contém arte** — só `appearanceId` e `outfitId`.
7. **A versão de conteúdo é fixada na sessão** e não muda no meio dela.
8. **Todo personagem está sempre em exatamente um estado**, cidade inclusive — e um estado ATIVO
   é sempre exatamente uma sessão hospedada (ADR 0024).
9. **Estado QUENTE só é escrito pela sessão dona.** Nenhum outro processo toca o
   `CharacterRuntime`; a linha do Postgres não é estado quente (ADR 0024).
10. **Movimentação de valor passa pelo ledger** com `(session_id, seq)` único. Retry nunca duplica.
11. **A automação é legítima** — "parece bot" nunca é sinal de punição.

### 2.3 Por pacote: `packages/<pkg>/CLAUDE.md`

Um por pacote, e por subpasta quando a subpasta tem regra própria. Sempre a mesma estrutura:

```markdown
# <pacote>

## Propósito
Uma frase.

## Fronteiras
Pode importar: ...
Não pode importar: ...          ← a parte que mais evita estrago

## Invariantes locais
Regras específicas deste pacote.

## Como testar
Comando e o que os testes cobrem.

## Armadilhas conhecidas
O que já deu errado aqui.
```

A seção **Fronteiras** é o que faz esses arquivos valerem o custo. "`sim/` não pode importar de
`server/`" escrito ali é lido pelo agente antes de qualquer edição naquela pasta — e, na camada 3,
vira regra de lint.

---

## 3. Camada 2 — Skills

Cinco. Cada uma existe porque há um momento recorrente e um formato que vale padronizar.

### 3.1 `/adr` — registrar decisão técnica

**Quando:** uma decisão de arquitetura foi tomada, em qualquer conversa.

O que faz:
1. Cria `docs/adr/NNNN-titulo-em-kebab.md` com o próximo número
2. Preenche o template: contexto, decisão, alternativas consideradas, consequências, status
3. Atualiza `docs/adr/README.md` (índice)
4. **Se a decisão muda um invariante, atualiza o `CLAUDE.md` afetado** — é este passo que fecha
   o ciclo entre "a gente decidiu" e "o agente sabe"
5. Se houver issue relacionada, referencia `FUN-nn`

Template curto de propósito. ADR que ninguém escreve porque dá trabalho não serve.

```markdown
# NNNN — <título>

**Status:** proposto | aceito | substituído por NNNN
**Data:** AAAA-MM-DD
**Contexto técnico:** <pacotes/sistemas afetados>

## Contexto
O que forçou a decisão.

## Decisão
O que foi decidido, no imperativo.

## Alternativas
O que foi descartado e por quê. Uma linha cada.

## Consequências
O que fica mais fácil, o que fica mais difícil, o que precisa mudar.

## Invariantes afetados
Lista, ou "nenhum".
```

**Primeira tarefa: preencher retroativamente os ADRs das decisões já tomadas.** Existem umas oito,
e elas são a razão de o projeto ter a forma que tem — hoje só vivem em conversa e em documento
narrativo:

| # | Decisão |
|---|---|
| 0001 | Sessão desacoplada da conexão — a hunt roda com o navegador fechado |
| 0002 | Bot avaliado no servidor, com vocabulário fechado |
| 0003 | Tick variável por tipo e por presença de visualizador |
| 0004 | Cidade como protect zone, único espaço compartilhado |
| 0005 | Monólito modular com processos `api` / `game` / `jobs` |
| 0006 | Ledger append-only idempotente para toda movimentação de valor |
| 0007 | Cliente React + PixiJS v8, com store fora do React |
| 0008 | Pacote de assets do cliente Tibia, com indireção por `appearanceId` |
| 0009 | Rota fixa por hunt — sem pathfinding na hunt |
| 0010 | Drenagem em deploy encerra creditando, em vez de migrar sessão |

### 3.2 `/module` — criar módulo com documentação de nascença

**Quando:** um pacote ou subsistema novo.

O que faz: cria a pasta, o `package.json`, o `tsconfig` com as referências certas, o setup de
teste, e o **`CLAUDE.md` já preenchido** — perguntando propósito e fronteiras se não estiverem claros.
Registra o pacote no mapa do `CLAUDE.md` raiz e nas regras de fronteira do lint.

O ponto inteiro é que **a documentação nasce junto**, e não é retrofitada depois. Retrofitar
documentação de módulo é exatamente o trabalho que nunca acontece.

### 3.3 `/compliance` — revisar diff contra os invariantes

**Quando:** antes de fechar uma issue, ou quando o diff toca `sim/`, `protocol/` ou economia.

Percorre o diff procurando violação dos onze invariantes, com atenção especial às que são baratas
de cometer e caras de corrigir:

- import de I/O dentro de `sim/`
- contador decrementado por tick em vez de cálculo por `dtMs`
- opcode declarado fora de `protocol/`
- caminho de sprite dentro de `content/`
- escrita de valor sem passar pelo ledger, ou sem `seq`
- escrita em estado quente fora da sessão dona
- mensagem cliente→servidor que carrega resultado em vez de intenção

É a skill de maior valor do conjunto, porque essas são precisamente as violações que passam em
revisão humana distraída e só aparecem meses depois.

### 3.4 `/product` — sincronizar a documentação funcional

**Quando:** um sistema do PRD sai do papel.

O PRD v0.9 é um **instantâneo**: descreve o que se pretendia em 07/09/2026, com `[ABERTO]` espalhado.
`docs/product/` é o documento **vivo**: o que existe de fato, hoje.

O que faz, para o sistema indicado:
1. Cria ou atualiza `docs/product/<system>.md` com o comportamento implementado
2. Marca a divergência entre o que o PRD dizia e o que foi construído, com o motivo
3. Resolve os `[ABERTO]` que foram fechados na implementação, com o valor escolhido
4. Lista os parâmetros de balanceamento e onde eles moram em `content/`

O item 4 vale sozinho: quando alguém for balancear a hunt daqui a três meses, a pergunta vai ser
"onde fica esse número", não "qual era a regra".

### 3.5 `/spec` — detalhar uma task para execução autônoma

**Quando:** uma issue está rasa demais para alguém executar sem reconstruir o entendimento.

Transforma a descrição da issue no GitHub numa especificação executável: escopo por pacote,
contratos, design com código real, casos de borda, testes e critérios de aceite verificáveis. A
spec vive **na própria issue** — arquivo separado diverge dela no primeiro ajuste.

Dois passos que definem a skill:

- **auditar antes de escrever.** Caminho citado existe, símbolo citado existe, trecho colado foi
  lido agora. Spec com caminho inventado é pior que nenhuma: tem aparência de autoridade;
- **validar a premissa da issue.** Ela pode estar errada, e já esteve duas vezes — a direção que a
  FUN-56 propunha duplicaria crédito, e o defeito da FUN-67 só existia numa condição que a issue
  não mencionava. Premissa que não se sustenta vira relato, não spec.

Mecânica de jogo consulta `docs/reference/` e declara a seção, por obrigação do ADR 0019.

O critério da skill: um agente que nunca viu o repositório consegue executar sem perguntar nada.

### 3.6 `/delivery` — ritual de fechamento

**Quando:** uma issue está terminando.

A cola do harness. Em ordem:
1. `pnpm test` e `pnpm build`
2. `/compliance` no diff
3. Se alguma fronteira ou invariante mudou → `CLAUDE.md` do pacote
4. Se houve decisão de arquitetura → `/adr`
5. Se um sistema do PRD saiu do papel → `/product`
6. Commit no padrão, na branch da issue (`<n>-<slug>`)
7. Comenta na issue do GitHub o que foi feito e o que ficou de fora; a PR fecha a issue

Não faz nada que as outras não façam — garante que nenhuma seja esquecida, que é o problema real.

---

## 4. Camada 3 — o que impõe

### 4.1 Padrão de commit

```
<type>(<scope>): <description no imperativo> (#nn)

type:   feat | fix | refactor | perf | docs | test | chore
scope: sim | protocol | content | server | client | tools | docs | deps
```

Exemplo: `feat(sim): advance simulation using elapsed time (#150)`

`#nn` é a issue do GitHub. Até 2026-09-12 o rastreador era o Linear e a referência era `(FUN-nn)`;
os hooks continuam aceitando essa forma para branch aberta antes da troca, e só para isso.

**Branch:** `<n>-<slug>`, a que `gh issue develop <n>` cria — o número liga commit, PR e issue sem
trabalho manual, e a PR fecha a issue com `Closes #n`.

**Hook `PreToolUse` em `git commit`:** valida o formato e recusa o que não bate. É a única forma
de o padrão valer sempre — um agente que "sabe" o padrão o esquece na quinta hora de sessão.

> **Corrigido na execução.** Os dois hooks recusavam também **commit de merge**, porque o assunto
> que o git escreve sozinho (`Merge branch 'x' into y`) não bate no formato. Apareceu ao mesclar a
> `main` numa branch de feature: o merge com conflito foi recusado e só passou com um assunto
> artificial (`chore(server): merge main and ...`) inventado para o hook — que é o pior resultado
> possível, porque ensina a contornar o hook em vez de segui-lo, e ia acontecer em todo merge.
> A convenção existe para commit de trabalho; merge não descreve uma mudança, descreve uma junção.
> Os dois hooks agora isentam merge, detectando por `MERGE_HEAD` e não pelo prefixo "Merge " do
> assunto — assunto é texto livre, e `MERGE_HEAD` só existe entre o início de um merge e o commit
> que o conclui, então o único commit isento é o próprio merge. Coberto por teste em
> `packages/tools/src/harness/commit-hooks.test.ts`, nos dois caminhos que o merge com conflito
> oferece (`git merge --continue` e `git commit` à mão) e no caso oposto: commit normal cujo
> assunto começa com "Merge" continua recusado.

### 4.2 Fronteiras de import como lint, não como prompt

As regras de "quem pode importar quem" descritas nos `CLAUDE.md` devem existir também como
`no-restricted-imports` ou `eslint-plugin-boundaries`.

Um prompt pode ser ignorado; um erro de lint não. Esta é a diferença entre documentar a arquitetura
e **ter** a arquitetura. A regra mais importante: nada em `sim/` importa de `server/`, `client/`,
`node:*` ou de qualquer pacote com efeito colateral.

### 4.3 Hooks úteis, e só eles

Hook que incomoda vira hook desligado. Três:

| Evento | O que faz |
|---|---|
| `PreToolUse` em `git commit` | valida a mensagem contra o padrão |
| `PostToolUse` em `Write` | pasta nova em `packages/` sem `CLAUDE.md` → aviso |
| `Stop` | se a sessão tocou `sim/` ou `protocol/` sem rodar `/compliance`, lembra |

### 4.4 CI

- `pnpm lint` com as regras de fronteira
- `pnpm test`
- **`docs-check`**: todo pacote tem `CLAUDE.md`; todo ADR está no índice; a numeração de ADR não
  tem buraco nem duplicata; todo link relativo em `docs/` e no `CLAUDE.md` raiz resolve.
  Além disso, lista as pendências `[ABERTO]` de `docs/product/` como **inventário informativo**,
  sem derrubar o check.

> **Corrigido na execução.** A versão original deste plano exigia responsável indicado em cada
> `[ABERTO]`, e a regra derrubava o CI. Foi rebaixada a inventário na primeira vez que rodou:
> num projeto onde o dono de toda decisão de produto é a mesma pessoa, o campo seria sempre o
> mesmo nome, e atribuição de dono e prazo já vive no rastreador de issues — duplicar isso em markdown é
> exatamente a burocracia que a §7 manda não criar. O que sobrou é o que tem valor: saber
> quantas decisões seguem abertas e onde. Um CI que nasce vermelho por uma regra sem sinal
> ensina todo mundo a ignorar o CI.

### 4.4.1 Dependabot

`.github/dependabot.yml`, três ecossistemas: npm (a raiz do workspace pnpm), GitHub Actions e
Docker. Semanal, segunda de manhã.

O problema que ele resolve não é interessante — dependência desatualizada não avisa, e vira ou
uma CVE descoberta meses depois ou um salto de três versões maiores num dia de pressa. O
problema que ele **cria** é: Dependabot sem agrupamento num monorepo abre um PR por pacote por
semana, e PR que ninguém lê ensina a ignorar a aba de PRs inteira. É o mesmo mecanismo do CI
que nasce vermelho (§4.4), e a mesma cura: menos sinal e sinal que vale.

Por isso minor e patch chegam agrupados — dois PRs de npm por semana, produção e
desenvolvimento — e versão maior vem sozinha, porque cada uma é uma decisão, não uma tarefa.

Uma exclusão, e ela é de arquitetura: **a versão maior do Node não é bump.** Ela é fixada em
quatro lugares que precisam concordar (`.node-version`, `engines`, o `FROM` do Dockerfile e o
`node-version` do CI), e um PR que mexe só num deles produz exatamente a divergência que
quebra o binário nativo do `uWebSockets.js` com uma mensagem que não menciona a versão do Node.
A exclusão é só de atualização de versão; alerta de segurança continua chegando.

Escopo de commit: `chore(deps)`, adicionado à lista de escopos junto com o arquivo. Sem isso,
todo commit do Dependabot seria recusado pelo hook de mensagem — e a alternativa, chamar de
`tools` um bump que vive em `packages/server`, tornaria o campo de escopo inútil.

**O arquivo sozinho liga só metade.** `dependabot.yml` ativa as atualizações de VERSÃO; as de
SEGURANÇA dependem de os alertas do Dependabot estarem ligados, e num repositório privado eles
vêm desligados. Foram ligados junto com este arquivo — sem isso, a exclusão do Node maior
acima não teria a válvula de escape que ela promete, porque alerta nenhum chegaria.

As correções automáticas de segurança (`automated-security-fixes`) seguem **desligadas**, por
escolha: elas abrem PR fora do agendamento semanal, e o valor de um agendamento é ser o único
momento em que dependência entra na cabeça de alguém. Ligar é uma linha:
`gh api -X PUT repos/funkcaipora/draconya/automated-security-fixes`.

### 4.5 Harness da sessão — `.claude/settings.json`

Permissões pré-aprovadas para o que é lido ou rodado o tempo todo, para não gastar interrupção
com confirmação: `pnpm test`, `pnpm build`, `pnpm lint`, `git status`, `git diff`, `git log`.

---

## 5. Estrutura final

```
CLAUDE.md                          norte e invariantes
docs/
  architecture.md                   restrições do motor
  technical-architecture.md           arquitetura e plano do MVP
  harness-plan.md                 este documento
  adr/
    README.md                      índice
    0001-....md
  product/
    README.md                      índice from sistemas
    hunt.md  bot.md  economy.md   documentação funcional viva
packages/
  <pkg>/CLAUDE.md                  propósito, fronteiras, invariantes locais
.claude/
  skills/
    adr/SKILL.md
    module/SKILL.md
    compliance/SKILL.md
    product/SKILL.md
    spec/SKILL.md
    delivery/SKILL.md
  settings.json                    hooks e permissões
```

---

## 6. Ordem de execução

**Fazer antes do E0, não depois.** A skill `/module` é o que vai criar os pacotes do E0 já com
`CLAUDE.md` dentro. Invertida a ordem, a documentação de módulo vira dívida que não se paga.

| Etapa | Escopo | Tempo |
|---|---|---|
| **1** | `CLAUDE.md` raiz com os invariantes · estrutura `docs/` · padrão de commit · hook de commit · `settings.json` | meio dia |
| **2** | Skills `/adr` e `/module` · **backfill dos 10 ADRs já decididos** | 1 dia |
| **3** | Skill `/compliance` · lint de fronteiras · CI `docs-check` | 1 dia |
| **4** | Skills `/product` e `/delivery` · templates de `docs/product/` | meio dia |

**Total: ~3 dias.**

O backfill da etapa 2 não é burocracia: as dez decisões listadas são a razão de o projeto ter a
forma que tem, e hoje só existem em conversa e em documento narrativo. Um ADR por decisão é o que
permite, daqui a quatro meses, entender por que a hunt não usa pathfinding sem precisar reconstruir
o raciocínio do zero.

---

## 7. O que deliberadamente não entra

- **Skill de "revisar código" genérica.** `/code-review` já existe no Claude Code e é melhor.
  `/compliance` é específica dos invariantes deste projeto, que é onde ela agrega.
- **Skill de "gerar testes".** Escrever teste é trabalho normal; ritualizar não melhora.
- **Skill por sistema de jogo** (`/hunt`, `/bot`, `/market`). Isso é conteúdo de `CLAUDE.md` e de
  `docs/product/`, não procedimento.
- **Changelog automático.** Os commits no padrão já geram um quando for preciso.
- **Documentação gerada de código.** Assinatura de função não é o que se esquece — o que se esquece
  é *por quê*, e isso é ADR.
