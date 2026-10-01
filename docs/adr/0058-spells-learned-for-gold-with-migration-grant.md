# 0058 — Magia é aprendida por gold numa tela de serviço da Cidade; quem já existe recebe o que já podia lançar

**Status:** proposto — resolve a questão 8 de `docs/tibia-parity-plan.md` §5 (bloqueio de #624
**Emendado pelo [ADR 0060](0060-tibia-open-world-without-pvp.md) (2026-09-30) — d.2:** a tela de aprender magia fica em tile PZ do mundo.
desde 2026-09-25); persiste e cobra pelo [ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md);
tela de serviço no padrão do [ADR 0042](0042-tibia-death-promotion-blessings-and-item-loss.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/content` (magia: `learnPrice`, importado dos NPCs do Canary com
TibiaWiki como fallback — ADR 0037 d.4), `packages/sim` (`casting.ts`: cast exige aprendida; bot
pula slot com magia não aprendida), `packages/server` (registro `learnedSpells`; migração de
concessão), `packages/protocol` (`learn-spell`), `docs/product/progression.md`, `onboarding.md`
**Issues:** M44-06 (#624)

## Contexto

No Tibia toda magia instantânea e toda conjuração é **comprada** de um NPC por gold, com level
mínimo; `Player::learnSpell`/`hasLearnedSpell` são checados antes do cast. No Draconya a magia é
liberada por level (`docs/product/progression.md`), sem compra. O plano de paridade deixou uma
pergunta para o dono: personagens existentes ganham de graça o que já usam, ou todos pagam? A
varredura do Huntera (2026-09-25) não achou evidência em nenhuma direção — o termo "NPC" não
aparece — e a issue ficou bloqueada.

A decisão tem duas metades: o mecanismo (Canary, sem dúvida sob o ADR 0037) e a migração (ADR
0014: dado persistido migra, nunca é descartado — e "poder lançar" é capacidade persistida por
level).

## Decisão

1. **Cast exige magia aprendida.** `learnedSpells` é registro do personagem (ADR 0052 d.1);
   `casting.ts` recusa magia ausente com motivo (`spell-not-learned`), e o bot **pula** o slot
   como já pula magia sem mana — nunca encerra a hunt por isso. Runa (o item/suprimento) continua
   exigindo só level e magic level, como no Tibia; a **conjuração** da runa é magia e exige
   aprendizado.

2. **Aprender é intenção de Cidade sem rolagem** (`learn-spell { spellId }`), aceita também na
   hunt por não tocar RNG (ADR 0052 d.4) — mas a tela vive na Cidade, como tela de serviço (ADR
   0042), sem diálogo de NPC. Requisitos: vocação e `requires.level`; preço `learnPrice` pelo
   ledger (ADR 0052 d.3); idempotente (aprender duas vezes é recusado sem cobrar).

3. **`learnPrice` vem dos NPCs do Canary** (`StdModule.learnSpell` em 51 NPCs — o menor preço
   entre os que ensinam, na regra do ADR 0038 d.6 para preço), com TibiaWiki para magia que nenhum
   NPC importado ensina. Nenhuma magia é grátis por padrão; conteúdo pode declarar `learnPrice: 0`
   como override com citação.

4. **Migração: quem já existe recebe todas as magias da sua vocação com `requires.level ≤ level`
   no momento da migração**, gravadas em `learnedSpells` por uma migração de dados única (ADR
   0014). Ninguém perde um slot da barra que funcionava ontem. Personagem novo começa sem
   nenhuma, como no Tibia; o kit de nascimento (ADR 0026) não muda.

5. **O preset do bot por vocação continua igual**: slots com magia não aprendida ficam na barra,
   marcados na tela como "não aprendida", e a tela de serviço oferece comprar dali. Nada é
   escondido (ADR 0032 d.5).

## Alternativas

- **Todos pagam, inclusive quem já existe.** Descartada pelo ADR 0014: regressão de capacidade
  persistida sem fonte que a justifique.
- **Manter liberação por level (regra atual).** Descartada pelo ADR 0037 d.1: divergência sem
  exceção que a cubra.
- **Esperar a captura do Huntera.** Descartada: a captura decide só a migração, e o ADR 0014 já
  decide a migração; a captura vira corroboração quando existir (#643).
- **Motor de diálogo de NPC.** Descartada (ADR 0042).

## Consequências

- #624 destrava. `docs/product/progression.md` e `onboarding.md` ganham a regra e a divergência
  registrada do kit (sem magia grátis).
- Registro `learnedSpells: string[]` (+ `version`); opcode `learn-spell`; `spellSchema.learnPrice`;
  extrator de magias lê preços dos NPCs.
- O que piora: um personagem de level 8 novo tem gold de kit e nenhuma magia; o onboarding precisa
  mostrar a tela de serviço cedo — é o mesmo atrito do Tibia, registrado como tal.

## Invariantes afetados

Nenhum. **4** (só intenção), **9** e **10** (ADR 0052).
