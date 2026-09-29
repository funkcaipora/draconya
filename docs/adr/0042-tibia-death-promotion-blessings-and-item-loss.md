# 0042 — Morte do Tibia: promoção, bênçãos e perda de item sem item no chão

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1 (mecânica de jogo segue o Tibia); bloqueada por duas questões em aberto (ver seção
própria)
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
