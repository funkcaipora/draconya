---
name: adr
description: Use sempre que uma decisão de arquitetura ou técnica for tomada nesta conversa — cria o ADR numerado em docs/adr/, preenche o template padrão, atualiza o índice e corrige o CLAUDE.md afetado se algum dos onze invariantes mudou. Acione com "registra essa decisão", "cria um ADR", "documenta essa escolha de arquitetura", "isso vira ADR", ou ao final de qualquer discussão técnica que termine em "vamos fazer assim" sobre algo estrutural.
---

# Registrar decisão técnica (ADR)

Um ADR existe para que, daqui a alguns meses, alguém entenda *por que* o sistema tem a forma que
tem, sem reconstruir a conversa do zero. Escreva curto — um ADR que dá trabalho de escrever é um
ADR que ninguém escreve na próxima decisão.

## Quando invocar

Toda vez que uma decisão de arquitetura, protocolo, modelo de dados ou processo for fechada nesta
conversa — não só decisões "grandes". Se a resposta a "por que fizemos assim?" não está óbvia em
nenhum arquivo do repositório, essa é uma decisão que precisa de ADR.

## Passo 1 — descobrir o próximo número

```bash
ls docs/adr/ | grep -E '^[0-9]{4}-.*\.md$' | sort
```

Pegue o maior `NNNN` encontrado (ignore `README.md`) e some 1. Formate com 4 dígitos e zero à
esquerda (`0001`, `0002`, ...). Se o diretório não tiver nenhum arquivo `NNNN-*.md`, comece em
`0001`.

## Passo 2 — título em kebab-case

Título curto, minúsculo, sem acento, espaços viram hífen. Exemplo: "Sessão desacoplada da
conexão" → `session-desacoplada-da-conexao`. Arquivo final: `docs/adr/NNNN-titulo-em-kebab.md`.

## Passo 3 — preencher o template

Use este template literalmente. Não adicione seção, não remova nenhuma:

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

Como preencher cada campo:

- **Status:** `proposto` se ainda não está implementado; `aceito` se já está em vigor no código;
  `substituído por NNNN` só quando este ADR revoga um anterior — nesse caso, edite também o ADR
  antigo, trocando o status dele para `substituído por <este NNNN>`.
- **Data:** data de hoje, `AAAA-MM-DD`.
- **Contexto técnico:** pacotes (`packages/sim`, `packages/protocol`, ...) ou sistemas (hunt, bot,
  economia) afetados pela decisão.
- **Contexto:** o problema ou a tensão que forçou a escolha — não a decisão em si.
- **Decisão:** frase no imperativo. "Usar rota fixa por hunt", não "decidimos que rota fixa seria
  melhor".
- **Alternativas:** cada alternativa descartada em uma linha — o que era e por que perdeu.
- **Consequências:** seja honesto sobre o trade-off. Toda decisão real piora algo — diga o quê.
- **Invariantes afetados:** ver Passo 4. Se nenhum, escreva literalmente "nenhum".
- Se houver issue relacionada, referencie `#nn` no Contexto ou nas Consequências (`FUN-nn` só para
  decisão ligada a uma issue do Linear, aberta antes de 2026-09-12).

## Passo 4 — checar contra os onze invariantes

Estes são os invariantes do `CLAUDE.md` raiz. Compare a decisão com cada um:

> **Fonte canônica dos invariantes:** a lista abaixo é uma cópia de trabalho. A versão que vale é
> a do `CLAUDE.md` raiz, que é carregada em toda sessão do projeto. Se as duas divergirem, o
> `CLAUDE.md` vence e esta cópia é o bug — releia-a de lá antes de usar, e corrija aqui.


1. `sim/` é puro — sem I/O, sem framework, sem rede, sem banco, sem relógio global.
2. Nada é escrito por tick — todo cálculo recebe `dtMs`. É o que permite rodar a 1 Hz desanexado
   com resultado idêntico.
3. O resultado da simulação não depende de haver alguém assistindo — cai a apresentação, nunca a
   matemática.
4. O cliente só manda intenção — nunca dano, posição resolvida, loot, XP ou resultado de
   transação.
5. Opcodes vivem só em `protocol/`, como fonte única das duas tabelas (cliente→servidor e
   servidor→cliente).
6. `content/` nunca contém arte — só `appearanceId` e `outfitId`.
7. A versão de conteúdo é fixada na sessão e não muda no meio dela.
8. Todo personagem está sempre em exatamente um estado, cidade inclusive — e um estado ATIVO é
   sempre exatamente uma sessão hospedada (ADR 0024).
9. Estado QUENTE só é escrito pela sessão dona — nenhum outro processo toca o `CharacterRuntime`.
   A linha do Postgres não é estado quente (ADR 0024).
10. Movimentação de valor passa pelo ledger com `(session_id, seq)` único — retry nunca duplica.
11. A automação é legítima — "parece bot" nunca é sinal de punição.

Se a decisão **cria, revoga ou reformula** algum destes:

1. Edite o `CLAUDE.md` raiz — atualize o texto do invariante afetado (ou adicione um novo, se for
   o caso; a numeração de um invariante existente nunca é reciclada para outra regra).
2. Se o invariante alterado tinha regra correspondente em `packages/<pkg>/CLAUDE.md` (seção
   "Invariantes locais" ou "Fronteiras"), atualize esse arquivo também.
3. Liste os invariantes afetados na seção correspondente do ADR — nunca deixe "nenhum" se este
   passo mudou algum arquivo.

**Este passo não é opcional.** É o que fecha o ciclo entre "a gente decidiu" e "o agente sabe" —
sem ele, o `CLAUDE.md` fica defasado em relação às próprias decisões do projeto assim que alguém
esquecer de atualizá-lo manualmente.

## Passo 5 — atualizar o índice

Abra `docs/adr/README.md` (crie-o só se realmente ainda não existir) e mantenha uma tabela
ordenada por número:

```markdown
# Índice de ADRs

| # | Título | Status |
|---|---|---|
| 0001 | Sessão desacoplada da conexão | aceito |
| 0002 | ... | ... |
```

Adicione a nova linha na posição correta (ordem crescente de número). Se este ADR substitui outro,
atualize também a coluna Status da linha antiga.

## Saída

Ao terminar, reporte: caminho do arquivo criado, número escolhido, se algum `CLAUDE.md` foi
alterado (qual arquivo e o quê mudou) e se o índice foi atualizado.
