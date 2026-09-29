# 0033 — O catálogo de ações carrega os números de exibição: a régua do `ActionConfigModal` é a imagem do Tibia

**Status:** aceito
**Data:** 2026-09-19
**Contexto técnico:** `packages/content` (`spellSchema`/`supplySchema` ganham `description?`;
`spellPowerRange` muda de `sim` para `content`), `packages/protocol` (`catalogue.bot.spells[]`/
`supplies[]` ganham cooldown, descrição e o detalhe do efeito; `catalogue.bot.spellPower`),
`packages/server` (`catalogue.ts` projeta os campos novos), `packages/sim` (`casting.ts` importa
a fórmula de `content`), `packages/client` (sub-issue própria: `ActionConfigModal` novo),
`docs` (este ADR, `docs/hud-contract-plan.md`, `docs/hud-contract-tasks.md`)

## Contexto

O dono decidiu em 2026-09-19: o `ActionConfigModal` do cliente — hoje três `Select` (Tipo / Ação /
Atalho) que não dizem nada sobre a ação escolhida — passa a seguir o "Configurar ação" do cliente
Tibia (imagem anexa à issue #435): abas Magias / Runas / Itens, lista à esquerda, painel de
detalhe à direita com título, requisito, Tipo, Área, Tipo de dano, Dano/Cura, Custo, Cooldown e
Descrição. O jogador configura a barra às cegas hoje e descobre o efeito de uma magia pelo
extrato que fecha errado, não por uma tela.

Duas coisas impedem isso, e as duas são decisões vigentes deste projeto:

1. `packages/server/src/game/catalogue.ts:12` dizia, antes desta task: "O que NÃO entra: dano,
   cura, cooldown, alcance. São balanceamento, e o cliente não simula (invariante 4) — mandá-los
   seria dar ao cliente material para calcular resultado." O catálogo era desenhado para omitir
   deliberadamente os números que a imagem do Tibia mostra.
2. A faixa "135~183" que o painel precisa mostrar depende de `spellPowerRange` (ADR 0026 decisão
   5), hoje em `packages/sim/src/casting.ts`. O cliente não pode importar `sim`
   (`packages/client/AGENTS.md`: "Pode importar: `protocol`, `content`. Não pode importar:
   `sim`…"), então a fórmula não estava em lugar nenhum que o cliente pudesse alcançar.

## Decisão

### Decisão 1 — o catálogo carrega os números de EXIBIÇÃO

`catalogue.bot.spells[]`/`supplies[]` passam a levar `cooldownMs`, `groupCooldownMs?`,
`description?` e `detail?` (alcance, área, tipo de dano, `basePower`/`power`/`amount` fixo,
`intervalMs`, `durationMs`, `speedPercent`) — os campos que o painel do `ActionConfigModal`
mostra. A leitura do invariante 4 que este ADR fixa: ele governa o que o cliente **manda**, nunca
o que ele **mostra**. Publicar o cooldown de uma magia ou a faixa de dano que o servidor vai
sortear não dá ao cliente nada que fabrique resultado — o servidor continua rolando com
`rng.integer(min, max)` em `casting.ts` e continua sendo o único que escreve vida, mana e gold. O
parágrafo de `catalogue.ts:12` citado acima é revertido por este ADR.

O que continua fora, e continua sendo a leitura certa do invariante 4: o que o cliente usaria para
**decidir** por conta própria — elegibilidade agora, cooldown corrente, estoque. Isso vem de
`slot-state` (AB-09), que muda a cada golpe e não é conteúdo fixado na sessão; o catálogo é.

### Decisão 2 — a conversão do Base Power mora em `content`

`spellPowerRange` (ADR 0026 decisão 5) sai de `packages/sim/src/casting.ts` e passa a viver em
`packages/content/src/spell-power.ts`, com a mesma assinatura e o mesmo comentário. `content` é a
única dependência que `sim` e `client` já têm em comum — `sim` importa a função de lá, e o
`ActionConfigModal` calcula a mesma fórmula como **prévia**, com o `level` e o
`skills.magic.level` que já chegam pela HUD. A rolagem de verdade (`rng.integer(min, max)`)
continua exclusiva do servidor: o cliente nunca decide o resultado, só antecipa o intervalo em
que ele vai cair. `bot.spellPower` viaja no catálogo com os três coeficientes
(`levelFactor`/`skillFactor`/`spread`) para essa prévia usar os mesmos números que o servidor usa.

### Decisão 3 — a régua do `ActionConfigModal` é a imagem do Tibia

A imagem do "Configurar ação" do cliente Tibia (anexa à issue #435) substitui
`docs/kit-reference/34-modal-action-config.png` (fixada em #426, AB-11) como a especificação
desta tela: abas Magias/Runas/Itens, lista + painel de detalhe, condições com operador por
extenso — nos tokens do design system vigente (ADR 0029). Isto emenda a decisão 1 do ADR 0030
("a composição renderizada do kit é a especificação da tela") só para este modal, e a linha AB-11
de `docs/hud-contract-plan.md`; as outras telas continuam na régua do `ui_kit` normal. Não é uma
reversão do ADR 0030 — é a mesma regra ("a imagem que o dono aprovou decide") aplicada a uma
imagem diferente, para uma tela onde o dono explicitamente trocou a referência.

## Alternativas

- **O servidor recalcula a faixa por personagem e manda por level-up** — descartado: exige
  protocolo e estado novos (uma mensagem por level-up, por magia, por personagem) só para
  entregar um número de PRÉVIA que o cliente já pode calcular sozinho com o que a HUD manda.
- **Copiar a fórmula no cliente** — descartado: duas implementações da mesma conversão divergem
  na primeira mudança de coeficiente que alguém esquecer de replicar, e é exatamente o defeito
  que mover para `content` evita — fonte única para `sim` e para o cliente.
- **Esconder a faixa e mostrar só o Base Power** — descartado: o BP é um número do TibiaWiki que
  o jogador não sabe interpretar (o "40" de Light Healing não diz "cura entre 50 e 69"); é o
  oposto do que a imagem pede.

## Consequências

O que fica mais fácil: o protocolo cresce só com campos opcionais SEM `default` — um nó `game`
anterior manda o catálogo sem `detail`/`spellPower`, e o cliente novo não recusa a mensagem, só
omite a linha do painel que falta (nenhum número inventado); a fórmula do Base Power tem UM
lugar (`grep -rn "function spellPowerRange" packages` devolve uma linha só); `docs/product/bot.md`
e `docs/hud-contract-plan.md`/`docs/hud-contract-tasks.md` (AB-11) passam a apontar para a régua
certa. O que fica mais difícil: nó `game` novo com cliente antigo continua funcionando (o cliente
antigo ignora os campos que não conhece), mas nó antigo com cliente novo mostra um painel
incompleto até o deploy terminar — é o preço normal de um campo opcional, não um bug. O que fica
fora: a aba "Prévia" (grade da área) e o ícone por magia (`appearanceId` de efeito) ficam como
trabalho futuro, com issue própria quando o dono pedir (seção 12 da spec de #435).

## Invariantes afetados

Nenhum muda; um é reafirmado com a leitura explícita acima. **4** (o cliente só manda intenção):
nada novo sai do cliente por esta task — `bot-config` continua a mesma mensagem; o número que o
painel mostra é uma prévia calculada localmente, e a rolagem de verdade continua
`rng.integer(min, max)` no servidor, em `casting.ts`. Mostrar ao jogador o que o servidor VAI
fazer não é o cliente decidindo o que o servidor faz.
