# Plano da matemática do Tibia — itens, uso de itens, runas, magias, skills, dano e monstros

**Status:** proposto em 2026-09-26.
**Pedido do dono:** *"monte um plano completo e especificado para fazer essa matemática toda funcionar
no Draconya"* — itens, uso de itens, runas, magias, skills, balanceamento de dano e monstros.
**Método:** auditoria em quatro frentes (itens, magias/runas/cooldowns, skills/vocações,
dano/monstros) de cada sistema do Canary (`things/sources/canary`, 47dfd51) contra o Draconya na
`main` e na branch `tibia-parity` (onde o combate v3 e as ondas A–C do plano de paridade já
rodam). Cada achado foi conferido no código; os que viraram issue foram reconferidos por quem
escreveu a spec.

## 1. A regra

Este plano **não substitui** o [plano de paridade do catálogo](tibia-parity-plan.md) (M29–M44): ele
já tem a maior parte desta matemática em issues, várias `em andamento` na `tibia-parity`. O que
este plano faz é:

1. dizer, sistema por sistema, **onde cada pedaço da matemática mora** — pronto, em issue existente,
   ou lacuna;
2. abrir **só as lacunas** que nenhuma issue cobre, como issues com spec completa (skill `/spec`),
   nos milestones do plano de paridade, executadas a partir da `tibia-parity`;
3. fixar a **ordem**: o que destrava o quê.

Mecanismo copiado do Canary, números do Canary (ADR 0037); código nunca copiado (ADR 0019); toda
mudança de fórmula que altera número de conteúdo existente fica atrás do perfil de combate (ADR
0031/0040 — v1 e v2 preservados bit a bit).

## 2. Mapa por área

Legenda: ✅ pronto (M = `main`, P = só `tibia-parity`) · 🔷 issue existente · 🆕 lacuna nova (este plano).

### 2.1 Balanceamento de dano

| Sistema | Situação |
|---|---|
| Dano de arma `0.085·fator·atk·skill + level/5`, normal truncada, acerto à distância por baldes | ✅ M (#522) |
| Pipeline `blockHit`: imunidade, blockCount, defesa em faixa, armadura em faixa, mitigação | ✅ P — 🔷 #548 |
| Defesa, armadura e mitigação do jogador | ✅ P — 🔷 #549 |
| Postura (ofensiva/balanceada/defensiva) | 🔷 #550 |
| Crítico e leech (item e monstro) | ✅ P — 🔷 #551 |
| Absorção/aumento por tipo, reflexo de item, cleave | 🔷 #552 |
| Linha de visão, stairhop, tiro errado | 🔷 #553, #554, #555 |
| **Sorteio pela normal truncada em magia, runa, poção e ataque/cura de monstro** (hoje uniforme) | 🆕 #681 |
| **Armadura contra ataque físico à distância de monstro** (hoje tratado como magia) | 🆕 #682 |
| **Cura e reflexo por elemento no monstro; resistência fora de ±100%** | 🆕 #683 |

### 2.2 Magias e runas

| Sistema | Situação |
|---|---|
| Fórmula `level/5 + skill·x + y`, cura pelo magic level, runa pelo ML | ✅ M (#523, #475) |
| Cooldown próprio, de grupo e secundário; runa compartilha o grupo | ✅ M |
| **Magias LEVELMAGIC escalam pela skill da vocação** (Divine Caldera/Missile do Paladin ~5× acima) | 🆕 #677 — **bug** |
| **Ondas e feixes perdem a última fileira; forma SQUAREWAVE5 ausente** | 🆕 #679 |
| **Magic level especializado por elemento** (itens e fórmula) | 🆕 #680 |
| Party, provocação, cura de condição, campos, paralyze/invisibility | 🔷 #588–#592 |
| Soul, conjuração, extrator, magias e runas restantes | 🔷 #593–#597 |
| Invocações, familiares, convince/animate dead | 🔷 #598–#600 |
| Utilitárias, aprender magia com NPC, Roda | 🔷 #623, #624, #610 |

### 2.3 Skills e vocações

| Sistema | Situação |
|---|---|
| Curva de XP, tries por skill, mana para ML, HP/mana/cap por level, velocidade, attack speed | ✅ M |
| Bônus de XP por level | ✅ M (#563) |
| Stamina, promoção, quatro skills corpo a corpo, perda na morte, loyalty, treino | 🔷 #562, #566, #567/#568, #569, #628, #631 |
| **De onde vem cada try** (blood hit, distância 2/1, escudo só com bloqueio real) | 🆕 #686 |
| **Cura cheia no level up e regeneração em rajadas por tick da vocação** | 🆕 #678 |
| **Rates e stages (XP, skill, ML, loot, monstro)** | 🆕 #691 |

### 2.4 Monstros

| Sistema | Situação |
|---|---|
| XP por dano e divisão, runHealth, cura de monstro, resistências/imunidades | ✅ M |
| IA do Canary (alvo, distância, dança, empurrar, campos, invocação, passo aleatório) | ✅ P parcial — 🔷 M29 (#541–#547, #645, #655) |
| Leitor de monstros, mapeamento de ataques, importação, os quatro regenerados | 🔷 #578–#581 |
| Spawns reais e fim da dificuldade | 🔷 M36 (#582–#587) |
| **Melee de monstro por `skill`/`attack`** (223 ataques) | 🆕 #684 |
| **Rolagem de loot do Canary** (fator 95–105%, quantidade, minCount, rate, container) | 🆕 #685 |
| Influenced/Fiendish, facções | 🔷 #616, #619 |

### 2.5 Itens

| Sistema | Situação |
|---|---|
| Peso, capacidade, slots, pilhas de 100, duas mãos × escudo | ✅ M |
| Importador de itens e reconciliação dos dados autorais | 🔷 #572 (P), #573 |
| Munição e aljavas, poções de buff, comida | 🔷 #575, #576, #577 |
| **Dano elemental dividido da arma, defesa de duas mãos, arma já vestida quando o level cai** | 🆕 #687 |
| **Bônus completos: várias skills (54 itens), regeneração própria de item, suppress** | 🆕 #688 |
| Imbuement, tier, elemental bond | 🔷 M40, #617, #627 |

### 2.6 Uso de itens

| Sistema | Situação |
|---|---|
| Runas e poções como suprimento abstrato, cargas de amuleto | ✅ M (ADR 0026/0032) |
| **Duração do anel por instância e forma ativa/inativa** | 🆕 #689 (depende de #604) |
| **Health/Mana Potion nas faixas do Canary, Small Health Potion, exaustão de 1 s compartilhada com runa** | 🆕 #690 |
| Skinning | 🔷 #626 |
| Ferramentas rope/shovel/pick exigidas para trocar de andar | fora (ver §4) |

## 3. Ordem

1. **Bug primeiro:** #677 — muda número de magia em produção, e é pequeno.
2. **O que a `tibia-parity` já destrava:** #682 (resíduo da #548), #686 (usa o tipo de
   bloqueio da #548), #681 (normal truncada, atrás do perfil v3).
3. **Áreas e ML:** #679, #680.
4. **Com os importadores:** #684 (depois da #579), #685 (depois da #578), #687,
   #688, #690 junto da #573.
5. **Estado por instância:** #689 (depois da #604).
6. **Vocação e rates:** #678, #691.

#683 (elemento no monstro) entra quando a #552 (reflexo de item) entrar.

## 4. Fora do escopo

| Item | Motivo |
|---|---|
| Rope/shovel/pick exigidos para usar escada, buraco e corda | O Draconya abstrai ferramenta como abstrai suprimento; o bot não carrega ferramenta. Reavaliar no mundo aberto: desde 2026-09-30 ele é a direção do produto (ADR 0060), e o plano do mundo (`docs/open-world-plan.md`) decide ferramenta em escada, buraco e corda. |
| Vocação Monk e suas magias | Já fora pelo plano de paridade; agora há arte no pacote 15.33 (ADR 0008, emenda de 2026-09-26), então é decisão de produto, não impedimento técnico. |
| Grupos de cooldown `crippling`/`burstsofnature` | Só Monk e Roda os usam (#610). |
| Cooldown próprio da Paralyze Rune (6 s além do grupo) | Vai como comentário na #592, que já é dela. |

## 5. Issues deste plano

Todas com spec completa (skill `/spec`), executadas a partir da `tibia-parity` com PR de base
`tibia-parity`. A coluna "bloqueada por" é relação real no GitHub.

| Issue | Chave | Milestone | O que entrega | Bloqueada por |
|---|---|---|---|---|
| #677 | `M37-G1` | M37 | Magias LEVELMAGIC escalam pelo ML (Divine Caldera/Missile: 420–620 → 100–140 no level 100) | — |
| #679 | `M37-G2` | M37 | Área pelas fileiras da matriz do Canary; ondas, feixes e a onda de fogo do Dragon | — |
| #680 | `M37-G3` | M37 | Magic level especializado por elemento (46 itens) | #677 |
| #681 | `M30-G4` | M30 | Normal truncada em 6 pontos de sorteio (magia, runa, poção, monstro), sob combat-v3 | — |
| #682 | `M30-G5` | M30 | Bloqueio por tipo de ataque de monstro: combat físico bloqueia armadura | #548 |
| #683 | `M30-G6` | M30 | Monstro: cura por elemento (20), reflexo (18), vulnerabilidade até −200% | #552 |
| #684 | `M35-G7` | M35 | Melee de monstro por skill/attack (223 ataques) | #579 |
| #685 | `M35-G8` | M35 | Rolagem de loot do Canary (rollModel) | #578 |
| #686 | `M32-G9` | M32 | Origem dos tries: tipo de bloqueio, contador de sangue, escudo só bloqueando | #548 |
| #678 | `M32-G10` | M32 | Cura cheia no level up; regeneração em pulsos por vocação | — |
| #687 | `M34-G11` | M34 | Arma com dano elemental dividido; defesa de duas mãos; arma com level caído | — |
| #688 | `M34-G12` | M34 | Várias skills por item, regeneração própria (Life Ring), supressão | #678 |
| #689 | `M34-G13` | M34 | Duração de anel por instância e forma ativa/inativa | #604 |
| #690 | `M34-G14` | M34 | Poções nas faixas do Canary e exaustão compartilhada | — |
| #691 | `M44-G15` | M44 | Rates configuráveis (XP, skill, ML, loot, monstro, boss) | — |

Também: a #573 passou a depender de #687, #688 e #680 (criam os campos que ela preenche); #578,
#579 e #592 receberam os achados que são delas, por comentário.

### Premissas corrigidas na verificação

A auditoria inicial errou em alguns pontos, e as specs carregam o número verificado:

- o Canary **também recusa** equipar arma abaixo do level — a lacuna de #687 é só a arma já
  vestida quando o level cai na morte;
- são **54** itens com mais de uma skill, não 236 (os `skillboost` do Crusader e do Royal Helmet
  estão dentro de `imbuementslot`);
- só Health e Mana Potion divergem; as outras nove poções já batem;
- loot aninhado (`child`) não existe no Canary — as ocorrências eram falas;
- são 4 elementos acima de 100 %, não 18; e 46 itens com ML especializado, não 12.

## 6. Execução (2026-09-26)

As 15 issues foram implementadas no mesmo dia, cada uma numa PR com base `tibia-parity` (ou
empilhada sobre a PR de que depende). Os quatro bloqueios que ainda não existiam em código foram
feitos junto: #552 (assumida da outra sessão, com autorização do dono), #578, #579 e #604.

| Issue | PR | Base |
|---|---|---|
| #677 LEVELMAGIC pelo ML | #700 | `tibia-parity` |
| #678 cura no level up e regeneração em pulsos | #707 | `tibia-parity` |
| #679 área pelas fileiras | #701 | `tibia-parity` |
| #680 ML especializado | #709 | #700 |
| #681 normal truncada | #698 | `tibia-parity` |
| #682 bloqueio por tipo de ataque | #695 | `tibia-parity` |
| #683 elemento no monstro | #715 | #710 |
| #684 melee por skill/attack | #716 | #714 |
| #685 rolagem de loot | #711 | #708 |
| #686 origem dos tries | #704 | `tibia-parity` |
| #687 arma elemental | #705 | `tibia-parity` |
| #688 bônus completos | #712 | #707 |
| #689 duração de anel | #713 | #702 |
| #690 poções | #706 | `tibia-parity` |
| #691 rates | #703 | `tibia-parity` |
| bloqueio #552 | #710 | `tibia-parity` |
| bloqueio #578 | #708 | `tibia-parity` |
| bloqueio #579 | #714 | #708 |
| bloqueio #604 | #702 | `tibia-parity` |

**Verificação conjunta:** a PR #717 (rascunho, só para verificação) junta todas sobre a
`tibia-parity`, resolve os conflitos e roda o `pnpm check` completo com banco — **252 arquivos,
4557 testes, verde**. A ordem de merge recomendada e cada conflito resolvido estão no corpo dela.
Três ajustes só existem na junção e foram anotados nas PRs: o cleave da #552 depois da #687, o
rate de loot do modelo `canary` (#685 com #691) e um comentário da #683.

**Ficou para depois:** a #579 chegou a 63,4 % dos monstros de caça importáveis, abaixo da meta de
70 % da própria issue — o que falta são magias de monstro escritas em script Lua e `invisible`
(#559). Dois achados viraram tarefa separada: o teto do manadrain no jogador sob `combat-v3` e a
aproximação do monstro pelo `targetDistance` em vez do maior alcance de ability.
