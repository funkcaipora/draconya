# Bot

**Status:** parcial — vocabulário fechado e versionado (FUN-73), compilador de regras (FUN-80),
cadência por categoria (FUN-84), execução de magia e supply (FUN-74/FUN-77), targeting
configurável (FUN-85), regras de saída do jogador (FUN-86), configuração pelo socket com
persistência e gate de level (FUN-81) e o bot avançado — lure dinâmico e ring swap (FUN-87) —
implementados; a **UI** existe (FUN-89) — falta a parte avançada dela, que a issue deixou fora
do escopo até o servidor tê-la (e ele já tem, desde a FUN-87)
**PRD:** §13, §43.3
**Épico:** E4

## Comportamento

A automação é parte oficial do produto e roda inteiramente no servidor — o jogador configura regras, e a hunt continua funcionando mesmo com o client fechado. Do level 1 ao 49, o personagem usa um bot simplificado, inspirado na experiência do Huntera. A partir do level 50, o bot avançado é liberado, adicionando ferramentas como lure dinâmico e ring swap.

O bot é organizado em cinco categorias independentes, cada uma com seus próprios slots: Cura, Potions, Magias de ataque, Runas e itens, e Magias de suporte. Não existe prioridade global entre categorias — cada uma avalia seus próprios slots de cima para baixo, e a primeira regra válida encontrada é executada; as demais regras daquela categoria não executam naquele ciclo. Por exemplo, numa categoria de Cura configurada como "HP<=30% → cura forte", "HP<=55% → cura média", "HP<=80% → cura fraca", se a primeira regra for válida, as outras duas nem são avaliadas.

Cada categoria tem um cooldown próprio de 1 segundo, independente das outras — uma ação de Potion não consome o cooldown de Runa, por exemplo — além do cooldown específico da magia ou item usado, quando houver.

O bot também administra targeting: mirar no alvo mais próximo, no de menor ou maior HP, priorizar ou ignorar criaturas específicas, seguir o alvo, ficar parado, ou manter uma distância configurada.

O bot avançado (level 50+) adiciona duas máquinas de estado sobre o mesmo motor. A primeira é o lure dinâmico: o jogador define um intervalo mínimo/máximo de monstros — por exemplo, mínimo 4 e máximo 8 — e o personagem alterna entre percorrer a rota acumulando inimigos (quando a contagem está abaixo do mínimo) e parar para limpar o grupo (quando atinge o máximo), retomando o percurso quando a contagem volta a cair abaixo do mínimo. A segunda é o ring swap: uma máquina de estados para Energy Ring e anéis semelhantes, com limiares de entrada e saída propositalmente diferentes para evitar troca repetitiva perto do mesmo percentual (por exemplo: equipar com HP < 50%, retirar com HP >= 60%, ou retirar por Mana < 10%). Ao retirar, o jogador escolhe entre restaurar o anel anteriormente equipado ou deixar o slot vazio.

Por fim, o jogador pode configurar duas regras automáticas de saída da hunt: sair se algum membro da party sair ou morrer, e sair se o próprio gold acabar. Se a segunda regra não estiver ativa e o gold acabar, o personagem permanece na hunt, incapaz de pagar supplies, e pode morrer.

## Regras

- Bot básico: do level 1 ao 49. Bot avançado: a partir do level 50.
- Cinco categorias independentes, cada uma com cooldown próprio de 1 segundo (além do cooldown da magia/item usado, se houver).
- Sem prioridade global entre categorias; dentro de cada categoria, avaliação de cima para baixo, primeira regra válida executa e interrompe a avaliação daquela categoria naquele ciclo.
- Uma ação de uma categoria não consome, por padrão, o cooldown de outra categoria.
- Condições da categoria Cura: HP e Mana, com operadores `<`, `>`, `<=`, `>=`.
- Potions: 2 slots de vida e 2 de mana; Spirit Potion pode ser elegível para ambas as categorias.
- Targeting suportado: mais próximo, menor HP, maior HP, priorizar específicas, ignorar específicas, seguir alvo, permanecer parado, manter distância configurada.
- Lure dinâmico: intervalo mínimo/máximo de monstros configurável; abaixo do mínimo percorre a rota acumulando, no máximo para e limpa, retoma quando cai abaixo do mínimo de novo.
- Ring swap: limiares de entrada e saída distintos (histerese); ao retirar, jogador escolhe restaurar o anel anterior ou deixar o slot vazio.
- Regras de saída configuráveis: (1) sair se membro da party sair/morrer; (2) sair se o próprio gold acabar. Sem a regra (2) ativa, gold zerado não tira o personagem da hunt.

## O vocabulário, por inteiro (FUN-73)

Fechado, e é decisão do ADR 0002: o compilador só transforma em predicado o que conhece, e uma
linguagem de script no lugar disto seria código do jogador rodando no servidor. Versionado
porque a configuração é dado **persistido** — um vocabulário que muda sem número quebra a regra
de quem a salvou, em silêncio, e o sintoma é o bot parar de curar sem ninguém ligar uma coisa à
outra.

**Versão atual: 1.** Configuração declarando outra versão é recusada com o número no motivo.

### Condições

`kind` é o nome da condição, não um rótulo ao lado dela — é o que faz a recusa apontar o campo
errado em vez de dizer "nenhuma variante casou".

| `kind` | Campos | O que testa |
|---|---|---|
| `hp` | `op`, `percent` (0–100) | HP do personagem, em percentual do máximo |
| `mana` | `op`, `percent` (0–100) | Mana do personagem, em percentual do máximo |
| `targets` | `op`, `count` (≥ 0) | Quantos alvos estão dentro do alcance da arma (#152, #216) |
| `target-hp` | `op`, `percent` (0–100) | Vida do alvo atual. Sem alvo, a condição é falsa — nunca erro |

**Operadores:** `<`, `<=`, `>`, `>=`. **Sem `==`** — comparar percentual exato quase nunca
dispara, e é a armadilha que faz o jogador achar que configurou cura e não ter cura nenhuma.

### Ações

| `kind` | Campo | Catálogo |
|---|---|---|
| `spell` | `spellId` | `packages/content/data/spells/*.json` (FUN-74) |
| `supply` | `supplyId` | `packages/content/data/supplies/*.json` (FUN-77; a runa de ataque, #165, é supply e vai na categoria `rune`) |
| `item` | `itemId` | `packages/content/data/items/*.json` (FUN-76) — a regra é **sempre** recusada: o catálogo existe, mas falta o atuador que usa item (#160 deu o inventário, não o atuador) |

Toda regra pode carregar `enabled: false` (#162): fica no slot, sai da avaliação. Ausente é ligada.

A referência cruzada acontece na **validação**, nunca na execução: `validateBotConfig` confere
cada `spellId` e `supplyId` contra o catálogo e devolve o problema com a categoria e o número do
slot. Uma regra que aponta magia inexistente e só falha ao ser disparada é o bot que para de
curar sem explicação — o formato exato que este vocabulário existe para impedir. É o mesmo
mecanismo que `buildContent` já usa em `loot.items`, e `item` segue recusado pela mesma razão que
`loot.items` só aceita lista vazia.

### Exemplo

```jsonc
{
  "version": 1,
  "heal":    [{ "when": { "kind": "hp", "op": "<=", "percent": 30 },
                "do": { "kind": "spell", "spellId": "strong-heal" } }],
  "potion":  [{ "when": { "kind": "mana", "op": "<", "percent": 20 },
                "do": { "kind": "supply", "supplyId": "mana-potion" } }],
  "attack":  [{ "when": { "kind": "targets", "op": ">=", "count": 3 },
                "do": { "kind": "spell", "spellId": "wave" } }],
  "rune": [], "support": []
}
```

### Onde os limites moram

`packages/content/data/bot/baseline.json` — slots por categoria, cooldown de categoria e o level
do bot avançado. Em conteúdo e não em código, porque é balanceamento: um designer precisa
alcançá-lo sem deploy.

Isto é o contrato. A avaliação é a FUN-80, a execução é a FUN-74/FUN-77, e a configuração pelo
socket segue sendo a FUN-81 — até ela existir, nenhum personagem tem bot configurado.

## Como a regra vira decisão (FUN-80)

A configuração é **compilada ao entrar na sessão** (ADR 0002), uma vez, para um vetor de funções
puras `(view) => boolean`. Interpretar o JSON a cada avaliação é o caminho fácil e errado: com
5.000 hunts e cinco categorias por personagem, cada avaliação alocaria o objeto de condição de
novo, e alocação por evento é o que custa caro no `sim`.

Três propriedades que o compilador garante, e que têm teste:

- **A avaliação não aloca.** A `BotView` é reaproveitada — os campos são reescritos antes de
  avaliar —, e a ação devolvida é a mesma referência do vetor compilado, não uma cópia.
- **Primeira válida executa** (§13.4) é a ordem do vetor, e a avaliação **para** ali: com
  "HP≤30 → forte", "HP≤55 → média", "HP≤80 → fraca" e HP em 20%, as duas de baixo nem são
  consultadas.
- **HP e Mana comparam percentual**, nunca valor absoluto. 40 de 100 e 400 de 1000 disparam a
  mesma regra — senão a mesma configuração mudaria de comportamento a cada level up.

**Sem alvo, `target-hp` é falsa** — não é erro. "Ataque quando o alvo estiver abaixo de 30%" não
vale quando não há alvo, e lançar ali derrubaria a sessão por uma regra escrita corretamente.

Quem **executa** a ação escolhida não é o compilador, e sim uma interface (`BotActuator`) — não
um `if` lá dentro que cresce a cada categoria nova. Ela devolve `false` quando a ação não
aconteceu, porque uma categoria não pode gastar o cooldown de uma ação que não aconteceu: seria
o bot parando um segundo por ter tentado curar sem mana.

## A cadência: cinco categorias, cinco relógios (FUN-84)

Cada categoria é um **evento independente** na fila da sessão. Não existe prioridade global
(§13.4): uma cura que executa não atrasa o ataque, porque são vencimentos separados.

Uma categoria está sempre num de dois estados, e nunca nos dois:

| Estado | Quando | Custo |
|---|---|---|
| **agendada** | executou uma ação; volta no cooldown da categoria | um evento por cooldown |
| **engatilhada** | nenhuma regra valeu, ou o atuador recusou | **zero** até o mundo mudar |

Engatilhar em vez de reagendar no vazio é o que faz um bot configurado e sem nada a fazer custar
nada. Reavaliar é imediato quando o personagem **leva dano** — esperar o próximo múltiplo de um
relógio para curar quem está caindo custa a vida do personagem, e é a mesma perda que o golpe
engatilhado da FUN-68 corrigiu do outro lado.

**Atuador que recusa não consome o cooldown.** Sem mana ou sem gold, a ação não aconteceu — e a
categoria não pode ficar um segundo parada por ter tentado.

**A recusa por cooldown é a exceção, e ela reagenda** (FUN-74). "Sem mana" e "sem gold" não
melhoram com o tempo passar, então engatilhar é certo: a categoria volta quando o mundo mudar.
"Em cooldown" melhora, e só com o tempo — uma categoria engatilhada por isso ficaria dormindo
até alguém bater no personagem, e um personagem parado, sangrando, com a cura em cooldown,
simplesmente nunca curaria. Por isso a recusa carrega o **prazo** (`retryInMs`), e a categoria é
reagendada para o vencimento dele.

**Categoria sem regra não entra na fila**, e personagem sem bot configurado não agenda nada. Os
cinco eventos por segundo por hunt que isto orça só existem para quem configurou — e até a
FUN-81 não existe configuração, então o custo medido é zero: `pnpm bench:hunts` deu 17,1 µs por
tick contra 21,0 µs na `main`, diferença dentro da variância entre execuções.

O estado de "agendada" entra no **snapshot**. Sem ele, uma sessão retomada acharia a categoria
engatilhada com um evento já na fila, e ela agiria duas vezes por cooldown — a mesma invariante
que o golpe do personagem protege, e que já quebrou uma vez lá.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Level máximo do bot básico | 49 (avançado a partir de 50) | caminho previsto: `packages/content/bot` |
| Slots — Cura | 3 | caminho previsto: `packages/content/bot` |
| Slots — Potions | 4 (2 vida + 2 mana) | caminho previsto: `packages/content/bot` |
| Slots — Magias de ataque | 10 | caminho previsto: `packages/content/bot` |
| Slots — Runas e itens | 10 | caminho previsto: `packages/content/bot` |
| Avalanche Rune — preço por uso / requisitos | 14 gold; level 30, magic level 4 (provisórios) | `packages/content/data/supplies/avalanche-rune.json` |
| Slots — Magias de suporte | 10 | caminho previsto: `packages/content/bot` |
| Cooldown por categoria | 1s | caminho previsto: `packages/content/bot` |
| Teto de ações por segundo por personagem | 5 (derivado: 5 categorias × 1 cooldown cada — não é número do PRD, é consequência calculada em `docs/technical-architecture.md` §5) | caminho previsto: `packages/content/bot` |
| Lure dinâmico — mín/máx | escolha do jogador; mín 4 / máx 8 é o exemplo do PRD | `bot_config.lure` do personagem — não é conteúdo |
| Ring swap — limiares | escolha do jogador; equipar HP<50%, retirar HP>=60%, Mana<10% é o exemplo do PRD | `bot_config.ringSwap` do personagem — não é conteúdo |

## Em aberto

- Subconjunto exato de opções disponíveis no bot básico (pré-level 50) — deve ser definido a partir do bot completo (§13.2, §43.3). O mecanismo existe e é dado (`advancedOnly` em `bot/baseline.json`); falta o recorte.
- Vocabulário final de todas as condições possíveis do bot (§43.3).

## Divergências do PRD

**`enabled` é opcional, não `default(true)`.** A spec original de #162 tinha
`enabled: z.boolean().default(true)`; a implementação usa `.optional()` com a mesma semântica
(ausente é ligada) porque um default explícito obrigaria as ~86 fixtures de regra existentes a
declarar o óbvio. `compileBot` filtra por `enabled !== false` na compilação, não pelo valor
materializado pelo schema (PR #175).

## Decidido (ADR 0026): painel fixo, interruptor por regra, runa

- **A tela vira um painel fixo na coluna da esquerda**, abaixo da lista de hunts, no estilo do
  vBot do OTClientV8 (MIT): uma linha compacta por regra com um interruptor liga/desliga, a
  edição fina (condição, operador, valor, ação) por cima; minimizável pela barra do topo, nunca
  removível. A regra ganha `enabled?: boolean`, opcional e ausente é ligada (ver
  "Divergências"), e o compilador pula a desligada. É o PRD §5.3 (bot à esquerda). Issue #162.
- **A categoria `rune` ganha o que lançar**: a Avalanche entra como supply de ataque em área
  (decisão 8), com requisito de level e magic level e preço por uso. Issue #165 — entregue;
  a tela tranca a opção abaixo do level, e quem recusa é o servidor. Detalhe em
  `docs/product/combat.md` §"Runa é supply de ataque".

## Quem executa: magia e supply (FUN-74, FUN-77)

O atuador embutido é a **própria hunt**, e não uma classe à parte. Tudo o que ele precisa já está
lá: o alvo mais próximo, o RNG semeado da sessão, o relógio lógico e o pipeline de morte. Uma
classe separada receberia os quatro por parâmetro e não ganharia nada em troca.

O que ele faz, por tipo de ação:

| Ação | O que acontece | Recusa quando |
|---|---|---|
| `spell` com efeito `heal` | repõe HP do lançador, debita mana, inicia o cooldown da magia | level insuficiente, cooldown, mana |
| `spell` com efeito `damage` | resolve o dano por `resolveDamage` com `kind: 'magic'`, aplica no monstro mais próximo e **atribui** (`recordDamage`) | level, cooldown, sem alvo, fora de alcance, mana |
| `supply` com efeito `heal`/`mana` | repõe HP ou mana e **debita gold** | gold insuficiente |
| `supply` com efeito `damage` (runa, #165) | mira como a magia em área, escala pelo magic level, aplica pelo mesmo `#applyHits` e **debita gold** | level, magic level, sem alvo, fora de alcance, gold — nesta ordem; sem cooldown próprio |
| `item` | nada | sempre — o catálogo existe, mas falta o atuador que usa item |

Três coisas que não podem mudar sem pensar duas vezes:

- **A mana sai por último.** Level, cooldown, alvo e alcance são conferidos antes de descontar.
  Descontar primeiro é como se perde mana sem lançar nada, e esse é o defeito que o jogador nota
  e não consegue explicar.
- **O cooldown da magia é dela, e é diferente do cooldown da categoria.** Uma cura de 4 s numa
  categoria de 1 s sai a cada 4 s, não a cada 1 s. Os dois valores são conteúdo, e o maior manda.
- **O dano sai do motor de magia RESOLVIDO, não aplicado.** Quem aplica é quem tem o alvo, porque
  aplicar é também registrar a atribuição e resolver a morte — e a atribuição não pode ser paga
  duas vezes.

O saldo que a sessão enxerga é **o gold de entrada mais o delta da sessão**: o loot desta hunt já
dá para virar poção sem passar pelo banco. O saldo nunca fica negativo, e a garantia é a ordem —
o débito é recusado antes, não corrigido depois.

## Alvo e postura (FUN-85)

§13.6. Até aqui a hunt tinha **uma** política, escrita no motor: o monstro mais próximo dentro do
alcance da arma. Ela continua sendo o padrão — e agora é um caso de uma política que vem da
configuração.

### Escolher o alvo

| Campo | Valores | O que faz |
|---|---|---|
| `policy` | `nearest`, `lowest-hp`, `highest-hp` | mais perto, termina quem está quase morto, ou bate no mais gordo |
| `prioritize` | ids de monstro | um priorizado ganha de qualquer não-priorizado |
| `ignore` | ids de monstro | nunca é alvo, e **não conta** na condição `targets` |

A ordem de decisão é contrato, e é o que faz duas execuções da mesma semente escolherem o mesmo
monstro:

1. **priorizado ganha antes da política** — senão "mate o mago primeiro" só valeria quando o mago
   já estivesse mais perto, que é justamente quando não faz diferença;
2. dentro da mesma faixa, a política;
3. empate fica com quem **nasceu antes**. A varredura é na ordem da lista, e a comparação é
   estrita: o campeão só é trocado por quem ganha de verdade.

`ignore` vence `prioritize` quando o mesmo id está nas duas listas. É configuração contraditória
do jogador, e "não ataque" é a leitura conservadora — a outra ordem faria o bot atacar exatamente
quem foi mandado deixar em paz.

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
  `bot/baseline.json`). Enquanto as duas eram a mesma busca, "seguir o alvo" não tinha como ser
  expresso — quem já está ao alcance não precisa ser seguido.
- **O passo sai pelo mesmo sistema de movimento.** `movement.ts` é o único escritor de posição
  (FUN-69), e a postura não é exceção. Perseguir usa o mesmo passo guloso do monstro; recuar usa
  o guloso com a ameaça espelhada, que dá a direção oposta sem um segundo algoritmo.
- **Já estar na distância pedida é ficar parado**, não voltar a percorrer a rota. Voltar faria o
  personagem oscilar entre manter distância e seguir o laço, e de fora isso parece o bot travado.

Quando o alvo morre, a postura deixa de mandar e o passo volta a ser o da rota: o `rejoinNearest`
do walker reentra pelo tile mais próximo. É o mesmo caminho de quem foi empurrado para fora.

`keep-distance` só faz sentido com arma de alcance maior que 1 — o bow (6) e a wand/rod (3)
existem desde a #152, e `#attackRangeOf` já lê o alcance da arma equipada.

### Por que a versão do vocabulário NÃO subiu

Todo campo de `targeting` tem default, e o bloco inteiro tem: uma configuração salva antes desta
issue continua válida e ganha `nearest` + `stand`, que é o que ela já fazia. Subir
`BOT_VOCABULARY_VERSION` invalidaria configuração de jogador para acrescentar um campo que ela nem
precisa ter — o oposto do que o versionamento existe para proteger.

## Quando a hunt encerra sozinha (FUN-86)

§13.9. A configuração tem uma lista `exit`, com teto de 4 slots em `bot/baseline.json` — regra de
saída não age, ela **encerra**, e por isso vive fora das cinco categorias. O teto existe pela
mesma razão que o das categorias: a lista é avaliada a cada 250 ms, e nada no schema impediria
mil regras salvas.

| `kind` | Dispara quando | Hoje |
|---|---|---|
| `hp-below` | o HP do personagem cai **abaixo** de `percent` | vale |
| `out-of-gold` | o saldo (entrada + delta) chega a zero | vale |
| `party-member-lost` | um companheiro saiu ou morreu | vale (#193): dispara no `onLeave` do outro, em cascata; quem sai leva o próprio extrato |

Quatro coisas que não podem mudar sem pensar duas vezes:

- **A comparação de HP é estrita.** Com `<=`, quem configurasse "sair abaixo de 100%" veria a
  hunt encerrar no instante em que entrasse, de vida cheia, sem ter tomado um golpe.
- **`out-of-gold` olha o SALDO, não o delta.** Delta negativo é qualquer um que gastou uma poção;
  saldo zero é quem não consegue comprar a próxima. Olhar o delta encerraria a hunt de quem tem
  mil de gold e gastou um.
- **`party-member-lost` ignora o próprio personagem**, mesmo morto. Sem isso, quem morre sozinho
  encerraria por "companheiro caiu" em vez de por morte — e o motivo é o que o jogador lê ao
  voltar. Desde o #193 ela não é predicado periódico: dispara quando OUTRO membro sai (por
  morte, regra ou pedido), em cascata e na ordem de entrada, e quem a tem SAI — `exit-rule` no
  extrato dele; os outros ficam. Em party, sair e morrer são `leave`, não `end`: o último a
  sair encerra a sessão, com o motivo dele.
- **Encerra por `exit-rule`, nunca por `manual-exit`.** O jogador não pediu para sair; a regra
  dele decidiu. Trocar os dois é o extrato mentindo sobre quem encerrou.

O extrato registra **qual** regra disparou, e `hp-below` carrega o percentual no id
(`hp-below-30`): duas regras de HP com limites diferentes precisam ser distinguíveis na tela de
retorno. "Sua hunt encerrou por uma regra de saída", sem dizer qual, é a mensagem que faz o
jogador desconfiar do bot que ele mesmo configurou.

Sem a regra `out-of-gold`, gold zerado **não** encerra: o personagem fica, não paga o supply e
pode morrer. São as duas metades do §20.3, e a diferença entre elas é uma linha na configuração.

### Onde o predicado é compilado, e por quê ali

`compileExitRules` mora em `rulesets/hunt.ts`, não no compilador do bot. O predicado lê a
`HuntView`, e `bot.ts` não conhece ruleset nenhum — nem pode, porque o mesmo bot vai valer para
quest e boss, que terão outra view. O compilador entrega a regra crua; quem tem a view é quem
sabe fechar a closure.

## Como a configuração chega, e onde ela mora (FUN-81)

O jogador monta o bot na Cidade, entra na hunt, fecha o navegador — e a hunt roda com ele. Isso
exige que a configuração seja **durável** e que o processo que hospeda a sessão a tenha na mão.

| | quem | como |
|---|---|---|
| nascer | `api` | `createCharacter` grava `bot_config` com `content.bot.defaultConfig` (FUN-114) |
| aceitar/aplicar | `game` | mensagem `bot-config` no socket → regra ativa → pendência no Redis |
| persistir | `jobs` / `api` | pendência → `character.bot_config`; `api` processa antes da admissão |
| ler | `api` | lê a linha ao emitir o ticket; a configuração viaja em `InitialCharacter` |

**Todo personagem nasce com o bot padrão do conteúdo** (FUN-114): cura a 70 % de HP, poção de
vida a 40 %, Golpe Arcano com alvo ao alcance — `bot/baseline.json`, campo `defaultConfig`,
validado no boot pelo mesmo juiz que julga a configuração do jogador. Até aí o personagem novo
entrava na primeira hunt só no golpe básico até abrir a tela e escrever regras, e "magia + poção"
do MVP não existiam no primeiro minuto. Personagem criado antes disso continua como estava: a
coluna dele é dele. Os limiares são ponto de partida (`_open`), não balanceamento decidido.

O [ADR 0028](../adr/0028-role-configuration-and-bot-write-behind.md) substitui a escrita
no Postgres pelo `game` que o ADR 0021 autorizava. Modo solo e separado usam o mesmo caminho:
Redis recebe uma pendência por personagem, e `jobs` grava a preferência no ciclo de 10 s.
Uma reconexão anterior ao ciclo passa pela mesma gravação no `api`, antes do ticket, inclusive
em party. A preferência não movimenta valor e não gera linha econômica no ledger.

**A ordem é aceitar → aplicar → registrar no Redis → confirmar.** Uma falha no Redis não
desfaz a regra ativa, mas retorna falha de salvamento para o jogador tentar novamente. `ok: true`
significa que o Redis aceitou a preferência; Postgres pode recebê-la depois. Falha do banco
mantém a pendência sem TTL; a perda do Redis nessa janela ainda pode perder a edição.

Consumidores travam a linha antes de ler a pendência e removem apenas o envelope que gravaram,
depois do commit. Isso protege edições concorrentes e retry. O contrato completo, operação e
limites estão em [`runtime-configuration.md`](../runtime-configuration.md).

**Mudar no meio da hunt vale na hora.** A configuração é dado puro, então recompilar não tem
risco; quem recompila é a própria sessão (invariante 9), nunca outro processo. As regras de saída
vão junto: deixar as antigas valendo faria a hunt encerrar por uma regra que o jogador acabou de
apagar.

**A configuração viaja no snapshot.** Uma hunt retomada em outro nó volta com o bot que estava
rodando — antes disto ela voltava sem nenhum, e o sintoma era o pior possível: a hunt seguia
andando e matando com o ataque básico, então nada parecia quebrado. O que sumia era a cura.

O banco é a fonte para **começar** uma hunt; o snapshot é a fonte para **continuar** a que já
estava rodando. Não é duplicação — são dois instantes da mesma coisa, e a sessão é a dona
enquanto roda.

**E ela volta para a tela** (FUN-111): o `session-state` leva a configuração em vigor — a do
ticket ou a última aceita —, e a tela do bot abre com ela. Até aí a tela nascia vazia a cada
carregamento, e um "Salvar" dali apagava as regras que a hunt estava executando. A tela só a
adota quando o rascunho local está intocado ou salvo: um rascunho tocado e não salvo — editado,
pendente ou recusado, mesmo que apagado até ficar igual ao vazio — sobrevive à reconexão, pela
mesma razão que sobrevive a uma recusa. `lure` e `ringSwap`, que nenhuma tela edita, passam
opacos pelo rascunho: um "Salvar" de quem só mexeu na cura não apaga o anel.

### O gate de level (§13.2)

Até o level 49 vale o bot **básico**; do 50 em diante, o avançado. O recorte é **dado**, em
`bot/baseline.json`, como uma lista do que só o avançado pode usar — e não como uma lista do que
o básico permite: descrever a regra por enumeração faria toda adição ao vocabulário exigir uma
edição ali para continuar funcionando, e esquecer essa edição travaria o recurso novo para todo
mundo abaixo do 50.

**A lista está vazia hoje, e isso é deliberado.** O subconjunto exato do bot básico é `[ABERTO]`
no PRD §13.2. Preencher a lista agora seria decidir balanceamento por conta própria e disfarçá-lo
de implementação. O mecanismo está pronto e tem teste; o recorte entra editando dado, quando o
PRD o decidir.

**Lure dinâmico e ring swap são a exceção, e ela é fixa em código.** Os dois são avançados
**por nome no §13.2** — é a única coisa que aquele parágrafo decide —, então `advancedFeaturesUsed`
os reconhece direto, sem passar pela lista. A diferença entre os dois casos é o que separa
implementar de inventar: aqui seguir a especificação é fixar em código; lá seria escolher
balanceamento e disfarçá-lo de implementação.

A recusa diz **o quê**, não só que recusou: "bot avançado exige level 50: alvo lowest-hp". Um
aviso genérico deixa o jogador procurando qual das trinta regras dele é a culpada.

### Configuração salva que deixou de valer

Conteúdo muda: uma magia é renomeada, um vocabulário sobe de versão. Uma configuração guardada
que não passa mais na validação é **ignorada com aviso no log**, nunca fatal — derrubar a conexão
por isso trancaria o personagem fora do jogo por um arquivo de balanceamento. Ele entra sem bot,
que é degradação, e pode salvar outra.

## O bot avançado: duas máquinas de estado (FUN-87, §13.7 e §13.8)

As duas rodam sobre o motor que já existia — nenhuma delas trouxe evento, laço ou varredura
nova. Ficam ligadas a decisões que a hunt já tomava: o lure entra na decisão de **parar para
lutar**, no vencimento do passo; o ring swap entra onde HP e mana **acabaram de mudar**.

**Os dois são recusados abaixo do level 50** pelo gate do §13.2, por nome — ver acima.

### Lure dinâmico: `lure: { min, max }`

O jogador diz entre quantos monstros quer lutar. Abaixo do máximo o personagem **não para**:
ele percorre a rota com quem está colado nele, e o passo guloso dos monstros faz o resto —
não há pathfinding novo, nem rota de fuga, nem "puxar" como verbo separado.

```
correndo  --(contagem chegou em `max`)-->    lutando
lutando   --(contagem caiu abaixo de `min`)--> correndo
```

**Os dois limiares existem para não oscilar.** Com um só, cada monstro que morre em cima do
número faria o personagem alternar entre correr e parar — e quem alterna não faz nem uma coisa
nem outra. Entre `min` e `max` a máquina não muda de estado, por construção.

Correndo, ele **continua atacando** quem estiver ao alcance. O que o lure muda é parar, não
bater: um personagem que corre sem atacar junta um bando que ele nunca começa a limpar, e a
hunt inteira vira uma volta olímpica.

A contagem usa o **raio de busca** (8 tiles por padrão), não o alcance de ataque: "juntar" é
sobre quem está vindo atrás, não sobre quem já encostou. E ela ignora quem o jogador mandou
ignorar (FUN-85) — uma onda disparada por causa de quem o bot não vai atacar é a regra reagindo
ao que ela não atinge.

O estado (`luring`) **viaja no snapshot**. Uma hunt retomada no meio de um lure voltaria
correndo e juntaria por cima do bando que já estava junto.

### Ring swap: `ringSwap: { itemId, equipBelow, removeAbove, manaFloor, restorePrevious }`

```
sem anel  --(HP < `equipBelow`  E  mana >= `manaFloor`)-->  com anel
com anel  --(HP > `removeAbove` OU mana <  `manaFloor`)-->  sem anel
```

**`removeAbove` tem de ser maior que `equipBelow`, e o schema recusa o contrário.** Limiares
iguais apagam a faixa morta: o HP parado em cima do número trocaria o anel a cada golpe, e cada
troca é uma ação que o personagem não usou para lutar. É o mesmo motivo do lure, no eixo do HP.

`manaFloor` **desativa a máquina inteira**, e derruba o anel já equipado. Um anel que custa mana
não vale a mana que falta para curar; desativar pela metade — não equipar, mas manter o que está
— seria gastar exatamente quando ela é escassa.

`restorePrevious` decide o que acontece com o dedo na saída: devolver o anel que o jogador tinha,
ou deixá-lo vazio. Sem guardar qual era (`ringReplaced`, que também viaja no snapshot), a hunt
terminaria com o anel do jogador no fundo da mochila e nada explicando para onde ele foi.

Perder o anel no meio da hunt é caso normal — o §21.3 gasta anel por tempo. Sem ele na mochila a
máquina **não faz nada e não avisa**: virar erro por isso seria transformar consumo previsto em
falha.

O anel apontado é conferido na entrada: precisa existir no catálogo e vestir em `finger`. Uma
máquina de estados que aponta item inexistente é um slot avançado que nunca dispara, sem nada
dizendo por quê.

### Onde os dois são avaliados, e por que ali

| | quando | por quê |
|---|---|---|
| lure | no vencimento do passo do personagem | é a decisão de parar; avaliar em outro lugar seria decidir duas vezes |
| ring swap | depois do dano de monstro, e depois de ação do bot | são os dois instantes em que HP ou mana mudaram |

Nenhum dos dois é uma varredura periódica. Um evento por segundo para redescobrir que nada
mudou é exatamente o custo que o ADR 0020 existe para não pagar.

## A tela (FUN-89; painel fixo desde #162)

**Painel fixo na coluna da esquerda**, o vBot do OTClientV8 (ADR 0026 decisão 7; PRD §5.3):
sempre montado, minimizável pela barra do topo, nunca removido. Um grupo por categoria,
colapsável, com `n/slots`; cada regra é **uma linha compacta** — `[interruptor] HP ≤ 70 % →
Cura [⚙] [▴▾] [×]` — e o interruptor, verde ligado e vermelho desligado, é o `enabled` da regra
(`botRuleSchema`; ausente é ligada). **Desligar não apaga nem libera slot**: a regra fica na
configuração e conta para o teto; `compileBot` a pula, com custo zero no tick. A edição fina
(condição, operador, valor, ação) abre **por cima**, no `RuleEditor` — porque a linha larga não
cabe em 300 px, o motivo original da sobreposição da FUN-89 —, com Salvar e Cancelar; "+ regra"
abre o mesmo editor com uma regra nova. No celular o painel é um bloco da página (o bot antes das
hunts: configurar o bot é o caso de uso móvel, §5.1) e o editor continua sobreposição.

**O interruptor salva sozinho.** Não há botão "Salvar" no painel: ligar, desligar, mover e
remover agendam um `bot-config` com **debounce de 300 ms** (três toques são uma gravação, porque
o servidor registra a configuração inteira — ADR 0028); o Salvar do editor manda na hora. Sem
conexão a tela diz por quê e o rascunho fica tocado.

**Nada na tela tem lista de opções em código.** Categorias, slots, magias e supplies vêm do
catálogo. Se as duas divergirem sobre o que existe, o jogador configura o que o bot recusa — e
descobre isso pelo extrato que não fecha, não por uma mensagem de erro.

**A ordem dos slots é a prioridade** (§13.4), então dá para mover uma regra para cima e para
baixo: reordenar é configurar. A lista viaja como está — reordenar na hora de mandar mudaria o
comportamento sem o jogador ter pedido, e ele não estaria lá para notar.

**Salvar é uma intenção.** O estado "salvo" só vira verdade quando o servidor responde
`bot-config-result` — tipado, e não uma frase num `system-message`, porque casar com texto
quebraria no dia em que alguém melhorasse a redação.

**Uma recusa NÃO descarta o que o jogador escreveu.** Seria a pior resposta possível a "corrija
isto": apagar justamente o que precisa ser corrigido. O motivo fica na tela, em palavras do
servidor — quem recusa é quem sabe por quê, e traduzir no cliente espalharia a mesma explicação
por dois lugares.

**Mudar depois de salvar tira o "salvo" da tela.** O que está no servidor deixou de ser o que
está na tela, e continuar dizendo "salvo" faria o jogador fechar o navegador achando que
configurou.

O teto de cada categoria vem do catálogo, e a tela para de oferecer ao chegar nele. O gate do
§13.2 aparece como aviso — "bot avançado a partir do level 50" —, e não como opção escondida:
descobrir o limite montando uma configuração inteira e levando um não é pior que ler antes.
