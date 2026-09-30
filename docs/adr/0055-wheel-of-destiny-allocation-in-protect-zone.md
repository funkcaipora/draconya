# 0055 — Wheel of Destiny: estrutura transcrita como conteúdo, alocação só em zona de proteção, bônus pelo perfil de combate

**Status:** proposto — substitui a "árvore de passivas por vocação" do PRD §9.5
**Emendado pelo [ADR 0060](0060-tibia-open-world-without-pvp.md) (2026-09-30) — d.4:** a Roda aloca em tile PZ do mundo.
(`docs/product/progression.md`) pela Roda do Tibia 13.x, sob o [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
decisão 1; persiste pelo [ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/content` (`wheel/` — slots, custos, adjacência, dedicação,
convicção, revelações, gemas; magias da Roda no extrator), `packages/sim` (stats derivados,
`combat-v4`, condições do M31), `packages/server` (registro `wheel`), `packages/protocol`
(`wheel-allocate`, `wheel-gem-*`)
**Issues:** M41 — #608, #609, #610, #611

## Contexto

O PRD previa uma árvore de passivas própria, com respec livre em PZ. O Tibia tem a Wheel of
Destiny (13.20): pontos por level a partir do 51, alocados em slots de quatro cores com
adjacência a partir do centro, que rendem **dedicação** (vida, mana, capacidade, mitigação),
**convicção** (perks por vocação), **revelações** (magias e melhorias por estágio) e, desde o
13.20, **gemas** com modificadores. O ADR 0040 deixou o multiplicador de mitigação da Roda em 0
esperando este milestone.

A estrutura da Roda (quais slots, quantos pontos cada um custa, o que cada um dá) vive no cliente
do Tibia; o Canary a espelha em `wheel_definitions.hpp` e observa em `config.lua.dist`: "only the
wheel points are modified, all other data is on the client executable". São **números**, não
código — entram como conteúdo (ADR 0019 limite 1, ADR 0038 d.7). O Canary `main` também carrega a
Roda do Monk; o Monk está fora do corte (ADR 0038 d.5) e a Roda dele fica no relatório.

## Decisão

1. **Portão do Canary:** `level > 50`, promovido (ADR 0042) e Premium (`canOpenWheel`). Os três
   são dado de conteúdo (`wheel.requires`), e `requiresPremium` é o único que o produto pode
   virar sem ADR — a monetização (`docs/product/monetization.md`) é decisão de produto, não
   mecânica de caça. Default: como o Tibia.

2. **Pontos = `(level − 50) × 1`** (`wheelPointsPerLevel`, `m_minLevelToStartCountPoints`). Sem
   pontos extras: o bônus da quest do Monk está fora do corte.

3. **A estrutura é transcrita para `content/data/wheel/`**: slots por cor e anel com custo,
   grafo de adjacência, tabela de dedicação por vocação e por ponto, perks de convicção com
   limiares, estágios de revelação (`getRevelationStage`) e o que cada um libera. Transcrição de
   número por ferramenta quando houver fonte estruturada, à mão com citação quando não (ADR 0038
   d.3). Nenhuma linha de C++ é traduzida.

4. **Alocação é intenção de Cidade, atômica e inteira.** `wheel-allocate { slots: {id → points} }`
   substitui a alocação toda; o servidor valida total ≤ pontos, custo por slot, adjacência a partir
   dos quatro slots centrais e vocação. Só na Cidade (PZ), como o Tibia; grátis e sem limite de
   troca — o "respec livre em PZ" do PRD sobrevive por coincidir. A alocação viaja no ticket e
   fica **fixa durante a hunt**; o extrato a devolve inteira (ADR 0052 d.1).

5. **Dedicação entra nos stats derivados** (vida, mana, capacidade máximas; mitigação como
   multiplicador do `calculateMitigation` que o ADR 0040 zerou) na entrada da sessão; **convicção e
   os bônus de combate** (leech, crítico, skill, dano/cura por perk) entram como estágios declarados
   do `combat-v4` (ADR 0052 d.7), no lugar exato em que `player.cpp` os soma.

6. **Revelações e as magias da Roda** (Avatars, Divine Empowerment, Divine Dazzle, Expose Weakness,
   Sap Strength) vêm pelo extrator de magias (M37-08) com `requires.wheelStage`; graus de melhoria
   (`upgradeSpellsWOD`) alteram números da magia por estágio, lidos do conteúdo. Efeitos sobre
   condições do M31 (ADR 0041) — Avatar é condição de outfit + modificadores (#621, #622).

7. **Gemas seguem o `wheel_gems.cpp`**: Lesser/Regular/Greater, afinidade por cor, um a dois
   modificadores básicos e um supremo; **não são item** — são entradas do registro `wheel.gems`,
   como o KV do Canary, sem valor no ledger e sem troca. Drop pelo `ondroploot_gem_atelier.lua`
   (roll extra ligado à classe do bestiário do monstro), cai no cadáver como "gema revelável" que
   vira entrada do registro ao ser coletada. Vessels (encaixe por cor), revelar e girar custam
   gold pela tabela da config (125k/250k/500k girar; 125k/1M/6M revelar) pelo ledger, como
   intenções de Cidade com `session.rng` da Cidade (ADR 0052 d.4).

## Alternativas

- **Árvore de passivas própria (PRD §9.5).** Descartada pelo ADR 0037 d.1; não há fonte de
  números para ela e o teste da party level 200 ficaria incomparável.
- **Roda sem portão Premium.** Não decidida aqui: a decisão 1 deixa o portão como dado de
  conteúdo para o produto virar; o default é a fidelidade.
- **Permitir realocar na hunt.** Descartada: o Tibia exige PZ, e realocar no meio da hunt mudaria
  stats derivados dentro de uma sessão com perfil fixado — o mesmo problema que o invariante 7
  evita para conteúdo.
- **Gemas como item de inventário.** Descartada: no Canary são KV do jogador, não item; como item
  entrariam no ledger, no peso e na venda sem que o Tibia faça nada disso.
- **Adiar gemas para fora do M41.** Descartada: sem gemas a Roda de nível alto fica incompleta
  contra o Canary; entram por último no milestone (#611), depois de #608–#610.

## Consequências

- #608–#611 destravam. `docs/product/progression.md` perde a árvore de passivas e ganha a Roda,
  com a divergência do portão Premium marcada como decisão de produto.
- Registro `wheel { allocation, gems, vessels, version }`; opcodes `wheel-allocate`,
  `wheel-gem-reveal`, `wheel-gem-rotate`, `wheel-gem-equip`; `player-stats` passa a levar os
  máximos derivados com a Roda.
- `combat-v4` ganha os estágios de convicção e o multiplicador de mitigação; o teste de
  conformance do Knight 200 com alocação de referência (#609) prende os números à mão.
- O que piora: a transcrição da estrutura é um dado grande e sem importador estruturado no
  Canary para tudo; o `[ABERTO]` de cada tabela sem fonte automática fica marcado no conteúdo.

## Invariantes afetados

Nenhum. O **4** (cliente só manda intenção) é a decisão 4; o **7** é estendido em espírito pela
alocação fixa durante a hunt; **9** e **10** vêm do ADR 0052.
