# Bot

**Status:** parcial — vocabulário v2 (`sets[4] × slots[24]`, AB-03), motor por grupo de cooldown
(AB-07), automações (AB-08), suprimento abstrato com gold no uso (AB-04), intenções `use-slot`/
`select-target`/`select-ammo` e migração v1→v2 (AB-09), barra de ações e painel de Automações
(AB-10…AB-13) implementados; postura (`stance`) e moedas são M21/M22
**PRD:** §13, §43.3
**Épico:** E4

## Comportamento

A automação é parte oficial do produto e roda inteiramente no servidor — o jogador configura a
**barra de ações**, e a hunt continua funcionando com o navegador fechado. A configuração é o
**vocabulário v2** (ADR 0032 decisão 1): quatro **conjuntos** (loadouts) de 24 slots cada, um
deles ativo. Cada slot guarda uma ação — magia (`spell`) ou suprimento (`supply`) —, uma lista
de condições ligadas por **E**, a tecla de atalho e a chave "automática". Não existe trava de
level: tudo vale desde o level 1 (ADR 0032 decisão 4).

O motor não tem mais categorias independentes. A **ordem do slot é a prioridade** (fileira 1 da
esquerda para a direita, depois a fileira 2) e a **cadência é o grupo de cooldown do conteúdo**
(`attack`/`healing`/`support` para magia, mais `potion` para poção e `attack` para runa). A cada
grupo pronto, os slots ligados são tentados em ordem; o primeiro que consegue executar tranca o
grupo pelo cooldown dele, e quem não consegue agora é **pulado no mesmo ciclo** — sem mana, sem
gold, sem alvo, ou em cooldown individual.

O jogador também administra targeting: mirar no alvo mais próximo, no de menor ou maior HP, ou
no alvo que ele escolheu clicando no mundo; priorizar ou ignorar criaturas específicas; e a
postura (parado na rota, seguir o alvo, manter distância).

Cinco **automações** fecham o vocabulário: renovar anel e colar quando acabam, trocar munição por
número de alvos, trocar arma/escudo por vida e o ring swap por vida/mana. Cada uma tem condições
de **entrada em OU** e de **saída em E**.

Por fim, quatro regras de saída configuráveis encerram a hunt: HP abaixo de um percentual, gold
zerado, membro da party perdido e capacidade estourada. Sem a regra de gold, o personagem fica na
hunt sem gold para pagar o próximo supply e pode morrer.

## Regras

- Vocabulário v2: `sets[4] × slots[24]`, `activeSet` (0–3), `hotkey` opcional e única dentro do
  conjunto e `auto` (ausente é ligada).
- Sem categorias e sem prioridade global: a ordem do slot é a prioridade, e o cooldown é o
  **grupo do conteúdo** da ação.
- Condições: `hp`, `mana`, `targets`, `target-hp` e `condition` (efeito ativo/ausente), com
  operadores `<`, `<=`, `>`, `>=`. `when` vazio é elegível sempre.
- Ações: `spell` e `supply`. O token `item` do v1 não existe mais.
- A tecla dispara `use-slot` na hora, ignorando `when` e `auto`; `enabled: false` continua
  valendo, e `auto: false` tira o slot do ciclo automático sem desligar a tecla.
- Sem trava de level (ADR 0032 d.4).
- Automações: `renew-ring`, `renew-amulet`, `swap-ammo-by-targets`, `swap-weapon-shield-by-hp`,
  `swap-ring`; entrada em OU, saída em E.
- Targeting: `nearest` (padrão), `lowest-hp`, `highest-hp`, `follow`; `prioritize`/`ignore` por
  id de monstro; postura `stand` (padrão), `follow`, `keep-distance`.
- Regras de saída: `hp-below`, `out-of-gold`, `party-member-lost`, `out-of-capacity`, com teto de
  4 slots em `bot/baseline.json`.
- Usar um supply debita o `price` do gold na hora (`useSupply`); o saldo nunca fica negativo, e a
  garantia é a ordem — o débito é recusado antes, não corrigido depois.
- Personagem sem configuração não agenda nada.

## O vocabulário, por inteiro (AB-03, ADR 0032 d.1)

Fechado, e é decisão do ADR 0002: o compilador só transforma em predicado o que conhece, e uma
linguagem de script no lugar disto seria código do jogador rodando no servidor. Versionado porque
a configuração é dado **persistido** — um vocabulário que muda sem número quebra a regra de quem
a salvou, em silêncio, e o sintoma é o bot parar de curar sem ninguém ligar uma coisa à outra.

**Versão atual: 2.** Configuração declarando outra versão é recusada com o número no motivo; a v1
salva é migrada na entrada (ver "Intenções e migração").

### Condições

`kind` é o nome da condição, não um rótulo ao lado dela — é o que faz a recusa apontar o campo
errado em vez de dizer "nenhuma variante casou".

| `kind` | Campos | O que testa |
|---|---|---|
| `hp` | `op`, `percent` (0–100) | HP do personagem, em percentual do máximo |
| `mana` | `op`, `percent` (0–100) | Mana do personagem, em percentual do máximo |
| `targets` | `op`, `count` (≥ 0) | Quantos alvos estão dentro do alcance do grupo (#152, #216, #444): o da arma, ou o da ação de dano à distância do grupo (uma runa de alcance 8 conta a 8) |
| `target-hp` | `op`, `percent` (0–100) | Vida do alvo atual. Sem alvo, a condição é falsa — nunca erro |
| `condition` | `conditionId`, `present` (padrão `true`) | Efeito ativo/ausente no personagem, por chave semântica (`haste`, `mana-shield`, `buff`) — "castar haste só sem haste" |

**Operadores:** `<`, `<=`, `>`, `>=`. **Sem `==`** — comparar percentual exato quase nunca
dispara, e é a armadilha que faz o jogador achar que configurou cura e não ter cura nenhuma.

### Ações

| `kind` | Campo | Catálogo |
|---|---|---|
| `spell` | `spellId` | `packages/content/data/spells/*.json` (FUN-74) |
| `supply` | `supplyId` | `packages/content/data/supplies/*.json` (FUN-77) — poção e runa |

O token `item` da v1 saiu com o AB-03 (ADR 0032 d.6): poção e runa voltaram a ser **suprimento
abstrato**, com `price`, `effect`, `requires` e `group` em `data/supplies/`, e o gold é debitado
no uso (ver `economy.md`). A carga de bênção continua item `kind: 'consumable'`, mas quem a
consome é a TP-03 (M22), não o bot.

Toda regra pode carregar `enabled: false` (#162): fica no slot, sai da avaliação. Ausente é
ligada. `auto: false` é outra coisa — o slot não entra no ciclo automático, mas a tecla continua
disparando.

A referência cruzada acontece na **validação**, nunca na execução: `validateBotConfigV2` confere
cada `spellId` e `supplyId` contra o catálogo e devolve o problema com o conjunto e o número do
slot. Uma regra que aponta magia inexistente e só falha ao ser disparada é o bot que para de
curar sem explicação — o formato exato que este vocabulário existe para impedir. A validação
também recusa tecla repetida dentro do conjunto.

### Exemplo

```jsonc
{
  "version": 2,
  "activeSet": 0,
  "sets": [
    { "slots": [
      { "do": { "kind": "spell", "spellId": "heal" },
        "when": [{ "kind": "hp", "op": "<=", "percent": 30 }],
        "hotkey": "1", "auto": true },
      { "do": { "kind": "supply", "supplyId": "mana-potion" },
        "when": [{ "kind": "mana", "op": "<", "percent": 20 }],
        "hotkey": "2", "auto": true },
      null, null, null, null, null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null, null
    ] },
    { "slots": [ /* 24 posições */ ] },
    { "slots": [ /* 24 posições */ ] },
    { "slots": [ /* 24 posições */ ] }
  ],
  "automations": [],
  "targeting": { "policy": "nearest", "prioritize": [], "ignore": [], "posture": { "kind": "stand" } },
  "exit": []
}
```

### Onde os limites moram

- `packages/content/src/schemas.ts` — `BOT_SET_COUNT` (4), `BOT_SLOTS_PER_SET` (24),
  `BOT_HOTKEYS` (1–9, 0, F1–F12) e o teto de regras de saída.
- `packages/content/data/bot/baseline.json` — `targetSearchRadius`, o teto de `exit`, o
  `defaultConfig` v1 legado, as baselines v2 por vocação e o cooldown de fallback
  (`categoryCooldownMs`, ainda lido pelo motor v2 como o intervalo padrão de um grupo sem
  cooldown próprio).
- Os **grupos de cooldown** vêm de `spell.group` (`data/spells/*.json`) e `supply.group`
  (`data/supplies/*.json`).

## Como a regra vira decisão (FUN-80, AB-07)

A configuração é **compilada ao entrar na sessão** (ADR 0002), uma vez, para um vetor de funções
puras `(view) => boolean`, agrupado pelo grupo de cooldown do conteúdo. Interpretar o JSON a cada
avaliação é o caminho fácil e errado: com 5.000 hunts e dezenas de slots por personagem, cada
avaliação alocaria o objeto de condição de novo, e alocação por evento é o que custa caro no
`sim`.

Três propriedades que o compilador garante, e que têm teste:

- **A avaliação não aloca.** A `BotView` é reaproveitada — os campos são reescritos antes de
  avaliar —, e a ação devolvida é a mesma referência do vetor compilado, não uma cópia.
- **A ordem do slot é a prioridade.** O vetor de cada grupo sai na ordem da barra, e quem
  percorre pula o inelegível no mesmo ciclo.
- **HP e Mana comparam percentual**, nunca valor absoluto. 40 de 100 e 400 de 1000 disparam a
  mesma regra — senão a mesma configuração mudaria de comportamento a cada level up.

**Sem alvo, `target-hp` é falsa** — não é erro. "Ataque quando o alvo estiver abaixo de 30%" não
vale quando não há alvo, e lançar ali derrubaria a sessão por uma regra escrita corretamente.

Quem **executa** a ação escolhida não é o compilador, e sim uma interface (`BotActuator`). Ela
devolve `false` quando a ação não aconteceu, porque um slot não pode gastar o cooldown de uma
ação que não aconteceu: seria o bot parando um segundo por ter tentado curar sem mana.

## A cadência: grupos de cooldown do conteúdo (AB-07, ADR 0032 d.2)

O motor v2 não tem relógios por categoria. Cada **grupo de cooldown do conteúdo** é um evento
independente na fila da sessão, e a ordem do slot é a prioridade dentro dele. A magia
de grupo tranca `group:<g>`; a ação sem grupo declarado cai num livro individual
(`spell:<id>`/`item:<id>`), para não inventar prioridade compartilhada que o conteúdo não
declarou.

Um grupo está sempre num de dois estados, e nunca nos dois:

| Estado | Quando | Custo |
|---|---|---|
| **agendado** | executou uma ação; volta no cooldown do grupo | um evento por cooldown |
| **engatilhado** | nenhum slot valeu, ou o atuador recusou por falta | **zero** até o mundo mudar |

Engatilhar em vez de reagendar no vazio é o que faz um bot configurado e sem nada a fazer custar
nada. Reavaliar é imediato quando o personagem **leva dano** ou quando uma ação do bot muda HP,
mana ou gold — esperar o próximo múltiplo de um relógio para curar quem está caindo custa a vida
do personagem.

**Atuador que recusa por falta não consome o cooldown.** Sem mana, sem gold, sem alvo ou fora de
alcance, a ação não aconteceu e o **próximo slot do mesmo grupo tenta agora**. A recusa por
**cooldown** é a exceção: ela carrega o prazo (`retryInMs`) e o grupo é reagendado para o
vencimento do livro que trancou — cooldown melhora com o tempo, e um grupo engatilhado por isso
ficaria dormindo até alguém bater no personagem.

**Slot desligado (`enabled: false`) ou manual-only (`auto: false`) não entra no vetor**, e
personagem sem bot configurado não agenda nada. O estado "agendado" viaja no snapshot: sem ele,
uma sessão retomada acharia o grupo engatilhado com um evento já na fila, e ele agiria duas vezes
por cooldown.

## Parâmetros de balanceamento

| Parâmetro | Valor atual | Onde mora |
|---|---|---|
| Conjuntos × slots | 4 × 24 | `packages/content/src/schemas.ts`, `BOT_SET_COUNT`/`BOT_SLOTS_PER_SET` |
| Teclas válidas | 1–9, 0, F1–F12 (22 para 24 slots) | `packages/content/src/schemas.ts`, `BOT_HOTKEYS` |
| Cooldown de fallback de um grupo | 1 s | `packages/content/data/bot/baseline.json`, `categoryCooldownMs` |
| Grupo de cooldown por magia | `attack` / `healing` / `support` | `packages/content/data/spells/*.json`, campo `group` |
| Grupo de cooldown por supply | `potion` / `attack` | `packages/content/data/supplies/*.json`, campo `group` |
| Preço do supply (gold no uso) | poção de vida 45; poção de mana 50; avalanche 14 `[ABERTO — provisório]` | `packages/content/data/supplies/*.json`, campo `price` |
| Preço do tiro de munição | arrow 1; burst arrow 3; sniper arrow 5; onyx arrow 7 `[ABERTO — provisório]` | `packages/content/data/ammunition/*.json`, campo `price` |
| Raio de busca de alvo | 8 tiles | `packages/content/data/bot/baseline.json`, `targetSearchRadius` |
| Teto de regras de saída | 4 | `packages/content/data/bot/baseline.json`, `slots.exit` |
| Baseline v2 por vocação (slots + automações) | cavaleiro: arma/escudo por vida; paladino: munição por alvos; sorcerer: renovar anel; druid: renovar colar `[ABERTO — provisório]` | `packages/content/data/bot/baseline.json`, `defaultConfigByVocation` |
| Lure dinâmico — mín/máx | escolha do jogador; mín 4 / máx 8 é o exemplo do PRD | `bot_config.lure` do personagem — não é conteúdo |
| Automação — limiares e parâmetros | escolha do jogador; baseline por vocação acima | `bot_config.automations` do personagem — não é conteúdo |

## Em aberto

- Vocabulário final de todas as condições possíveis do bot (§43.3).
- **Postura de combate** (`stance`: `offensive`/`balanced`/`defensive`) já existe no schema e no
  rascunho do cliente, mas o efeito sobre o combate é **M21** (ADR 0032 d.10) — não está em
  vigor no `sim`.
- **Baseline v2 por vocação**: `defaultConfigByVocation` é declarada e validada no boot, mas o
  `api` ainda semeia o personagem novo com o `defaultConfig` v1, migrado na entrada (ver
  "Divergências").

## Divergências do PRD

**`enabled` é opcional, não `default(true)`.** A spec original de #162 tinha
`enabled: z.boolean().default(true)`; a implementação usa `.optional()` com a mesma semântica
(ausente é ligada) porque um default explícito obrigaria as fixtures de regra existentes a
declarar o óbvio. `compileBot` filtra por `enabled !== false` na compilação.

**Sem trava de level, contra o §13.2.** O PRD descrevia um bot básico até o level 49 e o avançado
a partir do 50. O ADR 0032 decisão 4 revogou a trava: a barra, os conjuntos, o alvo, o lure e as
automações valem desde o level 1. `advancedFromLevel`/`advancedOnly` saíram do conteúdo e do
catálogo.

**Sem categorias, contra o §13.5.** O PRD descrevia cinco categorias independentes
(`heal`/`potion`/`attack`/`rune`/`support`). O ADR 0032 decisões 1–2 as substituíram pela barra
de 24 slots com prioridade por ordem e cooldown por grupo do conteúdo.

**A baseline por vocação existe, mas ainda não semeia o personagem.** O ADR 0032 d.4 previa que
a baseline por vocação ligasse as automações que fazem sentido (paladino: munição por alvos;
cavaleiro: arma/escudo por vida). `defaultConfigByVocation` está em
`packages/content/data/bot/baseline.json` e é validada no boot, mas `createCharacter` continua
gravando `content.bot.defaultConfig` (v1, genérico), migrado para v2 na entrada. As baselines v2
por vocação ainda não são consumidas pelo `server`.

**A migração v1→v2 mapeia o token `supply` para `supply`.** A configuração v1 salva (suprimento
abstrato) volta a apontar para `supplyId` em `data/supplies/`, e as baselines v2 por vocação também
usam `supply`. O token `item` do vocabulário intermediário (AB-01/AB-03) não existe mais.

## Histórico: decidido (ADR 0026), incorporado pelo ADR 0032

- **A tela vira um painel fixo na coluna da esquerda** (decisão 7). O painel v1 (`BotPanel`/
  `RuleEditor`) foi **aposentado no M18**: a barra de ações é a configuração, e o painel de
  Automações a substitui. `enabled` opcional e ausente é ligada continua valendo.
- **A categoria `rune` ganha o que lançar** (decisão 8): a Avalanche é o suprimento
  `avalanche-rune` de `data/supplies/`, e a ação `supply` a lança, com o gold debitado no uso.
- **Munição é seleção, não item** (decisão 3): flecha e virote são selecionadas por família, com
  `price` por tiro e level gate; o slot do Escudo mostra a escolhida e o `AmmoPicker` a troca.

## Quem executa: magia e suprimento (FUN-74, AB-04)

O atuador embutido é a **própria hunt**, e não uma classe à parte. Tudo o que ele precisa já está
lá: o alvo mais próximo, o RNG semeado da sessão, o relógio lógico e o pipeline de morte. Uma
classe separada receberia os quatro por parâmetro e não ganharia nada em troca.

O que ele faz, por tipo de ação:

| Ação | O que acontece | Recusa quando |
|---|---|---|
| `spell` com efeito `heal` | repõe HP do lançador, debita mana, inicia o cooldown da magia | level, vocação, cooldown, mana |
| `spell` com efeito `damage` | resolve o dano por `resolveDamage` com `kind: 'magic'`, aplica no alvo e **atribui** (`recordDamage`) | level, vocação, cooldown, sem alvo, fora de alcance, mana |
| `supply` `heal`/`mana` | repõe HP ou mana e **debita `price` do gold** no ato | sem gold |
| `supply` `damage` (runa) | mira como a magia em área, escala pelo magic level, aplica pelo mesmo `#applyHits` e **debita `price` do gold** | level, magic level, sem alvo, fora de alcance, sem gold |
| `item` com efeito `blessing` | nada — quem o executa é a TP-03 (M22) | sempre |

Três coisas que não podem mudar sem pensar duas vezes:

- **A mana sai por último.** Level, cooldown, alvo e alcance são conferidos antes de descontar.
  Descontar primeiro é como se perde mana sem lançar nada, e esse é o defeito que o jogador nota
  e não consegue explicar.
- **O cooldown da magia é dela, e é diferente do cooldown do grupo.** Uma cura de 4 s num grupo
  de 1 s sai a cada 4 s, não a cada 1 s. Os dois valores são conteúdo, e o maior manda.
- **O dano sai do motor de magia RESOLVIDO, não aplicado.** Quem aplica é quem tem o alvo, porque
  aplicar é também registrar a atribuição e resolver a morte — e a atribuição não pode ser paga
  duas vezes.

O saldo que a sessão enxerga é **o gold de entrada mais o delta da sessão**: o loot desta hunt já
dá para pagar a próxima poção sem passar pelo banco. O saldo nunca fica negativo, e a garantia é a
ordem — o débito é recusado antes, não corrigido depois.

### O débito no uso (AB-04, ADR 0032 d.6)

`useSupply` debita o `price` do supply do saldo do personagem no ato (`gold + goldDelta`) e leva o
gasto a `aggregates.goldSpent`. **Não há estoque a conferir nem lote a comprar:** o limitador é o
saldo. A recusa é `not-enough-gold`, e ela vem antes de qualquer efeito — sem gold, a poção não
cura e o gold não sai. Sem gold para o próximo uso, vale a regra de saída "acabar o gold".

O tiro de munição segue a mesma ordem: `#ammoFor` recusa sem saldo que cubra o `price`, e o débito
sai no `#strike`. Não existe munição grátis nem pilha de reserva.

## Alvo e postura (FUN-85)

§13.6. Até aqui a hunt tinha **uma** política, escrita no motor: o monstro mais próximo dentro do
alcance da arma. Ela continua sendo o padrão — e agora é um caso de uma política que vem da
configuração.

### Escolher o alvo

| Campo | Valores | O que faz |
|---|---|---|
| `policy` | `nearest`, `lowest-hp`, `highest-hp`, `follow` | mais perto, termina quem está quase morto, bate no mais gordo, ou persegue o alvo escolhido |
| `prioritize` | ids de monstro | um priorizado ganha de qualquer não-priorizado |
| `ignore` | ids de monstro | nunca é alvo, e **não conta** na condição `targets` |

`follow` é o alvo que o jogador escolheu clicando no mundo/Batalha (intenção `select-target`,
AB-09): o override vale enquanto o monstro vive e, ao morrer, cai em `nearest`.

**O alvo também é escolhido sozinho** (#444): ao surgir um monstro na tela — o raio de busca, os
mesmos 8 tiles — o motor o guarda como alvo pela política corrente, mesmo fora do alcance da arma.
É o que permite a uma runa de alcance 8 ser lançada num alvo a 5 tiles com arma corpo a corpo na
mão. O alvo persiste no `Runner` até o monstro morrer ou sair da tela, e atravessa o snapshot. O
clique do jogador continua tendo precedência: enquanto ele vive, o auto-target não o troca; e o
alvo do jogador é exclusivo — fora do alcance ele **não** cai na política, ao contrário do alvo do
auto-target, que é só a mira corrente e deixa o corpo a corpo bater em quem estiver colado.

A ordem de decisão é contrato, e é o que faz duas execuções da mesma semente escolherem o mesmo
monstro:

1. **priorizado ganha antes da política** — senão "mate o mago primeiro" só valeria quando o mago
   já estivesse mais perto, que é justamente quando não faz diferença;
2. dentro da mesma faixa, a política;
3. empate fica com quem **nasceu antes**. A varredura é na ordem da lista, e a comparação é
   estrita: o campeão só é trocado por quem ganha de verdade.

`ignore` vence `prioritize` quando o mesmo id está nas duas listas. É configuração contraditória
do jogador, e "não ataque" é a leitura conservadora.

Os ids são validados contra o **catálogo inteiro** de monstros, não contra a composição da hunt:
a configuração é do personagem e sobrevive à troca de hunt.

### Se posicionar

| `posture` | O que o personagem faz |
|---|---|
| `stand` (padrão) | percorre a rota e deixa o monstro vir — o comportamento de sempre (ADR 0009) |
| `follow` | sai da rota e persegue até chegar ao alcance da arma |
| `keep-distance` | mira a distância configurada: aproxima se está longe, **recua** se está perto |

É o primeiro caso em que o personagem **anda fora da rota por decisão própria**. Três coisas que
não podem mudar sem pensar duas vezes:

- **Escolher alvo e alcançar alvo são buscas diferentes.** Em quem bater é limitado pelo alcance
  da arma; atrás de quem andar é limitado pelo raio de visão (`targetSearchRadius`, em
  `bot/baseline.json`).
- **O passo sai pelo mesmo sistema de movimento.** `movement.ts` é o único escritor de posição
  (FUN-69), e a postura não é exceção. Perseguir usa o mesmo passo guloso do monstro; recuar usa
  o guloso com a ameaça espelhada.
- **Já estar na distância pedida é ficar parado**, não voltar a percorrer a rota. Voltar faria o
  personagem oscilar entre manter distância e seguir o laço.

Quando o alvo morre, a postura deixa de mandar e o passo volta a ser o da rota: o `rejoinNearest`
do walker reentra pelo tile mais próximo.

## Quando a hunt encerra sozinha (FUN-86)

§13.9. A configuração tem uma lista `exit`, com teto de 4 slots em `bot/baseline.json` — regra de
saída não age, ela **encerra**, e por isso vive fora dos grupos. O teto existe pela mesma razão
do teto de slots: a lista é avaliada a cada 250 ms, e nada no schema impediria mil regras salvas.

| `kind` | Dispara quando | Hoje |
|---|---|---|
| `hp-below` | o HP do personagem cai **abaixo** de `percent` | vale |
| `out-of-gold` | o saldo (entrada + delta) chega a zero | vale |
| `party-member-lost` | um companheiro saiu ou morreu | vale (#193): dispara no `onLeave` do outro, em cascata; quem sai leva o próprio extrato |
| `out-of-capacity` | o peso carregado (containers + equipado) alcança ou ultrapassa a capacidade total | vale (SV-06); sem faixa morta |

Cinco coisas que não podem mudar sem pensar duas vezes:

- **A comparação de HP é estrita.** Com `<=`, quem configurasse "sair abaixo de 100%" veria a
  hunt encerrar no instante em que entrasse, de vida cheia.
- **`out-of-gold` olha o SALDO, não o delta.** Delta negativo é qualquer um que gastou uma poção;
  saldo zero é quem não consegue comprar a próxima.
- **`party-member-lost` ignora o próprio personagem**, mesmo morto. Em party, sair e morrer são
  `leave`, não `end`: o último a sair encerra a sessão, com o motivo dele.
- **`out-of-capacity` não tem faixa morta, e é intencional.** As duas são binárias, ligou-desligou,
  sem número editável.
- **Encerra por `exit-rule`, nunca por `manual-exit`.** O jogador não pediu para sair; a regra
  dele decidiu.

O extrato registra **qual** regra disparou, e `hp-below` carrega o percentual no id
(`hp-below-30`). Sem a regra `out-of-gold`, gold zerado **não** encerra: o personagem fica, não
consegue pagar o próximo supply nem o próximo tiro e pode morrer.

### Onde o predicado é compilado, e por quê ali

`compileExitRules` mora em `rulesets/hunt.ts`, não no compilador do bot. O predicado lê a
`HuntView`, e `bot.ts` não conhece ruleset nenhum — nem pode, porque o mesmo bot vai valer para
quest e boss, que terão outra view.

## Como a configuração chega, e onde ela mora (FUN-81)

O jogador monta o bot na Cidade, entra na hunt, fecha o navegador — e a hunt roda com ele. Isso
exige que a configuração seja **durável** e que o processo que hospeda a sessão a tenha na mão.

| | quem | como |
|---|---|---|
| nascer | `api` | `createCharacter` grava `bot_config` com `content.bot.defaultConfig` (FUN-114) |
| aceitar/aplicar | `game` | mensagem `bot-config` no socket → regra ativa → pendência no Redis |
| persistir | `jobs` / `api` | pendência → `character.bot_config`; `api` processa antes da admissão |
| ler | `api` | lê a linha ao emitir o ticket; a configuração viaja em `InitialCharacter` |

**Todo personagem nasce com o bot padrão do conteúdo** (FUN-114), hoje o `defaultConfig` v1
genérico, migrado para v2 na primeira entrada. O [ADR 0028](../adr/0028-role-configuration-and-bot-write-behind.md)
substitui a escrita no Postgres pelo `game` que o ADR 0021 autorizava: Redis recebe uma pendência
por personagem, e `jobs` grava a preferência no ciclo de 10 s. Uma reconexão anterior ao ciclo
passa pela mesma gravação no `api`, antes do ticket, inclusive em party. A preferência não
movimenta valor e não gera linha econômica no ledger.

**A ordem é aceitar → aplicar → registrar no Redis → confirmar.** Uma falha no Redis não desfaz a
regra ativa, mas retorna falha de salvamento para o jogador tentar novamente. `ok: true` significa
que o Redis aceitou a preferência; Postgres pode recebê-la depois.

**Mudar no meio da hunt vale na hora.** A configuração é dado puro, então recompilar não tem
risco; quem recompila é a própria sessão (invariante 9), nunca outro processo.

**A configuração viaja no snapshot.** Uma hunt retomada em outro nó volta com o bot que estava
rodando — antes disto ela voltava sem nenhum, e o sintoma era o pior possível: a hunt seguia
andando e matando com o ataque básico, então nada parecia quebrado. O que sumia era a cura.

**E ela volta para a tela** (FUN-111): o `session-state` leva a configuração em vigor, e a tela
do bot abre com ela. A tela só a adota quando o rascunho local está intocado ou salvo: um
rascunho tocado e não salvo sobrevive à reconexão.

### O gate de level (§13.2) — histórico, revogado

Até o AB-03, o bot tinha um gate de level: até o level 49 valia o **básico**, do 50 em diante o
avançado, com o recorte em `bot/baseline.json` (`advancedOnly`) e a recusa
"bot avançado exige level 50: …". **O ADR 0032 decisão 4 revogou o gate**: `advancedFromLevel` e
`advancedOnly` saíram do conteúdo e do catálogo, e tudo vale desde o level 1. A seção fica como
histórico.

### Configuração salva que deixou de valer

Conteúdo muda: uma magia é renomeada, um vocabulário sobe de versão. Uma configuração guardada
que não passa mais na validação é **ignorada com aviso no log**, nunca fatal — derrubar a conexão
por isso trancaria o personagem fora do jogo por um arquivo de balanceamento. Ele entra sem bot,
que é degradação, e pode salvar outra.

## Automações (AB-08, ADR 0032 d.9)

As cinco automações rodam sobre o motor que já existia. São um **catálogo fechado** (ADR 0002
continua: vocabulário, nunca script): cada modelo tem `enabled`, parâmetros, condições de
**entrada em OU** e de **saída em E**, e o `sim` as compila junto com o bot.

**Entrada em OU, saída em E.** Uma automação age quando qualquer condição de entrada é
verdadeira, e desfaz quando todas as de saída são. `enter`/`exit` vazios são **falsos** — nunca
entra, nunca sai; o E vazio verdadeiro faria toda automação reverter no mesmo ciclo em que entrou.

| Modelo | Parâmetros | O que faz |
|---|---|---|
| `renew-ring` | `itemId` | com o dedo **vazio**, equipa o próximo anel da mochila |
| `renew-amulet` | `itemId` | com o colo **vazio**, equipa o próximo colar da mochila |
| `swap-ammo-by-targets` | `ammoA`, `ammoB` | entrada leva para `ammoA`, saída volta para `ammoB` |
| `swap-weapon-shield-by-hp` | `oneHanded`, `shield`, `twoHanded` | HP baixo pede uma mão + escudo; HP alto pede as duas mãos |
| `swap-ring` | `itemId`, `manaFloor`, `restorePrevious` | o ring swap do §13.8, agora com entrada em OU (HP e/ou alvos) |

**Renovar age no slot VAZIO.** O anel vence por duração e o colar esgota as cargas; os dois
deixam o slot vazio, e é o vazio que é o gatilho — com outro item no mesmo slot a automação não
age. Sem o item na mochila ela não faz nada e não avisa: virar erro por isso seria transformar
consumo previsto em falha.

**Arma/escudo é a única que precisa de ordem**, porque o inventário recusa `hands-full` (bow com
escudo, #152): desequipar antes de equipar libera a mão e o escudo. Os itens são validados antes
de qualquer mutação — a operação é transação (referência §25).

**`manaFloor` desativa o ring swap inteiro, e derruba o anel já equipado.** Desativar pela metade
— não equipar, mas manter o que está — gastaria mana exatamente quando ela é escassa.
`restorePrevious` decide o que acontece com o dedo na saída: devolve o anel que o jogador tinha
(guardado em `ringReplaced`, que viaja no snapshot) ou deixa vazio.

Os itens de cada automação são conferidos contra o catálogo **e contra o slot**: trocar o modelo
sem trocar o slot do item é o erro que só apareceria na hunt, e a validação o recusa com modelo,
item e slot esperado.

## Intenções e migração (AB-09, ADR 0032 d.1/d.3/d.5)

O cliente só manda **intenção** (invariante 4): quem decide elegibilidade, debita gold, gasta
mana e inicia cooldown é o servidor.

| Mensagem | Direção | O que carrega |
|---|---|---|
| `use-slot` | C2S | `{ set, slot }` — dispara o slot na hora; `set` defasado é recusa (`wrong-set`) |
| `select-target` | C2S | `{ creatureId }` — escolhe o alvo clicando no mundo/Batalha |
| `select-ammo` | C2S | `{ ammoId }` — escolhe a munição da família; o servidor valida `requires.level` e responde em `player-stats.ammo` |
| `slot-state` | S2C | o estado dos 24 slots do conjunto ativo: `ready`/`cooldown`/`blocked`/`empty`, `remainingMs` e o motivo em palavras |
| `slot-result` | S2C | a resposta ao `use-slot`: `ok` e, quando falso, o motivo para o tooltip |

**Manual é manual.** `use-slot` ignora as condições (`when`) e a chave automática (`auto`), mas
`enabled: false` continua valendo e o cooldown é conferido antes de executar — ação que não
aconteceu não inicia cooldown nenhum. Fora de uma hunt a intenção é recusada com motivo, nunca
escondida.

O `catalogue` v2 leva `vocabularyVersion`, `setCount`, `slotsPerSet`, `setNames`, `hotkeys`,
`groups`, `spells` e `automations` — a tela não tem lista de opções em código.

### `migrateBotConfigV1`

A configuração v1 salva é convertida para v2 de forma **determinística e idempotente**:

- as categorias entram em sequência (conjunto 1 primeiro) na ordem cura → poções → ataque →
  runas → suporte, preservando `enabled` e a ordem interna de cada categoria;
- `when` (condição única) vira `when: [ … ]` (lista E de um) e `auto: true`;
- o token de supply da v1 vira `supplyId` (o suprimento abstrato voltou a `data/supplies/`);
- as teclas entram em sequência (1–9, 0, F1–F12) e reiniciam a cada conjunto; 22 teclas para 24
  slots, então os dois últimos ficam sem;
- o excedente acima de 24 regras continua no conjunto 2, na mesma ordem — nada é descartado;
- `ringSwap` vira a automação `swap-ring`, com `enter`/`exit` derivados dos limiares.

Uma config já na v2 volta apenas parseada (idempotência). A detecção de "já é v2" é compartilhada
com o `server`, que precisa dela para saber se o que veio no ticket é dado novo a persistir.

## A tela (AB-10…AB-13)

**A barra de ações 2 × 12 é a configuração E a superfície de disparo manual** — um só
vocabulário. Ela é montada na Cidade e na caçada: a configuração é editável em qualquer lugar, e
a execução é do servidor. Ao lado dela, os seletores **CONJUNTO** (os quatro loadouts com nomes
fixos) e **ALVO** (a política), e o botão **⌖ LURE · FOLLOW** com a legenda do lure e da postura.

**Nada na tela tem lista de opções em código.** Conjuntos, slots, teclas, grupos, magias, itens,
suprimentos e modelos de automação vêm do `catalogue`. Se os dois divergirem sobre o que existe, o
jogador configura o que o bot recusa — e descobre isso pelo extrato que não fecha, não por uma
mensagem de erro.

**Nada de estado do bot é calculado no cliente**: o cooldown e o bloqueio vêm do `slot-state`, e a
recusa da tecla do `slot-result`. A munição selecionada vem do `player-stats.ammo`.

**O clique simples abre o `ActionConfigModal`**, redesenhado no M18 (#437, ADR 0033) na régua da
imagem do "Configurar ação" do cliente Tibia em vez do kit de três `Select` do #426: abas
**Magias / Runas / Itens** (magia é `bot.spells`; runa é `bot.supplies` com `group === 'attack'`;
item é o resto), uma lista à esquerda ordenada por level exigido e um painel de detalhe à
direita — título, `Lv. X+` (e `ML Y+` quando o suprimento exige), Tipo, Área, Tipo de dano, Dano/
Cura/Efeito, Custo, Cooldown e Descrição. A faixa de dano/cura (`min~max`) é calculada no cliente
por `spellPowerRange` (`@draconya/content`) a partir de `catalogue.bot.spellPower` e do level/magic
level do personagem — uma PRÉVIA da mesma fórmula que o servidor usa para sortear; a rolagem de
verdade continua exclusiva dele (invariante 4). Campo que o catálogo não manda (nó `game` anterior
à #436) nunca vira número inventado: a linha correspondente some. Abaixo, as condições e a tecla e
`auto` de sempre; trocar de aba não descarta a ação escolhida em outra. **Shift+clique desliga o
automático** (`auto: false`) — o atalho continua manual. O
`AutomationsPanel` lista uma linha por automação do rascunho (interruptor, nome, resumo dos
parâmetros, ⚙ e ×), com "+ Adicionar" abrindo o catálogo de modelos; os modais
`AddAutomationModal`/`AutomationConfigModal` editam. O `ExitRulesPopover` grava a lista `exit`.

**O interruptor salva sozinho.** Não há botão "Salvar" na barra: mudar o conjunto, o alvo, uma
regra ou uma automação agenda um `bot-config` com **debounce de 300 ms** (ADR 0028); o Salvar do
modal manda na hora. Sem conexão a tela diz por quê e o rascunho fica tocado.

**A ordem dos slots é a prioridade**, então mover uma regra para cima e para baixo é configurar.
A lista viaja como está — reordenar na hora de mandar mudaria o comportamento sem o jogador ter
pedido.

**Salvar é uma intenção.** O estado "salvo" só vira verdade quando o servidor responde
`bot-config-result` — tipado, e não uma frase num `system-message`. Uma recusa **não descarta** o
que o jogador escreveu, e mudar depois de salvar tira o "salvo" da tela.

O painel Bot v1 foi aposentado no mesmo marco que entregou a barra e o `AutomationsPanel`. A
munição voltou a ser abstrata: com bow/crossbow na mão, o slot do Escudo vira o `AmmoPicker` (a
seleção por família, com preço por tiro e level gate).
