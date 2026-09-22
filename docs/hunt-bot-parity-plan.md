# Paridade do bot de hunt com o Huntera — plano

**Data:** 2026-09-22
**Fonte da especificação:** `docs/reference/huntera-observed.md`, Parte IV (§23–§30) — onze
minutos de socket e a barra de ações do `Funkcaipora` (RP 360) numa party de quatro na Issavi
Steppe, mais duas notas do dono do projeto no mesmo dia (referência de distância e prioridade
da referência).
**Objetivo:** o bot do Draconya se comportar **exatamente** como o observado — alvo, follow,
distância, regras de magia/runa/poção e cadência — dentro dos onze invariantes e do ADR 0019
(seguir o design, nunca copiar código).

Este documento é o plano; cada fase vira uma issue pelo `/spec`, com o texto daqui como
premissa auditada. O inventário do que já existe foi feito sobre o código desta data e está
resumido na §1 com arquivo e linha, para o `/spec` não repetir a auditoria.

---

## 1. Onde o Draconya está hoje (auditado em 2026-09-22)

O motor já tem a espinha certa. O que existe, e serve:

| Capacidade | Onde | Estado |
|------------|------|--------|
| Barra de ações server-side, ordem do slot = prioridade, condições em AND, "sem condição dispara sempre" | `packages/sim/src/bot.ts:141-280`, `packages/content/src/schemas.ts:1949-2051` | ✔ igual ao Huntera |
| Um evento de fila por grupo de cooldown (`attack`/`healing`/`support`/`potion`), grupo + magia + secundário | `packages/sim/src/rulesets/hunt.ts:2661-2748`, `packages/sim/src/casting.ts:250-321` | ✔ |
| Relógio da arma independente do grupo `attack` (2.000 ms) | `hunt.ts:2594-2629`, `content/data/combat/baseline.json:18` | ✔ igual (§27) |
| Alvo pegajoso: `botCandidate` só muda quando morre ou sai da tela | `hunt.ts:5236-5260` | ✔ igual (§25) |
| Políticas `nearest`, `lowest-hp`, `highest-hp` (absolutas), `follow` (clique) + priorizar/ignorar por monstro | `packages/sim/src/targeting.ts:71-118`, `schemas.ts:1752` | parcial |
| Follow de membro/líder, passo guloso até ficar adjacente | `hunt.ts:2409-2450` | parcial (§26) |
| Postura `stand`/`follow`/`keep-distance{tiles}` medida **do monstro** | `hunt.ts:2369-2395`, `schemas.ts:1765` | parcial (§26) |
| Cura dirigida: `self` / `lowest-hp-member` / `member` | `hunt.ts:2787-2805`, `schemas.ts:1889` | ✔ igual ("Alvo da cura", §24) |
| Condições `hp`, `mana`, `targets`, `target-hp`, `condition` (efeito próprio); comparadores `< <= > >=` | `bot.ts:141-230`, `schemas.ts:1689-1710` | parcial (§24) |
| Catálogo do paladin: Divine Healing, Salvation, Divine Caldera, (Strong) Ethereal Spear, Divine Missile, Swift Foot, Sharpshooter; runas UH/Avalanche/SD/…; poções | `packages/content/data/spells/`, `supplies/` | ✔ (números no §4) |
| `stance: offensive | balanced | defensive` guardado e **inerte** | `schemas.ts:2031`, `docs/product/bot.md:223` | ✘ (ADR 0032 d.10 decidido, não implementado) |
| Lure com histerese `{min,max}` | `hunt.ts:3685-3700` | ✔ (o Huntera não tem; fica) |
| Rateio de gasto por membro, `party-spending` | `packages/protocol/src/types.ts` | ✔ igual (`sharedCosts`, §29) |

O que **não existe** e o Huntera tem:

1. Distância de referência **ao knight da party** e a prioridade **boss > monstro > knight**
   (nota do dono, §26). Hoje a distância é só do monstro e o follow só sabe "adjacente".
2. `follow-member` como **estratégia de alvo**: no Huntera, seguir alguém muda o alvo para o
   monstro que ele segura (§25). Aqui follow e alvo são ortogonais.
3. Políticas `lowest-health-percent`, `highest-health-percent` e `boss` (§25).
4. Fight mode com efeito (ADR 0032 d.10).
5. Sujeitos de condição `Alvo`, `Área`, `Aliado ×N`, `No alcance`; atributos `Preso`,
   `Paralisado`, `Magic shield`; comparador `==`; valor absoluto **ou** percentual (§24).
6. Lista de monstros ignorados **por ação** (hoje é global).
7. Munição em área (diamond arrow acerta 1–14 no mesmo disparo, §27) e regra de reserva de
   munição (crystalline arrow quando a principal acaba).
8. Regras de catálogo: Swift Foot "só sem nada no alcance, acaba ao atacar"; Sharpshooter
   "sem defesa, 30 % mais lento, sem cura/suporte enquanto durar" (§24).
9. Magias do knight que o líder usa o tempo todo: `exeta res` / `exeta amp res` (§28) — não
   há challenge no catálogo.
10. Preset exportável como código (copiar/importar) (§24).

---

## 2. O que "exatamente igual" significa aqui — os oráculos

Os números da Parte IV viram **critérios de aceite mensuráveis** num teste de paridade em
`packages/sim` (cenário sintético: knight + RP a distância 3 + 24 monstros num campo aberto,
igual ao pull observado):

| Oráculo | Valor observado | Como medir no teste |
|---------|-----------------|---------------------|
| Retarget depois da morte do alvo | 0–100 ms (mesmo tick ou seguinte) | `player-target` novo no mesmo `advanceBy` do `creature-disappear` |
| Alvo com `follow-member` | sempre a 1 tile do membro seguido quando existe um | 100 % das trocas |
| Troca com o alvo vivo | 0 | contador |
| Distância RP→knight (distância 3) | moda 3, 90 % em 2–5, mesmo tile ≈ 0 | histograma por passo |
| Reação ao passo do knight | 0–200 ms | `t(passo seguidor) − t(passo knight)` |
| Flecha | a cada 2.000 ms | intervalos de `shot` |
| Runa de ataque | a cada 2.000 ms, **defasada** da flecha, nunca esperando por ela | intervalos e fase |
| Cura (grupo `heal`) | 1.000 ms; `exura san` na janela 75–85 %, `exura gran san` ≤ 75 % | sequência de casts contra HP% |
| Swift Foot | só com 0 monstros no alcance; termina ao atacar | nunca em pull |
| Passo do jogador | `ceil50(1000 × chão / speed)`, diagonal `ceil50(3×)` | já coberto por `docs/product/hunt.md`; reconferir com chão 130/150 |

---

## 3. Fases (cada uma é uma issue; ordem = dependência)

### F1 · Alvo — políticas que faltam e `follow-member` como estratégia (`sim`, `content`, `protocol`, `client`)

- **Políticas:** acrescentar `lowest-hp-percent`, `highest-hp-percent` e `boss` em
  `targeting.ts` e no schema (`schemas.ts:1752`). `boss` = monstro com flag `boss` no
  conteúdo, senão cai em `nearest` (o Huntera não mostra o fallback; assumir nearest e marcar
  `[ABERTO]` em `docs/product/bot.md`).
- **`follow-member-<id>` como política de alvo:** o alvo passa a ser **o monstro adjacente ao
  membro seguido** (desempate: o que o próprio membro está atacando, se o runner dele expõe o
  alvo; senão o de menor HP% entre os adjacentes — `[ABERTO]`, §30 não separa). Sem monstro
  adjacente, o alvo é o alvo atual do membro seguido (§25, início do pull). Continua pegajoso
  e o retarget continua no mesmo evento de morte (já é assim em `hunt.ts:5236`).
- **Contrato:** `bot-config.targeting.policy` ganha os três valores e
  `{ kind: 'follow-member', characterId }`; `bot-config.follow` (movimento) continua
  separado, mas a UI liga os dois quando o jogador escolhe "Seguir <membro>" (F2 usa a mesma
  referência).
- **Cliente:** `LureTargetingModal.tsx:20-24` e `action-bar.ts:137` listam as novas opções
  com os rótulos do Huntera ("Menor % de vida", "Boss", "Seguir <nome>").
- **Aceite:** oráculos 1–3 da §2; `docs/product/bot.md` atualizado; a §6 da referência
  (que ainda fala em `advancedOnly.targetPolicies`) recebe uma nota de que está obsoleta.

### F2 · Distância com referência — boss > monstro > knight (`sim`, `content`, `protocol`, `client`)

É o coração da paridade e a única fase que precisa de ADR (muda a semântica de "postura").

- **Um número só, "Distância dos inimigos"**, e uma **referência** escolhida por prioridade a
  cada avaliação: boss na tela → monstro mais próximo → membro seguido (só se
  `follow-member` está configurado). A postura `keep-distance` passa a receber a referência
  em vez de assumir o monstro (`hunt.ts:2369-2395`).
- **Follow deixa de ser "adjacente":** com referência = knight, o seguidor mantém
  `distance ≤ N` e só anda quando `distance > N` **ou** quando a referência anda (reavaliar no
  passo do membro seguido: hoje `#armBot` roda no passo do próprio jogador, `hunt.ts:2270`;
  o passo do knight precisa acordar o seguidor no mesmo evento, oráculo 5).
- **Distância 1 = ao lado, nunca no mesmo tile** (nota do dono): o passo guloso recebe a
  posição do knight como bloqueada e prefere um dos oito vizinhos.
- **Ranged/caster medem do knight; o knight mede do monstro** (o líder observado ficou colado
  no alvo: `exori gran`/`exori min` são corpo a corpo). A regra: se a vocação da referência é
  a própria (knight seguindo knight) cai em monstro.
- **Contrato:** `bot-config.posture` vira `{ kind: 'keep-distance', tiles, reference:
  'auto' }`; `'auto'` é a prioridade acima. Sem campo novo para o jogador escolher a
  referência: o Huntera não expõe isso.
- **ADR:** "distância de referência por prioridade e follow como política de alvo" —
  registra por que `stand`/`follow`/`keep-distance` colapsam num número e numa prioridade,
  e por que a referência não é configurável.
- **Aceite:** oráculos 4 e 5; teste com o knight andando 20 tiles e o RP mantendo moda 3;
  teste de distância 1 sem nunca ocupar o tile do knight.

### F3 · Condições e sujeitos da regra (`content`, `sim`, `client`)

- **Sujeito × atributo × comparador × valor(% ou absoluto)**, como no §24:
  - sujeitos `self | target | area | ally(×N) | in-range`;
  - atributos `hp | mana | targets | trapped | paralyzed | magic-shield`;
  - comparadores `< <= == >= >` (falta `==`, `bot.ts:223-230`);
  - `%` opcional — hoje `hp` é só percentual (`bot.ts:150-157`); passa a aceitar absoluto.
- `ally ×N` = "pelo menos N aliados na condição" (ex.: `Aliado HP ≤ 50 % ×2`).
- `trapped` = sem passo livre (`greedyStep === null` para todos os vizinhos); `paralyzed` =
  efeito `paralyze` ativo; `magic-shield` = mana shield ativo — os três são `[ABERTO]`
  quanto ao que o Huntera mede (§30), e a doc de produto registra a escolha.
- **Ignorados por ação:** `slot.ignore: monsterId[]` além do global.
- **Cliente:** `ActionConfigModal.tsx` mostra as três colunas e o `%`; `action-config.ts:47`
  deixa de esconder `condition`.
- **Aceite:** a configuração real do Funkcaipora (§24, tabela de 15 slots) **serializa sem
  perda** para o `bot-config` do Draconya — teste de fixture.

### F4 · Fight mode com efeito (`sim`, `content`, `client`)

- Implementar o ADR 0032 d.10: `offensive | balanced | defensive` altera fator de ataque e
  defesa (referência TFS: `docs/reference/opentibia-engine-reference.md`, seção de fight
  mode). UI: três botões na barra como no Huntera ("Defesa total / Equilibrado / Ataque total").
- Sem novo opcode: vai no `bot-config`, campo que já existe (`schemas.ts:2031`).
- **Aceite:** teste de dano com os três modos; `docs/product/combat.md:217` deixa de dizer
  que fight mode está fora.

### F5 · Catálogo — números e regras que faltam (`content`, `sim`)

- `swift-foot`: cooldown 10.000 ms (hoje 4.000), `castsOnlyWithNoTargetInRange: true`,
  `endsOnAttack: true` (§24, §28). `strong-ethereal-spear` 8.000 ms (o `lesser-ethereal-spear`
  já tem 8.000 e o `ethereal-spear` 2.000 — conferir qual é qual contra a Parte IV e renomear
  se preciso, com a compatibilidade do ADR 0014).
- Sharpshooter: efeito com "sem defesa, −30 % velocidade, bloqueia grupos `healing` e
  `support` enquanto durar".
- **Knight:** `challenge` (`exeta res`) e `challenge-amp` (`exeta amp res`) — puxam a aggro
  dos monstros no raio para o conjurador; é o que faz o knight ser referência de distância
  na prática. Precisa de aggro por monstro no `sim` (verificar se o `monster/` já tem tabela
  de ameaça; se não, é a parte grande desta fase).
- Cooldown do grupo `support` = 2.000 ms em todos os suportes (auditar os 4 de 4.000).
- **Aceite:** oráculos 6–9.

### F6 · Munição em área e reserva (`content`, `sim`)

- `diamond-arrow` com `area: circle r1 centered target` (1–14 acertos observados);
  `crystalline-arrow` como reserva. O `#strike` (`hunt.ts:4308`) passa a aplicar área quando
  a munição tem.
- Regra de munição `{ primary, reserve }`: troca para a reserva ao esgotar a principal (a
  automação `swap-ammo-by-targets` já cobre a troca por contagem; a reserva é a segunda
  metade do `set-ammo-rules`, §20/§27).
- **Aceite:** um disparo gera N `creature-hit` no mesmo instante; sem diamond arrow, dispara
  crystalline.

### F7 · Presets como código (`client`, `server`)

- "Copiar este conjunto como código" / "Importar por código": serializar um `set` em
  base64url do JSON validado; importar valida com `validateBotConfigV2`. Sem novo opcode —
  o import é um `bot-config` normal.
- Baixa prioridade; não muda o comportamento da hunt.

### Fora do plano, de propósito

- "Jogador pelo nome…" como alvo de cura (fora da party) — não faz sentido com a party
  como sessão única (ADR 0027).
- RMT, Huntera Coins, loja — não são bot.
- Lure com dois limiares: o Draconya tem e o Huntera não; fica.

---

## 4. Sequência, tamanho e o que cada fase entrega ao jogador

| Ordem | Fase | Tamanho | O jogador vê |
|-------|------|---------|--------------|
| 1 | F1 Alvo | M | "Seguir <membro>" ataca o que o knight segura; "Menor % de vida"; "Boss" |
| 2 | F2 Distância + ADR | G | RP/ED/MS param a 3 do knight e nunca em cima dele; reagem no passo dele |
| 3 | F5 Catálogo | M–G (challenge) | knight puxa aggro; Swift Foot só entre pulls; spear a 8 s |
| 4 | F3 Condições | M | editor igual ao do Huntera; a config do Funkcaipora importa inteira |
| 5 | F4 Fight mode | P–M | três posturas com efeito |
| 6 | F6 Munição | P | diamond arrow em área; reserva |
| 7 | F7 Presets | P | copiar/importar conjunto |

F1 e F2 são as que mudam a hunt em party de verdade e devem ir primeiro; F3 é o que torna
a barra "igual"; F5 é o que faz o knight ser knight. O teste de paridade da §2 nasce em F1 e
ganha uma linha por fase.

## 5. Como fechar cada fase

`/spec` na issue com o trecho desta seção como premissa; `pnpm check`; `/compliance` no
diff (F2 e F5 tocam `sim/` e o ledger de munição); `/product` em `docs/product/bot.md`
(e `combat.md` em F4); `/adr` só em F2. A Parte IV é a fonte — se a implementação decidir
diferente do observado, a divergência é marcada lá e em `docs/product/bot.md`, não apagada.
