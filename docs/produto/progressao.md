# Progressão, vocações e level

**Status:** não implementado
**PRD:** §4.1, §9, §43.1
**Épico:** E2 (stats por vocação/level, skills por uso); E7 (árvore de passivas, promoção de vocação por quest)

## Comportamento

O jogo tem quatro vocações — Cavaleiro, Druida/Curandeiro, Feiticeiro e Arqueiro — cada uma um arquétipo clássico de papel (tank, suporte/cura, dano mágico, dano à distância). HP e Mana crescem automaticamente por level, sem distribuição manual de atributos: o jogador não aloca pontos em força ou inteligência, o crescimento é inteiramente determinado pela vocação escolhida.

Existe uma única promoção permanente de classe no MVP, obtida por quest. A maior parte das magias é liberada automaticamente conforme o personagem sobe de level; as magias mais fortes ficam condicionadas a essa promoção. O sistema deve ser construído de forma que promoções adicionais possam ser introduzidas futuramente sem exigir remodelagem completa do personagem.

Skills sobem pelo uso, seguindo o paradigma do Tibia, e não automaticamente com o level do personagem.

Cada personagem recebe pontos de passiva ao longo da progressão, distribuídos numa árvore própria da vocação. A árvore permite caminhos como dano, suporte e sustain. Os pontos podem ser redistribuídos livremente em PZ, quantas vezes o jogador quiser — não há custo nem limite de respec.

O catálogo de magias do jogo usa como referência de escopo funcional as magias do Tibia até aproximadamente o level 120, sem reproduzir catálogo proprietário, nomes, assets ou código — o conteúdo final precisa ser definido/licenciado de forma própria.

## Regras

- Ganho de HP/Mana por level é automático e fixo por vocação (ver tabela de parâmetros).
- A escolha de vocação ocorre no level 8 (ver `onboarding.md`).
- Existe exatamente uma promoção de classe no MVP, obtida por quest permanente e única.
- Magias liberadas por level: a maioria; magias mais fortes: condicionadas à promoção.
- Skills evoluem por uso, não por level.
- Pontos de passiva são distribuídos em árvore própria por vocação (dano / suporte / sustain).
- Respec de passivas é livre, ilimitado e restrito a PZ.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| HP por level — Cavaleiro | +20 | caminho previsto: `packages/content/vocacoes` |
| Mana por level — Cavaleiro | +5 | caminho previsto: `packages/content/vocacoes` |
| HP por level — Arqueiro | +15 | caminho previsto: `packages/content/vocacoes` |
| Mana por level — Arqueiro | +10 | caminho previsto: `packages/content/vocacoes` |
| HP por level — Feiticeiro/Mago | +5 | caminho previsto: `packages/content/vocacoes` |
| Mana por level — Feiticeiro/Mago | +25 | caminho previsto: `packages/content/vocacoes` |
| HP por level — Druida | `[ABERTO]` | caminho previsto: `packages/content/vocacoes` |
| Mana por level — Druida | `[ABERTO]` | caminho previsto: `packages/content/vocacoes` |
| Quantidade de promoções no MVP | 1 | caminho previsto: `packages/content/vocacoes` |
| Curva de ganho de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocacoes` |
| Teto de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocacoes` |
| Referência de catálogo de magias | Tibia até ~level 120 (referência funcional; catálogo final próprio) | caminho previsto: `packages/content/magias` |

## Em aberto

- HP/Mana por level do Druida ainda não definidos (§9.3).
- Nomes finais das vocações e das promoções (§9.1).
- Curva exata de ganho de pontos de passiva e teto final da árvore — foi discutida uma desaceleração progressiva em levels altos, mas nada foi fechado (§9.5).
- Catálogo final de magias e números de balanceamento associados (§43.1).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
