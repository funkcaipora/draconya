# Analisador de hunt

**Status:** parcial — os agregados existem, atravessam snapshot e extrato, saem em
`session-state` (FUN-32, FUN-78) e ao vivo em `analyzer` quando mudam (FUN-110); a **janela no
cliente** existe como janela flutuante e arrastável, com "por hora" derivado local (FUN-83) e um
modal expandido com a lista completa de métricas da sessão (#315); falta o maior hit por skill (M7 já existe, mas o agregado é por tipo) e
qualquer notificação fora do jogo
**PRD:** §16, §43.10
**Épico:** E6

## O que já existe (FUN-78)

`Aggregates`, na sessão, e ele é **o mesmo objeto** que o extrato leva ao ledger — não uma cópia.
Duas cópias divergiriam, e a divergência apareceria como "o analisador me deu mais gold do que
caiu na conta".

| Campo | O que conta |
|---|---|
| `durationMs`, `xpGained`, `kills`, `deaths` | o básico da sessão |
| `goldGained`, `goldSpent` | o que entrou e o que saiu; o saldo é a subtração |
| `itemsLooted` | quantos itens caíram — **contagem, não valor** |
| `suppliesUsed` | quantos supplies foram usados |
| `bestBasicHit` | o maior golpe de arma |
| `bestSpellHit` | o maior dano de magia, **por alvo** |

### Quatro decisões que os testes protegem

- **"Por hora" NÃO existe no protocolo.** É `valor / durationMs`, e quem divide é o cliente.
  Mandar a divisão pela rede é mandar o mesmo número duas vezes, e os dois divergem na primeira
  pausa entre calcular e enviar.
- **O maior hit é o RESOLVIDO, não o aplicado.** Um golpe de 300 num monstro com 10 de vida foi
  um golpe de 300; guardar o aplicado faria o recorde depender de quão morto o alvo já estava.
- **O maior hit de magia é por alvo**, não a soma de uma área — somar faria uma magia fraca em
  cinco alvos superar a mais forte do jogo em um, e o número deixaria de responder a pergunta
  que ele existe para responder.
- **O item conta mesmo quando não cabe na mochila.** Contar só o que coube faria a mochila cheia
  parecer hunt ruim; a hunt rendeu, o que faltou foi espaço, e são perguntas diferentes.

`itemsLooted` é contagem e não valor porque **preço de venda é do Market**, que é F6. Um "valor
do loot" hoje seria um número inventado passando por medida.

Todo agregado é escrito **onde o fato acontece**, pela sessão dona (invariante 9): o maior hit no
golpe, o loot no abate, o supply no uso. Reconstruir por varredura seria contar de novo o que já
foi contado, e é assim que dois números que deveriam bater param de bater.

Os campos são **opcionais no protocolo**, e isso é sobre deploy em rolagem: um nó `game` antigo
manda os agregados sem eles, e um cliente que os exigisse recusaria a mensagem inteira — em
silêncio, porque `decodeS2C` devolve `null` sem erro.

## Comportamento

Durante a hunt, o jogador tem acesso a um painel de análise em tempo real, que pode ser minimizado sem fechar. O painel mostra, no mínimo, tempo de sessão, XP obtida e XP/h, gold obtido e gold/h, gastos e gasto/h, saldo e saldo/h, inimigos mortos, loot obtido, supplies consumidos, o maior hit do ataque básico, e o maior hit registrado de cada skill utilizada.

Quando o jogador reanexa o client a uma hunt que continuou rodando sem visualizador — o caso comum do idle/AFK —, ele recupera o estado atual do personagem e os agregados acumulados da sessão inteira, não um replay de eventos. A arquitetura de referência recomenda também uma lista de eventos notáveis (subiu de level, item raro, quase morreu, morreu, saiu por qual regra) e notificações para fim de sessão, morte e stamina zerada — mas os canais exatos dessas notificações e o escopo completo de eventos notáveis ainda não foram fechados.

## Regras

- O painel do analisador fica disponível durante toda a hunt e é minimizável.
- Métricas mínimas exibidas: tempo de sessão, XP obtida, XP/h, gold obtido, gold/h, gastos, gasto/h, saldo, saldo/h, inimigos mortos, loot obtido, supplies consumidos, maior hit do ataque básico, maior hit por skill utilizada.
- Reanexar a uma sessão devolve o estado atual completo mais os agregados acumulados da sessão — nunca um replay de eventos.

## Parâmetros de balanceamento

Este sistema não define parâmetros numéricos de balanceamento — é uma especificação de quais campos o painel precisa expor. A tabela abaixo registra apenas onde essa especificação deve morar como dado, para não virar texto fixo na UI.

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Lista de métricas mínimas do painel | ver seção "Regras" acima | caminho previsto: `packages/content/analisador` (ou definição fixa em `protocol/`, a decidir na implementação) |
| Lista de eventos notáveis do snapshot | subiu de level, item raro, quase morreu, morreu, saiu por qual regra (recomendação da arquitetura, não fechada como obrigatória) | caminho previsto: `packages/content/analisador` |

## A janela (FUN-83)

Mora numa janela à direita (`packages/client/src/shell/Analyzer.tsx`), e é **DOM** — HUD em DOM,
mundo em canvas. Nada nela toca `world`.

**É um `Panel dock` FIXO desde #258 (D6).** Antes, a barra do topo montava e desmontava a janela
inteira (`{open.analyzer && <Analyzer />}`); agora ela está sempre montada na coluna da direita,
como `BotPanel`/`EquipmentPanel` (#161/#162) — o botão da barra só MINIMIZA (`collapsed`), nunca
remove. **Nasce aberta** (FUN-115; o §16.1 dizia minimizada): quem decide se o corpo aparece é a
barra do topo, e uma janela que abre minimizada é uma janela que abre vazia. Minimizada, o tempo
de sessão fica na barra de título (`meta` do `Panel`). Ao encerrar ela reabre sozinha — um
override local por cima do `collapsed` da barra —: aí o extrato é a notícia, e escondê-lo seria a
sessão sumir em silêncio. Sem sessão, ou na Cidade, ela continua sem desenhar nada — essa
continua sendo a única situação em que a janela não aparece, e não é o jogador que a removeu.

**Os números viraram duas caixas** ("Sessão" e "Por hora", `Box`/`Line` sobre os primitivos
`Panel`/`Kicker` do design system), no lugar da lista solta de linhas de antes — a taxa que
aparecia como uma terceira coluna na mesma linha do valor absoluto agora é a caixa "Por hora"
inteira. **A matemática não mudou**: `perHour` continua a única derivada, o "—" do campo opcional
ausente continua a mesma regra (ver abaixo), e o relógio local continua o mesmo. Só a moldura ao
redor trocou de pele.

**Uma janela, duas telas.** Durante a hunt mostra o que está rendendo; ao voltar de um período
offline mostra o mesmo, mais a lista curta de eventos notáveis (§16.2). São a mesma pergunta em
dois momentos, e duas janelas divergiriam na terceira mudança.

**Só o TEMPO anda entre duas atualizações.** O "por hora" é uma divisão, e o denominador é um
relógio local que corre desde a última entrega — o `session-state` ou o `analyzer` mais recente
(FUN-110), que rebaseia o relógio junto com os números. XP, gold e abates
são sempre o último número que o servidor mandou — extrapolar qualquer um mostraria progresso que
talvez não tenha acontecido, e o jogador veria o valor ANDAR PARA TRÁS na atualização seguinte.

A consequência assumida é que a taxa cai devagar entre duas atualizações, porque o numerador está
parado e o denominador anda. É o lado certo para errar: uma taxa levemente pessimista que se
corrige é melhor que uma otimista inventada no cliente.

**Encerrada, o relógio para.** O extrato é definitivo; continuar contando faria o "por hora"
derreter na frente de quem está lendo.

**Campo que o servidor não mandou aparece como "—", nunca como zero.** Os agregados da FUN-78 são
opcionais no protocolo: um nó `game` antigo, em deploy em rolagem, manda sem eles. Zero é uma
afirmação, e ele não afirmou nada.

A janela **não pede `session-state`** para se atualizar. O servidor manda `analyzer` — os mesmos
agregados e eventos do `session-state` — **sempre que um deles muda** (abate, loot, gasto,
level, morte; FUN-110), no mesmo ciclo que já leva `player-stats`; a janela lê a store. O tempo
não é gatilho: `durationMs` muda a cada ciclo, e compará-lo mandaria a mensagem dez vezes por
segundo para dizer que nada aconteceu. Pedir em laço, do outro lado, seria tráfego de volta
gerado por tráfego de entrada. Até a FUN-110 nada saía entre dois `session-state`, e a janela
ficava em zero a hunt inteira — foi o achado do passe de QA do MVP.

Ela não aparece na Cidade: a praça não credita nada (§37), e uma janela de "0 XP, 0 gold" ali é
ruído com aparência de informação.

## Em party (M13, ADR 0027)

Os agregados são **por participante** desde o #187: `Session.aggregatesOf(characterId)`, e
`session.aggregates` é a soma. Cada membro vê no analisador **a própria linha** — a XP que a cota
dele rendeu, o gold que ele ganhou e gastou (no modo `shared`, já rateado), os abates (que contam
para todos os presentes) e os itens que caíram (para todos, no modo `shared`; para o sorteado, no
`split`). O `session-state` e o `analyzer` que cada socket recebe levam os agregados do personagem
daquele socket, e o servidor guarda o último enviado **por personagem** — dois membros na mesma
sessão não compartilham o "já mandei isto".

Os eventos notáveis são os da sessão, para todos, e em party dizem de quem: `level-up` com
`id/level`, `bestiary-milestone` com `id/monstro/marco`, `exit-rule` com a regra (inclusive
`party-member-lost`), e **`party-settlement`** com `total/presentes` — a bolsa foi vendida e
dividida (ao sair alguém e no fim). O extrato final (`session-ended`) é o de quem saiu: um
`Receipt` por membro, com `seq` próprio, e a tela de retorno mostra o dele. Ver `party.md`.

O M20 (#400, ADR 0033 d.11) acrescentou o bloco **`analyzer.party`** à seção PARTY dos Detalhes da
Caçada — o mesmo objeto em `session-state.partySummary` (o `party` do `session-state` continua
sendo o roster, #196): `players`, `uniqueVocations`, `xpPercent`, `totalXp`, `totalSupplies`,
`shareCosts`, `splitLoot`, `bagValue`, `bagWeight` e `autoSell: { used, limit }`. `autoSell.limit`
é o limite do **personagem líder** (`autoSellItemTypes`, D2) e `used` é quantos ids ele guardou; a
"parte estimada" de cada um continua vindo de `party-spending` (`estimatedShare`).

A **PT-01** (#431, ADR 0032 d.14) acrescentou **DPS e HPS por membro**: `party-state.members[].{
dps, hps, damageDealt, healingDone}` e `analyzer.aggregates.{damageDealt, healingDone}` (todos
opcionais). O `sim` acumula dano causado e cura feita por EVENTO, com carimbo lógico, e mantém uma
janela de 60 s aparada na LEITURA — nunca por tick (invariante 2). `dps`/`hps` são a taxa da
janela; `damageDealt`/`healingDone` são os totais da sessão. O dano contado é o **aplicado**
(overkill e mana shield ficam de fora), e a janela não viaja no snapshot: uma sessão retomada
recomeça a janela, os totais continuam. O painel da party mostra a linha "DPS · HPS" por membro.

## Em aberto

- Canais e escopo exatos de eventos notáveis e notificações de fim de sessão/morte/stamina (§16.2).
- Canais e eventos que geram push/alerta fora do jogo (§43.10).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
