# Bot

**Status:** parcial — vocabulário fechado e versionado (FUN-73) e compilador de regras
(FUN-80) implementados; nada **executa** ação ainda, porque magia é M7 e supply é M8
**PRD:** §13, §43.3
**Épico:** E4

## Comportamento

A automação é parte oficial do produto e roda inteiramente no servidor — o jogador configura regras, e a hunt continua funcionando mesmo com o client fechado. Do level 1 ao 49, o personagem usa um bot simplificado, inspirado na experiência do Huntera. A partir do level 50, o bot avançado é liberado, adicionando ferramentas como lure dinâmico e ring swap.

O bot é organizado em cinco categorias independentes, cada uma com seus próprios slots: Cura, Potions, Magias de ataque, Runas e itens, e Magias de suporte. Não existe prioridade global entre categorias — cada uma avalia seus próprios slots de cima para baixo, e a primeira regra válida encontrada é executada; as demais regras daquela categoria não executam naquele ciclo. Por exemplo, numa categoria de Cura configurada como "HP<=30% → cura forte", "HP<=55% → cura média", "HP<=80% → cura fraca", se a primeira regra for válida, as outras duas nem são avaliadas.

Cada categoria tem um cooldown próprio de 1 segundo, independente das outras — uma ação de Potion não consome o cooldown de Runa, por exemplo — além do cooldown específico da magia ou item usado, quando houver.

O bot também administra targeting: mirar no alvo mais próximo, no de menor ou maior HP, priorizar ou ignorar criaturas específicas, seguir o alvo, ficar parado, ou manter uma distância configurada.

O bot avançado (level 50+) adiciona duas máquinas de estado sobre o mesmo motor. A primeira é o lure dinâmico: o jogador define um intervalo mínimo/máximo de monstros — por exemplo, mínimo 4 e máximo 8 — e o personagem alterna entre percorrer a rota acumulando inimigos (quando a contagem está abaixo do mínimo) e parar para limpar o grupo (quando atinge o máximo), retomando o percurso quando a contagem volta a cair abaixo do mínimo. A segunda é o ring swap: uma máquina de estados para Energy Ring e anéis semelhantes, com limiares de entrada e saída propositalmente diferentes para evitar troca repetitiva perto do mesmo percentual (por exemplo: equipar com HP < 50%, retirar com HP >= 60%, ou retirar por Mana < 10%). Ao retirar, o jogador escolhe entre restaurar o anel anteriormente equipado ou deixar o slot vazio.

Por fim, o jogador pode configurar duas regras automáticas de saída da hunt: sair se algum membro da party sair ou morrer, e sair se o próprio gold acabar. Se a segunda regra não estiver ativa e o gold acabar, o personagem permanece na hunt, incapaz de pagar supplies, e pode morrer.

## Regras

- Bot básico: do level 1 ao 49. Bot avançado: a partir do level 50.
- Cinco categorias independentes, cada uma com cooldown próprio de 1 segundo (além do cooldown da magia/item usado, se houver).
- Sem prioridade global entre categorias; dentro de cada categoria, avaliação de cima para baixo, primeira regra válida executa e interrompe a avaliação daquela categoria naquele ciclo.
- Uma ação de uma categoria não consome, por padrão, o cooldown de outra categoria.
- Condições da categoria Cura: HP e Mana, com operadores `<`, `>`, `<=`, `>=`.
- Potions: 2 slots de vida e 2 de mana; Spirit Potion pode ser elegível para ambas as categorias.
- Targeting suportado: mais próximo, menor HP, maior HP, priorizar específicas, ignorar específicas, seguir alvo, permanecer parado, manter distância configurada.
- Lure dinâmico: intervalo mínimo/máximo de monstros configurável; abaixo do mínimo percorre a rota acumulando, no máximo para e limpa, retoma quando cai abaixo do mínimo de novo.
- Ring swap: limiares de entrada e saída distintos (histerese); ao retirar, jogador escolhe restaurar o anel anterior ou deixar o slot vazio.
- Regras de saída configuráveis: (1) sair se membro da party sair/morrer; (2) sair se o próprio gold acabar. Sem a regra (2) ativa, gold zerado não tira o personagem da hunt.

## O vocabulário, por inteiro (FUN-73)

Fechado, e é decisão do ADR 0002: o compilador só transforma em predicado o que conhece, e uma
linguagem de script no lugar disto seria código do jogador rodando no servidor. Versionado
porque a configuração é dado **persistido** — um vocabulário que muda sem número quebra a regra
de quem a salvou, em silêncio, e o sintoma é o bot parar de curar sem ninguém ligar uma coisa à
outra.

**Versão atual: 1.** Configuração declarando outra versão é recusada com o número no motivo.

### Condições

`kind` é o nome da condição, não um rótulo ao lado dela — é o que faz a recusa apontar o campo
errado em vez de dizer "nenhuma variante casou".

| `kind` | Campos | O que testa |
|---|---|---|
| `hp` | `op`, `percent` (0–100) | HP do personagem, em percentual do máximo |
| `mana` | `op`, `percent` (0–100) | Mana do personagem, em percentual do máximo |
| `targets` | `op`, `count` (≥ 0) | Quantos alvos estão ao alcance |
| `target-hp` | `op`, `percent` (0–100) | Vida do alvo atual. Sem alvo, a condição é falsa — nunca erro |

**Operadores:** `<`, `<=`, `>`, `>=`. **Sem `==`** — comparar percentual exato quase nunca
dispara, e é a armadilha que faz o jogador achar que configurou cura e não ter cura nenhuma.

### Ações

| `kind` | Campo | Catálogo |
|---|---|---|
| `spell` | `spellId` | M7 — ainda não existe |
| `supply` | `supplyId` | M8 — ainda não existe |
| `item` | `itemId` | M8 — ainda não existe |

A forma é validada agora; **a referência cruzada entra quando o catálogo existir**, e entra na
validação, não na execução. Uma regra que aponta magia inexistente e só falha ao ser disparada é
o bot que para de curar sem explicação — o formato exato que este vocabulário existe para
impedir. É o mesmo mecanismo que `buildContent` já usa em `loot.items`.

### Exemplo

```jsonc
{
  "version": 1,
  "heal":    [{ "when": { "kind": "hp", "op": "<=", "percent": 30 },
                "do": { "kind": "spell", "spellId": "strong-heal" } }],
  "potion":  [{ "when": { "kind": "mana", "op": "<", "percent": 20 },
                "do": { "kind": "supply", "supplyId": "mana-potion" } }],
  "attack":  [{ "when": { "kind": "targets", "op": ">=", "count": 3 },
                "do": { "kind": "spell", "spellId": "wave" } }],
  "rune": [], "support": []
}
```

### Onde os limites moram

`packages/content/data/bot/baseline.json` — slots por categoria, cooldown de categoria e o level
do bot avançado. Em conteúdo e não em código, porque é balanceamento: um designer precisa
alcançá-lo sem deploy.

**Nada aqui executa regra.** Isto é o contrato; a avaliação é a FUN-80, e a configuração pelo
socket é a FUN-81.

## Como a regra vira decisão (FUN-80)

A configuração é **compilada ao entrar na sessão** (ADR 0002), uma vez, para um vetor de funções
puras `(view) => boolean`. Interpretar o JSON a cada avaliação é o caminho fácil e errado: com
5.000 hunts e cinco categorias por personagem, cada avaliação alocaria o objeto de condição de
novo, e alocação por evento é o que custa caro no `sim`.

Três propriedades que o compilador garante, e que têm teste:

- **A avaliação não aloca.** A `BotView` é reaproveitada — os campos são reescritos antes de
  avaliar —, e a ação devolvida é a mesma referência do vetor compilado, não uma cópia.
- **Primeira válida executa** (§13.4) é a ordem do vetor, e a avaliação **para** ali: com
  "HP≤30 → forte", "HP≤55 → média", "HP≤80 → fraca" e HP em 20%, as duas de baixo nem são
  consultadas.
- **HP e Mana comparam percentual**, nunca valor absoluto. 40 de 100 e 400 de 1000 disparam a
  mesma regra — senão a mesma configuração mudaria de comportamento a cada level up.

**Sem alvo, `target-hp` é falsa** — não é erro. "Ataque quando o alvo estiver abaixo de 30%" não
vale quando não há alvo, e lançar ali derrubaria a sessão por uma regra escrita corretamente.

Quem **executa** a ação escolhida é o motor de magia (M7) e o de supply (M8), por uma interface
(`BotActuator`) — não por um `if` dentro do compilador que cresce a cada categoria nova. Ela
devolve `false` quando a ação não aconteceu, porque uma categoria não pode gastar o cooldown de
uma ação que não aconteceu: seria o bot parando um segundo por ter tentado curar sem mana.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Level máximo do bot básico | 49 (avançado a partir de 50) | caminho previsto: `packages/content/bot` |
| Slots — Cura | 3 | caminho previsto: `packages/content/bot` |
| Slots — Potions | 4 (2 vida + 2 mana) | caminho previsto: `packages/content/bot` |
| Slots — Magias de ataque | 10 | caminho previsto: `packages/content/bot` |
| Slots — Runas e itens | 10 | caminho previsto: `packages/content/bot` |
| Slots — Magias de suporte | 10 | caminho previsto: `packages/content/bot` |
| Cooldown por categoria | 1s | caminho previsto: `packages/content/bot` |
| Teto de ações por segundo por personagem | 5 (derivado: 5 categorias × 1 cooldown cada — não é número do PRD, é consequência calculada em `docs/technical-architecture.md` §5) | caminho previsto: `packages/content/bot` |
| Lure dinâmico — mín/máx de exemplo | mín 4 / máx 8 (exemplo ilustrativo do PRD, não é valor final) | caminho previsto: `packages/content/bot` |
| Ring swap — limiares de exemplo | equipar HP<50%, retirar HP>=60%, retirar Mana<10% (exemplo ilustrativo do PRD, não é valor final) | caminho previsto: `packages/content/bot` |

## Em aberto

- Subconjunto exato de opções disponíveis no bot básico (pré-level 50) — deve ser definido a partir do bot completo (§13.2, §43.3). Bloqueia a última tarefa do épico E4 (`docs/technical-architecture.md` §20).
- Vocabulário final de todas as condições possíveis do bot (§43.3).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
