# Bestiário

**Status:** parcial — dois sistemas coexistem na mesma tela (ADR 0053): a linha de XP do
FUN-113 (o contador de abates por monstro é permanente, os cinco marcos fecham e cada um dá
+1 % de XP PvE para sempre) e, desde o #601, o Bestiário do Canary (estágio por monstro,
estrelas de dificuldade, ocorrência e pontos de Charm — os dois primeiros DERIVADOS do mesmo
contador, nunca guardados à parte). Faltam as recompensas especiais por monstro do PRD (§18.4),
a regra de Guild War (§18.5, que não tem Guild War para valer) e a ECONOMIA de Charms — gastar
pontos em runa, atribuir a um monstro, remover (#602) — e o efeito deles em combate (#603).
**PRD:** §18
**Épico:** E7
**ADRs:** [0053](../adr/0053-bestiary-xp-line-kept-and-charms-added.md) (decisão sobre este
sistema), [0052](../adr/0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
(estado durável do endgame, ainda não usado por este sistema — ver Divergências)

## Comportamento

O personagem acumula abates por monstro **de forma permanente** — o contador atravessa hunts,
snapshot e extrato, e nunca desce. Cada monstro tem cinco marcos de contagem (10 000, 25 000,
50 000, 100 000 e 200 000 abates), e cada marco alcançado, em qualquer monstro, concede **+1 %
de XP PvE para sempre**. O bônus é **global**: é `(marcos alcançados em todos os monstros,
somados) × 1 %`, aplicado à XP de todo abate — dois marcos no rato e um no morcego são +3 % na
XP de qualquer coisa que o personagem mate daí em diante. O bônus **soma-se** aos demais (faixa
de level, VIP, evento) e a multiplicação acontece uma vez (#563, ver `progression.md`).

Abate com stamina zero **não conta** (§18.6) — e não conta pela MESMA condição que já não paga
XP nem loot: é um `if` só em `#onMonsterDied`, e duas condições divergiriam na primeira mudança
em uma delas.

Fechar um marco é evento notável, como o level up: aparece na lista curta do analisador
(§16.2) como "Bestiário: Rato · marco 1 (+1 % XP)". O abate comum não aparece, pela regra de
sempre — uma hunt de oito horas com uma linha por rato não é lista, é log.

**O que a tela mostra.** O ícone Cyclopedia da barra abre um modal com as abas Itens e Bestiary,
não uma seção fixa na coluna. Na aba Bestiary, o modal traz busca por nome, ordenação
por progresso/nome/abates e alternância entre grade e lista; cada monstro mostra o placeholder de
sprite, abates, estrelas do MARCO DE XP alcançado (o "★N" do FUN-113) e a barra até o próximo
marco (ou cheia e verde depois do último). A caixa "Progresso no Bestiário" soma os marcos reais
dos monstros presentes no catálogo e mostra o bônus global de XP; ela não aparece quando o
servidor não trouxe configuração de marcos. Bosstiary e sprite real permanecem ausentes até os
respectivos sistemas transportarem esses dados.

**Desde o #601, cada monstro também mostra a ficha do Canary — um segundo vocabulário de
progresso, lado a lado com o marco de XP (ADR 0053 d.2).** Quando `catalogue.monsters[].bestiary`
traz a ficha (limiares + estrelas de DIFICULDADE + ocorrência + pontos de Charm), o cartão exibe
o ESTÁGIO ("Bloqueado" / "1º desbloqueio" / "2º desbloqueio" / "Completo"), as estrelas de
dificuldade (0 a 5, `★★★☆☆`) e a raridade de encontro ("Comum" a "Muito raro") — três dados
DISTINTOS das estrelas de marco de XP, que continuam significando outra coisa na mesma tela. A
caixa lateral ganhou uma segunda linha, "Pontos de Charm", com o total DERIVADO — a soma de
`charmsPoints` de todo monstro cuja ficha está completa (`kills >= toKill`), calculada em
`shell/bestiary-progress.ts` (`bestiaryStageOf`/`charmPointsEarned`) do MESMO jeito que o marco de
XP: apresentação pura sobre o contador que o servidor manda, nunca um segundo contador. Sem a
ficha (monstro sem entrada em `content.bestiary.entries`, ou nó `game` anterior a esta issue), o
cartão mostra só o que já mostrava — nenhuma das três linhas novas aparece.

Num servidor sem monstros no catálogo, o modal diz "Este servidor não tem Bestiário" em vez de uma
lista vazia com "+0 %". Os contadores chegam inteiros do servidor (`bestiary`, no attach e sempre
que um muda); os marcos e o valor de cada um vêm no `catalogue`, fixados na sessão (invariante 7).
O cliente não conta nada — o que ele calcula é apresentação do próximo marco, do progresso, do
estágio do Canary e dos pontos de Charm; se divergisse do `sim`, a conta do `sim` é a verdadeira
(hoje o `sim` não calcula estágio nem pontos — ver Divergências). Desde a SV-20, `catalogue.
monsters[]` também carrega `class` quando o conteúdo define uma (vocabulário fechado em
`MONSTER_CLASSES`: desde o #578, as 20 classes do Bestiário do Canary, de `amphibic` a `vermin`);
é o dado que a `SideList` de categorias da Cyclopedia usa para agrupar.

Desde a #344, o modal ganhou a aba "Itens": a lista de `catalogue.items`, com sprite, nome,
categoria (derivada de onde o item veste — o mesmo rótulo do painel do set) e peso; Atq/Def só
aparecem quando o item tem ataque ou defesa (`attack`/`armor`, desde a #337, ambos opcionais no
protocolo). A busca do modal é uma só, fica acima das abas e filtra a aba que estiver ativa.
Descrição e "dropado por" não aparecem: nenhum dos dois existe em
`content` hoje (ver `docs/reviews/kit-fidelity-audit-2026-09-16.md`, achado R8-22b).

**A ficha de Bestiário por monstro chegou como DADO antes de ter leitor (#520), e o #601 é o
leitor.** `bestiary/baseline.json` tem `entries` — uma linha por `monsterId` com `class`/`race`,
os três limiares de desbloqueio (`firstUnlock` ≤ `secondUnlock` ≤ `toKill`, crescentes por
`.refine`) e `charmsPoints`/`stars`/`occurrence`, os mesmos números que o Bestiário real do
Tibia mostra por monstro (Canary `Bestiary`/TFS `bestiary`, conferido monstro a monstro).
`buildContent` confere que a chave é um monstro que existe e que o `class` da ficha bate com o
`class` do próprio monstro — duas fontes da mesma categoria divergiriam na primeira mudança em
uma delas. `packages/server/src/game/catalogue.ts` publica a ficha em
`catalogue.monsters[].bestiary` (os seis campos que a tela precisa; `class`/`race`/`raceId` ficam
de fora — `class` já viaja solto no monstro, e `race`/`raceId` seguem sem consumidor); o cliente
DERIVA estágio e pontos, nunca guarda os dois (`shell/bestiary-progress.ts`). **`sim` continua sem
ler `entries`**, porque estágio e pontos de Charm não mudam resultado de jogo nenhum ainda — só a
ECONOMIA de Charms (gastar ponto, atribuir a um monstro, remover, #602) e o efeito deles em
combate (#603) vão precisar do `sim`.

**O leitor de monstros do Canary (#578) gera a ficha junto com o monstro.** `scripts/catalog/
monsters.ts` converte `monster.Bestiary` e `monster.raceId` para a forma de `bestiaryEntrySchema`
(`raceId` entrou como campo opcional); a ficha fica em `packages/content/staging/monsters/` ao lado
do monstro até `pnpm catalog:promote-monsters` (#580) mesclá-la em `entries`. O leitor achou
no Canary estrelas de 0 (inofensivo, 13 monstros) a 5 (desafiador, 53) — o schema aceitava só 1
a 4 e passou a aceitar 0 a 5.

**A primeira promoção (#580) trouxe 933 fichas** — os 939 monstros do corte do Canary, menos Rat,
Rotworm, Dragon e Dragon Lord (fora do alcance de `pnpm catalog:promote-monsters` por decisão —
`HAND_AUTHORED_MONSTER_IDS` — e regenerados à parte pelo #581) e menos dois monstros de
quest (`eshtaba-the-conjurer`, `leiden`) cujo `summons.entries` repete o mesmo `monsterId` com
chances diferentes — o `sim` só aceita uma entrada por id (`content.ts`), e a saída honesta foi
deixá-los fora da promoção em vez de inventar uma chance que o Canary não escreveu.
`scripts/catalog/promote-monsters.ts` e o relatório de cobertura
(`docs/reference/catalog/monsters-promotion-report.md`) detalham os dois casos e o que mais ficou
de fora. **O #581 fechou as quatro fichas que faltavam** — Rat e Rotworm entraram em `entries`
pela primeira vez (vinham sem ficha nenhuma); Dragon e Dragon Lord já tinham a ficha hand-authored
de antes, e os números batiam com o que o leitor do Canary produz, então continuam como estavam.

## Regras

- Cinco marcos de abates por monstro: 10 000 / 25 000 / 50 000 / 100 000 / 200 000.
- O que conta é o abate, não o cadáver: o rato do Tibia (FUN-123 — 20 HP, 5 XP, cadáver só
  visual por dez segundos) rende um abate por morte, e os 10 000 do primeiro marco são
  10 000 ratos, a 5 XP cada antes do bônus.
- Cada marco alcançado dá **+1 % de XP PvE permanente**, somado com os demais — de todos os
  monstros (DT-01, ver Divergências).
- A XP de um abate é `floor(xp × (100 + 1 × marcos + outros bônus) / 100)`, em inteiro: o
  percentual do Bestiário **soma-se** ao da faixa de level e aos demais antes de uma
  multiplicação só (#563). `100 × 1,13` em ponto flutuante é `112.99999999999999`, e o `floor`
  daria 112 onde a conta exata dá 113 — um abate em cada setenta perderia um ponto sem ninguém
  conseguir explicar por quê.
- O abate que **alcança** um marco é pago com o multiplicador de antes; o marco vale do abate
  seguinte em diante (DT-04, ver Divergências).
- Abate com stamina zero não conta, não dá XP e não dá loot — uma condição só.
- **Em party o abate conta para todo membro elegível** (vivo, com stamina), não só para quem
  deu o golpe (#190, ADR 0027 decisão 4): party é o jeito previsto de jogar, e o Bestiário é
  progressão por monstro, não por golpe. O bônus de XP de cada um continua individual e se
  aplica à cota dele.
- O contador é **absoluto** no ticket e no extrato, e o ledger fica com o **maior** por monstro
  (DT-02): abate nunca desce, então um extrato antigo processado fora de ordem não rebaixa nada,
  sem precisar de guarda de instante. É o padrão das skills (FUN-75).
- Personagem ou snapshot anterior à FUN-113 não tem `bestiary`, e isso é `{}` — nenhum abate
  contado, sem subir `SNAPSHOT_FORMAT_VERSION` (DT-06), como `skills`.
- Monstro nunca abatido **não tem entrada**: o `sim` não grava zero para todo monstro do conteúdo
  em todo personagem, e a tela lê a ausência como zero.
- Sem `bestiary` no conteúdo (fixture de teste), o contador sobe do mesmo jeito; só não há
  marco nem bônus — a config define marco, não autoriza contar.
- Todos os bônus são individuais ao personagem e valem só em PvE. Não há PvP para o contrário
  ser testado.
- Recompensas especiais por monstro **não existem** (DT-05): todo monstro usa a recompensa
  padrão.
- **O estágio da ficha do Canary é DERIVADO do MESMO contador de abates**, nunca uma segunda
  contagem: `0` (bloqueado) abaixo de `firstUnlock`, `1` (1º desbloqueio) a partir dele, `2`
  (2º desbloqueio) a partir de `secondUnlock`, `3` (completo) a partir de `toKill` — cada limiar
  por `>=`, como "quantos marcos já alcançou" (`bestiaryStageOf`, `shell/bestiary-progress.ts`).
- **Os pontos de Charm ganhos também são DERIVADOS**: a soma de `charmsPoints` de todo monstro
  cuja ficha está COMPLETA (`kills >= toKill`), recalculada a cada abate — nada persiste além do
  contador que já existia (ADR 0053 d.1). Só o GASTO de pontos, quando a economia de Charms
  entrar (#602), vai persistir, no registro `charms` que o ADR 0052 descreve.
- **Os limiares do Canary e os marcos de XP são de ORDENS DIFERENTES, e não disparam juntos**: o
  Dragon completa a ficha em 1 000 abates, o primeiro marco de XP são 10 000 — dois relógios
  independentes sobre o mesmo contador, nunca a mesma condição.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora em packages/content |
|---|---|---|
| Marcos (os cinco, crescentes) | 10 000 / 25 000 / 50 000 / 100 000 / 200 000 abates | `packages/content/data/bestiary/baseline.json`, `milestones` |
| Recompensa por marco | +1 ponto percentual de XP PvE | `packages/content/data/bestiary/baseline.json`, `xpBonusPercentPerMilestone` |
| Recompensas especiais por monstro | não implementado (DT-05) | sem entrada — entram com o primeiro monstro que as pedir |
| Ficha do Dragon/Dragon Lord (#520) | toKill 1000, firstUnlock 50, secondUnlock 500, charmsPoints 25, stars 3, occurrence 0, class/race `dragon` — os dois iguais | `packages/content/data/bestiary/baseline.json`, `entries.dragon` / `entries.dragon-lord` |
| Fichas importadas do Canary (#578/#580/#581) | 451 monstros com `entries` hoje (o corte de `content/data/monsters` — ver `docs/reference/catalog/monsters-promotion-report.md` para o que ficou de fora) | `packages/content/data/bestiary/baseline.json`, `entries` |

O schema (`bestiarySchema`, em `packages/content/src/schemas.ts`) exige os marcos em ordem
crescente: o `sim` para de contar no primeiro que o contador não alcança, e uma lista fora de
ordem faria o terceiro marco fechar antes do segundo.

## Em aberto

- **O valor do +1 % de XP por marco** `[ABERTO — provisório]` (ADR 0053 d.2): o ADR 0045 propunha
  remover o bônus de XP do Bestiário; o Huntera observado (2026-09-25) mostra a MESMA forma que o
  Draconya já usa ("Progresso no Bestiary" como uma das cinco fontes do bônus de XP total), o que
  pesa contra remover — mas o número exato (`1 %`) nunca foi observado numa conta com marco
  alcançado (a conta capturada estava no level 1, sem nenhum marco — "—"). O ADR 0053 resolveu a
  FORMA (o bônus FICA, coexistindo com os Charms) e deixou só o NÚMERO provisório, até a captura 7
  de #643 ler uma conta do Huntera com progresso real. Ver a emenda "2026-09-25" do ADR 0045,
  `docs/tibia-parity-plan.md` §5 questão 7 (agora "decidida, ADR 0053; captura pendente") e o ADR
  0053 inteiro.
- **Recompensas especiais por monstro** (§18.4, DT-05): loot PvE, Dodge PvE, resistência
  física e elemental PvE, redução de penalidade de morte. O conteúdo não tem monstro que as
  peça, e o formato — qual marco de qual monstro troca a XP por qual bônus — entra com o
  primeiro que pedir, não antes.
- **Guild War** (§18.5): "os bônus valem só em PvE" é verdade por falta de PvP, não por regra
  escrita. A regra entra com a Guild War.
- **A economia de Charms** (gastar pontos numa runa, atribuir a um monstro, remover) e o efeito
  deles em combate são o #602 e o #603, ainda não implementados. Este sistema (#601) só mostra o
  estágio e os pontos GANHOS; não há como gastá-los ainda, e nenhum Charm altera combate.

## Divergências do PRD

**A linha de XP FICA, como exceção de produto (ADR 0053 d.2), em vez de ser removida.** O ADR
0045 propunha trocar o Bestiário do PRD (marcos globais de XP) pelo do Canary (estágios + Charms,
sem XP direta) inteiro. O Huntera observado mostra a MESMA forma que o Draconya (linha "Progresso
no Bestiary" somada às demais fontes de XP), o que contesta a remoção — então os DOIS sistemas
coexistem: os marcos de XP do FUN-113 (abaixo) e o Bestiário do Canary (estágio/estrelas/
ocorrência/pontos, acima) são independentes, sobre o MESMO contador de abates, sem disparar
juntos (os limiares são de ordens diferentes). O `1 %` por marco continua provisório — ver Em
aberto.

**O bônus é global, não por monstro (DT-01).** O §18 diz "+1 % de XP PvE permanente" por
marco, e não diz de qual XP. A leitura literal é a global — a XP PvE do personagem, de
qualquer abate —, e é a que foi implementada: `1 + 0,01 × Σ marcos`. "Só a XP daquele monstro"
seria uma segunda regra que o PRD não escreve, e que obrigaria o jogador a farmar o mesmo rato
para colher o que plantou nele — o oposto de uma progressão que dá razão para voltar.

**O abate que fecha o marco é pago pela regra anterior (DT-04).** O PRD não diz se o abate
10 000 já sai com o bônus. Aqui ele sai com o multiplicador que valia quando começou, e o marco
vale do 10 001 em diante: a ordem é determinística (XP primeiro, contagem depois), e invertida o
abate 10 000 seria o único da vida do personagem a render diferente dos vizinhos. O
arredondamento é para baixo.
