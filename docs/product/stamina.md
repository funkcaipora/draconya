# Stamina

**Status:** implementado — cálculo, consumo em hunt e bloqueio de XP, de loot (FUN-63) **e do
abate no Bestiário** (FUN-113), os três pelo mesmo portão.
**PRD:** §10
**Épico:** E2 (stamina como função do tempo decorrido, sem tick); E3 (bloqueio de XP, loot e Bestiário com stamina zero)

## Comportamento

Todo personagem tem uma reserva de stamina que funciona como o freio econômico do tempo de caça efetivo. Ela se esgota enquanto o personagem está em hunt e se recupera enquanto ele está fora de hunt — inclusive enquanto está em treino, que conta como "fora de hunt" para esse efeito.

Quando a stamina chega a zero, a hunt não é interrompida: o personagem continua dentro dela, continua andando, continua atacando, continua consumindo supplies e gastando gold, e pode morrer normalmente. O que muda é que a partir desse ponto ele para de progredir de verdade: não recebe XP, não recebe loot e os abates não contam para a Bestiário. Ou seja, stamina zero transforma a hunt em uma atividade que ainda tem custo mas não tem mais benefício de progressão — o jogador (ou o bot, via regra de saída configurada) é quem decide encerrar.

## Regras

- Stamina máxima: 24 horas.
- Recuperação fora de hunt: 1 minuto de tempo real recupera 1 minuto de stamina (proporção 1:1).
- Treino conta como "fora de hunt" para fins de recuperação de stamina.
- Em stamina zero, dentro da hunt: personagem continua se movendo, atacando, consumindo supplies/gold e pode morrer; não recebe XP; não recebe loot; abates não contam para a Bestiário.
- Stamina zero, por si só, nunca encerra a hunt automaticamente.

## Não é um recurso "ticado", e isso é o desenho inteiro

Não existe job decrementando nada. Guarda-se **quanto sobra** (`staminaMs`) e **o instante em
que aquele valor valia** (`staminaUpdatedAt`), e o valor de agora é **calculado quando alguém
pergunta**. Um personagem parado três dias custa exatamente zero.

Isso importa além da regra de jogo: a stamina é o principal freio de custo de infraestrutura do
projeto, porque o teto de simulação é `2 × contas ativas` ([ADR 0001](../adr/0001-session-decoupled-from-connection.md)).
Um mecanismo que custasse por personagem parado atacaria justamente o número que ele existe para
proteger.

### Há dois relógios, e confundi-los é o erro

| | relógio | por quê |
|---|---|---|
| dentro da hunt | `dtMs` **simulado** | é o invariante 2: uma hunt desanexada a 1 Hz consome o mesmo que a anexada a 10 Hz |
| fora da hunt | tempo de **relógio** | ninguém está simulando nada, e é justamente esse o caso |

A separação é o que permite as duas coisas ao mesmo tempo. O consumo dentro da hunt **não toca**
no instante de materialização: aquele campo é o marco da recuperação de fora, e mexer nele faria
o tempo de hunt contar duas vezes — uma consumindo, outra recuperando.

**O teto de 24 h é aplicado na leitura**, não só na escrita. Aplicar só na escrita funciona
enquanto alguém escreve, e o caso inteiro é ninguém ter escrito nada.

**Relógio para trás não devolve stamina.** Acontece com ajuste de horário e com NTP; deixar a
subtração passar daria stamina de graça se algum dia o instante viesse de fora do servidor.

### Materializar acontece nas fronteiras

Ao **entrar** numa sessão e ao **sair** da hunt, e o valor entra no snapshot como qualquer outro
estado quente. Entre esses momentos, calcula-se na leitura.

## Stamina zero avisa, uma vez

O cenário comum é o jogador ausente: daqui para a frente a hunt anda, gasta supply e **não gera
nada**. Zerar entra na lista curta da tela de retorno como evento notável — uma vez só, porque
repetir a cada tick encheria a lista com a mesma linha até ela deixar de ser lista.

O que zerar **não** faz é encerrar a hunt (§10.2). É a regra que mais parece bug para quem
implementa, e a que mais precisa ser respeitada: o personagem continua caçando, matando e
apanhando. O abate inclusive continua contando no extrato — o jogador matou, e dizer que não
seria mentira. O que ele deixa de ganhar é XP.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Stamina máxima | 24h | `packages/content/data/stamina/baseline.json`, `maxMs` |
| Taxa de recuperação fora de hunt | 1:1 (1 min = 1 min) | `packages/content/data/stamina/baseline.json`, `recoveryRatio` |
| Taxa de recuperação em treino | 1:1 (1 min = 1 min) | mesma taxa: treino é "fora de hunt" e não tem entrada própria |

## Direção planejada (ADR 0043, emenda 2026-09-25 — "copie do Huntera")

O comportamento acima é o **implementado hoje**; o que segue é o alvo do M32, ainda não
construído. O [ADR 0043](../adr/0043-tibia-stamina-and-food-only-regeneration.md) propõe stamina
do Tibia com faixas; a emenda de 2026-09-25 (resposta do dono, "copie do Huntera", à luz de
`docs/reference/huntera-observed.md`) revisou essa proposta:

- **Teto: 12 h** (`staminaMs: 43.200.000`), não os 42 h que o ADR 0043 propunha originalmente —
  o Huntera opera com 12 h cheios na Cidade. O consumo em hunt continua 1:1, sem mudança.
- **Recuperação fora de hunt:** `[ABERTO]`. A razão por faixa do Canary (1 min a cada 180 s, depois
  a cada 360 s) NÃO foi adotada — ela era calculada contra o teto de 42 h que caiu, e o Huntera
  nunca teve sua razão de recuperação passiva medida. Fica mantida a recuperação atual, 1:1, como
  valor provisório até uma captura medir a razão real.
- **Faixas de XP/loot por stamina baixa:** `[ABERTO]`. As faixas do Canary (1,5× Premium acima de
  2.340 min, 0,5× em 840 min ou menos, corte de loot em 840 min ou menos) também eram calculadas
  contra o teto de 42 h; sem reescalonamento contra os novos 720 min, e sem confirmação do
  Huntera (a conta observada tinha "Bônus de Premium" inativo), ficam como pendência.
- **Sem comida.** A regeneração de vida/mana (hoje um sistema separado, fora do escopo deste
  documento) passa a depender só de "estar em hunt agora" — a tela do Huntera diz "Regeneração de
  vida/mana: só em caçadas", e o socket confirma `healthRegen`/`manaRegen` zerados na Cidade. Isto
  reverte a proposta anterior do ADR 0043 de condicionar a regeneração a um item de comida; nenhum
  consumível de comida entra em `content/items`.

Ver a emenda "2026-09-25: decisões do dono" no fim do ADR 0043 para a citação completa da
evidência (parte/linha de `huntera-observed.md`) e a captura que falta para fechar a recuperação
e as faixas.

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. A direção planejada do M32 (seção
acima) tem duas pendências: a razão de recuperação fora de hunt `[ABERTO]` e as faixas de
XP/loot por stamina baixa `[ABERTO]`, as duas aguardando captura do Huntera (ver
`docs/tibia-parity-plan.md` §6).

## Divergências do PRD

**Não existe taxa de consumo configurável**, e é decisão: dentro da hunt a stamina cai 1:1 com o
tempo simulado. Um multiplicador viraria a tentação de "queimar mais rápido nas hunts difíceis",
e aí a stamina deixaria de ser o teto de simulação que a projeção de custo usa — que é a razão de
ela existir antes de ser regra de jogo.

**Loot e Bestiário passam pelo MESMO portão da XP.** O bloqueio está escrito no lugar onde a
recompensa é creditada (`#onMonsterDied`), e o loot (FUN-63) e o abate no Bestiário (FUN-113,
§18.6) entraram por ele — uma condição só, para não divergirem na primeira mudança em uma delas.

**Personagem sem stamina persistida roda sem teto.** É o que uma sessão gravada antes desta
implementação é, e cobrar dela uma stamina que nunca foi medida seria inventar uma punição.

**A stamina volta para o banco como valor absoluto, não como delta** — ela não é uma soma. Vai
com o instante em que valia, e só sobrescreve quando é mais nova, senão um extrato atrasado
devolveria stamina já gasta.
