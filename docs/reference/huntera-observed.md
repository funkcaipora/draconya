# Huntera observado — números de um Tibia-idle em produção

**Data da observação:** 2026-09-10
**Fonte:** conta de teste própria em `huntera.com.br`, personagem `Liesh Onshaw`, level 1 Rookie
**Como ler:** isto é **especificação de domínio**, no sentido do ADR 0019 — observação de um
jogo do mesmo gênero, rodando com jogadores de verdade. Não é alvo a copiar: é um ponto de
referência para os `[ABERTO]` do PRD deixarem de ser palpite.

O Huntera é um Tibia-idle brasileiro com RMT, e o PRD já o cita como referência de experiência
(§5.2 e §43). O que segue foi lido da tela do próprio jogo e do tráfego dele.

---

## 1. O que ele confirma da nossa arquitetura

Duas coisas que decidimos por raciocínio e que aparecem lá, iguais:

| Huntera | Draconya |
|---|---|
| `POST /api/game-tickets` → `201`, e só então o socket | `POST /api/tickets` (FUN-12, ADR 0001) |
| `GET /api/auth/me`, `GET /api/characters` | as mesmas duas rotas, com os mesmos nomes |
| `/things/1332/catalog-content.json` + `appearances-<hash>.dat` + `sprites-<hash>.bmp.lzma` | o layout da §13.1, e `THINGS_VERSION=1332` no `.env` |

O fluxo de ticket antes do socket não é invenção nossa nem coincidência: é o que este gênero
faz. Vale como confirmação independente do ADR 0001.

## 2. O que ele resolve do pipeline de assets (FUN-16, FUN-18)

O `catalog-content.json` real, de 4.175 entradas, respondeu duas perguntas que a FUN-16 teve de
deixar em aberto por falta de um pacote:

- **`area` é sempre `0`.** Em 4.171 folhas, nenhuma traz outro valor. Ler-e-ignorar estava
  certo, e agora está verificado.
- **A geometria por `spritetype` fecha nas quatro.** O maior número de sprites por folha é
  144, 72, 72 e 36 — que são exatamente 12×12, 12×6, 6×12 e 6×6, ou seja folha de 384×384 nos
  quatro casos, como a §13.1 documenta.

E um detalhe que não estava em lugar nenhum: **folha não é sempre cheia.** Os mínimos são 6 a
33 sprites por folha. Quem assumir "folha cheia" para calcular a faixa de ids vai errar a
última folha de cada tipo.

Tipos de entrada no índice: `appearances`, `sprite`, `staticdata`, `staticmapdata`, `map`.

## 3. Os números de um personagem level 1

Lidos da tela de personagem, sem equipamento, com a roupa inicial.

| | Huntera | Draconya (`content/data`) |
|---|---|---|
| Vida inicial | **100** | 150 (`progression/baseline.json`, `[ABERTO]`) |
| Mana inicial | **10** | 0 |
| Capacidade inicial | **1500 oz** | 400 |
| Velocidade | **278** | — (temos `stepDurationMs: 500`) |
| Skills de combate iniciais | **10** (punho, clava, espada, machado, distância, escudo, pesca) | 10 (`skills/*.json`) ✅ |
| Magic Level inicial | **0** | 0 ✅ |
| XP do level 1 → 2 | **100** | `xp: { base: 20, exponent: 2 }` → 20 |
| Stamina cheia | **12 h** | **24 h** (`stamina/baseline.json`) |
| Dano do ataque automático | **3 – 7** | `player.attackPower: 25` (`combat/baseline.json`, `[ABERTO]`) |

**As duas divergências que valem decisão:**

1. **Stamina de 12 h, não 24 h.** O nosso teto de 24 h é o teto de simulação do ADR 0001 — é
   ele que limita o custo de hunt desanexada. Metade disso é metade do custo, e o Huntera
   opera com 12 h. Não é razão para mudar sozinha, mas é evidência de que 24 h é escolha, e
   não obrigação do gênero.
2. **Dano 3–7 no level 1.** O nosso `attackPower: 25` está marcado `[ABERTO]` e é uma ordem de
   grandeza acima. Com 100 de vida do lado deles, um golpe de 25 mataria em quatro acertos.

## 4. Regeneração só acontece em caçada

A tela de personagem diz, nas duas linhas: **"Regeneração de vida: só em caçadas"** e
**"Regeneração de mana: só em caçadas"**.

Isto é uma regra de jogo com consequência econômica direta, e nós não a temos: o
`progression/baseline.json` tem `regen.healthPerSecond` e `manaPerSecond` que valem sempre.
Regenerar fora da hunt torna o tempo parado produtivo, o que empurra o jogador a ficar fora —
o oposto do que um jogo idle quer.

## 5. Bônus de experiência, e um multiplicador de level baixo

A tela lista cinco fontes somando um total:

| Fonte | No level 1 |
|---|---|
| Progresso no Bestiary | — |
| Experience Scroll | — |
| Bônus da guild | — |
| Bônus de Premium | — |
| **Bônus de level** | **+200%** |

O **bônus de level** é o interessante: um multiplicador que existe *porque* o personagem é de
level baixo, e que presumivelmente decai. É uma rampa de entrada que o nosso PRD não tem.

## 6. O vocabulário de automação deles

É a parte mais próxima do nosso motor de bot (§13, M6), e a que mais informa `[ABERTO]`.

**Política de alvo** — cinco, com estes valores exatos no `select`:

```
nearest · lowest-health · highest-health · lowest-health-percent · highest-health-percent
```

O nosso `bot/baseline.json` tem `advancedOnly.targetPolicies` **vazio**, porque a §13.2 não
decidiu a lista. Aqui está uma que funciona em produção — e note que ela distingue **vida
absoluta** de **percentual**, que são estratégias diferentes (rematar o quase-morto *versus*
focar o mais frágil).

**Postura de combate** — três: `Defesa total`, `Equilibrado`, `Ataque total`. É o fight mode do
Tibia, e nós não temos equivalente.

**Distância dos inimigos** — um campo numérico de distância a manter. É a mesma família do
nosso `lure`, mas expresso como **distância alvo** em vez de dois limiares de contagem.

**Barra de ações** — 20 slots, com **conjuntos nomeados** (`Default`, "salvar como novo
conjunto", "limpar a barra"). Nós temos 5 categorias com slots por categoria (37 no total) e
nenhum conceito de conjunto salvo.

## 7. O catálogo de caçadas

**55 caçadas**, listadas em ordem de progressão, e a primeira delas é literalmente
**`Rat Cellars` / `Rat`** — o mesmo nome que já está no nosso `hunts/rat-cellars.json`.

Cada linha do catálogo mostra três coisas: o nome, **a lista de monstros** e
`3 tamanhos de pull · N drops de loot`. A ordem é Rat Cellars → Spider Nest → Troll Hills →
Orc Camp → … → Infernal Gate (Demon) → Falcon's Eye.

**"Tamanho do pull" é um nome melhor que "dificuldade".** Nós chamamos de dificuldade o que a
`huntDifficultySchema` guarda como `perSpawnPoint` — quantos monstros vêm de uma vez. Eles
chamam pelo que é, e os três são `Cautelosa`, `Ousada`, `Agressiva`. Vale considerar renomear:
"dificuldade" sugere monstro mais forte, e não é isso que muda.

A tela de detalhe traz, antes de entrar: a **lista de loot possível** (Rat Cellars: Gold Coin,
Cheese), a descrição, e **"Encontrar time"** ao lado de "Iniciar caçada" — o matchmaking de
party mora na seleção de caçada, não numa tela à parte.

E há **recorde por caçada**: *"complete uma caçada de 5 minutos para marcar um recorde"*.

## 8. O que aparece DENTRO da caçada

Três ações no topo: **`DETALHES DA CAÇADA`**, **`DESPACHAR LOOT`**, **`SAIR DA CAÇADA`**.

**As barras mostram a regeneração como número:** `110/110 +10` e `15/15 +5`. É a regra da §4
tornada visível — o `+10` só existe porque o personagem está caçando.

**A stamina drena 1 min por minuto de caçada**, e a barra dela fica ao lado das outras.

### A caixa de loot da sessão expira em 15 minutos

```
Loot da sessão
Nada aqui ainda — vá caçar!
Clique para pegar — expira em 15 min
```

Nós temos a caixa (M8, §25) e **não temos o prazo**. Quinze minutos é uma decisão de produto
com consequência clara: loot não recolhido some, o que empurra o jogador a voltar — e é
exatamente o tipo de número que o PRD deixou `[ABERTO]`.

### O analisador é PREMIUM

```
SESSÃO ATUAL 00:01:06 · PRÓXIMO LEVEL --:--:-- · EXP TOTAL --- · EXP/H ---
LUCRO TOTAL --- · LUCRO/H ---
                                                        [Assinar Premium]
```

Duas coisas aqui. A primeira: eles mostram **tempo até o próximo level**, que é derivada e nós
não temos. A segunda, e maior: **o analisador inteiro é recurso pago**. O nosso §16 o trata
como parte do jogo. Não é evidência de que estejamos errados — é evidência de que dá para
monetizá-lo, e de que alguém no gênero achou que valia.

## 9. Progressão medida, level 1 ao 3

Um minuto de Rat Cellars, com o bot padrão e sem equipamento:

| | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Vida | 100 | 110 | 120 |
| Mana | 10 | 15 | 20 |
| Bônus de XP | +200% | +199% | +197% |

**Por level, sem vocação: +10 de vida e +5 de mana.** O nosso `progression/baseline.json` tem
`healthPerLevel: 5` e `manaPerLevel: 5` — metade da vida.

**O bônus de level decai por level**, e devagar: dois pontos percentuais do 2 para o 3. É uma
rampa de entrada longa, não um empurrão de dois minutos.

E a velocidade importa: **level 1 → 3 em cerca de um minuto**, com 15 de gold e 6 itens de
loot. O começo do jogo deles é deliberadamente rápido.

## 10. O que NÃO dá para concluir daqui

- **Nada sobre o servidor deles.** Tudo acima é tela e tráfego HTTP; não há como saber como o
  laço de simulação funciona, se a hunt roda desanexada, nem a que taxa.
- **Nada sobre balanceamento de níveis altos.** O personagem observado é level 1.
- **Nada sobre licença de assets.** Eles servem o pacote do cliente do Tibia na versão 1332,
  como nós pretendemos; isso não diz nada sobre o risco que o ADR 0008 assume, só que não
  somos os primeiros a assumi-lo.

## 11. O que isto sugere abrir

Cada linha da §3 e da §6 que diverge é candidata a issue de balanceamento — em especial a
lista de políticas de alvo (§13.2, hoje vazia) e a regeneração fora de hunt, que é regra e não
número.
