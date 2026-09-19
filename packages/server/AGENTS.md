# @draconya/server

## Propósito

Os três processos: `api` (stateless — HTTP, auth, tickets, market, pagamentos), `game` (stateful —
WebSocket, hospeda sessões) e `jobs` (singleton com lock — agendador, expirações, reconciliação).
Persistência, diretório de sessão e roteamento.

## Fronteiras

**Pode importar:** `protocol`, `content`, `sim`, `tools`.
**Não pode importar:** `client`.

## Invariantes locais

- **O cliente só manda intenção** (invariante 4). Nada que chega pelo socket decide dano, posição
  resolvida, loot, XP ou resultado de transação. Se uma mensagem de entrada carrega resultado, é
  bug de protocolo, não recurso.
- **Movimentação de valor passa pelo ledger** com `(session_id, seq)` único (invariante 10).
  Retry nunca duplica. Ver ADR 0006.
  **A guarda de stamina compara DOIS RELÓGIOS** (FUN-101). `characters.stamina_updated_at`
  nasce de `defaultNow()` — relógio do Postgres; `receipt.staminaUpdatedAtMs` sai de
  `Date.now()` do nó `game`. A guarda só vale enquanto o skew for menor que o tempo entre duas
  sessões do mesmo personagem — o que é verdade, mas por folga e não por construção. **Teste
  que fale de stamina lê o instante da PRÓPRIA LINHA**, nunca `Date.now()`: medido nesta
  máquina, o Postgres está ~35 ms à frente, e um insert que volta mais rápido que isso faz a
  guarda recusar corretamente e reprovar um teste que não fala de relógio nenhum.
  **`characters.gold` é PROJEÇÃO, não fonte** (FUN-57). A verdade é a soma do ledger; a coluna
  existe para não somar linhas a cada leitura, e é escrita na mesma transação da linha. O que
  a reconstrói **não é `SUM(delta)`**: o crédito tem piso de zero (`Math.max(0, …)` em
  `applyProgress`), então uma sessão que gasta mais do que o personagem tinha grava o delta
  negativo cheio e trunca a coluna. A projeção é a soma DOBRADA NO PISO, linha a linha, na
  ordem em que entraram — e `ledger.postgres.test.ts`, "a coluna `gold` bate com o ledger", é quem
  confere. Quem escrever um caminho novo que credita gold sem linha de ledger reprova ali.
- **Nenhuma leitura ou escrita de banco no caminho crítico de uma ação.** A simulação vive em
  memória; persistência é write-behind. Postgres no meio do tick mata o tempo de resposta.
- Sessão de hunt sobrevive ao socket e ao restart. Deploy **drena encerrando com crédito**, não
  descarta. Ver ADR 0010.
- O limite de 2 personagens ativos por conta é aplicado com script atômico no Redis, nunca com
  verificação otimista.

## Bibliotecas fixas (ADR 0011)

Drizzle + drizzle-kit no Postgres, ioredis, Fastify no `api`, uWebSockets.js no `game`, pino,
prom-client. Zod para validação. Trocar qualquer uma exige ADR novo, não decisão no meio de uma
tarefa — o valor da lista é ser única.

## Autenticação (ADR 0012)

Credencial e fluxos de conta ficam no WorkOS AuthKit; a tabela `account` local segue dona de
Coins, personagens e ledger, ligada por `external_auth_id`. A coluna `password_hash` existe nulável
e sem uso, para que trazer a autenticação para casa seja aditivo. Depois que o WorkOS prova a
identidade, o `api` cria uma sessão opaca no Redis e envia só o token num cookie httpOnly — o
provedor não fica no caminho de cada request autenticado. `AUTH_DEV_MODE=true` troca o redirect
por `POST /api/auth/dev-login`, aceita qualquer e-mail válido e continua proibido em produção.

Rotas atuais: `GET /api/auth/login`, `GET /api/auth/register`, `GET /api/auth/callback`,
`POST /api/auth/logout`, `GET /api/auth/me` e, somente em dev, `POST /api/auth/dev-login`.
A callback confere `state`; a sessão local tem TTL e fica em `auth:session:*` no Redis.

## Ticket de sessão (FUN-12)

A sessão HTTP morre no `api`. O que segue para o socket é um ticket de ~30 s, uso único,
consumido atomicamente com a reserva ativa e amarrado a um `nodeId` — apresentado a outro nó, é recusado. Duas
regras não são negociáveis aqui:

- **Reconexão volta para o MESMO nó.** Sessão viva num nó que parou de bater é recusada, não
  re-hospedada: escolher outro nó cria a segunda sessão do mesmo personagem (invariante 8).
  Decidir que uma sessão morreu é da retomada (FUN-28), com lock.
- **Sem autenticação configurada, a rota responde 501.** Emissão de ticket sem dono é acesso a
  qualquer conta; falhar aberto aqui é pior que não ter a rota. No fluxo normal, a FUN-10 injeta
  o principal da sessão HTTP e a FUN-11 consulta a posse no Postgres.

O slot de personagem ativo é reservado na EMISSÃO. A varredura em `jobs` devolve o slot por
uma regra só: passado o prazo, se o personagem não tem sessão no diretório, o slot volta —
o que cobre ticket abandonado, ticket queimado numa conexão que morreu, e ticket duplicado
sem um caminho de limpeza para cada caso.


## Personagens (FUN-11)

Personagem nasce sem vocação, com Coins fora dele (na conta) e Premium por personagem. Nasce
**vestido** com `progression.startingKit` (#153): `createCharacter` grava o personagem e uma
linha de `item_instance` por peça (`origin: 'starting-kit'`, `equipped_slot` preenchido, id
`<characterId>:kit:<n>`) na **mesma transação** — sem ledger, porque o kit não tem preço; é
inicialização de linha, como o bot padrão (FUN-114). Duas peças no mesmo slot derrubam a
criação inteira pelo índice único, e é o que se quer: kit pela metade em silêncio seria pior.
Personagem anterior ao #153 continua sem kit. Nomes são
únicos sem diferenciar maiúsculas/minúsculas. Exclusão é **soft delete** (`deleted_at`) para não
quebrar proveniência futura de item/ledger; personagem com `session_id`, lease ou reserva ativa não pode ser apagado. Exclusão e emissão
de ticket usam a mesma trava de linha do Postgres; o teste de concorrência é obrigatório.
O limite de dois personagens simultaneamente ativos NÃO mora no Postgres — continua no Redis
(FUN-15).

Rotas: `POST /api/characters`, `GET /api/characters`, `POST /api/characters/:id/select` e
`DELETE /api/characters/:id`.

## Sessão e visualizador (FUN-13)

Duas coisas, e a distinção entre elas é a arquitetura inteira:

- a **sessão** vive no `SessionHost`, avança sozinha e sobrevive ao socket;
- o **visualizador** é um socket olhando essa sessão, e entra e sai sem consequência nenhuma.

Duas abas do mesmo personagem são dois visualizadores da MESMA sessão, nunca duas sessões.
Se desanexar encerrar, pausar, creditar ou zerar qualquer coisa, o modelo está errado.

A `Session` do `sim` guarda só IDS de visualizador — ela não pode conhecer socket
(invariante 1). A ponte é `session.attached`, que decide a taxa de tick: a sessão sabe SE
alguém olha, nunca QUEM.

Saída é **um frame por ciclo**, em lote, nunca um `send` por evento — é o que sustenta a
projeção de 0,5–1,5 KB/s por jogador. As exceções são `welcome` e `pong`, que saem na hora:
`pong` que espera o ciclo mede a fila, não a rede.

## Reanexar devolve estado, nunca replay (FUN-32)

`session-attach` responde com `session-state`: **onde as coisas estão agora**, mais os
agregados e a lista curta de eventos notáveis. Nunca a fila de eventos que aconteceram
enquanto ninguém olhava — voltar depois de seis horas não pode virar seis horas de animação.
A versão sutil do mesmo erro é mandar "os últimos N eventos" e deixar o cliente decidir; por
isso não existe campo para isso na mensagem.

Duas armadilhas concretas:

- **O `session-state` vai pela FILA, nunca por `sendNow`.** Mandá-lo na frente o colocaria
  depois de deltas que já esperavam, e o cliente aplicaria um passo antigo por cima do estado
  atual. A fila é a atomicidade da troca entre "completo" e "só deltas"; basta não furá-la.
- **Nenhum campo de carga pode se chamar `type`.** O codec serializa com
  `const { type, ...props } = msg`, então um campo com esse nome é apagado no caminho e a
  mensagem inteira é recusada do outro lado **em silêncio** (`decodeS2C` devolve `null`). O
  `session-state` nasceu com esse defeito e só falhou quando alguém mandou a mensagem pela
  primeira vez. Há teste estrutural em `protocol` cobrindo todas as mensagens.

O id numérico de criatura é do servidor. O protocolo usa `number` porque isso vai no caminho
quente — 4 bytes por `creature-move`, dezenas de vezes por segundo, contra 36 de um UUID. O
`sim` não conhece protocolo e o cliente não pode inventar número, então a tradução mora no
`SessionHost` e é estável enquanto a sessão viver.

## Sessão que sobrevive à queda do nó (FUN-28)

A sessão é gravada a cada dez segundos em `session:{characterId}:snapshot`, com TTL de 24 h. A
chave existir **é** o índice de "isto deveria estar rodando" — não há lista separada, porque
lista precisa ser mantida em sincronia e o dia em que ela diverge é o dia em que se perde uma
sessão ou se ressuscita uma que já acabou.

**Órfã = snapshot existe e lease do diretório não.** O lease morre com o nó, o snapshot não.

Quem retoma é o **nó ao qual o jogador reconecta**, no `prepare` — retomar é hospedar, e
hospedar é do `game`. O `jobs` não retoma: ele só devolve o slot de quem não voltou, para o
jogador conseguir usar os outros personagens. O snapshot fica (§38.4).

**A versão de conteúdo é condição de retomada.** Snapshot gravado numa versão e retomado noutra
é recusado: o ruleset seria montado com o conteúdo deste processo enquanto a sessão continuaria se
declarando na versão antiga — simulando com stats, curva de XP e coeficientes novos sob um rótulo
velho, que é o que o invariante 7 existe para impedir. O caminho não é o deploy normal, que drena
creditando e não deixa snapshot: é a QUEDA sem drenagem num nó cujo substituto já subiu com
conteúdo novo.

**Snapshot que não volta é CREDITADO antes de sumir.** Vale para formato antigo, ruleset
desconhecido e versão divergente. Descartar em silêncio é o oposto do ADR 0010 — encerrar
creditando, não jogar fora. O `seq` sai do `ledgerSeq` do próprio snapshot, e é ele que mantém a
idempotência: um snapshot que sobreviveu a uma drenagem parcial não credita duas vezes, porque a
chave única do ledger recusa o `seq` repetido. Se o crédito falhar, o snapshot **fica** e a
conexão falha — o jogador tenta de novo em segundos, e o progresso continua lá.

Três coisas que não podem mudar sem pensar duas vezes:

- **Tomar o registro de outro nó exige que o batimento dele esteja AUSENTE**, e a troca é
  atômica em Lua. Um nó que ainda bate pode estar só numa pausa de GC, e duas cópias da mesma
  sessão é pior que uma perdida: dobra loot e XP. Na prática, retomar leva até um lease.
- **O intervalo NÃO é simulado** (ADR 0018), e desde a FUN-68 isso é cumprido por construção. O
  relógio da sessão é LÓGICO, começa em zero e é dela; quem guarda relógio de processo é o
  hospedeiro, em `HostedSession.lastAdvancedAtMs`. Uma sessão retomada nasce com essa marca no
  agora do processo novo, então o buraco nunca chega a ser oferecido à simulação — `rebaseClock`
  deixou de existir porque deixou de ter o que rebasear. Ver ADR 0020.
- **Nunca compare `nowMs` do hospedeiro com `session.nowMs`.** São grandezas diferentes: uma é
  monotônico de processo, a outra é tempo lógico da sessão. O ciclo mede o atraso contra
  `lastAdvancedAtMs`, e trocar isso faria uma hunt com dez minutos de relógio lógico parecer dez
  minutos atrasada no primeiro ciclo depois de retomada.
- **O jogador é avisado** ao anexar numa sessão retomada, com quanto tempo não foi simulado.
  Silenciar é como o modo idle perde a confiança de quem joga.

## Nada de rede fora do Postgres sob trava de linha (FUN-53)

Emissão de ticket e exclusão de personagem se excluem mutuamente por uma trava de linha
(`SELECT … FOR UPDATE`), e isso é certo. **O problema nunca foi travar, é o que acontece dentro
da trava.**

O cliente Redis está em `commandTimeout: 3000` e o pool do Postgres em `max: 10`. Uma lentidão do
Redis dentro da trava segura a linha por segundos, logins concorrentes esgotam o pool, e **toda
rota que toca o banco para de responder** — por um problema de Redis que não tem nada a ver com
a linha travada.

- **A resolução de nó ficou FORA da transação.** Qual nó de jogo está vivo não tem relação
  nenhuma com a linha do personagem, e descobrir isso é `SCAN` mais `MGET`. A janela que isso
  abre — o nó morrer entre a resolução e a emissão — já era tratada: o `consume` recusa o ticket
  se o nó não bater.
- **A checagem de "está em jogo" é UMA ida ao Redis**, não duas (`directory.isActive`).

O que ainda roda sob a trava: o script atômico de emissão, e a checagem do `delete`. Os dois
precisam da exclusividade — tirá-los exigiria um marcador durável de reserva no Postgres, para o
`delete` decidir sem perguntar ao Redis. Isso é trabalho à parte, e não vale trocar a trava por
verificação otimista: o teste de exclusão concorrente com emissão precisa continuar passando sem
alteração.

## O `jobs` é singleton com lock, e agora de fato (FUN-91)

O `AGENTS.md` raiz e o ADR 0005 descrevem o `jobs` como "singleton com lock" desde o primeiro
dia. O lock **não existia**: ficou um `TODO(FUN-28)` no `start`, a FUN-28 fechou, e a
documentação seguiu prometendo garantia que o código não dava.

O que dois `jobs` quebram, e o que não quebram:

| Tarefa | Dois processos ao mesmo tempo |
|---|---|
| escrever extrato | **seguro** — `UNIQUE (session_id, seq)` faz do segundo operação nula |
| varrer ticket abandonado | **seguro** — script Lua atômico |
| varrer sessão órfã | **não** — ela DEVOLVE slot, e o segundo derruba uma sessão que nasceu no intervalo |

Três coisas que não podem mudar sem pensar duas vezes:

- **A liderança é decidida a cada ciclo**, não tomada no boot. Tomar uma vez exigiria um
  temporizador de renovação em paralelo, e um processo que trava com o lock na mão nunca o
  solta. Renovar por ciclo faz a tomada ser consequência de não renovar.
- **O TTL precisa ser maior que o intervalo do ciclo.** Menor, e o dono perde a liderança entre
  uma renovação e a seguinte: os dois processos se revezam, e metade dos ciclos não roda — pior
  que não ter lock. Há teste afirmando a desigualdade.
- **Redis fora do ar NÃO promove ninguém.** Assumir a liderança quando não dá para saber quem a
  tem é a única forma de acabar com dois líderes de verdade.

O dono do lock é único **por processo**, não por máquina: dois containers `jobs` no mesmo host
compartilham o `NODE_ID` e renovariam o lock um do outro. `draconya_jobs_lock_held` torna isso
observável — somando o cluster, o normal é **um**.

## Progresso pendente é liquidado na emissão do ticket (FUN-56)

Entre a sessão encerrar e o `jobs` varrer passam até dez segundos (`SCHEDULE_INTERVAL_MS`). Quem
reconectava dentro dessa janela lia `level` e `xp` da tabela **antes** do delta da sessão que
tinha acabado, e entrava com o progresso de antes — encolhido junto, porque o level up é
autoritativo sobre HP e mana. O banco convergia sozinho, o que é o pior formato: some em dez
segundos, ninguém reproduz de propósito, e quem reporta parece enganado.

`POST /api/tickets` agora chama `settleCharacterProgress` antes de ler a linha. Quatro coisas que
não podem mudar sem pensar duas vezes:

- **É o MESMO caminho da varredura**, não um paralelo — mesma linha de ledger, mesma chave única,
  mesma transação. É o que torna o encontro dos dois inofensivo: o segundo a chegar bate na
  `UNIQUE (session_id, seq)`, não aplica nada, e apaga um extrato já pago.
- **Somar o delta pendente por cima do que veio do banco é a versão errada e mais barata.** Entre
  ler a linha e ler o Redis cabe uma varredura inteira, e o mesmo delta entra duas vezes.
- **Roda FORA da trava de linha**, pela mesma razão que a resolução de nó (FUN-53) — mas aqui há
  uma a mais: a liquidação PRECISA da trava para escrever, e chamá-la de dentro dela seria travar
  contra si mesma.
- **Falhar recusa a entrada** (503 `progress-not-settled`), em vez de deixar passar. Entrar com um
  personagem que o servidor sabe estar desatualizado é o defeito que a rota acabou de deixar de
  ter, e a recusa é retentável de graça: o extrato continua no Redis.

**Liquidar antes de conferir posse é a armadilha desta forma** (ADR 0024), e ela apareceu em
duas rotas: aqui e em `POST /api/characters/:id/select`. A ordem certa é sempre posse primeiro —
no `select`, ler a linha JÁ é a checagem, e a releitura depois da liquidação só acontece quando
algo foi escrito, então o caso comum continua custando uma consulta.

**A posse é conferida DUAS vezes na rota de ticket, e é de propósito** (ADR 0024). `ownsCharacter` roda
antes de tudo, sem travar nada, e decide se a rota faz ALGUMA coisa; `withOwnedCharacter` roda
depois, sob a trava que o soft delete também usa, e decide o que é LIDO. Colapsar as duas na
segunda devolve a fresta que o ADR 0024 fechou — a liquidação rodava sobre o personagem que o
corpo do request pedisse, e uma conta autenticada disparava ação sobre dado de outra. Colapsar na
primeira leria a linha sem trava. O custo da barata é um lookup por chave primária, mais barato
que o `SCAN` do `resolveNode` que já roda ao lado.

**Escrever a linha do personagem daqui não viola o invariante 9** — ver ADR 0024. O invariante é
sobre estado QUENTE, o `CharacterRuntime` em memória, que continua tendo dono único. A linha do
Postgres é durável, e o extrato só existe depois que a sessão dona acabou: não há dono para
disputar.

Desde o #194 (ADR 0027) a chave é `receipt:{sessionId}:{characterId}` — **um extrato por
membro**: a party é uma sessão com N donos, e quatro extratos da mesma sessão não podem se
sobrescrever. A chave antiga `receipt:{sessionId}` e a entrada de índice com o `sessionId` cru
continuam LIDAS e apagadas por um deploy (extrato em voo de um nó anterior), e a tolerância sai
numa issue de limpeza depois. No hospedeiro, `hosted.credited` é um `Set` por personagem,
preenchido **só após confirmar a gravação no Redis** (#267), não ao iniciar a tentativa.
`hosted.receiptSaves` compartilha a promessa em voo: drenagem e `release` concorrentes aguardam
a mesma gravação, inclusive sua falha. Falha libera a tentativa para retry, mantendo sessão e
snapshot; resposta perdida repete o mesmo `(session_id, seq)`, sem novo crédito no ledger.
`#succeed` percorre `session.receipts()` e `#settleOne` grava, avisa os visualizadores DAQUELE
personagem e o devolve à Cidade; quem sai por dentro do `sim` (`member-left`: morte, regra de
saída) entra em `hosted.departures` no ciclo — que é síncrono — e `#settleDepartures` grava
depois, haja ou não visualizador; `leave-hunt` com mais de um dono é `leave`, não `end`; e
`#replace` só apaga a sessão quando não sobra ninguém dela. Uma sessão retomada com N traz os
outros membros: a conta de cada um vem do snapshot DELE, e o lease é registrado antes de
qualquer coisa local existir — senão o lease expira, o login seguinte resolve para outro nó, e
a cópia do snapshot revive a mesma sessão duas vezes.

Para achar o extrato daquele personagem sem varrer o keyspace inteiro a cada login, o
`ReceiptStore` mantém `receipts:char:{characterId}` ao lado (guardando a chave inteira). **Os dois
prefixos são distintos de propósito:** nomear o índice `receipt:char:{id}` o poria dentro do
`MATCH` do `SCAN` da varredura, e um SET no lugar de um extrato sai do `MGET` como nada — a
varredura pararia de ver um extrato por ciclo, sem erro em lugar nenhum.

A liquidação síncrona tem teto de 50 extratos por chamada — cada um é uma transação no
Postgres, e isto roda no caminho de uma requisição. Encostar nele significa que a varredura está
parada há um bom tempo, e aí o certo é o login continuar rápido e o resto sair no próximo.

Extrato gravado por um nó `game` antigo, durante deploy em rolagem, não tem entrada de índice:
aquele personagem volta a esperar a varredura. Degradação, não perda.

`GET /api/characters` e `POST /api/characters/:id/select` liquidam pelo mesmo caminho antes de
ler (FUN-66). **Ali falhar NÃO recusa a resposta:** a lista sai com o valor atrasado e o erro
vai ao log. A tela de personagens é como se chega a qualquer lugar, e um 503 nela trancaria a
conta inteira por uma falha de ledger — o valor ali só é exibido, nada é criado a partir dele.
Na lista, liquida-se DEPOIS de listar (os ids só se conhecem listando) e relê-se só quando algo
foi escrito; sem pendência é um `SMEMBERS` por personagem e nenhuma consulta a mais.

## Métricas do nó de jogo (FUN-47)

`/metrics` no `game`, formato Prometheus, sem autenticação — quem o esconde é a rede, e pôr
credencial ali daria a falsa impressão de que ele pode sair para a internet.

Três regras que valem para qualquer métrica nova aqui:

- **Custo de tick é HISTOGRAMA, nunca média.** A média esconde a cauda, e é a cauda que satura o
  nó: como o tick é single-thread, uma instância patológica no p99 derruba o marco de 10 Hz de
  todas as outras do mesmo processo.
- **Nada de rótulo por `characterId` ou `sessionId`.** São milhares de valores, e isso mata
  qualquer backend de métrica — o custo aparece no Prometheus, longe daqui.
- **Contagem de sessão é recontada por ciclo, com `reset`.** Um contador incremental espalhado
  por `attach`/`detach`/`release`/`#replace` erra na primeira aresta esquecida, e erra devagar;
  e sem o `reset` um tipo que zera fica congelado no painel, transformando "as hunts pararam" em
  "as hunts continuam iguais".

O atraso de tick é medido contra o **período que a sessão pediu**, não contra o intervalo: 1000 ms
num tick de 1 Hz está no prazo e num de 10 Hz é 900 ms de atraso.

## Métricas do `jobs` (FUN-59)

`/metrics` próprio, em `JOBS_PORT` (padrão 3001), servido por Fastify — o `jobs` não tem
WebSocket nem caminho quente, e uWS existe no `game` porque lá o socket é o produto. Sem
autenticação, como nos outros dois: quem esconde é a rede.

Por que porta própria e não Pushgateway nem contador no Redis: um contador que sobrevive ao
processo faz "o `jobs` parou" virar "o `jobs` não achou nada" — o mesmo defeito que a gauge
sempre-zero de `orphan_sessions` teria no `game`. Com alvo próprio, o processo morrer é o alvo
sumir, que é o sinal.

O ciclo vive em `createJobsCycle`, separado do `setInterval`, para ser testável à mão. A
reentrância mora nele: ciclo pulado sobe `cycles_skipped_total`, e é o primeiro sintoma de
intervalo apertado. `last_success_timestamp_seconds` existe porque o alerta que importa é "não
roda há N minutos", e contador que para de subir não dispara nada sozinho.

`orphan_sessions` é um zero OBSERVADO — a varredura olhou e não achou —, e não o zero de uma
gauge que ninguém escreve. Foi a pendência da FUN-47.

## Os dois critérios de saída, como teste (FUN-44, FUN-99)

`api/phase-one-exit.postgres.test.ts` prova que a sessão **sobrevive**; `api/phase-two-exit.postgres.test.ts`
prova que ela **rende** — e que o número que o jogador lê é o que chega ao banco.

Os dois seguem as mesmas duas regras, e elas valem para qualquer teste que entre aqui:

- **O tempo é dirigido, nunca esperado.** Um teste que dorme dez minutos não roda no CI, e
  portanto não roda nunca.
- **Cada passo verifica ESTADO.** "Não lançou exceção" passa com a sessão parada.

O da F2 tem uma asserção que é o motivo de ele existir: o saldo no Postgres é conferido pela
CONTA — `gold anterior + ganho − gasto` —, e não por "é maior que zero". Bot, loot, ledger e
analisador têm teste cada um; o que faltava era alguém afirmar que os quatro contam a MESMA
história sobre a mesma hunt.

## O critério de saída do M13, como teste (#198)

`api/party-exit.postgres.test.ts` prova que quatro personagens de quatro vocações rendem
JUNTOS numa party compartilhada — e que cada um leva a sua parte ao banco, da mesma sessão:
a party pelo `api`, o líder abre o socket com o ticket da party (é ESSE socket que cria a hunt
com os quatro) e fecha, os outros três nunca conectam, cada rato de 5 XP rende 2 a cada um
(pool 200 % ÷ 4), um membro entra e sai levando a cota do settlement, a drenagem grava os
outros três, e o ledger tem quatro linhas do mesmo `session_id` cuja soma é o que caiu. Duas
armadilhas que ele pegou: a arena de teste comum tem 2×2 de chão e quatro heróis a ENCHEM
(nenhum rato nasce, a hunt fica parada sem erro — o teste tem arena própria), e `release` de
um membro apagava a sessão que os outros ainda iam creditar na drenagem (agora só some quando
não sobra ninguém dela, como `#replace`). O cliente de carga ganhou `--party N` e
`--party-mode`: uma party não atravessa workers (`slicePartied`), e a sobra entra solo.

## O critério de saída da Fase 1 (FUN-44)

`src/api/phase-one-exit.postgres.test.ts` roda o roteiro inteiro com socket, Postgres e Redis de verdade:
entrar numa hunt, fechar o navegador, render enquanto ninguém olha, voltar e reencontrar a
sessão, matar o nó sem drenar e retomar em outro, drenar e ver o extrato virar linha de
personagem.

**É o contrato de regressão da propriedade central do projeto.** Quando ele quebrar, vai ser
porque alguém reintroduziu acoplamento entre socket e sessão — e é para avisar antes de produção
que ele existe.

Duas regras ao mexer nele:

- **O tempo é dirigido, nunca esperado.** O relógio do nó é injetado (`now` em
  `GameDependencies`) e o teste o empurra em saltos; um teste que dorme dez minutos não roda no
  CI, e portanto não roda nunca. Os saltos são de cinco segundos porque o acumulador de ação
  periódica tem teto de recuperação de 32 aplicações — um salto único de dez minutos seria
  descartado em parte.
- **Cada passo verifica ESTADO.** "Não lançou exceção" passa com a sessão parada.

`GameRole.stop()` existe para este teste e para o que ele representa: parar sem creditar nada é
o que um `kill -9` parece de fora. Não confundir com `drain()`, que credita — trocar as duas
seria perder exatamente o progresso que o ADR 0010 existe para preservar.

## Configuração por papel e preferências do bot (ADR 0028, #263)

`config.ts` resolve `PROCESSES` antes dos requisitos e o `main.ts` usa essa mesma seleção.
Redis é obrigatório para todos; Postgres para `api/jobs`; WorkOS para `api` de produção;
`GAME_PUBLIC_URL` exige `ws/wss` sem credenciais, query ou fragmento, e WSS em produção
com `game`. Papel duplicado, desconhecido, vazio ou `PROCESSOS` legado recusa o boot.
`THINGS_DIR` pertence às ferramentas, não ao runtime. Matriz e exemplos em
[`runtime-configuration.md`](../../docs/runtime-configuration.md).

**O `game` não escreve Postgres, nem no modo solo.** A exceção do ADR 0021 foi substituída.
A sessão aceita e aplica o bot imediatamente; `saveBotConfig` grava a pendência no Redis.
Só depois confirma `ok: true`. Falha mantém a regra ativa, mas responde `ok: false` para
permitir retry. Não emitir sucesso antes de o callback terminar.

`BotConfigStore` mantém um envelope com UUID por edição em `bot-config:pending`, sem TTL.
`jobs/bot-config.ts` é o consumidor compartilhado por `jobs` e pela admissão no `api`:

- Sem pendência (`HEXISTS`) não abre transação: a admissão chama isto em toda listagem e em
  todo ticket, e o caso comum precisa continuar custando só Redis, como `pendingFor` no ledger.
- Com pendência, trava a linha do personagem ANTES de ler a pendência do Redis; depois
  substitui `bot_config`. Ler antes da trava permitiria a um consumidor atrasado sobrescrever
  a edição mais nova — o `HEXISTS` de fora só decide se vale abrir a transação.
- Confirma a pendência só depois do commit, com comparação/remoção atômicas do envelope.
  Nova edição nunca é removida pelo ACK da anterior, mesmo com configuração idêntica.
- Retry após commit repete a substituição, sem efeito econômico. Não há entrada no ledger.
- **Entrada corrompida vira AUSENTE, nunca admissão recusada** (#265) — a regra das cores do
  outfit e do Bestiário. `load` a devolve marcada (`corrupt: true`, JSON inválido incluído), e
  o consumidor a move para `bot-config:corrupt` com a mesma comparação do ACK, para uma edição
  válida que chegou por cima ficar onde está. Só Redis fora do ar recusa a admissão.
- `settleCharacterState` processa o bot antes do progresso, antes de tickets solo/party e
  da atualização da lista de personagens. Falhar recusa dado velho; não voltar ao callback
  antigo que só liquidava extratos no boot.
- Configuração chega ao `game` no ticket e é validada contra o conteúdo fixado da sessão.
  Só o dono altera a regra em memória; `api/jobs` escrevem apenas a preferência durável.

A janela até o ciclo de `jobs` ou próxima admissão depende da disponibilidade dos serviços.
Redis perdido antes de gravar Postgres pode perder a pendência. AOF/backup continuam
necessários; confirmação no socket significa aceitação no Redis, não commit de Postgres.
Testes reais de concorrência e reconexão: o bloco "persistência do bot entre processos"
de `api/phase-two-exit.postgres.test.ts` — no fixture da F2, porque os bancos de Redis de teste
acabaram e o 0 é o do desenvolvimento local.

## As cores do outfit viajam no ticket, não no snapshot (FUN-104)

`characters.outfit_colors` é `jsonb` nulável (`{ head, body, legs, feet }`, índices da paleta),
lida pelo `api` na emissão do ticket e adotada pelo `SessionHost` no `prepare` — o mesmo caminho
do `name`, e pela mesma razão: é dado do personagem que só a APRESENTAÇÃO lê. O `sim` não
conhece cor, e o snapshot não a carrega; quem a repete é `creature-appear` e a lista de
criaturas do `session-state`, só para personagem — monstro é uma camada só e nunca traz o campo.

Três coisas que seguem disso:

- **Uma escolha nova aparece na PRÓXIMA entrada**, com o ticket que a trouxer. Quem já está
  hospedado continua com as cores com que entrou; não há mensagem de "trocou de cor" e não
  precisa haver enquanto a tela de escolha (§7.4) não existir. Ninguém escreve a coluna ainda.
- **Valor corrompido vira AUSENTE, nunca login recusado.** A coluna não tem CHECK — a paleta é
  do pacote de assets, não do schema —, então quem valida é quem monta o ticket
  (`OutfitColors.safeParse`, no `api` e de novo no `consume`). Sem cores, o cliente pinta o
  padrão de personagem novo. Chave ausente, e não `colors: undefined`: o codec apagaria a chave
  e o tipo passaria a mentir sobre o que foi mandado.
- **Nome e cores são adotados ANTES de `#createLocal`.** O anúncio de chegada ao shard (FUN-71)
  sai de dentro dele, e lê as duas tabelas. Adotar depois — como o nome era — mandava o
  recém-chegado com o id no lugar do nome, e o teste da FUN-71 não via porque usa os dois
  iguais. O da FUN-104 usa nomes diferentes dos ids de propósito.

## O Bestiário viaja como as skills: ticket → runtime → extrato → ledger (FUN-113)

`characters.bestiary` é `jsonb` nulável (`{ monsterId: kills }`), e percorre o MESMO caminho
das skills (FUN-75), pela mesma razão — é progressão que escala a hunt DURANTE a hunt (o bônus
dos marcos multiplica a XP, DT-01), então precisa entrar na sessão e não só sair dela:

- **`api` lê a linha e põe no ticket**, VALIDADO (`isBestiaryState`, em `tickets.ts`, a mesma
  régua que o `consume` usa). Ao contrário das skills, chega tipado: a forma é um mapa de
  inteiros, e conferir isso não é conhecer domínio nenhum. Valor corrompido vira AUSENTE, nunca
  login recusado — a linha não tem CHECK. `null` na linha NÃO vira chave no ticket.
- **`createCitySessionFactory` põe no `CharacterState`**; ausente é `{}`, que é onde um
  personagem novo começa. A hunt é o mesmo objeto (transição), e o `sim` conta o abate.
- **O extrato leva o mapa ABSOLUTO** (`#saveReceipt`), e `parseReceipt` é lista de
  PERMISSÃO — campo que não entra nela some no caminho de volta sem erro nenhum, e o teste de
  ida e volta em `receipts.test.ts` é quem pega a omissão.
- **O ledger funde pelo MAIOR de cada monstro** (`Bestiary.merge`), na mesma transação de XP e
  gold. Abate nunca desce: um extrato antigo fora de ordem não rebaixa nada, sem guarda de
  instante. Extrato SEM o campo (Cidade, nó antigo em deploy) não toca na coluna — gravar
  `{}` por cima apagaria abates que ninguém pediu para apagar.

A mensagem `bestiary` é APRESENTAÇÃO, pelo mecanismo de `sentStats`: sai no `#sendState` e no
ciclo com visualizador quando a SOMA dos contadores mudou (`sentBestiary`, por personagem). A
soma basta porque abate só sobe — muda se, e só se, algum contador mudou. Sem ninguém olhando
não se compara nada; o `sim` conta de qualquer jeito (invariante 3). O catálogo leva
`monsters: [{ id, name }]` em ordem de id e `bestiary: { milestones, xpBonusPercentPerMilestone }`
só quando o conteúdo tem — o de teste não tem, e a chave fica AUSENTE, não `undefined`.

## A munição é item no slot; a coluna `characters.ammo` é dado morto (#152, #420)

A munição escolhida por família foi **revogada** (ADR 0032 decisão 7, AB-05): a escolha é o item
equipado no slot `ammo`, o `sim` a consome por tiro, e o opcode queimado do seletor por família
(opcode 14) e o campo `player-stats.ammo`/`catalogue.ammunition` não existem mais. O ticket não
carrega `ammo`, o extrato não tem `SessionReceipt.ammo`, e o ledger não lê nem escreve
`characters.ammo` — a coluna `jsonb` continua na tabela como **dado morto** até uma issue de
limpeza (ADR 0014: descartar dado persistido exige tratamento explícito, e um `DROP` em deploy em
rolagem apagaria a preferência de quem ainda não migrou). Equipar a pilha usa `move-item`/`equip`,
que já marcam o shard como `dirty` e viajam no layout do inventário. O projétil do tiro (`shot`)
continua resolvido em `#presentCombat` pela tabela: `appearances.ammunition[ammoId].missile` para
a flecha (o `ammoId` é o id do ITEM), `appearances.weapons[itemId].missile` para wand e rod; sem
linha, o tiro é mudo.

## A vocação é escrita UMA vez, pelo `jobs`; e o shard grava um extrato de ESTADO (#154)

`characters.vocation` é `text` nulável, nunca escrita pelo `game` (ADR 0026 decisão 1, ADR
0021): chega ao banco pelo extrato (`SessionReceipt.vocation`, lista de PERMISSÃO em
`parseReceipt`) e o ledger a grava com `coalesce(vocation, $1)` — um extrato fora de ordem com
outra vocação não sobrescreve. Volta pelo ticket (`InitialCharacter.vocation`, string não vazia
ou ausente), entra em `CharacterRuntime.vocationId` e nos stats de entrada (`statsForLevel` com
a vocação), e vai ao cliente em `player-stats.vocationId` e `session-state.self.vocationId`. A
escolha é `choose-vocation` (opcode 15), processada na chegada como `equip`; o host resolve a
vocação e a arma no conteúdo fixado (`vocations`, `vocationLevel`, `itemCatalog`) e o `sim`
decide (`chooseVocation`). A arma nasce com `instanceId` `${sessionId}:${characterId}:vocation`
— **com o id do personagem no meio**, porque numa cópia da Cidade dois personagens compartilham
`session.id` e `${sessionId}:${lootSeq}` colidiria na chave primária de `item_instance` — e
`origin: 'vocation-choice'`, que o ledger grava (`item.origin ?? 'loot'`).

**O shard não credita progresso, mas grava estado.** Antes de #154 a Cidade nunca gravava
extrato: `equip` e agora a vocação feitos na praça sumiam no logout. Agora cada
`HostedSession` de shard tem `dirty: Set<characterId>` — marcado por `equip`, `unequip`,
`move-item` e `choose-vocation` — e `release` (antes do `leave`) e `drainAll` gravam, para
quem está em `dirty`, um **extrato de estado durável**: agregados zerados, `vocation`,
`equipment`, `acquired`, `lootBox`, `seq` do `ledgerSeq` compartilhado da cópia. A linha de
ledger que o `jobs` insere tem `delta: 0` e é só a chave de idempotência. Quem não mexeu em
nada sai sem extrato. **Limite:** a Cidade não tem snapshot (ADR 0023) — nó que cai sem drenar
perde o que a praça mudou, como já perdia. `#creditUnrestorable` passou a levar `vocation`,
`equipment`, `acquired` e `lootBox` (o buraco de antes: item equipado numa sessão
irrestaurável se perdia).

## A party é formada no `api`, em Redis, e vira uma sessão de hunt com N donos (#195)

`PartyStore` (`party:{id}`, `:members` ZSET por instante de entrada, `:accounts`, `:invites`,
`:approved`, `:tickets`, `party:by-char:{characterId}`) é FORMULÁRIO, não estado quente — o
personagem está na Cidade, que é inerte. Rotas em `api/party.ts`: `POST /api/party`,
`/:id/invite` (`inviteeId`, porque `characterId` no corpo é o de QUEM fala), `/:id/join`
(script Lua: convidado, com vaga, em nenhuma outra), `/:id/leave` (líder que sai passa a
liderança ao mais antigo; sair desaprova todos), `/:id/propose` (só o líder; hunt e dificuldade
validadas pelo conteúdo), `/:id/approve`, `/:id/start`, `GET /api/party/mine`. O `start` faz
para N o que `POST /api/tickets` faz para um, nesta ORDEM: tudo o que recusa antes de reservar
(aprovação de todos, todos na Cidade pelo diretório, liquidação de cada um); um nó só,
resolvido pelo líder — o `consume` recusa ticket de nó errado; um ticket por membro com o
MESMO `sessionId` e o mesmo bloco `party` (`TicketClaim.party`, com o `initialCharacter` de
todos — montado por `initialCharacterOf`, o mesmo do ticket solo), e a falha do k-ésimo
`revoke`a os k−1 (não há script Lua entre N contas: as chaves são de contas diferentes); só
depois a party some e cada um pega o SEU ticket pelo `mine`, uma vez. No `game`, `prepare`
recebe o bloco: se `party.sessionId` já está hospedada, o membro só entra nela; senão a
`SessionFactory` cria a HUNT com os N (`partyHuntFor` em `sessions.ts`, bot de cada um
validado ali com o conteúdo) e o host registra o lease dos outros com a conta do ticket —
o membro que nunca conecta está na hunt do mesmo jeito (invariante 3).

O matchmaking (#199, §15.2) FORMA a party, não a inicia: `POST /api/matchmaking/join` põe o
personagem em `matchmaking:queue` (ZSET por instante) e casa NA HORA, num script Lua, com quem
já esperava — na faixa de level de `content.party.matchmakingLevelRange` (`0` é qualquer um),
livre de outra party, preferindo VOCAÇÕES DISTINTAS (é o que o bônus de XP premia) até
`maxMembers`, tirando os escolhidos da fila no mesmo passo. A party formada tem o mais antigo
como líder e segue o fluxo de sempre (propor, aprovar, iniciar). Uma party de dois se forma
no instante em que o segundo chega: esperar "encher" faria dois jogadores esperarem para
sempre, e o §15.2 admite começar com menos de quatro.

## A Caixa de Loot vive no Redis porque ela EXPIRA (FUN-88)

`lootbox:{sessionId}`, TTL de 30 minutos a partir do encerramento (§21.6). A escolha entre Redis
e Postgres não é sobre velocidade: **expirar precisa significar que o item nunca existiu.** Uma
linha em `item_instance` que ninguém consegue mais ver é pior que nenhuma — ela aparece em
consulta de proveniência, em soma de patrimônio, e em toda auditoria escrita depois.

Três coisas que não podem mudar sem pensar duas vezes:

- **A caixa é escrita pelo `game`, no encerramento**, e não pela varredura: o relógio começa
  quando a sessão acaba, e quem sabe disso é quem a encerrou. Deixar para o `jobs` faria o prazo
  começar até dez segundos depois, e por acaso.
- **Quem expira é o TTL, não o ciclo.** O `jobs` só publica `draconya_loot_boxes_pending`. Um
  contador de "expiradas" exigiria alguém observando o instante em que a chave some, e ninguém
  observa — ela some sozinha. O alerta útil é a pilha CRESCENDO.
- **O item da caixa ainda não é linha no banco.** Ele vira instância quando for resgatado.
  Criá-la antes tornaria a expiração um `DELETE` que some com item de jogador.

O prefixo `lootbox:` é distinto de `receipt:` e `receipts:char:` de propósito — pela mesma razão
que a FUN-56 registrou: o `SCAN` de uma varredura não pode pegar a chave da outra.

## Como testar

```
pnpm vitest run packages/server
```

**Da RAIZ do repositório, sempre.** De dentro do pacote, o vitest resolve `@draconya/*` pelo
`dist/` de cada pacote — o que foi compilado da última vez, não o que está no editor. Um teste
daqui que atravessa para o `sim` (toda hunt de verdade em `host.test.ts`) passa com o `sim`
velho e, pior, uma mutação aplicada no `sim` fica invisível para ele: o teste "mata" a
mutação sem nunca tê-la visto. Foi um achado de revisão, e é por isso que a disciplina de
mutação manda a linha de comando inteira, com o caminho a partir da raiz.

Testes de integração que importam: reanexar a uma sessão em andamento; matar o processo e recuperar
do snapshot; drenar em deploy e conferir o extrato; duas requisições simultâneas competindo pelo
terceiro slot de personagem.

**Arquivo que abre o Postgres se chama `*.postgres.test.ts`** (FUN-102). O nome é o que o põe no
projeto `postgres` do `vitest.config.ts` da raiz, onde esses arquivos rodam no máximo dois por
vez: cada um cria um schema e roda as migrações, e cinco deles ao mesmo tempo contra um Postgres
de uma CPU (o Docker da máquina de desenvolvimento) reprovava doze testes sortidos por timeout
com um jogo aberto ao lado. O resto da suíte continua em paralelo. `testing/database.test.ts`
reprova o arquivo que chama `connectTestDatabase` sem o sufixo — e o que tem o sufixo sem
chamar. O custo é a suíte inteira ir de 6,5 s para ~14 s: os dois critérios de saída levam
quatro e cinco segundos cada, e o grupo do Postgres termina antes de o outro começar.

## Armadilhas conhecidas

- **Um passo por vez, por personagem, no relógio do PROCESSO** (`#walkingUntil` em
  `host.ts`, FUN-122). A Cidade não tem relógio (`hz` 0) e o `move` do `sim` não sabe que horas
  são: sem esta trava no hospedeiro, um cliente mandando mil `walk` por segundo atravessaria a
  praça em meio segundo. O `walk` que chega antes de o passo anterior acabar é recusado em
  silêncio — o teclado do cliente repete no ritmo do passo, e o ritmo é daqui. Vale para
  TODA sessão, hunt inclusive: `#requestWalk` é a porta única do `walk`, e antes da trava a
  hunt também aceitava a rajada — o jogador andava mais rápido que a fórmula do Tibia. Teste
  que dá muitos passos em sequência precisa de um `now` que ande (a praça da FUN-33 avança o
  relógio a cada consulta).

- Ações do jogador são processadas **na chegada**, não enfileiradas para o tick. Enfileirar
  adiciona até 100 ms de jitter em cima do ping — irrelevante na hunt, fatal no PvP manual.
- `uWebSockets.js` vem do GitHub, e é declarado pela **URL de tarball com SHA**
  (`https://codeload.github.com/uNetworking/uWebSockets.js/tar.gz/<sha>`), não por `github:` —
  o Dependabot reescreve `github:` como `git+ssh` no lockfile e o CI, sem chave SSH, morre no
  `pnpm install` (#222, emenda no ADR 0013). Atualizar é trocar o SHA pelo da tag nova.
- `uWebSockets.js` não é a API do `ws`. Não presuma compatibilidade. O `HttpRequest` do
  `upgrade` só vale DURANTE o handler: qualquer header ou query que o caminho assíncrono vá
  usar precisa ser lido antes, e mexer na resposta depois de `onAborted` derruba o processo.
- **Teste que usa Redis escolhe um banco só seu** (`testing/redis.ts`). O Vitest roda arquivos
  em paralelo e `flushdb` é global: dois arquivos no mesmo banco passam sozinhos e falham
  juntos, de forma intermitente.
- **Prazo de Redis em fixture vem de `testing/deadlines.ts`, e é LONGO** (FUN-95). Nenhum teste
  daqui espera prazo vencer: a FUN-62 trocou espera por asserção do prazo gravado, e a expiração
  é provada apagando a chave na mão. O número, então, só precisa **sobreviver ao próprio teste** —
  e um lease de 120 ms não sobrevive. Sob carga, a suíte inteira reprovava dois a quatro testes
  DIFERENTES por execução, cada um passando sozinho; `testing/redis.test.ts` agora reprova quem
  escrever prazo abaixo do piso. Prazo curto de verdade é LÓGICO, e prazo lógico não vai ao
  Redis: passa pelo relógio injetado, que o teste controla.
- **A Cidade é UMA sessão com muitos personagens** (FUN-71, ADR 0023). `#sessions` é indexado por
  sessão e `#sessionIdByCharacter` por personagem: com o shard, N personagens apontam para o
  mesmo `HostedSession`. Todo caminho que fazia "esta sessão = este personagem" precisa escolher
  de qual dos dois está falando — `release`, `#replace`, `#collectResting`, `saveAll` e
  `drainAll` já escolheram, e o próximo também precisa.
- **`#createLocal` REAPROVEITA o `HostedSession` quando a sessão já está hospedada.** Montar um
  novo jogaria fora os visualizadores e os ids de criatura de quem já estava na praça — e o
  sintoma seria o primeiro jogador parar de receber tudo no instante em que o segundo entrasse.
- **`SessionBuilder` recebe o `characterId`, e não é redundante com a sessão de origem.** Com
  duzentas pessoas na praça, "quem está transicionando" viraria "todo mundo" — e como a hunt
  recusa o segundo participante, o sintoma é a transição falhar para todo mundo sempre que
  houver mais alguém lá.
- **Voltar para o shard APAGA o snapshot, não apenas deixa de gravar um novo.** Shard não tem
  snapshot (ADR 0023); se o da hunt encerrada ficar de pé, a próxima conexão retoma uma hunt já
  creditada. Antes da FUN-71, o `save` da Cidade cobria essa linha por acidente.
- **Repouso (FUN-52) é por PERSONAGEM.** Por sessão, um jogador com o navegador aberto seguraria
  a praça inteira na memória do nó para sempre.
- **Repouso é o estado SEM sessão hospedada** (ADR 0024). Recolhida a sessão de Cidade, o
  personagem continua na Cidade por `characters.state` — e some do diretório de sessões, porque
  não há sessão para aparecer. É por isso que "onde está este personagem" se pergunta à coluna,
  nunca ao diretório. O invariante 8 fala de ESTADO, e um estado ativo é que é sempre uma sessão.
- **No shard, "todos os visualizadores da sessão" está QUASE sempre errado** (FUN-33). O passo, o
  `creature-appear`, o `session-state` e o `say` vão para quem tem o tile no campo de visão —
  `hosted.aoi`. Quem escrever o próximo caminho de saída precisa escolher entre os dois, e o
  default seguro é o campo, não a sessão: mandar demais é O(N²) de volta, e o teste que pega isso
  é `o passo de quem está LONGE não chega`.
- **O id numérico de criatura NÃO é reciclado quando alguém sai de vista.** Sumir do campo é
  reversível; sair da sessão não. Reciclar no primeiro caso deixaria o sprite antigo parado para
  sempre na tela do cliente — e o id novo no reaparecimento não teria como apagá-lo.
- **Quem acabou de aparecer não recebe o passo daquele mesmo instante.** O `creature-appear` já
  leva a posição de chegada; mandar o `creature-move` junto faria o cliente animar uma caminhada
  a partir de um tile em que a criatura nunca esteve, para ele.
- **A AOI só existe no shard.** Numa hunt de um personagem ela seria índice para nada, no caminho
  quente das 5.000 instâncias que a FUN-46 mediu.
- **`sentStats` guarda o que foi ENTREGUE, nunca o que foi calculado** (FUN-109). O
  `player-stats` ao vivo sai da comparação campo a campo entre os vitais de agora e os últimos
  que algum visualizador recebeu — no `session-attach` e no ciclo com visualizador. Sem
  ninguém olhando não se compara nada: a comparação é apresentação, e o `sim` muda o que tem
  de mudar de qualquer jeito (invariante 3). Escrever `sentStats` num ciclo sem visualizador
  faria quem reanexa perder a primeira mudança depois do estado. E a comparação é campo a campo, hoje doze — a lista muda com qualquer SV-nn que acrescente algo a player-stats: comparar só a vida deixa a mana gasta numa magia fora do HUD, e o teste de mana em
  `host.test.ts` é quem pega. **A stamina é comparada no MINUTO**, não no milissegundo: o
  `sim` a queima a cada evento que vence (as regras de saída, a cada 250 ms), então
  `staminaMs` muda em TODO ciclo anexado, e a comparação exata mandava um `player-stats` por
  ciclo — 482 em 120 s medidos, mais que `creature-move`. O HUD mostra horas e minutos, e o
  valor entregue continua em milissegundos; só o gatilho arredonda. O herói do helper da
  FUN-109 tem stamina justamente para o teste de "ciclo sem mudança" queimar como a produção.
- **`sentAnalyzer` é o mesmo mecanismo para o analisador** (FUN-110), por PERSONAGEM desde o
  #196 — os agregados são de cada participante (#187), e quem olha um membro da party vê os
  dele, não a soma; em solo é um só. `session-state.aggregates` também é dele. A party vai no
  fio por três mensagens S2C (`party-state` no attach e na mudança de composição, `party-bag`
  a cada item, `party-settlement` ao sair e no fim) e pelo bloco `party`/`partyBag` do
  `session-state`, montado por `#partyBlock` do estado do ruleset — a capacidade da bolsa é a
  soma dos PRESENTES agora, não a do snapshot. Compara nove agregados e a contagem de eventos notáveis,
  e `durationMs` fica de fora pela mesma razão da stamina: muda em todo ciclo. Até a FUN-110
  os agregados só saíam no `session-state` e no `session-ended`, e a janela ficava em zero a
  hunt inteira — três abates, level 2, gold no HUD, e "Mortos 0" — porque `docs/product` e o
  `Analyzer.tsx` diziam que "os deltas chegam pelo lote do ciclo" e nenhuma mensagem os levava.
- **Combate e vida do personagem vão para TODOS os visualizadores da sessão** (FUN-109), pela
  mesma decisão de `#presentPresence`: combate só existe em hunt, e hunt é privada. Magia ou
  supply sem linha na tabela de aparências é MUDO, não erro — `buildContent` só exige que toda
  linha aponte para algo que existe, não o contrário; uma magia nova sem arte ainda bate, e o
  número e a barra provam. Golpe em criatura sem id numérico (nasceu sem ninguém olhando, e o
  cliente ainda não pediu o `session-state`) é descartado, não mandado com id inventado.
- **A ability de monstro resolve a arte por CHAVE SEMÂNTICA** (CMB-06). O `sim` emite
  `monster-ability-cast` com `missileKey`/`impactKey` — nunca um id de arte (invariante 6) —, e
  `#presentCombat` os resolve em `appearances.abilities`: o projétil sai do monstro ao primeiro
  alvo, e o efeito de impacto em cada alvo/tile. Chave sem linha é MUDA, não erro: a mecânica
  (dano, morte, atribuição) já aconteceu no `sim`. O golpe da ability chega como `creature-hit`
  com `kind: 'spell'`; a básica legada continua `melee` com o sangue de `hits.melee`.
- **O herói "level 8 com XP zero" do helper da FUN-103 é inconsistente, e a mana some no
  primeiro abate.** `grantXp` recalcula o level a partir da XP acumulada (zero → 1) e devolve os
  máximos à tabela de progressão — cuja mana inicial de teste é zero. Para golpe não faz
  diferença; para uma hunt que precisa lançar magia, o bot nunca tem com quê. O helper da
  FUN-109 nasce no level 1, com os máximos de `statsForLevel(1)` e uma progressão de teste com
  `startingMana` alto — e é ele que se copia para o próximo teste com magia.

## Testes de autenticação e admissão

`TEST_REDIS_URL` deve apontar para um Redis descartável; os bancos listados em `testing/redis.ts`
são apagados pelos testes — hoje 1 a 15, e a lista é verificada, não confiada.
`DATABASE_TEST_URL` aponta para Postgres de teste, com um schema exclusivo por suíte. O CI
fornece os dois. Ver ADR 0017 para a ordem Postgres → Redis e separação entre sessão HTTP,
`state` e ticket. Nenhum vínculo de conta é decidido somente por e-mail.
