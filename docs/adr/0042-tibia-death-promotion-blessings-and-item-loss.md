# 0042 — Morte do Tibia: promoção, bênçãos e perda de item sem item no chão

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1 (mecânica de jogo segue o Tibia); bloqueada por duas questões em aberto (ver seção
própria); avaliadas contra o Huntera em 2026-09-25 sem evidência aplicável — as duas seguem
abertas, capturas pendentes registradas (ver emenda)
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`vocations/`, novo bloco `promotion`, bênçãos, morte),
`packages/sim` (pipeline de morte, ledger de item destruído), `packages/server` (débito de gold
por ledger, NPC ou tela de serviço da Cidade)
**Issues:** M32-05 (#566); M33 — #569 a #571

## Contexto

`docs/product/death.md` §3.8 hoje diz que a morte no Draconya **nunca** é perda material: XP e
level mudam, mas item e equipamento seguem intactos, e o piso é `levelFloor: 8` — um valor que
não existe no Tibia. O `Player::death` do Canary aplica o **mesmo** percentual de perda a XP,
mana gasta e skill tries — sem piso —, com o percentual reduzido por bênçãos compradas
(`data/libs/systems/blessing.lua`: 8 bênçãos cadastradas, `Blessings.All[1]` é Twist of Fate
(PvP, fora de escopo) e as outras sete são PvE, com preço por level via `Blessings.getBlessingCost`),
e um percentual de perda de **item** por `Blessings.LossPercent`, reduzido a zero por completo com
o Amulet of Loss (item id 3057, confirmado em `data/items/items.xml:6977`).

A promoção também é dado ausente: o Canary marca `player:kv():get("promoted")` (verificado em
`StdModule.promotePlayer`, `data/npclib/npc_system/modules.lua:92-120` — condiciona por level e
debita gold via `removeMoneyBank`) e troca de vocação para a promovida
(`player:getVocation():getPromotion()`), cujas quatro entradas (`vocation id="5"` a `"8"` em
`data/XML/vocations.xml`) têm `soulmax="200"` e cadência de regeneração próprias.

O problema de arquitetura é que "perder item na morte" pressupõe, no Tibia, que o item cai no
chão — e o ADR 0037 (Alternativas) já rejeitou o cadáver-container que isso exigiria: o Draconya
não tem item largado no mundo (invariante do design da economia de sessão, ADR 0026). A pergunta
que este ADR precisa responder não é só "que percentual", é **o que "perder" significa quando não
existe chão para o item cair**.

## Decisão

1. **Promoção é estado do personagem** (`promoted: boolean`), não uma vocação nova no catálogo:
   as regras que hoje checam `vocationId` continuam checando a base, e a vocação ganha um bloco
   `promotion` opcional com `regen`, `soulMax` e `soulGainTicks` das vocações 5–8 do
   `vocations.xml`. Obtida na Cidade — level 20 e 20.000 gold debitados pelo ledger (invariante
   10), no mesmo mecanismo que `StdModule.promotePlayer` usa (checagem de level, remoção de
   dinheiro, marca de estado).
2. **As bênçãos são as sete PvE** do `blessing.lua` (excluindo Twist of Fate, que é PvP e fica
   fora do escopo de hunt PvE deste ADR), compradas na Cidade pelo preço por level do
   `getBlessingCost`, consumidas na morte — deixando de ser inferidas do status de Premium, que é
   o comportamento atual não documentado em lugar nenhum como intencional.
3. **A morte aplica o mesmo percentual a XP, mana gasta e skill tries**, sem `levelFloor`: o piso
   de level 8 do Draconya sai, porque o Tibia não tem piso de level para a penalidade de morte
   (confirmado contra `Player::getLostPercent`/`Player::death`).
4. **A perda de item segue `Blessings.LossPercent` e o Amulet of Loss.** Como não existe item no
   chão (o ADR 0037 rejeitou o cadáver-container), o item perdido é **destruído** e registrado no
   extrato da sessão (invariante 10) — não transferido para lugar nenhum. Se o personagem perder a
   mochila, ele recebe uma nova, para nunca ficar sem container de inventário.

## Questões em aberto (decisão do dono)

- **Destruir o item ou manter "nunca perde item" como exceção de produto registrada?** As duas
  opções são compatíveis com a arquitetura — a primeira é a fidelidade ao Tibia que o ADR 0037
  pede por padrão; a segunda seria uma exceção de produto explícita, do mesmo tipo que
  "always-hit" e Dodge já são no `combat-v1` (ADR 0031). O plano **recomenda destruir e
  registrar no extrato** (decisão 4 acima), porque é a leitura mais direta do ADR 0037 decisão 1
  ("a divergência é defeito, a menos que caia numa exceção") — mas a decisão final, por afetar
  diretamente a percepção de risco do jogador, é do dono do produto.
- **Promoção e bênçãos como ações de Cidade sem NPC dialogável: basta uma tela de serviço, ou o
  produto quer NPCs com diálogo?** O Canary resolve as duas por diálogo de NPC
  (`npc_system/modules.lua`); o Draconya não tem motor de diálogo de NPC (invariante 8: a Cidade
  não simula nada além de navegação). O plano **recomenda uma tela de serviço** — o mesmo padrão
  que o Santuário de Imbuement do M40-04 já vai usar —, por não exigir um motor de diálogo novo
  só para duas transações. A decisão final é do dono, porque muda a superfície do cliente que o
  M32/M33 entrega.

Enquanto essas duas questões não forem respondidas, a implementação trata a decisão 4 (destruir e
registrar) e a tela de serviço como os valores **provisórios** do perfil — a mesma disciplina que
o ADR 0031 já usa para `armorEffectiveness` e `minimumDamageFraction`: o contrato de dado
(campo `promoted`, bloco `promotion`, ledger de item destruído) é fixado por este ADR; o
comportamento de produto fica marcado `[ABERTO]` em `docs/product/death.md` até o dono decidir.

## Alternativas

- **Mover o item perdido para o chão, como o Tibia faz de verdade.** Descartada: exigiria o
  cadáver-container que o ADR 0037 (Alternativas) já rejeitou — mundo persistente com item
  largado é o tipo de mecanismo que o Draconya deliberadamente não tem (Cidade inerte, ADR 0004;
  sem loot no chão, ADR 0025).
- **Vocação promovida como entrada própria do catálogo** (`vocationId` novo por promoção).
  Descartada: duplicaria todo filtro de vocação existente (kit inicial, magia por vocação,
  requisito de equipamento) para as quatro promovidas, quando o único dado que de fato muda é
  regen/soul/velocidade.
- **Inferir bênção do status de Premium**, como hoje. Descartada: o Tibia vende bênção por gold
  a qualquer jogador, Premium ou não; a inferência atual é uma regra do Draconya sem fonte no
  jogo real, e o ADR 0037 pede que ela vire compra explícita.

## Consequências

- M32-05 (#566, promoção) e M33 (#569–#571: perda de skill/ML, bênçãos, perda de item) ficam
  desbloqueados quanto ao **contrato de dado**; o comportamento de produto (destruir vs. manter
  intacto; tela vs. NPC) espera a decisão do dono antes de fechar a issue.
- `docs/product/death.md` §3.8 muda de "nunca perde item" para a regra nova, com o `[ABERTO]`
  registrado até a decisão.
- O ledger (invariante 10) ganha um tipo de linha novo — item destruído por morte —, que precisa
  do mesmo `(session_id, seq)` único que já protege gold.

## Invariantes afetados

Nenhum muda de texto. O invariante 10 é quem exige que a destruição de item passe pelo ledger,
não por uma escrita direta em inventário. O invariante 8 é o motivo de promoção e bênção serem
ações de Cidade (estado ATIVO sem sessão de hunt) em vez de um mecanismo simulado.

## Emenda — 2026-09-25: decisões do dono ("copie do Huntera") — sem captura para responder, captura registrada

Em 2026-09-25 o dono respondeu as doze questões abertas do `docs/tibia-parity-plan.md` §5 com
"copie do Huntera": onde o Huntera (o Tibia-idle observado em `docs/reference/huntera-observed.md`)
foi observado fazendo algo, a decisão segue o Huntera; onde não foi observado, a regra provisória
atual permanece e a captura que falta fica registrada. As duas questões em aberto deste ADR foram
avaliadas contra o documento inteiro, e nenhuma tem evidência aplicável.

- **Perda de item na morte.** Nenhuma morte de personagem, tela ou payload de opcode aparece em
  nenhuma das 828 linhas do documento — grep completo por
  `morte|death|skull|item loss|perda de item|morr` bate só na runa Sudden Death, no tipo de dano
  `death`, e em "até morrer" descrevendo HP de MONSTRO (não de jogador) na Parte VI. **Sem
  captura, não há o que copiar.** A implementação mantém a regra provisória atual, "nunca perde
  item" (`docs/product/death.md` §3.8), e a questão acima segue exatamente tão aberta quanto
  estava — aguardando decisão do dono sobre destruir-e-registrar vs. manter, não uma resposta do
  Huntera.
- **Promoção e bênçãos.** Promoção EXISTE no Huntera — a party da Parte IV mostra nomes de
  vocação promovida (Elite Knight, Elder Druid, Master Sorcerer, Royal Paladin) —, mas COMO ela é
  obtida nunca foi observado: nenhuma tela de serviço, diálogo de NPC ou custo em gold aparece em
  nenhuma das seis partes, incluindo as que decodificam tráfego da Cidade em detalhe (Parte II) e
  as que têm personagem de level alto onde a tela plausivelmente apareceria (Partes IV/VI, e um
  personagem level 328 visto de relance na Cidade na Parte II). Bênçãos: zero ocorrências de
  `blessing|bênção|promotion|promoção` no documento inteiro — inclusive nas seções "o que NÃO dá
  para concluir daqui" (§10, §16, §30, §35, §39), o que confirma que o assunto nunca foi sequer
  olhado, não que ele não exista. A existência de promoção corrobora, sem decidir o mecanismo, a
  decisão 1 acima (promoção como estado do personagem); o mecanismo de obtenção continua o da
  decisão 1 (tela de serviço, level 20, 20.000 gold — fonte Canary) como valor provisório, até a
  questão em aberto ser respondida pelo dono.

Nenhuma das decisões 1-4 acima muda. As duas questões em aberto seguem exatamente onde estavam.

Confiança: baixa nas duas — a ausência é ausência de captura, não confirmação negativa.

**Captura pendente:**
- Morte: uma morte real de personagem do Huntera — a tela (mensagem de perda de item? inventário
  faltando itens logo depois?) e o WebSocket no instante (uma mensagem S2C perto da vida do
  personagem chegando a zero, e se ela carrega uma lista de item/equipamento); e se algum status
  "abençoado" estava ativo no momento.
- Promoção/bênção: um personagem de level ≥20 do Huntera, checando toda tela da Cidade (painel de
  personagem, qualquer loja, qualquer NPC) por uma oferta de promoção e o custo em gold;
  separadamente, uma tela de compra de bênção ou um indicador "abençoado" antes de entrar numa
  hunt, com o socket decodificado no instante da ação que dispara qualquer um dos dois.

(Evidência: grep completo de `docs/reference/huntera-observed.md` para
`morte|death|skull|item loss|perda de item|morr` e para `blessing|bênção|promotion|promoção`,
zero ocorrências relevantes; Parte IV linhas 474-475; Parte II, personagem level 328.)

## Emenda — 2026-09-28: bênçãos implementadas (#570), tela de serviço resolvida por decisão direta

A questão "tela de serviço vs. NPC dialogável" (acima) foi resolvida por decisão direta do dono,
sem depender de captura do Huntera: **tela de serviço**, como o plano já recomendava. A #570
implementa a decisão 2 inteira (as sete bênçãos PvE, preço por level do `getBlessingCost`,
consumo na morte) e a metade "serviço de Cidade" da decisão 2/questão acima — ver
[ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md) para
o mecanismo genérico (intenção C2S tratada pela sessão de Cidade, gold pelo ledger) e
`docs/product/blessings.md` para o comportamento. A promoção (a outra metade da decisão 1/2)
continua em aberto — `options.promoted` em `applyDeathPenalty` segue como ponto de extensão sem
estado por trás.

A questão de perda de item (decisão 4) não muda: segue aberta, sem captura aplicável.

## Emenda — 2026-09-29: perda de item implementada (#571), DESLIGADA até a decisão do dono

A #571 implementa a decisão 4 inteira — o mecanismo de `Blessings.PlayerDeath`/`DropLoot`, o
consumo do Amulet of Loss, a bag de reposição e o registro no extrato — em
`packages/sim/src/item-loss.ts`, mas o conteúdo real a entrega **desligada**:
`deathPenalty.itemLoss.enabled: false` em `packages/content/data/progression/baseline.json`.

**Por que desligada, e não com o valor "provisório" da decisão 4.** O texto original deste ADR
tratava "destruir e registrar" como o valor provisório do perfil até o dono responder; a emenda de
2026-09-25 (e o comentário "Atualização de decisão" da própria #571) revogou isso: sem captura
do Huntera não há o que copiar, a issue fica BLOQUEADA aguardando a decisão DIRETA do dono, e a
implementação mantém "nunca perde item" (`docs/product/death.md` §3.8) até ela chegar. Destruir é
irreversível para o jogador — não há cadáver para recuperar o item —, então entregar o mecanismo
LIGADO por padrão seria decidir pelo dono na direção que não tem volta; entregá-lo desligado
deixa a decisão como ela estava e a reduz a um booleano. É a mesma disciplina do `combat-v1`
(ADR 0031): o comportamento de produto fica marcado até o dono decidir, e o contrato de dado
(`itemLoss`, `protectsOnDeath`, o evento `item-lost-on-death`) é fixado por este ADR.

**O que ligar significa.** Trocar `enabled` para `true`: a morte passa a sortear cada item vestido
(100/70/45/25/10/0 % por contagem de bênçãos, um décimo disso para quem não é container), destruir
o que cair — com o conteúdo da mochila —, entregar uma bag a quem ficou sem mochila e gastar o
Amulet of Loss vestido. Nada mais muda: sem migração (o conteúdo é fixado por sessão, invariante
7) e sem estado novo no snapshot. **Decidir por "nunca perde item"** é apagar o bloco `itemLoss` do
conteúdo e fechar a #571 como divergência de produto registrada.

**Fidelidade verificada contra o Canary (`47dfd51`)**, incluindo o que o texto do ADR não dizia:
a perda roda ANTES da penalidade de XP e do consumo das bênçãos (`Creature::onDeath` chama
`dropCorpse` antes de `death()`); o Amulet of Loss só protege no slot do pescoço e é consumido
DEPOIS da penalidade — mesmo com cinco bênçãos, e não quando o personagem tem vocação e o level
rebaixado ficou abaixo do Adventurer's Blessing (`Player::death`, `willNotLoseBless`); a aljava é
container para a regra (a flag `container` do cliente, não o `items.xml`) e perde com a chance
cheia; a bag de reposição vem mesmo com o personagem protegido.

**Adventurer's Blessing.** O Canary concede as cinco bênçãos regulares AUTOMATICAMENTE abaixo do
level 21 com vocação; a #570 modelou isso como preço zero (`blessingPricing.freeBelowLevel`) — a
bênção é comprada de graça, não concedida. A perda de item lê o mesmo bitmask que a penalidade de
XP, então enquanto aquele desenho valer um personagem de level < 21 que não comprou as bênçãos
grátis teria 100% de chance na mochila, com a chave ligada. Não é decisão desta issue, e fica
registrado aqui para quem ligar a chave.
