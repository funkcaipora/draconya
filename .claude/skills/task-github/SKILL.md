---
name: task-github
description: Use para criar ou detalhar uma tarefa rastreada no GitHub (issue, milestone, labels de épico e Projects) com o MESMO padrão de spec executável da skill `spec` — audita o código antes de escrever, valida a premissa e grava na própria issue o escopo por pacote, os contratos, o design com código real, os casos de borda, os testes e os critérios de aceite. Acione com "cria a task no GitHub", "detalha a issue #nn", "especifica a #nn", "abre as issues do milestone X", "prepara a #nn para outro agente executar", ou quando a tarefa vive num milestone do GitHub em vez do Linear.
---

# Tarefa executável no GitHub

A skill `spec` define **o que** é uma tarefa executável por qualquer agente; esta define **onde**
ela mora quando o trabalho é rastreado no GitHub — issues, milestone, labels e Projects — em vez
do Linear. O padrão de conteúdo é o mesmo, e é o único que existe: uma issue do GitHub sem a spec
da skill `spec` é um lembrete, não uma tarefa.

Quando usar GitHub em vez do Linear é decisão de quem toca o projeto, registrada no milestone
(o primeiro caso é o milestone "OTClient web · teste local", ADR 0025). Fora disso, o Linear
continua sendo o padrão e a skill `spec` continua sendo a porta.

## O que NÃO muda em relação à skill `spec`

Os Passos 2, 3 e 4 da skill `spec` — auditar o código e validar a premissa, consultar a
referência de domínio (ADR 0019), escrever com o template — valem literalmente. Leia-os lá; não
estão repetidos aqui de propósito, para que exista uma versão só do padrão. O template é o da
skill `spec`, com duas linhas a mais no cabeçalho de **Rastreabilidade**:

```markdown
- **Milestone:** {{nome}}
- **Branch:** {{a branch em que a tarefa é executada — no teste da engine, uma branch para o milestone inteiro}}
```

E a regra que vale para todos os passos também: **nada entra na spec sem ter sido verificado no
checkout**; o que ainda não existe leva `(a criar)`.

## Passo 1 — reler a issue AGORA, e conferir se ela já tem dono

```bash
gh issue view <n> --json state,title,assignees,labels,milestone,url,body \
  --jq '{state, title, assignees: [.assignees[].login], labels: [.labels[].name], milestone: .milestone.title}'
gh pr list --search "#<n> in:body" --state all --json number,title,state,url
```

| Campo | O que ele impede |
|---|---|
| `state` fechada | Escrever spec de coisa entregue |
| `assignees` | Reescrever o trabalho de outra pessoa |
| PR que cita `#<n>` | Ignorar uma implementação em andamento |
| label `em andamento` | Mudar o alvo debaixo de quem já começou |

**Se a issue tem dono, PR aberta ou a label `em andamento`, PARE** e relate. É a mesma regra da
skill `spec`, pelo mesmo caso real (FUN-68 sobrescrita com PR aberta havia dez minutos).

Leia também o `AGENTS.md` raiz, o do pacote que a issue toca, os ADRs citados e o
`docs/product/<sistema>.md` quando houver.

## Passo 5 — gravar no GitHub

Releia a issue (o comando do Passo 1) imediatamente antes de gravar. Depois:

```bash
gh issue edit <n> --body-file /caminho/da/spec.md
```

O corpo de uma issue aceita até 65.536 caracteres. Se a spec passar disso, a issue é grande
demais: quebre em sub-issues (Passo 6), nunca trunque nem divida a spec em duas issues.

Para **criar** uma tarefa nova já com a spec:

```bash
gh issue create --title "<título>" --body-file /caminho/da/spec.md \
  --milestone "<milestone>" --label "<épico>" --label "<escopo>" --label "<fase>"
```

## Passo 6 — organização: labels, milestone, dependências, Projects

**Labels** — três famílias, e toda issue leva uma de cada:

| Família | Valores | Para quê |
|---|---|---|
| épico | `E0 · Fundação` … `E16 · Engine web`, os mesmos nomes do Linear | Agrupar por sistema, como no `docs/technical-architecture.md` §17 |
| escopo | `sim`, `protocol`, `content`, `server`, `client`, `tools`, `docs` | Os mesmos escopos do commit; a label é o escopo do commit que fecha a issue |
| fase | `fase 0 · fio`, `fase 1 · cidade`, `fase 2 · hunt`, `fase 3 · operação` | A ordem do plano; uma issue de fase N não começa antes de a fase N−1 ter critério de saída observado |

Mais `em andamento`, que quem pega a issue aplica ao começar e tira ao abrir a PR. Label nova é
criada com `gh label create "<nome>" --color <hex> --description "<uma linha>"`.

**Milestone** — um por iniciativa, com descrição que diz o critério de saída e a branch. Criar:

```bash
gh api -X POST repos/<owner>/<repo>/milestones -f title="<nome>" -f description="<critério de saída, branch>"
```

**Dependências** — "bloqueada por" é relação de verdade no GitHub, não só texto. A API pede o
`id` numérico da issue bloqueadora, não o número:

```bash
blocker_id=$(gh api repos/<owner>/<repo>/issues/<m> --jq .id)
gh api -X POST repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by -F issue_id="$blocker_id"
```

A linha **Bloqueada por** da spec continua existindo: quem lê a issue não deve precisar abrir a
relação para saber a ordem.

**Sub-issues** — só com paralelismo real, como na skill `spec`:

```bash
child_id=$(gh api repos/<owner>/<repo>/issues/<filha> --jq .id)
gh api -X POST repos/<owner>/<repo>/issues/<pai>/sub_issues -F sub_issue_id="$child_id"
```

**Projects (quadro)** — o token do `gh` precisa do escopo `project`, que o login padrão não
traz. Sem ele, `gh project` falha com uma mensagem que diz o comando de renovação; é o usuário
quem o executa, porque abre um fluxo de autorização no navegador:

```bash
gh auth refresh -s project,read:project
```

Com o escopo, o quadro é criado uma vez por iniciativa e cada issue entra nele:

```bash
gh project create --owner <owner> --title "<nome>" --format json --jq .number
gh project item-add <número> --owner <owner> --url <url da issue>
```

O campo `Status` do quadro é o estado de execução; label e milestone não o substituem.

## Fechamento (o ritual da skill `delivery`, traduzido)

- **Commit:** `<tipo>(<escopo>): <descrição> (#<n>)`. Os hooks aceitam `(#nn)` como referência
  de issue, ao lado de `(FUN-nn)`; para tarefa que espelha uma issue do Linear (por exemplo a
  FUN-103), use o `FUN-nn`, que é o vínculo original.
- **PR:** o corpo leva `Closes #<n>` para cada issue fechada. É o que fecha a issue no merge e
  liga PR e issue no GitHub.
- **Comentário de entrega:** antes do merge, `gh issue comment <n> --body-file <arquivo>` com o
  que foi verificado — os comandos rodados e o que se observou —, no lugar da atualização de
  status do Linear. Uma issue fechada sem esse comentário é uma issue de que ninguém sabe o que
  foi entregue.
- Os Passos 1 a 5 da skill `delivery` (testes, conformidade, `CLAUDE.md` de pacote, ADR,
  documentação de produto) valem sem alteração.

## O que separa uma issue boa de uma longa

O mesmo da skill `spec`: critério verificável ou não é critério; fora do escopo vale tanto quanto
escopo; código real, nunca pseudocódigo; o "antes" colado ao lado do "depois"; issue com dono não
se reescreve.
