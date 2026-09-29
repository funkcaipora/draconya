# 0043 — Sustento do Tibia: stamina de 42 h com faixas e regeneração só com comida

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1; revisita a decisão de 2026-09-18 ("sem regen por comida", anterior ao ADR 0037) e o
adiamento de comida do [ADR 0032](0032-the-rendered-hud-is-the-game-contract.md); bloqueada por
três questões em aberto (ver seção própria)
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`stamina/`, condição de regeneração, comida como
suprimento), `packages/sim` (cálculo de stamina sem tick, condição `heal-over-time`), `packages/server`
(bot come sozinho)
**Issues:** M32 — #562 a #565

## Contexto

`docs/product/stamina.md` hoje descreve stamina de **24 horas**, recuperação **1:1** fora de
hunt, e um único portão (zero = sem XP, sem loot, sem Bestiário). O Tibia é mais estreito e mais
condicional: teto de **2.520 minutos (42 h)**, consumida a **1 min por 60 s** de hunt
(`useStamina`, não por `dtMs` — cada gasto é um evento, na mesma disciplina do invariante 2), e a
XP passa por **duas faixas multiplicativas**, confirmadas idênticas em TFS
(`data/scripts/events/player/default_onGainExperience.lua:60-68`) e Canary
(`data/libs/functions/player.lua:349-360`): **1,5×** acima de 2.340 min e **só para quem é
Premium**, **0,5×** em 840 min ou menos, sem faixa intermediária diferente de 1×. O corte de loot
é mais cedo do que o de XP: **840 min ou menos**, não zero — confirmado em Canary
(`luaPlayerCanReceiveLoot`, `src/lua/functions/creatures/player/player_functions.cpp:2200-2209`,
`stamina > 840`) e TFS (`default_onDropLoot.lua:12`, a mesma condição). O Draconya hoje é mais
generoso entre 0 e 840 minutos do que o Tibia é, e trata Bestiário igual à XP — o Tibia conta
abate para o Bestiário mesmo com stamina baixa; só XP e loot têm portão.

A recuperação fora de hunt também não é 1:1: é **1 min a cada 180 s** até 2.340 min, depois **1
min a cada 360 s** até o teto de 2.520 (`regenerate_stamina.lua`), com 10 min de carência antes de
começar.

Regeneração de vida/mana hoje corre para todas as vocações a 1 HP/s fixo, uma regra sem fonte no
Tibia (a sessão de 2026-09-18 já tinha decidido "sem regen por comida" e o ADR 0032 tinha
adiado comida para depois — as duas decisões são anteriores ao ADR 0037 e caem por ele). No Tibia
a regeneração **só existe enquanto durar uma condição dada por comida**: `value × 12` segundos por
unidade, com teto de 1.200 s por vez (`foods.lua:144-152`, confirmado: `itemFood[1] * 12` e o
corte em `>= 1200`).

## Decisão

1. **Stamina.** Teto 2.520 min. Consumida a 1 min por 60 s de hunt, por evento (`useStamina`),
   nunca por `dtMs` acumulado. XP: 1,5× acima de 2.340 min **e** Premium; 0,5× em 840 min ou
   menos; 1× no resto. Loot cortado em 840 min ou menos — corte diferente do de XP, não o mesmo
   portão. Bestiário e tarefas (Task Hunting, quando existir) contam **sempre**, mesmo com
   stamina baixa — divergindo do portão único atual.
2. **Recuperação.** A Cidade equivale a estar offline: 10 min de carência, depois 1 min a cada
   180 s até 2.340 min, e 1 min a cada 360 s até o teto de 2.520. A conversão do valor já
   persistido (hoje calibrado para 24 h/1:1) preserva o **tempo absoluto** de stamina restante, não
   a fração do teto (ADR 0014 — dado persistido migra, nunca é descartado às cegas).
3. **Regeneração.** Deixa de ser constante. Só existe enquanto houver a condição de regeneração
   dada por comida (`value × 12` s, teto de 1.200 s por unidade consumida). Comida é suprimento
   abstrato: vem do loot para um estoque, ou é cobrada pelo preço de NPC no uso — o mesmo modelo
   que o ADR 0032 (P1) já aplicou a runa e munição.
4. **O bot come sozinho** quando a condição de regeneração não está ativa e o personagem não está
   cheio — parte da automação server-side (ADR 0002, invariante 11), não uma ação manual nova.

## Questões em aberto (decisão do dono)

- **A Cidade conta como offline para a recuperação 1:3 (até 2.340) / 1:6 (até 2.520), com 10 min
  de carência? O 1,5× de XP fica só para Premium, como no Canary? E o impacto no teto de sessões
  do ADR 0001 precisa ser medido antes do deploy?** As três perguntas vêm juntas porque a razão
  de recuperação (1:3/1:6, mais lenta que o 1:1 atual) reduz quanto tempo de hunt "grátis" um
  personagem acumula por dia — e o teto de simulação do projeto é `2 × contas ativas` (ADR 0001).
  Uma recuperação mais lenta pode aumentar quantas contas ficam com stamina disponível ao mesmo
  tempo, ou diminuir — o sentido não é óbvio sem medir. O plano **recomenda adotar os números do
  Canary tal como confirmados** (Cidade = offline, 1,5× só Premium) por fidelidade direta ao ADR
  0037, mas marca a medição de custo como pré-requisito de deploy, não de implementação.
- **Comida como suprimento abstrato (gold no uso, estoque vindo do loot, bot come sozinho) ou
  como item físico que ocupa espaço no inventário e o bot precisa gerenciar?** O plano **recomenda
  o modelo abstrato** (decisão 3 acima), por ser a mesma forma que runa e munição já usam desde o
  ADR 0032 — um caminho de consumo só, em vez de dois. A alternativa (item físico) é mais fiel à
  experiência literal do Tibia (a mochila cheia de queijo), mas nenhuma das duas está decidida.
- **Bônus de XP de level baixo (`lowLevelBonusExp = 50` até level 50, do mesmo `onGainExperience`
  que as faixas de stamina) — mecânica real do Tibia, ou configuração de servidor OTS que fica de
  fora?** É a mesma função Lua que dá as faixas de stamina (TFS `default_onGainExperience.lua`,
  bloco anterior ao de stamina), mas o valor é um parâmetro de `config.lua`, não uma constante de
  engine — o tipo de número que pode ser escolha de operador de servidor, não regra do jogo
  oficial. Sem decisão do dono, o M32-02 (#563) fica sem implementar até a resposta.

## Alternativas

- **Manter 24 h/1:1 e só trocar o corte de XP/loot pelas faixas do Tibia.** Descartada: as duas
  metades (teto+recuperação e faixas de consumo) vêm do mesmo mecanismo no Canary/TFS — misturar
  teto nosso com faixas do Tibia produziria um número que não corresponde a nenhuma fonte
  verificável, o problema que o ADR 0031 (DT-01) já nomeou para combate.
- **Regeneração constante para automação, condicionada a comida só para jogo manual.** Descartada
  pelo invariante 11: não existe regra que trate automação como merecedora de comportamento
  diferente do jogador manual.

## Consequências

- M32 (#562–#565) implementa a decisão: stamina com faixas (M32-01), bônus de level baixo
  (M32-02, dependente da questão em aberto), regeneração por comida (M32-03), bot que come
  sozinho (M32-04).
- `docs/product/stamina.md` é reescrito com as faixas e a recuperação não-linear; a nota "não é um
  recurso ticado" continua valendo — o cálculo sob demanda (`staminaMs` + `staminaUpdatedAt`)
  não muda de forma, só de fórmula.
- O custo de infraestrutura (ADR 0001) é o risco nomeado desta decisão: é o único dos nove ADRs
  cuja resposta pode mudar quantas sessões o projeto sustenta ao mesmo tempo, e por isso a medição
  é condição explícita antes do deploy, não só antes do código.

## Invariantes afetados

Nenhum muda de texto. O invariante 2 (nada por tick) é quem exige que a stamina continue calculada
sob demanda, mesmo com faixas novas. O invariante 11 é quem decide a questão do bot comer sozinho
sem tratamento especial.
