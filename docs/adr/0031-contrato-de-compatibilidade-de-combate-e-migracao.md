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
