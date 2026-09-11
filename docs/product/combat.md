# Combate

**Status:** parcial — resolução de dano (FUN-35), motor de magias com alvo único, área e requisito de vocação (FUN-74, FUN-92) e skills por uso (FUN-75) implementados
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

## Ação por tempo decorrido, nunca por contagem de tick

O invariante 2 em forma operacional: **todo cálculo recebe `dtMs`**, e cooldown guarda tempo,
nunca um contador decrementado. É o que faz a hunt desanexada a 1 Hz render igual à anexada a
10 Hz — e como isso é fácil de quebrar sem perceber, `pnpm source-policy` **reprova** qualquer
nome de contador de tick (`remainingTicks`, `cooldownTicks`, …) dentro de `packages/sim`.

A checagem é por **nome**, não por operação. Procurar `--` ou `-= 1` daria falso positivo em
todo laço do motor, e um check que grita sem motivo é um check que as pessoas aprendem a
ignorar. Quem escreve `remainingTicks` está declarando a intenção no nome, e é a intenção que
está proibida.

São três mecanismos, e confundi-los é o erro clássico:

| | guarda | para quê |
|---|---|---|
| ação por evento | instante absoluto de disponibilidade | poção, magia — sobrevive a snapshot e a retomada tardia |
| ação periódica | acumulador de duração | ataque, passo — é o que faz 1 Hz e 10 Hz renderem igual |
| grandeza contínua | **o mesmo acumulador** | regeneração e dano ao longo do tempo |

O terceiro não ganhou mecanismo próprio, e isso foi uma correção: uma taxa de `r` por segundo
**é** uma ação periódica de `1000 / r` milissegundos. O caminho que parecia natural — somar
`r × dtMs / 1000` num acumulador fracionário — é pior: somar `0,1` dez vezes em ponto flutuante
dá `0,9999…`, e some uma unidade a cada dez. Numa hunt de oito horas isso é regeneração faltando
sem nada explicando. Em milissegundos a conta é exata.

## Regeneração

O personagem recupera vida e mana passivamente enquanto está em hunt, por tempo decorrido. Vale
**mesmo com a stamina zerada**: regenerar não é recompensa, é sobrevivência, e o §10.2 diz que o
personagem continua podendo morrer, não que ele passa a morrer mais rápido.

Morto não regenera — sem essa linha, quem caiu voltaria sozinho na hunt em que morreu, e a morte
deixaria de encerrar coisa nenhuma.

A taxa de hoje faz um rato sozinho **não** matar um personagem de level 1: ele apanha, mata, e
recupera durante o respawn. Três ratos ainda matam. É o balanceamento que as poções vão
reequilibrar quando existirem.

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
| Regeneração de vida | 1 HP/s `[ABERTO — valor provisório: 1]` | `packages/content/data/progression/baseline.json`, `regen.healthPerSecond` |
| Regeneração de mana | 1 mana/s `[ABERTO — valor provisório: 1]` | `packages/content/data/progression/baseline.json`, `regen.manaPerSecond` |
| Piso de dano, como fração do ataque | 0,1 `[ABERTO — valor provisório: 0,1]` | `packages/content/data/combat/baseline.json` |

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Chance de acerto do jogador (ofensivo) | 100% fixo, sem rolagem | caminho previsto: `packages/content/combate` |
| Redução de dano quando Dodge ativa | 50% | caminho previsto: `packages/content/combate` |
| Escopo do bônus de Bestiário | PvE-only | caminho previsto: `packages/content/bestiário` |

O catálogo de magias e seus números de dano/custo/cooldown pertence a `progression.md` — este arquivo cobre só a matemática geral de acerto/Dodge.

## Magia usa a MESMA resolução de dano (FUN-74)

Uma magia de dano não tem matemática própria: ela chama `resolveDamage` com `kind: 'magic'`, e é
só isso que a distingue de um golpe. A consequência é que a efetividade da armadura contra magia
— hoje `0`, e provisória — vale por construção, e o dodge do defensor também: as duas são
conteúdo, e nenhuma das duas precisou ser escrita duas vezes.

O que é da magia, e não do golpe, é o **portão**: level mínimo, cooldown próprio, alcance próprio
e custo de mana. Ele mora em `packages/sim/src/casting.ts`, e os números moram em
`packages/content/data/spells/*.json`. Quem lança é o bot (ver [`bot.md`](./bot.md)); o alvo é o
monstro mais próximo, e o alcance é o **da magia**, não o da arma — uma magia de alcance 3
alcança de onde o corpo a corpo não alcança.

O cooldown de magia guarda **instante absoluto no relógio lógico da sessão**, que é a primeira
das três linhas da tabela acima. É o que faz o mesmo cooldown valer igual a 1 Hz e a 10 Hz, e o
que o mantém correto do outro lado de um snapshot.

### Magia em área (FUN-92)

Uma magia de dano pode declarar `area: { radius }`, em tiles a partir do **alvo** — distância de
Chebyshev, a mesma métrica da grade. Raio 1 pega o alvo mais os oito vizinhos.

Três coisas que a área traz e o alvo único não tinha:

- **Uma rolagem por alvo, e a ordem é contrato.** Cada alvo consome um sorteio do RNG da sessão,
  e trocar a ordem troca qual sorteio cai em quem — a mesma semente passaria a render uma hunt
  diferente. A ordem é a da lista de monstros, que é a de nascimento.
- **Colher todos os alvos antes de aplicar qualquer dano.** Resolver morte no meio da varredura
  seria varrer um array que está sendo substituído (`#onMonsterDied` filtra `#monsters`), e os
  alvos depois do que morreu ficariam de fora.
- **Só o alvo principal é conferido contra o alcance.** Quem foi pego pela área está lá porque
  cai dentro do raio, não porque o lançador o alcança — conferir cada um faria a área encolher
  para o alcance.

O custo de mana é da **magia**, não do número de alvos: cobrar por alvo faria o jogador pagar
mais por lançar no lugar certo, que é o inverso do que uma magia de área quer ensinar.

**Área centrada no LANÇADOR não existe**, e é decisão: uma magia centrada em quem lança não
precisa de alvo nenhum, e isso muda o portão inteiro — some a recusa por "sem alvo", some a
conferência de alcance. É outra forma de magia, não um parâmetro desta.

### Requisito de vocação (§9.2)

Uma magia pode declarar `vocationId`. Quem não a tem recebe `wrong-vocation`, e a recusa **não
tem prazo de retentativa** — esperar não faz ninguém virar druida, e reagendar por isso seria um
evento por segundo para redescobrir a mesma coisa.

O personagem nasce **sem** vocação e escolhe no level 8 (§7.4), então uma magia com requisito é
inacessível até lá por construção, sem nenhuma regra escrita em outro lugar.

## O que o jogador vê (FUN-106, FUN-109)

O combate é calculado no `sim` e **apresentado** pelo host, como o passo (§12). Cada golpe
aplicado vira `creature-hit` — o número flutuante sobre a criatura, com o dano **aplicado**, e
não o resolvido: o golpe fatal mostra o que a criatura tinha, não o que o atacante bateu — e,
quando houve dano, um efeito de sangue no atingido. Cura vira `creature-hit` com `kind: heal`.
Magia vira `spell-cast` no `sim` e, pela tabela de aparências fixada na sessão, projétil do
conjurador ao primeiro alvo e um efeito **por alvo** (ou no conjurador, quando é cura); poção
vira efeito no tile de quem bebeu. Magia sem linha na tabela é muda, nunca erro. Quais ids são
esses mora em `packages/content/data/appearances/baseline.json` (`spells`, `supplies`, `hits`),
e só ids (invariante 6).

Os vitais do personagem saem ao vivo: `creature-health` do personagem em todo lugar que escreve
a vida dele (golpe, cura, poção, regeneração, level up, penalidade de morte), e `player-stats`
a cada ciclo em que algo mudou — a stamina comparada no minuto, porque ela queima a cada evento
e comparada exata faria a mensagem sair dez vezes por segundo.

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Texto flutuante de XP e "miss"/"block"
ficam para quando o protocolo os carregar.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
