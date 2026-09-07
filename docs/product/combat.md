# Combate

**Status:** não implementado
**PRD:** §12
**Épico:** E2

## Comportamento

A matemática e o comportamento geral de combate usam o Tibia como referência funcional — fórmulas e parâmetros são tratados como conteúdo configurável, nunca como dependência de código ou catálogo proprietário. Duas regras do PRD desviam explicitamente dessa referência e valem como exceção fixa.

Primeira: ataques realizados pelo jogador sempre acertam o alvo. Não existe miss ofensivo do lado do jogador — o servidor não rola chance de acerto para o atacante, o que elimina metade da matemática de combate tradicional.

Segunda: existe o atributo Dodge no defensor. Quando o Dodge ativa, o ataque recebido causa metade do dano que causaria normalmente. Isso vale contra qualquer tipo de ataque recebido — incluindo magia e ataques de boss —, não apenas contra combate corpo a corpo. A chance de Dodge é percentual e pode vir de fontes como bônus permanentes de Bestiário.

Bônus permanentes obtidos via Bestiário são válidos apenas em PvE. O PvP (Guild War) não herda automaticamente essas vantagens de farm.

## Regras

- Ataques do jogador sempre acertam (sem rolagem de acerto ofensivo).
- Dodge, quando ativa no defensor, reduz o dano recebido em 50%.
- Dodge pode ativar contra qualquer ataque recebido, incluindo magia e ataques de boss.
- Bônus permanentes de Bestiário valem só em PvE; não se aplicam em Guild War.

## Parâmetros de balanceamento

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
