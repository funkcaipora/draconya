# 0032 — A imagem decide: o HUD renderizado do kit é o contrato do jogo, não só da tela

**Status:** aceito
**Data:** 2026-09-18
**Contexto técnico:** `packages/content` (suprimentos e munição abstratos, moedas, cargas,
vocabulário v2 do bot, postura, skills por família, soul, loja), `packages/sim` (motor de slots,
automações, postura, cargas, moedas, loot na mochila, DPS/HPS), `packages/protocol` (`use-slot`,
`select-target`, `select-ammo`, `set-stance`, `dispatch-loot`, estado dos slots, gemas),
`packages/server` (migração v1→v2, loja), `packages/client` (barra de ações, `AmmoPicker`,
Automações, coluna direita, topo); `docs` (este ADR e `docs/hud-contract-plan.md`)

## Contexto

O ADR 0030 fez do kit renderizado a especificação da **tela** — e o M16, o M17, o M15 revisado e
o M19 foram executados e fechados em 2026-09-17/18 (PRs #364, #365–#380, #366, #412). Mesmo
assim, o HUD de caçada de hoje (captura em
`docs/reviews/hud-parity-audit-2026-09-18.md`) continua longe da imagem no que o dono
apontou como o principal: a coluna esquerda ainda mostra o painel **Bot** v1 (cinco categorias
Cura/Poções/Ataque/Runas/Suporte, botão "Lure e alvo", seção "Configurações avançadas") no lugar
das **Automações**; não existe **barra de ações** e o mundo vai até o rodapé; a coluna direita não
tem **postura**, a Bolsa é uma grade vazia sem GOLD/PLAT/GEM e a Mochila mostra sprites sem
rótulo nem contagem; o topo não tem gemas, Loja nem os ícones de Guild/Amigos/Prey/Configurações.

Isso não é atraso de execução — é consequência de como o 0030 leu o kit. Ele deixou o **modelo de
jogo** decidir o que aparece: a decisão 5 ("superfície se sequencia, não se corta") mandou OMITIR
tudo que o servidor ainda não sabia contar, e ficou no ar quem faria o servidor saber; a decisão 2
entregou a barra como "configuração, disparo manual na fase E10"; a decisão 4 deixou a postura
desabilitada "até o E2"; a decisão 7 pendurou cinco decisões de produto (P1–P5) numa confirmação
do dono que a issue-portão #362 esperou sem resposta; e o plano marcou como "decisões permanentes
contra o kit" a barra do Level, DPS/HPS, "Despachar loot", Soul Points. O resultado é um HUD que
mostra só o que o motor de 2026-09-12 sabia — exatamente o contrário do que "exatamente como na
imagem" pede.

Em 2026-09-18 o dono fechou a questão: **"Faça um plano para deixarmos a interface exatamente como
na imagem (principalmente a barra de ações inferior e os menus laterais). Isso muda as ADRs do bot
etc.; desconsidere tudo que foi decidido e vamos decidir com base na imagem."** A imagem é o HUD
de caçada do kit (`docs/kit-reference/10-hud-hunt.png`, a composição `GameScreen` de `App.jsx`
com `DR.analyzerLive`). Três levantamentos (cliente região a região, modelo de jogo sistema a
sistema, decisões vigentes) estão em `docs/reviews/hud-parity-audit-2026-09-18.md` e são a
evidência deste ADR.

## Decisão

### 0. A regra: a imagem é o contrato do jogo

**Cada elemento do HUD renderizado é um compromisso de produto que o servidor precisa sustentar.**
O invariante 4 não muda — o cliente continua mostrando só verdade do servidor —, então o que muda é
o sentido da diferença: quando o servidor não tem a fonte de um elemento da imagem, **a fonte é
construída** (`sim`/`content`/`protocol`), com marco nomeado em `docs/hud-contract-plan.md`.
"Omitido" passa a ser um estado transitório com número de issue, nunca uma decisão. Isto emenda a
decisão 5 do ADR 0030 e revoga a lista de "decisões permanentes contra o kit" de
`docs/kit-fidelity-plan.md` §3b no que a imagem mostra (barra do Level, DPS/HPS, Despachar loot,
Soul Points).

Do kit, o que é contrato: a composição de `App.jsx`/`Hud.jsx`, o desenho renderizado, e as
**classes de coisa** que `data.js` declara (moeda como saldo/ledger, munição selecionada por
família, tecla por slot, conjuntos, posturas, bênção, boost de EXP, soul, skill por família de
arma). O que continua NÃO sendo contrato, como no 0030: os **números** de `data.js` (nunca viram
constante), o código morto do protótipo e os hacks de render. Quando o kit se contradiz (Utamo Vita
e Magic Shield como duas pills do mesmo efeito), vence a leitura coerente com a mecânica de
referência, registrada no plano.

**Única classe de exceção:** nome proprietário do Tibia (palavras de magia "exori", "utamo vita";
nomes de item literais) não entra por causa do limite de licença do ADR 0019/0031 — o slot mostra
o rótulo curto do **nosso** conteúdo ("WAVE", "STRIKE", "HASTE"), na mesma tipografia. Fora isso,
não há "não se aplica".

### A barra de ações (rodapé, 124 px)

1. **A barra é a configuração do bot E a superfície de disparo manual — um só vocabulário.**
   Vinte e quatro slots (2 × 12); cada slot guarda uma ação (`spell` ou `supply`) mais
   uma lista de condições (E entre elas), a tecla de atalho e a chave "automática". As cinco
   categorias do bot v1 (`heal/potion/attack/rune/support`, ADR 0002/0026) **deixam de existir**:
   `BOT_VOCABULARY_VERSION` sobe para 2, e o servidor migra a configuração v1 salva de forma
   determinística (as regras entram no conjunto 1 na ordem cura → poções → ataque → runas →
   suporte, preservando `enabled` e a condição) — nenhum jogador perde configuração. O
   `BotPanel`/`RuleEditor` do cliente é aposentado no mesmo marco que entrega a barra; a barra
   cobre 100 % por construção (slot = regra).
2. **Prioridade é a ordem do slot; cooldown é o grupo do conteúdo.** O motor avalia por grupo de
   cooldown (os grupos do Tibia já modelados: `attack`/`healing`/`support` para magia, mais
   `potion` para poção e `attack` para runa — vindos do conteúdo, nunca configuráveis por slot) e,
   a cada grupo pronto, tenta os slots ligados em ordem (fileira 1 da esquerda para a direita,
   depois a fileira 2) e **pula** o que não consegue executar agora — sem mana, sem gold, sem
   alvo, em cooldown individual (RP-003/RP-004 do PRD; a lacuna do `select()` v1 registrada em
   #362). Sem tetos por categoria: o teto é 24. As condições são as quatro do v1 (`hp`, `mana`,
   `targets`, `target-hp`) mais `condition` (efeito ativo/ausente — "castar haste só sem haste").
3. **A tecla dispara agora.** Cada slot tem uma tecla (1–9, 0, F1–F12, escolhida no
   `ActionConfigModal`; a baseline atribui em sequência); apertar manda a intenção C2S
   `use-slot { set, slot }` e o servidor executa **imediatamente** se a ação for elegível (mesma
   elegibilidade do bot, ignorando as condições do slot — manual é manual), respondendo o motivo
   quando recusa. O atalho funciona com a chave "automática" desligada (Shift+clique, UC-BAR-005):
   é o "o atalho continua manual" do kit v3. Revoga a "fase E10" da decisão 2 do ADR 0030.
4. **Conjunto = quatro loadouts com nomes fixos.** "Energia", "Fogo", "Gelo" e "Sagrado" são
   quatro configurações completas de 24 slots; o dropdown troca `activeSet` (persistido pela
   `bot-config`, "Salva automaticamente" = write-behind do ADR 0028) e carrega os slots do
   conjunto sem tocar nos outros (UC-BAR-001). Os nomes são rótulos do kit, não mecânica: ligar
   cada conjunto ao elemento das magias espera as resistências chegarem ao cliente (E2) e é
   decisão futura, registrada no plano.
5. **Alvo e Lure·Follow reaproveitam o targeting que existe.** O dropdown ALVO expõe a política:
   `follow` ("Seguir <nome>" — o alvo que o jogador escolheu clicando na Batalha ou no mundo,
   intenção C2S `select-target { creatureId }`; ao morrer o alvo, cai em `nearest`), `nearest`
   ("Mais próximo") e `lowest-hp` ("Menor HP"). O botão ⌖ Lure·Follow abre o modal de lure/alvo
   já entregue (SV-09) e a legenda mostra `mín/máx` e "seguir alvo"/"parado na rota" da postura do
   bot. **Não existe mais "bot avançado a partir do level 50"** (diretriz do dono, 2026-09-18): a
   barra, os conjuntos, o alvo, o lure e as Automações valem para todo personagem desde o level 1;
   `advancedFromLevel`/`advancedOnly` saem do conteúdo e do catálogo, e o estado "LV 50+ / bot
   avançado" do kit é um mock que nunca acontece. E valem **o tempo todo**: a barra e o painel de
   Automações são montados na Cidade e na caçada (como o kit monta), a configuração é editável em
   qualquer lugar e a execução acontece na hunt — o `use-slot` fora de uma hunt é recusado com
   motivo, nunca escondido.

### Suprimento, munição e cargas

6. **P1 = SIM: suprimento é abstrato, e o gold sai no uso.** Poção e runa vivem em
   `data/supplies/` com `price`, `effect`, `requires` e `group` (o grupo de cooldown do motor v2:
   poção → `potion`, runa → `attack`). Usar chama `useSupply` (`casting.ts`), que debita `price`
   do gold do personagem no ato e leva o gasto a `Aggregates.goldSpent`. **Não há pilha, não há
   compra de lote e não há caminho `purchase` no ledger** — o débito por uso é o desenho do
   §20.1, e não há reposição a fazer: a próxima poção é paga no uso seguinte. A única
   exceção é a **carga de bênção**: segue item `kind: 'consumable'` não-empilhável, sem `restock`
   nem `group` obrigatórios, e quem a consome é a TP-03 (M22).
7. **P4 = SIM: munição é abstrata, escolhida por família.** Flecha e virote vivem em
   `data/ammunition/` com `family` (`arrow`/`bolt`), `attack`, `price` (> 0 — **sem fallback
   grátis**) e `requires.level`. Cada tiro debita `price` do gold. A escolha é por família:
   opcode 14 `select-ammo` (des-queimado), validada por `requires.level` no servidor e publicada
   em `player-stats.ammo { arrow, bolt }`; a ausência de uma família cai na **básica da família**
   (a primeira em ordem de id), que também é paga. Com um bow/crossbow (arma `distance` de duas
   mãos) equipado, o slot do escudo mostra a munição selecionada; clicar abre o `AmmoPicker` com
   as opções da família liberadas pelo nível. **Sem pilha, sem `#pullNextAmmo`, sem reposição** —
   sem gold para o tiro, o tiro não sai e a regra `out-of-gold` encerra a hunt.
8. **Anel gasta por tempo, colar por carga, e o motor consome.** `durationMs` e `charges` deixam
   de ser campos mortos: o `sim` agenda o vencimento na fila de eventos (invariante 2), destrói o
   item ao esgotar e a automação "Renovar" equipa o próximo da mochila. O conteúdo ganha o primeiro
   colar (proteção elemental por carga) e o primeiro escudo real.

### Automações

9. **Automações são um catálogo fechado de cinco modelos** (ADR 0002 continua: vocabulário, nunca
   script): `renew-ring`, `renew-amulet` ("quando acabar", decisão 8), `swap-ammo-by-targets`
   (≥ N alvos → munição A, senão B), `swap-weapon-shield-by-hp` (HP < x % → uma mão + escudo;
   HP > y % → duas mãos) e `swap-ring` (o ring swap atual, com o segundo gatilho "≥ N alvos" em
   OU). Cada uma tem `enabled`, parâmetros, condições de **entrada em OU** e de **saída em E** (o
   desenho do `AutomationConfigModal` v3), e o painel lista toggle · nome · resumo gerado dos
   parâmetros · ⚙ · ×, com "+ Adicionar" abrindo o catálogo. A baseline por vocação liga as que
   fazem sentido (paladino: munição por alvos; cavaleiro: arma/escudo por vida). **Comida e
   "Comer comida" ficam fora deste plano** (diretriz do dono, 2026-09-18): todo personagem tem
   uma regeneração base por vocação, que é assunto de um plano próprio — o slot COMIDA da imagem
   e a sexta automação do kit v3 entram com ele, não aqui.

### A coluna direita

10. **Postura é fight mode, e funciona.** `offensive` / `balanced` / `defensive` no personagem,
    intenção C2S `set-stance`, persistida com a configuração de combate (mesmo caminho do ADR
    0028). Efeito: o mecanismo do TFS (ofensiva: dano cheio, defesa base; balanceada: dano ÷ 1,2 e
    defesa × 1,2; defensiva: dano ÷ 2 e defesa × 2 — números da referência, ADR 0019). Como muda
    resultado, nasce com o perfil `combat-v2` e o teste de conformidade que o ADR 0031 exige; o
    adiamento de fight mode registrado no 0031 (emenda CMB-04) é revogado. O default é
    "Balanceada", como a imagem. Revoga a decisão 4 do ADR 0030.
11. **A Bolsa guarda moeda física; o topo mostra o saldo.** Gold, platinum e crystal coins são
    itens empilháveis (1 / 100 / 10 000, rótulos GOLD / PLAT / GEM da imagem) que o loot deposita
    na bolsa — o bot troca 100 gold por 1 platinum e 100 platinum por 1 crystal sozinho. O saldo
    do topo continua sendo o ledger (invariante 10): a bolsa é creditada nele ao "Despachar loot"
    e ao sair da hunt (`hunt-credit`, uma linha por sessão como hoje). Morte não perde a bolsa
    (`death.md` §"nunca perde item" continua). Em party `shared`, o gold vai para a bolsa da party
    como já vai. Emenda a decisão 6 do ADR 0030 ("o tile GOLD mostra saldo").
12. **Loot é item na mochila, e Despachar loot vende.** O drop entra na mochila (limitado pela
    capacidade; a Caixa de Loot em Redis da FUN-88 é aposentada); "Despachar loot" (intenção C2S
    `dispatch-loot`) vende ao `value` do conteúdo pelo ledger e esvazia — o modal do kit (captura
    25) lista item × quantidade × valor. Com a capacidade cheia o bot despacha sozinho (idle-first).
    Party: respeita `shareLoot` (bolsa da party) como hoje.
13. **Skills são as do Tibia, por família.** `fist`, `club`, `sword`, `axe`, `distance`,
     `shielding`, `magic` — a skill `melee` única (ADR 0026 d.4) é dividida na migração copiando o
     progresso para as três famílias. **Soul Points existe:** máximo 100 (200 com Premium),
     regenera 1 a cada 240 s (120 s Premium), consumido por magia com custo `soul` — o primeiro
     consumidor é a conjuração de munição do paladino. A barra do Level mostra `xpPercentToNext`,
     que passa a trafegar. O painel
    Skills tem as 11 linhas default da imagem e o modal Personalizar lista as 15 que existem
    (Fishing não existe; não entra).

### Party, mundo e topo

14. **DPS/HPS por membro** = dano causado e cura feita nos últimos 60 s (acumulador por evento com
    carimbo lógico, aparado na leitura — nada por tick), mais os totais da sessão, em
    `party-state` e no analisador. Os dois interruptores "Rateio de custos"/"Dividir loot" são do
    líder e mudam durante a hunt (converge com o M20, decisão D1 da PR #409). **"Parar no meio da
    caçada exige o sim de todos" é literal:** ninguém, nem o líder, encerra a sessão da party para
    os outros; encerrar para todos é uma proposta que cada membro aprova (60 s), e sair sozinho
    continua livre ("Saindo sozinho: …"). O teto de membros é decisão do M20 (a imagem só exige
    ≥ 5). Tudo isto mora no M20, não em marco novo.
15. **A pill de buff mostra o nome da fonte** (a magia ou o item do nosso conteúdo) com o tempo
    restante que `active-conditions` já leva; "Utamo Vita" e "Magic Shield" na imagem são o
    mesmo efeito (contradição do mock) e viram uma pill. A **moldura vermelha do alvo** entra
    sobre a criatura no mundo (`targetId` já chega). O status do canto vira "● 42 ms · 60 fps"
    (a palavra "conectado" só no tooltip; a cor do ponto é o estado).
16. **EXP +N % Xh** é a soma dos multiplicadores temporários de XP ativos (boost de EXP da Loja,
    Prey quando existir) com o tempo do que vence primeiro; sem bônus ativo a pill não aparece
    (a imagem é um instante com boost). **Bênção** é a carga de bênção consumida pelo slot BENÇÃO
    (decisão 6): `blessed` no personagem, pill "Bênção ativa", consumida na morte para reduzir a
    penalidade de XP (`death.md`: 60 %/54 %) por um fator do conteúdo. Gemas são `account.coins`
    (coluna já existente, hoje inerte), levadas na `session-state` e gastas na **Loja** (modal do
    kit, capturas 32–33) por um catálogo em `content/store`: boost de EXP, carga de bênção,
    Premium — compra pelo `api` com lançamento próprio; o "+" do gold abre a aba "Comprar gold"
    (livro de ordens gemas ↔ gold sem taxa, decisão do dono de 2026-09-16). Os ícones do topo
    aparecem cada um com o seu sistema (Amigos com o M20; Configurações com o endpoint de
    preferências; Guild e Prey nos épicos E12/E7, os últimos do plano) — nenhum ícone inerte.

### O que a imagem NÃO decide

Tela de entrada, modais e celular seguem o ADR 0030 (P5 continua NÃO; o toggle PT/EN espera i18n;
o "+20 % de premium" do modal Personagem continua fora). Os números de balanceamento (preço do
supply e do tiro, fatores de postura, fator da bênção, janela de DPS) são
do conteúdo e podem mudar sem ADR — o que este ADR fixa é a **forma**.

## Alternativas

- **Manter o 0030 e só "terminar o M18"** — descartado: o M18 como estava (barra como
  configuração, manual na fase 2, postura inerte, P1/P4 pendentes) produz um HUD que ainda não é
  a imagem; o dono pediu a imagem.
- **Contagens, postura e bolsa como decoração** — descartado pelas razões do 0030: inventa
  mecânica; e agora a alternativa honesta (construir a fonte) tem plano e marco.
- **Suprimento como item com reposição por lote pelo ledger** — descartado: o débito por uso
  mantém a economia auditável e o "acabar o gold" com sentido, sem uma segunda contabilidade de
  pilha que a imagem não pede.
- **Munição como item no slot `ammo` (pilha de 100)** — descartado em favor da seleção por
  família (Huntera, ADR 0026 d.3): o "acabar" fica no gold, não na pilha, e é o que o slot do
  Escudo da imagem mostra — clicar abre o `AmmoPicker`.
- **Grupo de cooldown livre por slot (rascunho da #362)** — descartado em favor do grupo vindo do
  conteúdo: é o modelo do Tibia, não exige que o jogador entenda cooldown compartilhado, e
  elimina os tetos por categoria sem inventar uma dimensão nova.
- **Manter a trava de level 50 do bot avançado (lure, alvo, ring swap)** — descartado pelo dono:
  a imagem é a mesma para todo level, e uma trava de nível só esconderia o vocabulário de quem
  mais precisa aprendê-lo cedo.
- **Conjunto ligado ao elemento das magias já** — adiado: sem resistência no cliente o jogador
  não teria como escolher; loadout com nome fixo entrega a imagem hoje sem fechar a porta.
- **Gold como item também no topo (sem ledger)** — descartado: o invariante 10 é o mecanismo de
  concorrência do gold; a bolsa é item porque a imagem mostra moeda carregada, o saldo continua
  ledger porque é o que impede duplicação.
- **Bot v2 sem migração (configuração v1 é descartada)** — descartado: a migração é um mapeamento
  determinístico de cinco listas para 24 slots; perder a configuração de quem já joga é regressão
  gratuita.

## Consequências

O que fica mais fácil: cada elemento da imagem tem dono (`docs/hud-contract-plan.md` §1 mapeia
elemento → decisão → marco → issue); as issues de M18/M21/M22 citam "ADR 0032 decisão n" em vez de
redecidir; a #362 fecha por este ADR (P1 e P4 confirmadas pela diretriz do dono; o vocabulário v2
está na decisão 1–3 e 9); `docs/product/*` passa a descrever um jogo com suprimento abstrato,
munição por família, cargas, postura, moedas e soul. O que fica mais difícil: a economia mantém o
débito por uso (`goldSpent` no ato) e o gold passa a ser o único limitador do consumo — a poção e o
tiro param quando o saldo acaba; o perfil de combate vira `combat-v2` (postura
muda números — conformidade nova, ADR 0031); há uma migração de dados de personagem (bot v1 → v2,
`melee` → três famílias) que precisa ser idempotente e testada; e a coluna
`account.coins` deixa de ser inerte, o que puxa o E13 para dentro do plano antes do previsto. O
que precisa mudar: ADR 0026 — d.3 e d.8 voltam a valer (seleção por família e débito por uso), d.4
é substituída pelo 0032; ADR 0030 recebe
"emendado pelo 0032 (decisões 2, 4, 5, 6 e 7)"; ADR 0031 ganha a nota de que fight mode entra com
`combat-v2`; `docs/kit-fidelity-plan.md` passa a instantâneo (executado até o M17; o M18 é
redesenhado no plano novo); `economy.md` §20.1 volta a ser [DECIDIDO]; a issue #362 fecha.
A PR #409 (Party v2) precisa renumerar o seu ADR para **0033** — 0031 é o de combate, 0032 é este.

## Invariantes afetados

Nenhum muda; três são exercitados. **4** (o cliente só manda intenção): `use-slot`, `select-target`,
`select-ammo`, `set-stance` e `dispatch-loot` são intenções — quem decide elegibilidade, debita
gold, troca moeda e vende é o servidor; cooldown e motivo de bloqueio chegam prontos. **10**
(ledger): o débito do supply e o débito do tiro entram em `goldSpent`/`goldGained`, e venda do loot
e gasto de gemas são lançamentos com `(session_id, seq)`; o saldo continua sendo o ledger.
**11** (automação
legítima): a barra é primeiro a vista do bot; o atalho manual é o extra, e o débito no uso existe
porque o modo default do jogo é ninguém estar olhando.
