# Bot

**Status:** parcial — vocabulário fechado e versionado (FUN-73), compilador de regras (FUN-80),
cadência por categoria (FUN-84), execução de magia e supply (FUN-74/FUN-77), targeting
configurável (FUN-85) e regras de saída do jogador (FUN-86) implementados; falta a configuração
chegar pelo socket (FUN-81) e o catálogo de itens (M8)
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
| `targets` | `op`, `count` (≥ 0) | Quantos alvos estão ao alcance |
| `target-hp` | `op`, `percent` (0–100) | Vida do alvo atual. Sem alvo, a condição é falsa — nunca erro |

**Operadores:** `<`, `<=`, `>`, `>=`. **Sem `==`** — comparar percentual exato quase nunca
dispara, e é a armadilha que faz o jogador achar que configurou cura e não ter cura nenhuma.

### Ações

| `kind` | Campo | Catálogo |
|---|---|---|
| `spell` | `spellId` | `packages/content/data/spells/*.json` (FUN-74) |
| `supply` | `supplyId` | `packages/content/data/supplies/*.json` (FUN-77) |
| `item` | `itemId` | M8 — ainda não existe; a regra é **sempre** recusada |

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
| Slots — Magias de suporte | 10 | caminho previsto: `packages/content/bot` |
| Cooldown por categoria | 1s | caminho previsto: `packages/content/bot` |
| Teto de ações por segundo por personagem | 5 (derivado: 5 categorias × 1 cooldown cada — não é número do PRD, é consequência calculada em `docs/technical-architecture.md` §5) | caminho previsto: `packages/content/bot` |
| Lure dinâmico — mín/máx de exemplo | mín 4 / máx 8 (exemplo ilustrativo do PRD, não é valor final) | caminho previsto: `packages/content/bot` |
| Ring swap — limiares de exemplo | equipar HP<50%, retirar HP>=60%, retirar Mana<10% (exemplo ilustrativo do PRD, não é valor final) | caminho previsto: `packages/content/bot` |

## Em aberto

- Subconjunto exato de opções disponíveis no bot básico (pré-level 50) — deve ser definido a partir do bot completo (§13.2, §43.3). Bloqueia a última tarefa do épico E4 (`docs/technical-architecture.md` §20).
- Vocabulário final de todas as condições possíveis do bot (§43.3).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.

## Quem executa: magia e supply (FUN-74, FUN-77)

O atuador embutido é a **própria hunt**, e não uma classe à parte. Tudo o que ele precisa já está
lá: o alvo mais próximo, o RNG semeado da sessão, o relógio lógico e o pipeline de morte. Uma
classe separada receberia os quatro por parâmetro e não ganharia nada em troca.

O que ele faz, por tipo de ação:

| Ação | O que acontece | Recusa quando |
|---|---|---|
| `spell` com efeito `heal` | repõe HP do lançador, debita mana, inicia o cooldown da magia | level insuficiente, cooldown, mana |
| `spell` com efeito `damage` | resolve o dano por `resolveDamage` com `kind: 'magic'`, aplica no monstro mais próximo e **atribui** (`recordDamage`) | level, cooldown, sem alvo, fora de alcance, mana |
| `supply` | repõe HP ou mana e **debita gold** | gold insuficiente |
| `item` | nada | sempre — não há catálogo |

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

`keep-distance` só faz sentido com arma de alcance maior que 1, **que ainda não existe**. A
postura entra por interface agora para a geometria já ter teste, e passa a valer no dia em que
houver arco ou varinha.

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
| `party-member-lost` | um companheiro saiu ou morreu | **inerte** — party é F3 |

Quatro coisas que não podem mudar sem pensar duas vezes:

- **A comparação de HP é estrita.** Com `<=`, quem configurasse "sair abaixo de 100%" veria a
  hunt encerrar no instante em que entrasse, de vida cheia, sem ter tomado um golpe.
- **`out-of-gold` olha o SALDO, não o delta.** Delta negativo é qualquer um que gastou uma poção;
  saldo zero é quem não consegue comprar a próxima. Olhar o delta encerraria a hunt de quem tem
  mil de gold e gastou um.
- **`party-member-lost` ignora o próprio personagem**, mesmo morto. Sem isso, quem morre sozinho
  encerraria por "companheiro caiu" em vez de por morte — e o motivo é o que o jogador lê ao
  voltar.
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
