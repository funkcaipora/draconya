# Plano de paridade do catálogo — M29 a M44

**Status:** proposto em 2026-09-25; as doze questões do §5 receberam decisão do dono no mesmo dia
("copie do Huntera" — ver abaixo), registrada em cada ADR afetado (0038, 0039, 0040, 0042, 0043,
0045) numa seção "Emenda — 2026-09-25" — as decisões de arquitetura e produto que este plano
exige estão nos [ADRs 0038 a 0046](adr/README.md); este documento é o inventário dos marcos, o
que fica de fora e as questões que ainda esperam captura (§6).
**Diretriz do dono (2026-09-24):** *"copie tudo do The Forgotten Server e Open Tibia... copie
todas as mecânicas, magias, monstros, itens"* — o [ADR 0037](adr/0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
registra a primeira metade do pedido (mecânica de caça); este plano é a segunda metade (o
catálogo inteiro) e tudo que ainda falta do motor para sustentá-lo.
**Fonte:** inventário verificado de Canary (`things/sources/canary`, gitignorado como
`things/sources/forgottenserver`) contra o Draconya em 2026-09-25, com seis pontos corrigidos na
revisão (ver §4).

## 1. Por que 16 marcos, nesta ordem

O M28 (#518–#527, [ADR 0037](adr/0037-tfs-canary-fidelity-except-action-bar-and-automation.md))
já entregou a primeira hunt inteiramente fiel — a party de dragões level 200 na Darashia Dragon
Lair. Este plano não repete nada que o M28 já cobre; ele estende a mesma regra ao resto do motor
e ao catálogo inteiro, na ordem da dependência real:

1. **M29–M31 terminam o motor de caça** — o que falta para qualquer monstro e qualquer combate se
   comportar como no Tibia, ainda com conteúdo de fixture.
2. **M32–M33 dão ao personagem o sustento e a morte do Tibia** — stamina, comida, promoção,
   bênçãos, perda de item.
3. **M34–M36 importam o catálogo por ferramenta** — itens, monstros, e então toda hunt nascendo
   dos spawns reais em vez do pull por dificuldade.
4. **M37–M38 fecham magias e runas** — o catálogo completo, party, provocação, cura de condição,
   campo, conjuração, invocação e familiares.
5. **M39–M43 trazem os sistemas de progressão do 13.x** — Bestiário/Charms, Imbuements, Wheel of
   Destiny, Prey/Task Hunting/Concoctions/Boosted Creature, Forja.
6. **M44 junta os periféricos** — o que fica no plano em vez de ser descartado, mas não muda o
   núcleo da caça.

## 2. Marcos

| Marco | Objetivo | Milestone | Issues | ADR |
|---|---|---|---|---|
| M29 | IA de monstro do Canary completa — alvo ponderado, manter distância, dança/staticAttack, empurrar criatura, evitar campo, invocação, drown/lifedrain/manadrain | [19](https://github.com/funkcaipora/draconya/milestone/19) | #541–#547 | — (pré-requisito de M35 e de 0040) |
| M30 | Combate do Canary: pipeline de recebimento (`combat-v3`) — `blockHit`, defesa/armadura/mitigação do jogador, postura, crítico/leech, reflexo, linha de visão, stairhop | [20](https://github.com/funkcaipora/draconya/milestone/20) | #548–#555 | [0040](adr/0040-combat-v3-canary-block-hit-pipeline.md) |
| M31 | Condições e campos do Tibia — velocidade com sinal, DOT decrescente, drunk, imunidade, campos com estágios | [21](https://github.com/funkcaipora/draconya/milestone/21) | #556–#561 | [0041](adr/0041-tibia-conditions-and-fields.md) |
| M32 | Sustento do Tibia — stamina 42 h com faixas, bônus de level baixo, regeneração só com comida, bot come sozinho, promoção, quatro skills corpo a corpo | [22](https://github.com/funkcaipora/draconya/milestone/22) | #562–#568 | [0042](adr/0042-tibia-death-promotion-blessings-and-item-loss.md) (M32-05); [0043](adr/0043-tibia-stamina-and-food-only-regeneration.md) (M32-01…04) |
| M33 | Morte do Tibia — perda de skill tries/mana gasta, bênçãos, perda de item sem item no chão | [23](https://github.com/funkcaipora/draconya/milestone/23) | #569–#571 | [0042](adr/0042-tibia-death-promotion-blessings-and-item-loss.md) |
| M34 | Catálogo de itens do Canary por importador — infra, itens, preços de NPC, munição/aljavas, poções de buff, comida | [24](https://github.com/funkcaipora/draconya/milestone/24) | #572–#577 | [0038](adr/0038-tibia-catalog-import-tooling.md) |
| M35 | Catálogo de monstros do Canary por importador — leitor, mapeamento de habilidades, primeira importação, Rat/Rotworm/Dragon/Dragon Lord regenerados | [25](https://github.com/funkcaipora/draconya/milestone/25) | #578–#581 | [0038](adr/0038-tibia-catalog-import-tooling.md) |
| M36 | Caçada idêntica ao Tibia em toda hunt — importador de spawns, fim do pull por dificuldade, compatibilidade de protocolo, vida do cadáver pela cadeia de decaimento, Rat Cellars/Rotworm Caves reais, primeiro lote de hunts novas | [26](https://github.com/funkcaipora/draconya/milestone/26) | #582–#587 | [0039](adr/0039-canary-spawn-points-end-of-pull-difficulty.md) |
| M37 | Magias e runas — alvo de party, provocação, cura de condição, campo/parede, Paralyze Rune, pontos de alma, conjuração abstrata, extrator, magias e runas restantes | [27](https://github.com/funkcaipora/draconya/milestone/27) | #588–#597 | [0044](adr/0044-conjuring-runes-and-soul-as-abstract-supply.md) (M37-06/07) |
| M38 | Invocações e familiares do jogador — Summon Creature (teto 2), familiares por vocação, Convince Creature, Animate Dead | [28](https://github.com/funkcaipora/draconya/milestone/28) | #598–#600 | — |
| M39 | Bestiário real e Charms — estágios por monstro, pontos de charm, sem o +1 % de XP global, efeitos em combate | [29](https://github.com/funkcaipora/draconya/milestone/29) | #601–#603 | [0045](adr/0045-tibia-bestiary-charms-prey-and-training.md) |
| M40 | Imbuements — estado por instância, catálogo do `imbuements.xml`, efeitos em combate, Santuário de Imbuement | [30](https://github.com/funkcaipora/draconya/milestone/30) | #604–#607 | [0046](adr/0046-item-instance-overlay-for-imbuements-and-forge-tier.md) |
| M41 | Wheel of Destiny — pontos e alocação, bônus de dedicação/convicção, revelações e magias, gemas e vessels | [31](https://github.com/funkcaipora/draconya/milestone/31) | #608–#611 | — |
| M42 | Prey, Task Hunting, Concoctions e Boosted Creature | [32](https://github.com/funkcaipora/draconya/milestone/32) | #612–#615 | [0045](adr/0045-tibia-bestiary-charms-prey-and-training.md) |
| M43 | Forja da Exaltação e criaturas Influenced/Fiendish — spawn, tier de item e procs, fusão/transferência/conversão | [33](https://github.com/funkcaipora/draconya/milestone/33) | #616–#618 | [0046](adr/0046-item-instance-overlay-for-imbuements-and-forge-tier.md) (M43-02) |
| M44 | Periféricos do Tibia — facções, apresentação de monstro, ilusões, condições de controle, magias utilitárias, aprender magia com NPC, trava de saída, skinning, atributos de item, Loyalty, Bosstiary, Weapon Proficiency, treino, Hazard, Animus Mastery | [34](https://github.com/funkcaipora/draconya/milestone/34) | #619–#633 | [0045](adr/0045-tibia-bestiary-charms-prey-and-training.md) (M44-13) |

M38, M41 e a maior parte de M44 não têm ADR dedicado nesta leva de nove: são extensão direta do
mecanismo já registrado (magia e invocação seguem o modelo do ADR 0038/0044; Wheel e a maioria dos
periféricos são conteúdo novo sem decisão de arquitetura própria). Uma decisão que surgir ao
especificar essas issues vira ADR na hora, como qualquer outra.

## 3. Fora do escopo, e por quê

| Item | Motivo |
|---|---|
| PvP: skulls, frags, unjust kill, PZ lock por agressão a jogador, Twist of Fate, bênção PvP, redução de morte por justiça | As hunts são PvE e instanciadas (invariante 8). O ADR 0031 exige perfil e ADR próprios para PvP; a Guild War é modo à parte (`docs/product/guild-war.md`), fora da mecânica de caça. |
| Casas, móveis, decoração, camas, portas e as magias de casa | O Draconya não tem mundo persistente com moradia, e nada disso cai de monstro nem é equipado. |
| Raids como evento global de mundo | Pressupõem mundo aberto compartilhado; as hunts são sessões instanciadas. Os monstros das raids entram no catálogo como qualquer outro. |
| Cadáver como container com dono e decadência em estágios de loot | Rejeitado pelo ADR 0037 (Alternativas). O loot vai para a caixa da sessão; a vida do cadáver é tratada no M36-04 sem precisar de dono. |
| Chase mode, secure mode, seleção de alvo do jogador e hotkeys | Caem nas exceções do ADR 0037 decisão 2 (barra de ações e automação do bot). |
| Store, Tibia Coins, XP boost de loja, VIP, Daily Reward, Soul War taint | Monetização e engajamento sem efeito no mecanismo de caça (`docs/product/monetization.md`); boosts de quest dependem de um motor de quest inexistente. |
| Vocação Monk e as magias dela, Enlighten Party, Transcendence Potion | O Monk veio depois do pacote de arte 13.32, referência de release (ADR 0031) e de aparência (invariante 6); não há outfit nem sprite. Reavaliar se o pacote trocar. |
| Eventos de quest dos monstros (329 arquivos) e scripts de NPC além de loja/promoção/bênção/magia | Não existe motor de quest (`docs/product/quests.md` é sistema futuro); o monstro é importado sem o gancho. |
| Outfits de jogador, addons e montarias | Cosméticos; não mudam número de caça. |
| Fishing e itens de texto (livros, placas), rotação, fonte de luz e líquidos | Sem efeito em combate, loot ou progressão de caça. |
| Monstros de familiars/, trainers/, traps/ e dos modos Dawnport, Nostalgia e Wild Magics | Familiares entram pelas magias (M38-02); trainers e traps não são criaturas caçadas; modos sazonais não se aplicam a um ruleset único, embora os monstros deles possam ser importados se o mapa for usado. |
| Recuperar munição do chão | O Canary consome munição por tiro; sem item no chão no Draconya, o arremessável é tratado pela `breakChance` do M34-04. |
| Practise spells (practise_fire_wave, practise_healing) | Magias de zero dano para os bonecos de treino de NPC, sem análogo no Draconya. |

## 4. Correções feitas na verificação de 2026-09-25

A inventário original tinha seis pontos corrigidos contra as fontes locais antes deste plano ser
escrito:

- **Stamina:** as faixas de XP existem nas duas engines — TFS
  `data/scripts/events/player/default_onGainExperience.lua:60-68` e Canary
  `data/libs/functions/player.lua:349-360` —, com 1,5× acima de 2.340 min para Premium e 0,5× em
  840 min ou menos. O corte de loot é em 840 min ou menos, não zero: Canary
  `src/lua/functions/creatures/player/player_functions.cpp:2200-2209` (`canReceiveLoot`) e TFS
  `default_onDropLoot.lua:12`. O Draconya é leniente demais entre 0 e 840 min hoje, e trata o
  Bestiário igual à XP.
- **Pontos de alma:** exigidos por cerca de 50 magias de conjuração via `spell:soul(n)` — por
  exemplo `data/scripts/spells/conjuring/avalanche_rune.lua:15`. Uma leitura anterior tinha
  buscado a sintaxe errada e concluído que nenhuma magia exigia alma.
- **Empurrar criatura:** `Monster::pushCreatures` (`src/creatures/monsters/monster.cpp:2405-2440`)
  só empurra monstro empurrável, nunca jogador, e esmaga quem não cabe.
- **Lifedrain e manadrain:** não curam o atacante. Manadrain tira mana do alvo
  (`src/game/game.cpp:9176`) e `Creature::mitigateDamage`
  (`src/creatures/creature.cpp:911-921`) pula os dois tipos explicitamente.
- **Imbuement agressivo:** só decai em combate e fora de zona de proteção
  (`src/creatures/players/imbuements/imbuements.cpp:473-497`), com duração de 20 h
  (`data/XML/imbuements.xml:2-4`).
- **`MONSTER_CLASSES`:** já inclui `dragon` (`packages/content/src/schemas.ts:1189`).

O dono do loot no cadáver fica fora deste plano: o loot nunca mora no cadáver no Draconya, e o
ADR 0037 (Alternativas) já rejeitou o cadáver-container.

## 5. Questões em aberto (decisão do dono)

As doze questões que o inventário levantou, na ordem em que aparecem no plano. As que bloqueiam
um dos nove ADRs estão marcadas; as outras ficam registradas aqui até a issue que as toca ser
especificada.

**Diretriz do dono (2026-09-25):** *"copie do Huntera"* — para produto (não mecanismo, que
continua TFS/Canary pelo ADR 0037), onde o Huntera (o Tibia-idle observado em
[`docs/reference/huntera-observed.md`](reference/huntera-observed.md)) foi de fato observado
fazendo algo, a decisão segue o Huntera; onde não foi observado, a regra provisória atual
permanece e a captura que falta entra na lista do §6. A coluna "Decisão (2026-09-25)" abaixo
resume o resultado de uma varredura de evidência verificada contra o documento inteiro; o ADR de
cada linha tem o detalhe completo, com citação de parte/linha, numa seção "Emenda — 2026-09-25".

| # | Questão | Onde é decidida | Decisão (2026-09-25, "copie do Huntera") |
|---|---|---|---|
| 1 | Corte de versão: adotar "o que o pacote de arte 13.32 desenha" como corte do catálogo (o que o [ADR 0038](adr/0038-tibia-catalog-import-tooling.md) já faz), ou planejar a troca do pacote? | Resolvida na prática pelo ADR 0038 decisão 5; revisitar só se o pacote de arte trocar. | Corroborada: Huntera serve o pacote 13.32 (`/things/1332/`) e não mostra Monk/Soulpit/Weapon Proficiency/Animus Mastery em nenhuma captura. Sem mudança de decisão. |
| 2 | Quantas e quais hunts: qual a meta total do M36-06 e quem aprova cada lote? | M36-06, sem ADR — decisão de conteúdo por lote. | Catálogo-alvo é o do Huntera: aberto e crescente (55 → 58 → 73 hunts em 12 dias), importado por lote, não um número fixo. Rat Cellars 1ª / Rotworm Caves 8ª já batem. O MODELO de spawn continua Canary por ponto (ADR 0039) — o pull por tamanho do Huntera não volta. |
| 3 | Perda de item na morte: destruir e registrar no extrato, ou manter "nunca perde item"? | [ADR 0042](adr/0042-tibia-death-promotion-blessings-and-item-loss.md) | Sem evidência — nenhuma morte de jogador aparece no documento. Mantém "nunca perde item" ([`docs/product/death.md`](product/death.md) §3.8) até o dono decidir; a questão do ADR 0042 segue aberta. |
| 4 | Stamina: a Cidade conta como offline para a recuperação 1:3/1:6 com 10 min de carência? O 1,5× fica só para Premium? O impacto no teto de sessões do ADR 0001 precisa ser medido antes do deploy? | [ADR 0043](adr/0043-tibia-stamina-and-food-only-regeneration.md) | Teto muda de 42 h para **12 h** (`staminaMs: 43.200.000`, Huntera). Recuperação por faixa (1:3/1:6) e as faixas de XP/loot do Canary NÃO são adotadas — nunca observadas no Huntera contra o teto novo; mantém recuperação 1:1 provisória, fórmula `[ABERTO]`. |
| 5 | Comida como suprimento abstrato ou item físico no inventário? | [ADR 0043](adr/0043-tibia-stamina-and-food-only-regeneration.md) | REVERTIDA: sem comida. Regen de vida/mana liga só por "estar em hunt" (tela + socket do Huntera confirmam), decisão 3 do ADR 0043 revertida. Pergunta fica sem objeto. |
| 6 | Tipo de dano `arcane`, magias genéricas (blast/strike/heal) e Divine Defiance sem fonte no Canary: remover ou manter como exceção documentada? | [ADR 0040](adr/0040-combat-v3-canary-block-hit-pipeline.md) | RESOLVIDA: remover. `damageInput` do Huntera é um enum fechado de seis canais sem `arcane`; o menu de magias de um paladino level 360 não tem Divine Defiance/Divine Barrage. Remove `arcane`, strike/blast/heal e Divine Defiance/divine-barrage/ethereal-barrage/forked-thorns, com migração de `botConfig`. |
| 7 | Bestiário: confirmar a remoção do +1 % de XP por marco sem compensação? | [ADR 0045](adr/0045-tibia-bestiary-charms-prey-and-training.md) | CONTESTADA: o Huntera lista "Progresso no Bestiary" como fonte de bônus de XP total (ao lado de level/guild/Premium), não só Charms. "Copie do Huntera" pesa CONTRA remover sem compensação — conflito genuíno para o dono; M39-01 não remove até decisão. |
| 8 | Aprender magia por gold com NPC (M44-06): personagens existentes ganham de graça as magias do level atual, ou todos pagam? | M44-06, sem ADR dedicado — decisão de produto quando a issue for especificada. | Sem evidência — "NPC" não aparece no documento. Mantém a regra atual (magia por level, sem compra) até uma captura; M44-06 segue bloqueado. |
| 9 | Dono do loot na party em modo split: maior dano (como o Tibia) ou sorteio (como hoje)? | Fora dos nove ADRs — desenho de party dos ADRs 0027/0035; decisão quando a issue for especificada. | Sem evidência — `party-update` não expõe dono de loot, só `damageTotal` por membro. Mantém o sorteio uniforme do ADR 0027. |
| 10 | Respawn bloqueável "à vista": janela de `Spectators::find` do Canary ou viewport do cliente do Draconya? | [ADR 0039](adr/0039-canary-spawn-points-end-of-pull-difficulty.md), nota não bloqueante — decisão quando a issue chegar. | Não isolável — as hunts "solo" do Huntera são shards compartilhados com outros jogadores reais, o dataset é ruído por desenho próprio do documento. Mantém o `Spectators::find` do ADR 0039. |
| 11 | Bônus de XP de level baixo (`lowLevelBonusExp = 50` até level 50): mecânica real do Tibia ou configuração de servidor OTS, fora do escopo? | [ADR 0043](adr/0043-tibia-stamina-and-food-only-regeneration.md) | RESOLVIDA: mecânica real, mas na FORMA do Huntera — `levelBonusPercent` decrescente e multiplicativo (L1 +200%, L2 +199%, L3 +197%, L7 +192%), não o `lowLevelBonusExp` aditivo fixo do TFS/Canary. Desbloqueia M32-02/#563; fórmula exata `[ABERTO]`. |
| 12 | Promoção e bênçãos sem NPC dialogável: tela de serviço na Cidade, ou o produto quer NPCs com diálogo? | [ADR 0042](adr/0042-tibia-death-promotion-blessings-and-item-loss.md) | Parcial: promoção EXISTE no Huntera (nomes de vocação promovida na party), mas como é obtida nunca foi observado; bênçãos nunca aparecem. Corrobora a decisão 1 do ADR 0042 sem decidir o mecanismo — questão segue aberta. |

## 6. Capturas pendentes no Huntera

A varredura de evidência de 2026-09-25 fechou o que dava para fechar com o documento existente
([`docs/reference/huntera-observed.md`](reference/huntera-observed.md)) e listou, para cada
questão sem evidência aplicável ou com evidência parcial, exatamente o que uma captura nova
precisaria mostrar. Nada aqui bloqueia trabalho já desbloqueado pelas decisões do §5 — é a lista
do que, se capturado, ainda pode mudar um `[ABERTO]` em decisão.

| Questão | O que observar | Tela / socket |
|---|---|---|
| 1 — corte de versão | Uma quinta opção "Monk" na escolha de vocação na criação de personagem; um painel de Wheel of Destiny, menu de Bosstiary/Hazard ou slot de soul core na ficha de um personagem de level alto. | Tela de criação de personagem; ficha de personagem level alto. |
| 2 — catálogo de hunts | O corpo decodificado COMPLETO da mensagem de catálogo de hunts, para todas as hunts que existirem na captura (73 ou mais). | WebSocket na tela de personagem/seleção de hunt (mesmo método do §12/§23 do documento). |
| 3 — perda de item | Uma morte real de personagem: a tela (mensagem de perda de item? inventário faltando algo logo depois?) e o WebSocket no instante (mensagem S2C perto da vida chegando a zero, se carrega lista de item/equipamento); se havia status "abençoado" ativo. | Tela de morte; WebSocket no instante da morte. |
| 4 — stamina | `staminaMs` de um personagem parado/desconectado na Cidade por uma janela medida (30-60 min), para calcular a razão de recuperação passiva; repetir numa conta Premium; a moeda de `staminaRefillCost`. | `player-stats` via WebSocket, medido contra relógio real. |
| 7 — bestiário | O valor numérico real da linha "Progresso no Bestiary" numa conta com abates suficientes para cruzar pelo menos um marco, e se o total de bônus de XP muda quando o marco fecha; se o bônus é por monstro ou global. | Tela de personagem (bônus de XP) numa conta veterana ou farmada. |
| 8 — aprender magia | Um personagem subindo pelos thresholds clássicos de magia do Tibia (levels 8, 9, 10, 12, 14, 18, 20): `player-stats` ganhando uma magia nova sem débito de gold, OU uma tela de compra "Aprender <magia> (<n> gold)" com débito correspondente. Grep do bundle do cliente por `learn`/`spell shop`/`aprender magia`. | WebSocket ao subir de level; bundle do cliente. |
| 9 — dono do loot em party | Uma party de 3+ membros com dano assimétrico, capturada por várias mortes, correlacionando o dono de cada `loot-drop`/delta de inventário com o `damageTotal` de cada membro no `party-update` concorrente; um toggle de modo de loot na UI/configurações. | WebSocket durante hunt de party; UI de configurações de party. |
| 10 — respawn à vista | Uma janela de baixa população, com o observador parado num tile de spawn identificável por vários minutos, logando `creature-appear`/`creature-disappear` naquele tile, confirmando que nenhum outro jogador real entrou na visão do tile. | WebSocket, sessão isolada de outros jogadores. |
| 11 — bônus de level | `levelBonusPercent` em mais levels — sobretudo por volta de 20 e 50 — e onde ele chega a 0% ou a um piso. | `player-stats` via WebSocket, personagens de level médio/alto. |
| 12 — promoção e bênção | Um personagem de level ≥20: toda tela da Cidade (painel de personagem, lojas, NPCs) por uma oferta de promoção e o custo em gold; uma tela de compra de bênção ou indicador "abençoado" antes de entrar numa hunt, com o socket decodificado no instante. | Telas da Cidade; WebSocket no instante da ação. |

Duas questões (5 e 6) não entram nesta lista: a 5 (comida) foi revertida com confiança alta e não
precisa de captura adicional para a decisão em si — só uma varredura residual de baixa prioridade
do catálogo de itens por um consumível de regen não usado; a 6 (`arcane`/magias genéricas) foi
resolvida com confiança alta, com uma captura residual específica (menu de action-bar do
Sorcerer) já registrada na emenda do [ADR 0040](adr/0040-combat-v3-canary-block-hit-pipeline.md).
