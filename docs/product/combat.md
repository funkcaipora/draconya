# Combate

**Status:** parcial — resolução de dano implementada (FUN-35); ataque, alvo e cooldown são FUN-36/40/43
**PRD:** §12
**Épico:** E2

## Comportamento

A matemática e o comportamento geral de combate usam o Tibia como referência funcional — fórmulas e parâmetros são tratados como conteúdo configurável, nunca como dependência de código ou catálogo proprietário. Duas regras do PRD desviam explicitamente dessa referência e valem como exceção fixa.

Primeira: ataques realizados pelo jogador sempre acertam o alvo. Não existe miss ofensivo do lado do jogador — o servidor não rola chance de acerto para o atacante, o que elimina metade da matemática de combate tradicional.

Segunda: existe o atributo Dodge no defensor. Quando o Dodge ativa, o ataque recebido causa metade do dano que causaria normalmente. Isso vale contra qualquer tipo de ataque recebido — incluindo magia e ataques de boss —, não apenas contra combate corpo a corpo. A chance de Dodge é percentual e pode vir de fontes como bônus permanentes de Bestiário.

Bônus permanentes obtidos via Bestiário são válidos apenas em PvE. O PvP (Guild War) não herda automaticamente essas vantagens de farm.

## O que já existe

`resolveDamage` em `packages/sim/src/combat/damage.ts`. Função pura a menos do RNG, que é o
**da sessão**: semeado e determinístico (FUN-25). `Math.random()` ali tornaria "por que eu
morri" uma pergunta sem resposta.

A ordem do cálculo, e cada passo tem um porquê:

1. **Rola o dodge — sempre**, mesmo contra alvo com chance zero. Pular a rolagem faria a
   sequência do gerador depender de um atributo do alvo, e aí dar dodge a um monstro
   deslocaria todo o loot que vem depois, num efeito que ninguém ligaria à causa.
2. Subtrai a armadura, com efetividade **por tipo de ataque** (hoje: vale contra corpo a
   corpo, não vale contra magia — provisório).
3. Aplica o **piso**: nem a armadura mais alta zera um golpe. Dano zero contra alvo pesado
   vira impasse silencioso, sem nada na tela dizendo o motivo.
4. Se esquivou, corta pela metade.
5. **Arredonda só no fim.** Arredondar antes do dodge faria 50% de 3 virar 2, e o jogador
   veria uma esquiva que reduziu um terço.

O bônus de Bestiário é **PvE-only por construção**: `resolveDamage` recebe o contexto, e o
acréscimo só entra quando ele é `pve`. A Guild War não tem como herdá-lo por esquecimento.

## Regras

- Ataques do jogador sempre acertam (sem rolagem de acerto ofensivo).
- Dodge, quando ativa no defensor, reduz o dano recebido em 50%.
- Dodge pode ativar contra qualquer ataque recebido, incluindo magia e ataques de boss.
- Bônus permanentes de Bestiário valem só em PvE; não se aplicam em Guild War.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Multiplicador de dodge | 0,5 (§12.2, decidido) | `packages/content/data/combat/baseline.json` |
| Efetividade da armadura — corpo a corpo | 1 `[ABERTO — valor provisório: 1]` | `packages/content/data/combat/baseline.json` |
| Efetividade da armadura — magia | 0 `[ABERTO — valor provisório: 0]` | `packages/content/data/combat/baseline.json` |
| Piso de dano, como fração do ataque | 0,1 `[ABERTO — valor provisório: 0,1]` | `packages/content/data/combat/baseline.json` |

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Chance de acerto do jogador (ofensivo) | 100% fixo, sem rolagem | caminho previsto: `packages/content/combate` |
| Redução de dano quando Dodge ativa | 50% | caminho previsto: `packages/content/combate` |
| Escopo do bônus de Bestiário | PvE-only | caminho previsto: `packages/content/bestiário` |

O catálogo de magias e seus números de dano/custo/cooldown pertence a `progression.md` — este arquivo cobre só a matemática geral de acerto/Dodge.

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
