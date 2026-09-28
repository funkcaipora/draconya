# 0053 — Bestiário: os estágios e os Charms do Canary entram, e a linha de XP do Bestiário fica como exceção de produto

**Status:** proposto — resolve a questão em aberto do [ADR 0045](0045-tibia-bestiary-charms-prey-and-training.md)
(decisão 1 e emenda de 2026-09-25) e a questão 7 de `docs/tibia-parity-plan.md` §5; persiste e
cobra pelo [ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/content` (`bestiary/`, novo `charms/generated/`, monstro:
`bestiary.{firstUnlock,secondUnlock,toKill,charmPoints,class}`), `packages/sim` (`bestiary.ts`,
resolver de combate — perfil `combat-v4`), `packages/server` (registro `charms`), `docs/product/bestiary.md`
**Issues:** M39 — #601, #602, #603; M44-08 (#626, charm Scavenge)

## Contexto

O ADR 0045 decidiu trocar o Bestiário do PRD (cinco marcos globais que valem +1 % de XP cada, FUN-113)
pelo do Canary (estágios por monstro que rendem pontos de Charm) e deixou em aberto "remover o +1 %
sem compensação?". Em 2026-09-25 a diretriz "copie do Huntera" puxou na direção oposta: a tela de
personagem do Huntera lista "Progresso no Bestiary" como uma das cinco fontes do bônus de XP total
— a **forma** do Draconya, corroborada por um jogo do gênero em produção, com o número exato nunca
observado. O conflito bloqueou #601 e, por cascata, #602 e #603.

Há mais uma coisa a decidir que o ADR 0045 não viu: o `bestiary_charms.lua` do Canary `main` é a
**revisão de 2024** dos Charms (major/minor, três tiers com `points {240, 360, 1200}`, echoes),
não a forma de 13.32 (um custo fixo por charm, uma criatura por charm). A regra do corte (ADR
0038 d.5) fala de **sistema** posterior ao 13.32; uma revisão de sistema que o 13.32 já tinha não
é sistema novo, e o Canary é a fonte de precedência (ADR 0037 d.4).

## Decisão

1. **Os estágios por monstro são os do Canary.** Cada monstro importado ganha
   `bestiary.{class, firstUnlock, secondUnlock, toKill, charmPoints}`; o estágio é **derivado**
   do contador de abates que já persiste (`characters.bestiary`), nunca guardado à parte. Completar
   um monstro (`kills ≥ toKill`) soma `charmPoints` ao total **derivado** de pontos; o que se
   persiste é só o gasto (registro `charms.pointsSpent`). Nenhuma migração: o contador é o mesmo.
   O Bestiário conta sempre, mesmo com stamina baixa (ADR 0043 d.1).

2. **A linha "Progresso no Bestiário" de XP fica, como exceção de produto registrada**, na forma
   do Huntera: os cinco marcos do FUN-113 (10 000 / 25 000 / 50 000 / 100 000 / 200 000 abates),
   globais, +1 % de XP PvE cada, somados aos demais bônus (#563). Os limiares são de outra ordem
   que os `toKill` do Canary (o Dragon completa em 1 000), então os dois sistemas **não disparam
   no mesmo gatilho** — a objeção do ADR 0045 (Alternativas) cai. O número `1 %` é
   `[ABERTO — provisório]` até a captura 7 de #643 ler o valor real; a forma não.

3. **Charms seguem o `bestiary_charms.lua` do Canary `main`** (a revisão com tiers), importados
   pelo extrator (ADR 0038) para `content/data/charms/generated/`: nome, `category` (major/minor),
   `type` (offensive/defensive/passive), `damageType`, `percent`, `chance[3]`, `points[3]`. Regra
   de corte registrada: **revisão de sistema existente em 13.32 segue o Canary `main`; sistema
   novo pós-13.32 fica fora** (Monk, Weapon Proficiency, Animus Mastery, Soulpit). Minor charm
   echoes entram como no Canary (`25·t² + 25·t + 50` por desbloqueio de major).

4. **Slots de atribuição: 2 (Free) e 6 (Premium)**, como o Canary. A Charm Expansion (25) é item
   da Loja e entra com o M22, não aqui. Desbloquear custa pontos do tier; atribuir exige o monstro
   completo (`kills ≥ toKill`, só para major); uma criatura por charm e um charm major + um minor
   por criatura; **remover custa `level × 100` gold** pelo ledger (ADR 0052 d.3). Tudo é intenção
   de Cidade (ADR 0052 d.2), também aceita na hunt por não ter rolagem (ADR 0052 d.4) — o Tibia
   deixa gerir Charms de qualquer lugar.

5. **Os Charms em combate entram no `combat-v4` na ordem do Canary**: defensivos rolam no hit
   recebido de monstro, minor antes de major, `chance[tier] ≥ normal_random(1, 10000) / 100`,
   antes do mana shield; Dodge encerra o hit; ofensivos (Wound, Enflame, Poison, Freeze, Zap,
   Curse, Divine Wrath) rolam no hit dado e causam `percent` da vida inicial do monstro; passivos
   (Low Blow, Savage Blow, Vampiric Embrace, Void's Call) somam nos termos que já existem;
   Bless entra no termo de morte (ADR 0042), Gut no loot (ADR 0048), Scavenge na esfola (#626).
   O Dodge do PRD (`combat-v1`) não volta: o único Dodge é o charm.

## Alternativas

- **Remover o +1 % sem compensação** (decisão 1 original do ADR 0045). Descartada: contraria a
  única evidência de produto disponível (Huntera) e é regressão visível para quem já tem marcos.
- **Remover com pontos de Charm retroativos.** Descartada: troca um bônus de XP por outra moeda;
  o jogador que farmou 50 000 ratos comprou XP, não Charms.
- **Manter o +1 % e adiar Charms.** Descartada: Charms são mecanismo do Canary sem contestação do
  Huntera (#602/#603, comentários de 2026-09-25) e mudam XP/loot por hora — o eixo que o ADR 0037
  quer comparável.
- **Reconstruir os Charms de 13.32 (custo fixo, sem tier) a partir da TibiaWiki.** Descartada:
  segunda fonte para um mecanismo que o Canary carrega inteiro; ADR 0037 d.4 dá precedência ao
  Canary, e o pacote 15.33 (ADR 0051) desenha a tela com tiers.

## Consequências

- #601 destrava com critério de aceite **mudado**: "+1 % removido" vira "linha de XP preservada
  como exceção registrada; estágios e pontos derivados visíveis". #602 e #603 destravam sem
  mudança de mecanismo.
- `docs/product/bestiary.md` é reescrito: comportamento do Canary + a seção "Divergências" com a
  linha de XP e o motivo (Huntera, ADR 0053).
- `docs/tibia-parity-plan.md` §5 questão 7 passa a "decidida (ADR 0053)"; a captura continua em
  #643 só para fixar o número.
- O que piora: o Bestiário passa a ter dois vocabulários de progresso na mesma tela (estrelas do
  Canary e marcos de XP). A tela mostra os dois com rótulos distintos; é o preço de honrar as
  duas fontes.

## Invariantes afetados

Nenhum. Estado quente (contador, pontos derivados) continua no `CharacterRuntime` da sessão dona
(invariante 9); gold da remoção pelo ledger (invariante 10); o cliente só manda intenção
(invariante 4).
