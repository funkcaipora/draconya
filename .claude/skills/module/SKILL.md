---
name: module
description: Use ao criar um pacote ou subsistema novo dentro de packages/ — monta a pasta, package.json, tsconfig com referências de projeto, setup de teste e o CLAUDE.md do pacote já preenchido, e registra o pacote no CLAUDE.md raiz e no lint de fronteiras. Acione com "cria um módulo novo", "novo pacote em packages", "preciso de um pacote para X", "bootstrap do pacote sim/protocol/content/server/client/tools".
---

# Criar módulo com documentação de nascença

O ponto inteiro desta skill: a documentação do pacote (`CLAUDE.md`) nasce junto com o código, não
depois. Documentação de módulo retrofitada é exatamente o trabalho que nunca acontece — não crie
o pacote sem o `CLAUDE.md` preenchido de verdade, no mesmo passo.

## Passo 1 — propósito e fronteiras

Antes de criar qualquer arquivo, você precisa de duas respostas: **propósito** (uma frase) e
**fronteiras** (o que este pacote pode e não pode importar).

Para os seis pacotes já descritos em `docs/technical-architecture.md` (E0 — Fundação), as fronteiras
já estão implícitas na arquitetura. Não pergunte, derive desta tabela:

| Pacote | Propósito | Pode importar | Não pode importar |
|---|---|---|---|
| `sim` | Motor de simulação puro — combate, tick, bot | `protocol` (tipos), `content` (dados) | `server`, `client`, `node:*`, qualquer coisa com I/O |
| `protocol` | Fonte única de opcodes e tipos de mensagem | nada de outro pacote do monorepo (tipos puros) | `sim`, `server`, `client`, `content` |
| `content` | Dados de configuração versionados (monstros, hunts, itens, magias, vocações...) | `protocol` (tipos, se necessário) | `server`, `client`, qualquer arquivo ou caminho de arte |
| `server` | Processos `api`/`game`/`jobs` — I/O, rede, banco, WebSocket | `protocol`, `content`, `sim` | nada bloqueado por padrão — é a camada de I/O do sistema |
| `client` | React + PixiJS v8, store de jogo fora do React | `protocol`, `content` (ids, nunca arte), pacote de assets (`things`) | acesso direto a `sim`/`server` fora de mensagens de `protocol` |
| `tools` | Scripts de importação, ferramentas de build/dev | qualquer pacote | nada bloqueado — não roda em produção |

Para qualquer pacote fora desses seis, **pergunte ao usuário** propósito e fronteiras antes de
continuar. Não invente — um `CLAUDE.md` com fronteira errada é pior que nenhum `CLAUDE.md`, porque
passa confiança falsa para quem ler depois.

## Passo 2 — convenções do monorepo

Antes de criar `package.json`/`tsconfig.json`, verifique o que já existe para não introduzir uma
segunda convenção concorrente:

- **Escopo do pacote:** olhe `packages/*/package.json` já existentes e leia o campo `name`. Se
  houver algum pacote, replique o mesmo escopo. Se este for o primeiro pacote do monorepo, use
  `@draconya/<name>` e trate isso como a convenção adotada a partir de agora — diga isso no
  resumo final.
- **Framework de teste:** olhe `scripts.test` e `devDependencies` de um pacote já existente. Se
  houver, use a mesma ferramenta. Se este for o primeiro pacote, use Vitest — é a opção padrão
  para monorepo pnpm + TypeScript sem servidor externo, e o custo de trocar depois é baixo. Deixe
  explícito no resumo final que essa foi uma decisão tomada agora, não algo já definido nos
  documentos do projeto.
- **tsconfig base:** verifique se a raiz do monorepo tem `tsconfig.base.json` ou `tsconfig.json`
  para saber o que referenciar em `extends`.

## Passo 3 — criar a estrutura

```
packages/<name>/
  src/
    index.ts
  CLAUDE.md
  package.json
  tsconfig.json
```

Siga a convenção de teste descoberta no Passo 2 para onde os arquivos `*.test.ts` moram (padrão
mais comum com Vitest: junto do código, em `src/`).

**`package.json`:**

```json
{
  "name": "@draconya/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -b"
  },
  "dependencies": {},
  "devDependencies": {
    "vitest": "^2.0.0",
    "typescript": "^5.0.0"
  }
}
```

Adicione `"@draconya/<pacote>": "workspace:*"` em `dependencies` para cada pacote listado em "Pode
importar" no Passo 1. Ajuste as versões para bater com o que o resto do monorepo já usa, se já
houver um pacote de referência.

**`tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../protocol" }
  ]
}
```

`references` lista só os pacotes internos que aparecem em "Pode importar" — pacote sem dependência
interna (caso de `protocol`) usa `references: []`. Se a raiz do monorepo mantém um tsconfig
"solução" que agrega as referências de todos os pacotes (para `pnpm build` compilar tudo na ordem
certa), adicione este pacote lá também — sem isso, o pacote novo compila sozinho mas fica de fora
do build agregado.

## Passo 4 — `CLAUDE.md` do pacote

Template literal — não adicione nem remova seções:

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

Preencha de verdade, com o que foi respondido ou derivado no Passo 1. Nunca deixe o texto de
placeholder ("Uma frase.", "...") no arquivo final:

- **Propósito:** a frase do Passo 1.
- **Fronteiras:** a lista de "Pode importar" / "Não pode importar" do Passo 1, com pacotes
  concretos — nunca categorias vagas como "coisas relacionadas".
- **Invariantes locais:** para os seis pacotes conhecidos, herde do `CLAUDE.md` raiz o que se
  aplica localmente — por exemplo, `sim` herda os invariantes 1 e 2 quase palavra por palavra;
  `protocol` herda o invariante 5; `content` herda os invariantes 6 e 7. Para pacote novo fora
  desse conjunto, comece com o que já ficou combinado na conversa que originou o pacote, ou deixe
  vazio se ainda não há regra própria.
- **Como testar:** `pnpm --filter @draconya/<name> test`, mais uma frase sobre o que a suíte
  cobre — mesmo que hoje seja "nada ainda: suíte vazia, primeiro teste chega com a primeira
  feature".
- **Armadilhas conhecidas:** "Nenhuma até agora." se o pacote é novo. Não invente incidente que
  não aconteceu.

## Passo 5 — registrar o pacote

**No `CLAUDE.md` raiz:** abra a seção de stack/mapa do repositório e adicione uma linha para o
novo pacote — nome, propósito de uma linha, link para `packages/<name>/CLAUDE.md`.

**No `eslint.config.js`:** adicione o pacote às regras de fronteira, no mesmo mecanismo que já
estiver em uso no arquivo:

- Se usa `eslint-plugin-boundaries`: adicione o `type` do pacote e as regras `allow`/`disallow`
  espelhando exatamente o Passo 1.
- Se usa `no-restricted-imports`: adicione um bloco de padrão proibido por pacote bloqueado, com
  mensagem de erro que cite o `CLAUDE.md` do pacote como referência.
- Se o arquivo ainda não tem nenhuma estrutura de fronteiras, crie só a entrada mínima deste
  pacote — generalizar o lint de fronteiras para o monorepo inteiro é trabalho da Camada 3 do
  harness (lint + CI), não desta skill.

## Saída

Reporte: caminho do pacote criado, propósito e fronteiras definidos (perguntados ou derivados da
tabela do Passo 1), convenções seguidas ou adotadas (escopo do pacote, framework de teste), e onde
o registro foi feito (`CLAUDE.md` raiz e `eslint.config.js`).
