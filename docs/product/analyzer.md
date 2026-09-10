# Analisador de hunt

**Status:** parcial — os agregados existem, atravessam snapshot e extrato, e saem em
`session-state` (FUN-32, FUN-78); a **janela no cliente** existe, minimizável, com "por hora"
derivado local (FUN-83); falta o maior hit por skill (M7 já existe, mas o agregado é por tipo) e
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

Mora no painel da direita (`packages/client/src/shell/Analyzer.tsx`), e é **DOM** — HUD em DOM,
mundo em canvas. Nada nela toca `world`.

**Nasce minimizada** (§16.1). Uma hunt idle não precisa dela aberta ocupando a tela, e a linha do
cabeçalho já diz há quanto tempo a sessão roda. Ao encerrar ela abre sozinha: aí o extrato é a
notícia, e escondê-lo seria a sessão sumir em silêncio.

**Uma janela, duas telas.** Durante a hunt mostra o que está rendendo; ao voltar de um período
offline mostra o mesmo, mais a lista curta de eventos notáveis (§16.2). São a mesma pergunta em
dois momentos, e duas janelas divergiriam na terceira mudança.

**Só o TEMPO anda entre duas atualizações.** O "por hora" é uma divisão, e o denominador é um
relógio local que corre desde o instante em que o último `session-state` chegou. XP, gold e abates
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

A janela **não pede `session-state`** para se atualizar. Os deltas chegam pelo lote do ciclo e ela
lê a store; pedir em laço seria tráfego de volta gerado por tráfego de entrada.

Ela não aparece na Cidade: a praça não credita nada (§37), e uma janela de "0 XP, 0 gold" ali é
ruído com aparência de informação.

## Em aberto

- Canais e escopo exatos de eventos notáveis e notificações de fim de sessão/morte/stamina (§16.2).
- Canais e eventos que geram push/alerta fora do jogo (§43.10).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
