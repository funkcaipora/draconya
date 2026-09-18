# 0031 — Contrato de compatibilidade de combate e migração

**Status:** aceito
**Data:** 2026-09-17
**Contexto técnico:** `content` (perfil e versão), `sim` (combate, `damage`, rulesets), `server` (retomada e drenagem); marco M19, issue #329

## Contexto

O PRD §12.1 diz que a matemática de combate usa o Tibia como referência funcional, com duas
exceções explícitas: ataque ofensivo do jogador **sempre acerta** (§12.2) e **Dodge reduz o dano
recebido à metade** (§12.2), com bônus permanentes de Bestiário valendo só em PvE (§12.3). O
`packages/sim/src/combat/damage.ts` implementa exatamente isso: conhece `melee` e `magic`, aplica
armadura por tipo, piso, a rolagem de Dodge e arredonda no fim.

"Usar o Tibia como referência" não é uma instrução executável. A CipSoft não publica as fórmulas
de combate, então "igual ao Tibia" pode significar coisas incompatíveis: o número observado em um
vídeo, o mecanismo descrito por uma engine de código aberto, ou uma fórmula que ninguém pode
verificar. O ADR 0019 já resolveu a metade da questão ao declarar TFS e Canary como
**especificação de domínio** e fixar o limite de licença (GPL v2, mecanismo e caso de borda,
nunca código copiado). O que falta é a outra metade: **qual release do jogo governa o resultado, a
partir de quais fontes, e como uma mudança de fórmula atravessa conteúdo, sessão e snapshot**.

O marco M19 vai mexer em fórmula de propósito — tipos de dano, defesa, resistência, famílias de
arma, abilities de monstro, condições e outcomes. Sem um contrato fixado antes, cada tarefa
escolheria sua própria "fidelidade", e um deploy no meio de milhares de hunts desanexadas
reinterpretaria a fórmula de uma sessão em andamento. O pacote local `things/1332` é referência
**visual**: prova que arte e fórmula têm ciclos de versão distintos, não que a fórmula deva ser a
de 13.32. É por isso que esta decisão é de produto e arquitetura, e vem antes de qualquer código.

## Decisão

**Congelar a release de referência, as fontes aceitáveis e um perfil semântico versionado. Nenhuma
mudança de fórmula, ordem de RNG, arredondamento ou snapshot entra sem perfil novo e ADR.**

### Release de referência e fontes

A release de referência é **Tibia 13.32**, congelada por três fontes verificáveis e independentes
entre si:

| Papel | Fonte | Versão/data |
|---|---|---|
| Comportamento observado e conjunto de conteúdo | `docs/reference/huntera-observed.md` (jogo do gênero lido em produção) | capturas de 2026-09-11/12 |
| Mecanismo e casos de borda | `docs/reference/opentibia-engine-reference.md`; TFS `otland/forgottenserver` e Canary `opentibiabr/canary` | TFS `70793fdc` (2026-08-30); Canary `d34733e1` (2026-09-09) |
| Números observados de magia | TibiaWiki, revisão usada pelo ADR 0026 decisão 5 | acesso de 2026-09-12 |

**A versão de arte não é a fonte desta decisão** (DT-01). `things/1332` e
`packages/content/data/packs/tibia-1332.json` são corroboração de que o conjunto de conteúdo é o
de 13.32; se o pacote de arte for trocado por outro (13.40, 14.x), **este número não muda**. O que
obriga um ADR novo é a fonte de comportamento mudar — uma revisão de wiki que contradiga o que
está fixado, ou um mecanismo novo nos commits de referência.

### Limite de licença

TFS e Canary são **GPL v2** e continuam valendo os três limites do ADR 0019:

1. estuda-se arquitetura, fluxo, contrato e caso de borda; **não se copia, traduz nem adapta
   código linha a linha**;
2. fórmulas oficiais não publicadas da CipSoft **não entram**, nem como referência de número;
3. a implementação é TypeScript original do Draconya, e o resultado continua instanciado,
   idle-first e server-authoritative.

Quando a referência GPL for a única fonte de um mecanismo, o algoritmo é escrito do zero a partir
do comportamento descrito, e o teste de conformance prende o **resultado**, nunca a forma do
código.

### Perfil semântico inicial

O perfil é o contrato. CMB-02 o materializa no schema de combate em `packages/content`; o cliente
não escolhe perfil, tipo de dano nem resultado (invariante 4).

```ts
type CombatCompatibilityProfile = {
  readonly id: string;
  readonly referenceRelease: string;
  readonly productExceptions: readonly string[];
  readonly migrationPolicy: "additive" | "breaking";
};
```

O perfil inicial, `combat-v1`, é **aditivo**: preserva bit a bit o resultado já entregue e só
acrescenta estágios que hoje são identidade.

```ts
const COMBAT_V1: CombatCompatibilityProfile = {
  id: "combat-v1",
  referenceRelease: "tibia-13.32",
  productExceptions: [
    "player-always-hit",
    "dodge-halves-damage",
    "pve-only-bestiary-bonus",
  ],
  migrationPolicy: "additive",
};
```

### Decisões explícitas do perfil v1

Nenhuma delas fica implícita.

- **Always-hit (jogador) — MANTER como exceção de produto.** Ataque ofensivo do jogador não rola
  chance de acerto; não se adota o hit chance ofensivo do Tibia. É a exceção do PRD §12.2, não
  uma fidelidade pendente.
- **Always-hit (monstro) — MANTER o comportamento entregue.** Em v1 nenhum ataque tem rolagem
  ofensiva de acerto, dos dois lados. A defesa/escudo do defensor, que é o bloqueio do Tibia,
  entra em CMB-04 como estágio novo sob este contrato — não como um refactor silencioso.
- **Dodge — MANTER como exceção de produto, adaptado.** O Dodge do Draconya **reduz à metade** e
  não zera; o Tibia tem um charm de esquiva que nega o golpe. A chance é percentual, vale contra
  qualquer ataque recebido (corpo a corpo, magia e ability de monstro) e o bônus de Bestiário só
  entra em `pve`.
- **Ordem de mitigação — ADAPTAR e congelar.** A ordem canônica do perfil v1 é:
  1. **uma única rolagem de Dodge, sempre consumida**, primeiro ato do resolver;
  2. mitigação aritmética, sem RNG: defesa/escudo (identidade em v1, CMB-04) → armadura por tipo
     de dano → resistência/imunidade por tipo (identidade em v1, CMB-03);
  3. piso (`minimumDamageFraction`);
  4. corte do Dodge, se a rolagem ativou;
  5. arredondamento final.

  A ordem difere da do Tibia (defesa antes de tudo) porque a posição do sorteio é do Draconya:
  estágios novos entram como identidade **sem mover a rolagem**, e qualquer estágio que precise
  de um sorteio próprio muda a ordem de RNG e exige perfil novo.
- **Arredondamento — MANTER.** `Math.round` **só no fim**, com piso em zero; nenhum estágio
  intermediário arredonda. Trocar por `floor`/`ceil` muda resultado observável e é rompimento.
- **RNG — MANTER e tratar como contrato.** O RNG é o da sessão, semeado e determinístico;
  `Math.random` é proibido (o `source-policy` reprova). Cada resolução consome **exatamente um**
  sorteio de Dodge, mesmo com chance zero, para que a sequência não dependa de um atributo do
  alvo. Número e ordem dos sorteios são parte do resultado auditável: mudar qualquer um dos dois
  é rompimento observável (DT-03).
- **PvE x PvP — MANTER o escopo.** O perfil v1 é PvE. Bônus permanentes de Bestiário são PvE-only
  por construção (`CombatContext`), e a Guild War não os herda. PvP fica fora do M19: quando
  existir, exige perfil e ADR próprios. O cliente nunca manda contexto nem perfil.
- **Migração — ADITIVA em v1.** `migrationPolicy: "additive"` porque o perfil preserva o
  resultado atual. Qualquer mudança que altere dano resolvido, quantidade/ordem de sorteio,
  arredondamento ou o significado de campo de snapshot passa a ser `"breaking"`.

### Regra de evolução

**Toda mudança de resultado, ordem de RNG, arredondamento ou snapshot exige um perfil novo e um
ADR antes do código.** Comparar só a média de dano não basta: a sessão é auditável por seed e
snapshot, então dois perfis que rendem a mesma média e consomem sorteios diferentes não são
compatíveis. Um perfil `"breaking"` não reinterpreta sessão nenhuma.

### Matriz de conformidade

| Mecanismo (Tibia) | Regra Draconya hoje | Decisão | Tarefa | Teste de conformance |
|---|---|---|---|---|
| Ataque ofensivo rola acerto | Jogador sempre acerta | **manter** (exceção) | CMB-02 | `damage.test.ts` — sem sorteio de acerto |
| Esquiva nega o golpe | Dodge reduz à metade | **manter** (exceção) | CMB-02 | `damage.test.ts` — metade e rolagem sempre consumida |
| Defesa/escudo bloqueia | Inexistente | **adaptar** (identidade → estágio) | CMB-04 | testes de defesa e escudo |
| Armadura subtrai por tipo | Armadura por `kind` | **manter** | CMB-02/CMB-03 | `damage.test.ts` — armadura e piso |
| Resistência/imunidade por tipo | Inexistente | **adaptar** (identidade → estágio) | CMB-03 | testes de tipo e resistência |
| Condições (DoT, haste, buff, shield) | Haste, postura, magic shield e recovery | **adaptar** | CMB-07 | testes de condição e expiração |
| Skills e famílias de arma | `melee`, `distance`, `wand`; skill por uso | **adaptar** | CMB-05 | `hunt.test.ts` — famílias e proficiências |
| Abilities de monstro | Faixa de ataque (`attackRange`) | **adaptar** | CMB-06 | testes de ability de monstro |
| Outcomes (crítico, leech, mana shield) | Inexistente | **adaptar** | CMB-08 | testes de outcome |
| Tipos de dano e elemento | `melee` e `magic` | **adaptar** | CMB-03 | testes de tipo e mitigação |
| Ordem de mitigação | Dodge, armadura, piso, corte | **manter** (congelada em v1) | CMB-02 | `damage.test.ts` — ordem e posição do RNG |
| Arredondamento | `round` só no fim | **manter** | CMB-02 | `damage.test.ts` — piso e arredondamento |
| Política de RNG | RNG da sessão, um sorteio uniforme | **manter** | CMB-02 | `damage.test.ts` / `session.test.ts` |
| PvE x PvP | Bestiário PvE-only | **manter** (escopo M19) | CMB-02 | `damage.test.ts` — contexto |
| Atribuição e morte | Pipeline de `resolveDeath` (FUN-63) | **manter** | — | testes existentes |
| Compatibilidade de snapshot | `Content.version` fixada na sessão | **manter** | CMB-02 | `sessions.test.ts` |

### Migração entre perfis

O perfil é **conteúdo versionado**, não estado de sessão:

- `Content.version` é calculado sobre o conteúdo e inclui o perfil de combate. A sessão congela
  a versão na criação e não a troca no meio da hunt (invariante 7).
- O perfil **não é serializado no snapshot** e `SNAPSHOT_FORMAT_VERSION` **não sobe** por causa
  dele: `Content.version` já é a identidade congelada.
- **Retomada de perfil incompatível é recusada, nunca reinterpretada.** Se a versão de conteúdo
  fixada na sessão resolver para um perfil `"breaking"` diferente do que a produziu, o nó recusa
  a retomada e credita o progresso, pelo mesmo caminho que o ADR 0020 usa para o formato 2 e o
  ADR 0018 usa para o intervalo pulado.
- **Deploy normal drena e credita** (ADR 0010): as sessões ativas terminam creditando, as novas
  nascem com o perfil novo, e não existe migração ao vivo que reinterpretaria um snapshot antigo.
- Um perfil `"additive"` — resultado, RNG, arredondamento e snapshot idênticos — pode ser
  retomado sem cerimônia, porque não há diferença observável a preservar.

### Casos de borda

| Cenário | Resultado exigido |
|---|---|
| Fonte do Tibia conflita com a regra atual | O ADR decide antes do código; não entra como refactor silencioso. |
| A referência é GPL | Só mecanismo e caso de borda; algoritmo original em TypeScript. |
| Deploy muda o perfil com hunt ativa | Drenar/creditar (ADR 0010) ou recusar retomada incompatível; nunca reinterpretar o snapshot. |
| Mudança só parece refactor, mas muda o RNG | Tratada como rompimento observável: perfil novo, ADR e teste de conformance. |
| Mudança aditiva em conteúdo legado | Recebe o perfil default compatível; perfil desconhecido falha no boot, sem fallback. |

### Decisões técnicas

| ID | Decisão | Alternativa descartada | Motivo |
|---|---|---|---|
| DT-01 | A release é decisão documentada, com fonte de comportamento. | Inferir de `things/1332`. | Arte e fórmula têm ciclos de versão distintos. |
| DT-02 | As exceções de produto são explícitas no perfil. | Chamar tudo de "igual ao Tibia". | Evita promessa ambígua e regressão de balanceamento. |
| DT-03 | Mudança de RNG é mudança de compatibilidade. | Comparar só a média de dano. | A sessão é auditável por seed e snapshot. |

## Alternativas

- **Não fixar release e seguir "o Tibia" caso a caso.** Descartada: cada tarefa do M19 escolheria
  uma fonte diferente, e o resultado deixaria de ser auditável.
- **Usar o pacote de arte 13.32 como definição da versão de combate.** Descartada (DT-01): trocar
  o pacote de arte passaria a mexer na fórmula, e arte e fórmula têm ciclos distintos.
- **Adotar a fórmula oficial do Tibia.** Descartada: a CipSoft não a publica, então não há fonte
  verificável — e o PRD quer duas exceções que a fidelidade não comporta.
- **Copiar a fórmula do TFS/Canary.** Descartada por licença (GPL v2): o ADR 0019 permite estudar
  mecanismo, nunca copiar código.
- **Fazer a compatibilidade depender do snapshot.** Descartada: `Content.version` já é a
  identidade congelada da sessão, e duplicá-la criaria duas fontes de verdade para o mesmo fato.
- **Trocar o perfil ao vivo sem recusar retomada.** Descartada: reinterpretar um snapshot produz
  resultado com cara de legítimo que ninguém simulou (ADR 0018).

## Consequências

- **CMB-02 é a primeira implementação bloqueada** por este ADR: materializa o perfil no schema,
  extrai o resolver canônico e preserva o resultado v1 bit a bit. CMB-03 a CMB-08 dependem dela.
- O `packages/content/data/combat/baseline.json` ganha (em CMB-02) o perfil default compatível;
  perfil desconhecido passa a falhar no boot, sem fallback silencioso.
- "Igual ao Tibia" deixa de ser argumento sozinho: qualquer conflito entre a fonte e a regra
  atual vira decisão de ADR, e a matriz diz qual tarefa implementa cada mecanismo.
- Os valores provisórios (`armorEffectiveness`, `minimumDamageFraction`, `spellPower`) continuam
  `[ABERTO]`: este ADR fixa o **contrato**, não o balanceamento.
- O custo é pequeno e localizado: um campo a mais no conteúdo, uma validação de boot e testes de
  conformance. O caminho quente não muda, e nenhuma mensagem de protocolo ou tela é tocada.
- Risco nomeado: um perfil `"breaking"` que não seja detectado como tal faz uma hunt retomada
  render diferente da que foi gravada. A mitigação é a regra de evolução e o teste de RNG — não a
  inspeção humana do diff.

## Invariantes afetados

Nenhum muda. A decisão é medida contra os seis que o M19 declara:

- **invariante 1** — o perfil e o resolver são dados e aritmética pura; nada vem de I/O.
- **invariante 2** — o resolver não conhece tick; recebe o instante do evento que vence.
- **invariante 3** — o resultado é idêntico anexado ou desanexado, porque não depende de
  observador.
- **invariante 4** — o cliente só manda intenção; perfil, tipo de dano e resultado são do
  servidor.
- **invariante 7** — o perfil é conteúdo versionado, e a versão é fixada na sessão.
- **invariante 9** — só a sessão dona escreve estado quente; a migração de perfil passa por
  conteúdo e snapshot, nunca por outro processo tocando o `CharacterRuntime`.

## Emenda — 2026-09-17: a taxonomia de dano e a ordem de mitigação do CMB-03

Esta emenda corrige a ordem de mitigação congelada na decisão original e fixa a taxonomia
canônica de tipos de dano, que a decisão deixava em aberto. O que ela NÃO muda: o perfil
`combat-v1` continua aditivo, a rolagem de Dodge continua o primeiro ato e o arredondamento
continua só no fim. Onde esta emenda e o texto acima divergirem, vale a emenda.

### Taxonomia canônica de `DamageType`

A fonte única é `DAMAGE_TYPES`, exportado por `@draconya/content`; o `sim` importa o tipo e
não redeclara o enum. A lista é:

```ts
type DamageType =
  | 'physical' | 'energy' | 'earth' | 'fire' | 'ice' | 'holy' | 'death' // Tibia 13.32
  | 'arcane';                                                          // não-elemental
```

Os sete primeiros são os tipos de dano do **Tibia 13.32**, lidos do `CombatType` do TFS/Canary
— só os NOMES, que são fato de domínio; nenhuma linha de código GPL é copiada (ADR 0019). O
conjunto confere com o que o cliente do gênero desenha como elemento (físico, fogo, terra,
energia, gelo, sagrado, morte — ver `docs/reviews/kit-fidelity-audit-2026-09-16.md`).

`arcane` é o OITAVO tipo, e existe por uma razão de compatibilidade: o `combat-v1` tinha
`physical`/`arcane` como vocabulário, e magia sem elemento declarado usava a coluna `magic` da
armadura. `arcane` é esse caso — "magia não-elemental, ou cujo elemento o conteúdo ainda não
declarou". Ele é o DEFAULT de magia, runa e wand sem tipo explícito, e existe para que a
ausência de tipo continue rendendo **bit a bit** o mesmo dano do v1. A lista tem "pelo menos"
os sete canônicos: um tipo novo entra por emenda a este ADR, nunca por um valor que passou em
silêncio.

### Ordem de mitigação (CORRIGE a decisão original)

A ordem canônica do perfil v1 passa a ser, nesta ordem exata:

1. **uma única rolagem de Dodge, sempre consumida, primeiro ato do resolver** (inalterado);
2. **defesa/escudo** — identidade em v1, encaixe do CMB-04;
3. **armadura por tipo de dano**, sem RNG;
4. **piso de armadura** (`minimumDamageFraction`) — DEPOIS da armadura e ANTES da resistência;
5. **resistência/vulnerabilidade por tipo** — identidade sem dado;
6. **imunidade explícita** — zera, e o piso não a revoga;
7. **corte do Dodge**, se a rolagem ativou;
8. **arredondamento** só no fim, com piso em zero.

A decisão original punha o piso DEPOIS da resistência. A ordem desta emenda o põe antes, e a
diferença é observável: com armadura que leva o dano a negativo e resistência de 50 %, a ordem
antiga daria `max(piso, pós-armadura × 0,5)` e a nova dá `max(piso, pós-armadura) × 0,5`. O
CMB-03 é a primeira tarefa em que resistência deixa de ser identidade, então a ordem só se
torna observável agora — e é agora que ela é corrigida e testada. A ordem antiga nunca
produziu um resultado entregue, porque em v1 a resistência era identidade.

A posição do SORTEIO continua sendo a decisão do Draconya, e continua intocada: a rolagem é o
primeiro ato para que nenhum estágio novo a desloque. A imunidade e a resistência não consomem
RNG; um estágio que precise de sorteio próprio muda a ordem de RNG e exige perfil novo.

### Resistência, vulnerabilidade e imunidade

- `resistances` é uma fração por tipo no intervalo **`[-1, 1)`**. Positivo reduz
  (`dano × (1 − r)`); negativo é **vulnerabilidade** e amplifica (`dano × (1 + |r|)`). O teto de
  amplificação é 2× (`r = −1`).
- **`r = 1` é recusado no boot**: 100 % de resistência seria imunidade disfarçada, e a DT-02
  exige que imunidade seja EXPLÍCITA. Resistência e imunidade para o mesmo tipo, no mesmo
  perfil, é ambiguidade e também é recusada.
- Imunidade é uma lista explícita de tipos; duplicata é recusada. Ela zera o dano mesmo com
  piso, e não consome sorteio extra.
- O perfil é dado de conteúdo de monstro e de EQUIPAMENTO (item), compilado no boot para uma
  tabela completa por tipo (lookup O(1)) e um `Set` de imunidade. O equipamento do personagem
  SOMA a resistência por tipo e UNE as imunidades; a defesa do monstro vem da definição dele.

### Migração de `armorEffectiveness`

A tabela de armadura deixa de ter as colunas `melee`/`magic` e passa a ser indexada pelos OITO
tipos de dano, exaustiva no schema. A migração que preserva o v1 é:

- **`physical` fica com o antigo `melee`**;
- **todo tipo não-físico fica com o antigo `magic`** — inclusive `arcane`.

Ela é a referência `V1_ARMOR_EFFECTIVENESS` exportada por `content`, e o que as fixtures usam. O
conteúdo real declara os oito valores, porque o schema é exaustivo: mudar a efetividade de um
elemento é editar JSON, nunca lógica (§12.1).

### Consequências do CMB-03

- **A versão de conteúdo muda**, como em qualquer deploy que altera `data/`. Uma sessão gravada
  antes desta emenda é recusada na retomada e creditada (ADR 0010, ADR 0024) — não é
  reinterpretada. O `SNAPSHOT_FORMAT_VERSION` NÃO sobe: o outcome é efêmero e o perfil continua
  identificado por `Content.version` (invariante 7).
- Os tipos dos produtores ficam em conteúdo: arma (`weapon.damageType`), munição
  (`ammunition.damageType`), efeito de magia e de runa (`effect.damageType`), ability de monstro
  (`monster.damageType`) e o golpe desarmado (`combat.player.damageType`). Os defaults que
  preservam o v1 são `physical` em corpo a corpo, distância, monstro e desarmado, e `arcane` em
  magia, runa e wand/rod. Um elemento só é declarado onde o catálogo o diz — nunca inferido do
  NOME do item ou da magia (DT-03).
- O elemento declarado de um golpe NÃO muda o número entregue: `physical` usa a coluna `melee`
  de antes e todo elemento usa a coluna `magic` de antes. O que muda o resultado é
  resistência/imunidade, que não existia.
- O `DamageOutcome` ganha `damageType`, `afterDefense`, `afterArmor`, `afterResistance` e
  `immune`, e mantém os campos do CMB-02. Continua efêmero: nunca vai ao cliente nem ao
  snapshot.
