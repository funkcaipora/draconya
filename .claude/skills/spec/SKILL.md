---
name: spec
description: Use para transformar uma issue rasa do Linear numa especificação executável por qualquer agente — audita o código antes de escrever, valida a premissa da issue, e grava na própria issue o escopo por pacote, os contratos, o design com código real, os casos de borda, os testes e critérios de aceite verificáveis. Acione com "detalha a FUN-nn", "cria a spec da FUN-nn", "essa task está rasa demais", "prepara essa issue para outro agente executar", "especifica isso antes de eu começar".
---

# Especificar uma task para execução autônoma

Uma issue de três parágrafos é um lembrete, não uma tarefa. Quem a executa acaba redescobrindo o
código, adivinhando fronteiras e inventando critério de pronto — e o resultado varia conforme quem
pegou. Esta skill produz o documento que fecha essa lacuna.

**O teste da spec é um só:**

> Um agente que nunca viu este repositório consegue executar do começo ao fim sem fazer nenhuma
> pergunta?

Se a resposta for não, a spec não está pronta. Caminho que ele teria que procurar, símbolo que ele
teria que adivinhar, decisão que ele teria que tomar sozinho — cada um desses é uma falha da spec,
não do executor.

A spec vive **na descrição da issue no Linear**. Não existe documento separado: arquivo solto
diverge da issue no primeiro ajuste, e aí passam a existir duas verdades.

## Regra que vale para todos os passos

**Nada entra na spec sem ter sido verificado no checkout.** Caminho citado existe, símbolo citado
existe, trecho colado foi lido agora. Uma spec com caminho inventado é pior que nenhuma spec: ela
tem a aparência de autoridade e manda o executor para o lugar errado, e ele confia porque o
documento parece preciso.

Quando algo ainda não existe, escreva **`(a criar)`** ao lado. A distinção entre "está lá" e "você
vai escrever" é metade do valor do documento.

---

## Passo 1 — ler a issue e o que ela referencia

Leia a issue no Linear (`get_issue`), inclusive relações — `blockedBy`, `blocks`, `relatedTo`.

Leia também, e não pule: o `AGENTS.md` raiz (os onze invariantes), o `AGENTS.md` do pacote que a
issue toca, os ADRs que ela cita, e o `docs/product/<sistema>.md` correspondente quando houver.

## Passo 2 — auditar o código, e validar a premissa da issue

Antes de escrever qualquer coisa, vá ao código. Localize os arquivos, leia as funções que vão
mudar, rode os testes que cobrem a área.

**A premissa da issue pode estar errada, e isso acontece.** Casos reais deste repositório:

- a FUN-56 propunha "somar o delta pendente ao que veio do banco" como a direção mais barata. Ela
  duplicaria o crédito, porque entre ler a linha e ler o Redis cabe uma varredura inteira. A spec
  certa foi a segunda direção da issue, não a primeira;
- a FUN-67 afirmava um defeito. Ele existia — mas só quando o intervalo da ação é **menor** que o
  tick, o que a issue não dizia, e o teste que deveria pegá-lo passava porque a fixture tinha o
  intervalo maior. Sem medir, a spec teria mandado corrigir a coisa certa pela razão errada.

Se a premissa não se sustenta, **pare e relate**, com a evidência. Não escreva a spec de uma
ficção — e não corrija a issue em silêncio, porque quem a escreveu precisa saber que estava errado.

Quando o comportamento for numérico ou dependente de tempo, **meça**. Um teste descartável que
imprime dois números vale mais que três parágrafos de raciocínio.

## Passo 3 — consultar a referência de domínio (ADR 0019)

Se a task é **mecânica de jogo** — movimento, combate, morte, loot, condição, spawn, IA, item,
progressão —, o ADR 0019 obriga: consulte a seção correspondente de
`docs/reference/opentibia-engine-reference.md` e responda, na spec, às cinco perguntas da §75 dele:

1. qual é o mecanismo genérico;
2. quais casos de borda já são conhecidos;
3. o que é específico do Tibia;
4. o que conflita com o Draconya;
5. qual é a versão mínima e original que devemos escrever.

Se não houver seção aplicável, **escreva que não há**. A ausência declarada é informação; o
silêncio é indistinguível de esquecimento.

Vale o limite do ADR: estuda-se arquitetura e caso de borda, **nunca se copia código GPL**.

## Passo 4 — escrever a spec

Use o template abaixo. Corte seção que não se aplica — seção vazia com `N/A` é ruído —, mas
**nunca** corte a 8 (invariantes), a 10 (aceite) ou a 11 (fora do escopo): são as três que
transformam a issue em contrato.

## Passo 5 — gravar no Linear

Grave com `save_issue` na descrição da issue. Se a gravação for recusada por tamanho, o Design
técnico (seção 6) desce para sub-issues, uma por pacote — nunca trunque, nunca divida a spec em
duas issues.

Uma spec que não cabe numa tela de revisão também não é lida. Se ela passar disso, provavelmente a
issue é grande demais e o que falta é quebrá-la, não resumi-la.

## Passo 6 — sub-issues, quando fizer sentido

Crie sub-issues (`parentId`) só quando houver **paralelismo real** ou fatias que fecham sozinhas.
Uma sub-issue por pacote quando a task cruza `sim` → `server` → `client`. Não crie sub-issue para
etapa sequencial de um mesmo arquivo: isso é lista de tarefas, e o lugar dela é a seção 10.

---

# Template

````markdown
## Objetivo

{{O que esta task entrega e qual problema resolve — 2 a 3 frases. O problema primeiro,
a solução depois: quem lê precisa saber por que isto existe antes de saber o que fazer.}}

## Rastreabilidade

- **Bloqueada por:** {{FUN-nn, ou "nenhuma"}}
- **Bloqueia:** {{FUN-nn, ou "nenhuma"}}
- **ADRs que regem esta task:** {{ADR 00nn — título; ou "nenhum"}}
- **Documentação de produto:** {{docs/product/<sistema>.md §<seção>; ou "nenhuma ainda"}}
- **Referência de domínio (ADR 0019):** {{docs/reference/opentibia-engine-reference.md §nn;
  ou "não se aplica — esta task não é mecânica de jogo"}}

## Contexto arquitetural

{{Trecho COPIADO do ADR, do AGENTS.md ou do documento de referência que rege esta task.
  Colar o texto, não só linkar: quem executa não vai abrir três documentos antes de começar,
  e a decisão precisa estar diante dos olhos na hora de escrever o código.}}

### Estado atual do código

{{Trecho COPIADO do código que vai mudar, com caminho e linha. É o "antes" contra o qual o
  "depois" da seção 6 vai ser lido. Sem isto, o executor reconstrói o entendimento do zero.}}

```ts
// packages/<pkg>/src/<arquivo>.ts:<linha>
{{código real de hoje}}
```

## 1. Escopo por pacote

**Pacotes impactados:** {{lista}}
**Pacotes NÃO alterados:** {{lista + motivo — é o que impede o escopo de crescer sozinho}}

| Pacote | Tipo de mudança | O que muda |
|---|---|---|
| `packages/{{pkg}}` | {{Novo / Extensão / Correção / Migração}} | {{descrição}} |

**Fronteiras de import em jogo:** {{o que este pacote pode e não pode importar, copiado do
`AGENTS.md` dele. `sim` não importa `server` é regra de lint, não convenção.}}

## 2. Fluxo da solução

```
{{Diagrama do caminho, do gatilho até o efeito. Um caminho por linha, com o arquivo real.}}

cliente → walk (opcode 5)
  → SessionHost.handle            (packages/server/src/game/host.ts)
  → MovementSystem.request        (packages/sim/src/world/movement.ts)      (a criar)
      ├── legalidade de tile      (packages/sim/src/world/tile.ts)          (a criar)
      └── CreatureMoved           → adaptador → creature-move no socket
```

## 3. Requisitos funcionais

| # | Requisito | Critério de aceite |
|---|---|---|
| RF-01 | {{o que o sistema passa a fazer}} | {{como se verifica — comando, arquivo, número}} |

## 4. Contratos e interfaces

Preencher só as subseções que a task toca.

### 4.1 Protocolo

{{Mensagem nova ou alterada. Opcode, direção, schema Zod. Invariante 5: opcode vive só em
  `packages/protocol`. Invariante 4: mensagem cliente→servidor carrega INTENÇÃO, nunca dano,
  posição resolvida, loot, XP ou resultado de transação.}}

### 4.2 Conteúdo (`packages/content`)

{{Campo novo em schema, arquivo de dados, validação cruzada. Invariante 6: nada de arte —
  só `appearanceId`/`outfitId`. Regra: a engine é dona do mecanismo, o conteúdo é dono dos
  números.}}

### 4.3 Banco e Redis

{{Tabela, coluna, índice, migration; chave de Redis, TTL, script Lua. Movimentação de valor
  passa pelo ledger com `(session_id, seq)` único (invariante 10).}}

### 4.4 Assinaturas em `sim`

```ts
{{As interfaces públicas novas. Assinatura real, com tipos, não descrição em prosa.}}
```

## 5. Referência de domínio consultada

{{Obrigatório para mecânica de jogo (ADR 0019). Responder as cinco perguntas da §75:}}

- **Mecanismo genérico:** {{como TFS/Canary estruturam este problema}}
- **Casos de borda já conhecidos:** {{o que a referência já tem mapeado}}
- **O que é específico do Tibia:** {{e portanto não vem}}
- **O que conflita com o Draconya:** {{e por quê — sessão instanciada, idle-first, Cidade inerte}}
- **Versão mínima que escrevemos:** {{o recorte original, em TypeScript}}

## 6. Design técnico

### `packages/{{pkg}}`

**Arquivos a criar**
- `{{path}}` — {{finalidade}}

**Arquivos a alterar**
- `{{path}}` — {{o que muda e por quê}}

```ts
{{Código real, não pseudocódigo. Não precisa ser a implementação inteira: precisa ser a parte
  em que uma escolha errada custa caro — a assinatura, a ordem das operações, o ponto de
  validação. Comentários em português, identificadores em inglês.}}
```

## 7. Casos de borda e erros

| Cenário | Comportamento esperado |
|---|---|
| {{entrada inválida ou vazia}} | {{o que o sistema faz}} |
| {{concorrência — duas fontes ao mesmo tempo}} | {{quem ganha e por quê}} |
| {{sessão retomada de snapshot}} | {{o que acontece com o estado desta task}} |
| {{conteúdo em versão diferente}} | {{invariante 7}} |
| {{falha de dependência externa}} | {{degradação, e para que lado ela erra}} |

## 8. Invariantes em jogo

{{Só os que esta task pode quebrar. Para cada um: como ela os respeita, e o que
  especificamente reprovaria numa revisão de conformidade.}}

| # | Invariante | Como esta task o respeita |
|---|---|---|
| {{n}} | {{nome curto}} | {{a garantia concreta, não "vamos tomar cuidado"}} |

**Snapshot:** {{esta task adiciona estado serializado? precisa de bump de
`SNAPSHOT_FORMAT_VERSION`? campo opcional evita o bump — dizer qual dos dois}}

**Custo:** {{isto roda no caminho quente do tick? cria varredura periódica? acorda entidade
sem necessidade? Se não toca o caminho quente, escrever "não toca".}}

## 9. Decisões técnicas

| ID | Decisão | Alternativa descartada | Motivo |
|---|---|---|---|
| DT-01 | {{decisão}} | {{o que foi descartado}} | {{por quê — citar o ADR quando aderente}} |

{{Decisão que contraria um ADR vigente não entra aqui: vira ADR novo antes da task começar.}}

## 10. Critérios de aceite

{{Cada linha precisa ser verificável por um comando ou por leitura de arquivo. "Funciona bem",
  "código limpo" e "sem regressão" não são critérios — são opiniões. Se você não consegue
  escrever como conferir, o critério ainda não está pronto.}}

- [ ] {{condição verificável, com o comando ou o arquivo que a comprova}}
- [ ] Testes da seção 11 escritos e passando
- [ ] `pnpm check` verde (lint, typecheck, test, docs-check, source-policy)
- [ ] {{docs/product/<sistema>.md atualizado — quando a task muda comportamento visível}}

## 11. Testes

| Arquivo | Cenário | O que reprova |
|---|---|---|
| `packages/{{pkg}}/src/{{arquivo}}.test.ts` | {{cenário}} | {{o defeito que este teste pega}} |

{{Se a task corrige um defeito: o teste precisa FALHAR antes da correção. Escreva qual é a
  saída da falha. Um teste que passa dos dois lados não protege nada — foi assim que a FUN-67
  atravessou um teste que afirmava exatamente a propriedade quebrada.}}

{{Se o teste usa Redis: escolha um índice de banco livre e registre em
`packages/server/src/testing/redis.ts`. `testing/redis.test.ts` reprova colisão.}}

## 12. Fora do escopo

- {{o que explicitamente NÃO entra, e para onde vai — outra issue, ou "quando X existir"}}

{{Esta seção é o que impede a task de virar refatoração. Se algo apareceu durante a análise e
  não cabe aqui, abra issue e cite o número.}}
````

---

## O que separa uma spec boa de uma longa

**Critério de aceite é verificável ou não é critério.** "O movimento respeita paredes" é opinião.
"`movement.test.ts` cobre destino fora do mapa, parede e tile ocupado, e cada um devolve a razão
tipada correspondente" é critério.

**Fora do escopo vale tanto quanto escopo.** É a seção que responde "e já que estou aqui, aproveito
e...". A resposta é não, e o documento precisa dizer isso antes da pergunta aparecer.

**Código real, nunca pseudocódigo.** Pseudocódigo empurra a decisão para o executor exatamente nos
pontos em que ela é difícil — que são os pontos pelos quais a spec existe.

**O "antes" importa tanto quanto o "depois".** Colar o código atual é o que permite ao executor
perceber que o repositório mudou desde que a spec foi escrita, em vez de aplicar um diff que não
encaixa mais.

**Não escreva a spec de uma ficção.** Se o passo 2 derrubou a premissa, o entregável é o relato,
não o documento.
