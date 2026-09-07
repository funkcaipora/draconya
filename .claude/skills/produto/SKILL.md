---
name: produto
description: Use quando um sistema do PRD sai do papel — cria ou atualiza docs/produto/<sistema>.md com o comportamento realmente implementado, marca divergência entre o PRD e o que foi construído com o motivo, resolve os [ABERTO] que foram fechados na implementação e lista os parâmetros de balanceamento com o caminho em packages/content. Acione com "sincroniza a documentação de produto", "atualiza docs/produto", "documenta o sistema X que acabei de implementar", "esse [ABERTO] já foi decidido, registra o valor".
---

# Sincronizar documentação funcional

O PRD (`Draconya_PRD_Consolidado_v0.9.md` ou versão mais recente) é um **instantâneo**: descreve o
que se pretendia numa data, com `[ABERTO]` espalhado pelo texto. `docs/produto/` é o documento
**vivo**: o que existe de fato, hoje, no código. Esta skill mantém o segundo sincronizado com a
realidade toda vez que um sistema sai do papel — em vez de esperar uma revisão geral que nunca
acontece.

## Passo 0 — identificar o sistema e reunir as fontes

Se o usuário não nomeou o sistema (`hunt`, `bot`, `economia`, `stamina`, `livraria`, `prey`, etc.),
pergunte. Nome de arquivo em kebab-case, singular. Antes de criar um arquivo novo, liste
`docs/produto/` e confira se já existe um arquivo para o mesmo sistema com nome ligeiramente
diferente (`hunt.md` vs `hunts.md`) — reaproveite o existente em vez de duplicar.

Reúna três fontes antes de escrever:

1. **O PRD**, versionado em `docs/prd-v0.9.md` (ou a versão mais recente em `docs/prd-v*.md`).
   Se não encontrar, pergunte ao usuário o caminho — não invente o que o PRD dizia.
2. **O código implementado** — a fonte de verdade sobre o que existe de fato. Leia o sistema real,
   não a intenção de quem o pediu.
3. `docs/arquitetura-tecnica.md` — a seção 20 já lista itens `[ABERTO]` do PRD por épico; útil
   para saber quais decisões estavam pendentes antes desta implementação.

## Passo 1 — comportamento implementado

Descreva o sistema como ele **funciona hoje no código**, não como o PRD descrevia a intenção.
Escreva em português, direto, com detalhe suficiente para alguém implementar um cliente ou balancear
o sistema sem precisar ler o código-fonte.

## Passo 2 — divergência do PRD

Para cada ponto em que o comportamento implementado difere do que o PRD descrevia, registre os três
campos:

```markdown
- **PRD dizia:** <trecho ou resumo>
- **Implementado:** <o que existe de fato>
- **Motivo:** <por que mudou — restrição técnica, decisão de produto no meio do caminho, ADR nnnn>
```

Se a divergência veio de uma decisão de arquitetura já registrada, referencie o ADR (ex. "ADR
0009") em vez de reexplicar o raciocínio.

## Passo 3 — resolver `[ABERTO]`

Para cada `[ABERTO]` do PRD relativo a este sistema que a implementação decidiu de fato, registre:

```markdown
- ~~[ABERTO] <texto original do PRD>~~ → **Resolvido:** <valor escolhido>, em
  `packages/content/<caminho>` (ou `packages/<pkg>/<arquivo>:<linha>`, se não for parâmetro de
  content).
```

Não risque um `[ABERTO]` que a implementação só contornou provisoriamente. Se o valor é um
placeholder até alguém decidir de verdade, deixe marcado como `[ABERTO — valor provisório: X]`,
nunca como resolvido.

## Passo 4 — parâmetros de balanceamento

Tabela com todo número que alguém vai querer ajustar sem reabrir o código:

```markdown
| Parâmetro | Valor atual | Caminho |
|---|---|---|
| XP do rato | 12 | `packages/content/monstros/rat.json` |
| Cooldown de cura (categoria) | 1000 ms | `packages/content/bot/vocabulario.json` |
```

Este é o item que sozinho paga o custo da skill: daqui a meses, a pergunta de quem for balancear é
"onde fica esse número", não "qual era a regra". Não deixe parâmetro de fora por parecer óbvio
agora — óbvio agora não é óbvio em três meses.

## Passo 5 — montar ou atualizar o arquivo

Estrutura de `docs/produto/<sistema>.md`:

```markdown
# <Sistema>

**Status:** implementado | parcial | planejado
**Última atualização:** AAAA-MM-DD

## Comportamento implementado
(Passo 1)

## Divergências do PRD
(Passo 2, ou "Nenhuma divergência identificada.")

## Itens [ABERTO] resolvidos
(Passo 3, ou "Nenhum item [ABERTO] deste sistema foi fechado nesta implementação.")

## Parâmetros de balanceamento
(Passo 4, ou "Este sistema não tem parâmetro configurável em content/.")

## Referências
Seção do PRD, ADRs relacionados, pacotes de código envolvidos.
```

Se o arquivo já existir, edite as seções afetadas em vez de reescrever o arquivo inteiro — o
histórico de divergências e de `[ABERTO]` resolvidos anteriormente não deve desaparecer.

## Passo 6 — atualizar o índice

Abra `docs/produto/README.md` (crie-o só se realmente ainda não existir) com uma tabela:

```markdown
# Índice de documentação de produto

| Sistema | Arquivo | Status |
|---|---|---|
| Hunt | [hunt.md](./hunt.md) | implementado |
```

Adicione ou atualize a linha do sistema tratado nesta execução.

## Saída

Reporte: arquivo criado ou atualizado, quantas divergências e quantos `[ABERTO]` foram registrados,
e se o índice foi atualizado.
