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

### Quem emite ticket liquida antes de ler

A varredura do `jobs` roda a cada dez segundos, e quem reconectava dentro dessa janela lia
`level` e `xp` da tabela **antes** do delta da sessão que tinha acabado. O personagem nascia com
o progresso de antes — e como o level up é autoritativo sobre os stats, ele também *encolhia*:
`statsForLevel` recalculava HP e mana a partir do level velho.

O banco convergia sozinho, porque o que se escreve é delta. Mas para quem estava jogando era
indistinguível de perda de dados, e sumia sozinho em dez segundos — o pior formato possível:
ninguém reproduz de propósito, e quem reporta parece enganado.

Agora `POST /api/tickets` liquida o que aquele personagem tem pendente antes de ler a linha
dele. É o **mesmo** caminho da varredura, não um paralelo: mesma linha de ledger, mesma chave
única, mesma transação. É isso que torna o encontro dos dois inofensivo — o `jobs` e a emissão
podem processar o mesmo extrato ao mesmo tempo, e o segundo a chegar bate na
`UNIQUE (session_id, seq)`, não aplica nada, e apaga um extrato já pago.

Somar o delta pendente por cima do que veio do banco seria mais barato e estaria **errado**:
entre ler a linha e ler o Redis cabe uma varredura inteira, e o mesmo delta entraria duas vezes
na conta que o jogador vê.

**Falhar ali recusa a entrada** (HTTP 503), em vez de deixar passar. Entrar com um personagem que
o servidor sabe estar desatualizado é o defeito que a rota acabou de deixar de ter, e a recusa é
retentável de graça: o extrato continua no Redis e a varredura o pega de qualquer jeito.

Para achar o extrato daquele personagem sem varrer o keyspace inteiro a cada login, o Redis
guarda um índice por personagem (`receipts:char:{characterId}`) ao lado do extrato. Um extrato
gravado por um nó `game` antigo, durante um deploy em rolagem, não tem entrada de índice e volta
a esperar a varredura — degradação, não perda.

`GET /api/characters` e `POST /api/characters/:id/select` liquidam pelo **mesmo caminho** antes
de ler a linha (FUN-66), então a tela de seleção e o jogo concordam. A diferença é o que se faz
ao falhar: o ticket recusa a entrada, porque a sessão nasce daquele número; a lista **serve o
valor atrasado** e loga, porque ela é como se chega a qualquer lugar e um 503 nela trancaria a
conta inteira por uma falha de ledger — o valor ali só é exibido, nada é criado a partir dele.
Na lista, liquida-se depois de listar (os ids só se conhecem listando) e relê-se só quando algo
foi escrito; sem pendência o custo é um `SMEMBERS` por personagem e nenhuma consulta a mais.

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
| Referência de catálogo de magias | Tibia até ~level 120 (referência funcional; catálogo final próprio) | `packages/content/data/spells/` |
| Cura — mana, cooldown, quanto cura | 20 / 1 000 ms / 60 `[ABERTO — valor provisório]` | `packages/content/data/spells/heal.json` |
| Golpe Arcano — mana, cooldown, dano, alcance | 15 / 2 000 ms / 40 / 3 tiles `[ABERTO — valor provisório]` | `packages/content/data/spells/strike.json` |

O catálogo tem **duas magias** (FUN-74), e é de propósito: uma de cura e uma de dano de alvo
único são o suficiente para o motor de magia existir por inteiro — custo, cooldown, alcance,
alvo, atribuição e morte. Magia em área e o resto do catálogo entram depois, contra um motor que
já está provado. Ver [`combat.md`](./combat.md) e [`bot.md`](./bot.md).

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
