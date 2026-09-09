# Progressão, vocações e level

**Status:** stats por level/vocação, curva de XP e level up implementados; skills, passivas e promoção não
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

## A curva de XP é fórmula, não tabela

`xpToCompleteLevel(L) = round(base × L^exponent)`, e `xp` no personagem é o **total acumulado**,
nunca "XP dentro do level".

Uma tabela de 500 linhas seria mais expressiva e é o caminho errado: a curva vai ser
rebalanceada muitas vezes, e rebalancear uma tabela é reescrever 500 linhas à mão — o que na
prática significa que ela nunca é rebalanceada. Dois números mudam a curva inteira.

Guardar o **acumulado**, e não o progresso dentro do level, é o que faz a penalidade de morte
cascatear sozinha: tira-se XP do total e o level é recalculado. Guardar o progresso dentro do
level exigiria um laço de "desce um level, devolve o resto" escrito à mão — exatamente onde o
caso de cascata de dois levels passa despercebido.

**Subir de level dá os pontos, não cura.** O máximo de HP e mana sobe, e o atual sobe junto na
mesma quantidade. Curar no level up faria "subir de level" virar poção grátis, e um bot bem
configurado morando na fronteira de um level nunca mais morreria.

**O level up é autoritativo sobre os stats.** Ele recalcula `maxHealth` e `maxMana` pela tabela,
o que significa que qualquer valor inventado na criação do personagem some no primeiro level up.
Por isso a criação de sessão passou a derivar HP e mana da mesma tabela — antes ela usava
números fixos, e o personagem *encolheria* ao subir de level.

## A progressão volta para o banco pelo `jobs`, como delta

O `game` não escreve nada durável. Ele encerra a sessão, monta o extrato e o deixa no Redis; o
`jobs` lê, escreve a linha de ledger e, **na mesma transação**, aplica a progressão na linha do
personagem.

A escolha é deliberada: o `jobs` já lê o extrato e já escreve o ledger, e manter a escrita
durável fora do processo stateful significa que uma falha ali não perde progresso — o extrato
fica no Redis e a próxima varredura tenta de novo.

**XP e gold entram como DELTA**, nunca como estado final. Escrever o estado final não é
idempotente, e dois extratos do mesmo personagem processados fora de ordem se sobrescreveriam.
Como delta, eles somam na ordem que vier.

**A progressão pendura na mesma chave de idempotência do ledger** (`session_id`, `seq`): a linha
do personagem só é tocada quando a linha de ledger foi de fato inserida. Um retry encontra o
conflito, não insere nada, e por isso não credita nada — que é o par grava-depois-apaga do
invariante 10 valendo para os dois de uma vez.

**O level é DERIVADO da XP nova**, nunca copiado do extrato. Copiar faria um extrato antigo,
processado fora de ordem, rebaixar um personagem que já subiu; derivar sempre bate com a XP que
está na linha.

**A stamina é a exceção, porque não é soma.** Ela vai como valor absoluto, com o instante em que
valia, e só sobrescreve quando é mais nova — sem essa guarda, um extrato atrasado devolveria
stamina já gasta.

O piso de zero na XP é do banco, não confiança em quem chama: a penalidade de morte chega no
extrato como número negativo, e XP negativa é um estado impossível que dá erro estranho em todo
lugar que a lê depois.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| HP por level — Cavaleiro | +20 | caminho previsto: `packages/content/vocations` |
| Mana por level — Cavaleiro | +5 | caminho previsto: `packages/content/vocations` |
| HP por level — Arqueiro | +15 | caminho previsto: `packages/content/vocations` |
| Mana por level — Arqueiro | +10 | caminho previsto: `packages/content/vocations` |
| HP por level — Feiticeiro/Mago | +5 | caminho previsto: `packages/content/vocations` |
| Mana por level — Feiticeiro/Mago | +25 | caminho previsto: `packages/content/vocations` |
| HP por level — Druida | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Mana por level — Druida | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| HP inicial (level 1) | 150 `[ABERTO — valor provisório: 150]` | `packages/content/data/progression/baseline.json` |
| Mana inicial (level 1) | 0 `[ABERTO — valor provisório: 0]` | `packages/content/data/progression/baseline.json` |
| Capacidade inicial | 400 `[ABERTO — valor provisório: 400]` | `packages/content/data/progression/baseline.json` |
| HP por level antes da vocação | 5 `[ABERTO — valor provisório: 5]` | `packages/content/data/progression/baseline.json` |
| Mana por level antes da vocação | 5 `[ABERTO — valor provisório: 5]` | `packages/content/data/progression/baseline.json` |
| Level em que a vocação é escolhida | 8 | `packages/content/data/progression/baseline.json` |
| Quantidade de promoções no MVP | 1 | caminho previsto: `packages/content/vocations` |
| Curva de ganho de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Teto de pontos de passiva | `[ABERTO]` | caminho previsto: `packages/content/vocations` |
| Base da curva de XP | 20 `[ABERTO — valor provisório: 20]` | `packages/content/data/progression/baseline.json`, `xp.base` |
| Expoente da curva de XP | 2 `[ABERTO — valor provisório: 2]` | `packages/content/data/progression/baseline.json`, `xp.exponent` |
| Velocidade de passo do personagem | 500 ms por tile `[ABERTO — valor provisório: 500]` | `packages/content/data/progression/baseline.json`, `stepDurationMs` |
| Referência de catálogo de magias | Tibia até ~level 120 (referência funcional; catálogo final próprio) | caminho previsto: `packages/content/spells` |

## Em aberto

- HP/Mana por level do Druida ainda não definidos (§9.3).
- Base de progressão (HP/mana/capacidade iniciais e crescimento dos níveis 1–7) não está no
  PRD: o §9.3 define só o incremento **por vocação**. Os valores em
  `progression/baseline.json` são provisórios e estão marcados como tal no próprio arquivo.
- A curva de XP também não está no PRD. `base: 20, exponent: 2` põe o level 8 — onde a vocação
  é escolhida — a cerca de duas horas de Rat Cellars, cedo o bastante para a escolha não virar
  espera.

## Decidido na implementação: a vocação não é retroativa

O PRD é silencioso sobre o que acontece com os sete primeiros levels quando a vocação é
escolhida no level 8. A implementação **não recalcula**: os incrementos até o level 8 saem da
tabela base, e só os levels acima seguem a vocação.

O motivo é o jogador. Recalcular mudaria o HP máximo de uma vez, na tela, no momento da
escolha — e um número que salta sem explicação parece bug, não progressão. Se o balanceamento
pedir o contrário depois, é mudança de conteúdo mais uma migração, não de lógica.

Quem passa do level 8 **sem** escolher vocação continua crescendo pela tabela base. O §7.4
permite adiar a escolha, e travar o crescimento seria punição silenciosa por algo que o jogo
não avisa.
- Nomes finais das vocações e das promoções (§9.1).
- Curva exata de ganho de pontos de passiva e teto final da árvore — foi discutida uma desaceleração progressiva em levels altos, mas nada foi fechado (§9.5).
- Catálogo final de magias e números de balanceamento associados (§43.1).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
