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

Personagem nasce sem vocação, com Coins fora dele (na conta) e Premium por personagem. Nomes são
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

Para achar o extrato daquele personagem sem varrer o keyspace inteiro a cada login, o
`ReceiptStore` mantém `receipts:char:{characterId}` ao lado de `receipt:{sessionId}`. **Os dois
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

## O critério de saída da Fase 1 (FUN-44)

`src/api/phase-one-exit.test.ts` roda o roteiro inteiro com socket, Postgres e Redis de verdade:
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

## A configuração do bot é a ÚNICA escrita de banco do `game` (FUN-81, ADR 0021)

Até aqui a divisão era limpa: `api` e `jobs` falam com o Postgres, o `game` não. A configuração
do bot quebra isso — ela é dado durável do personagem **e** é editada com o jogador conectado,
e quem tem a conexão é o `game`.

O que a mantém segura, e o que não pode mudar sem pensar duas vezes:

- **Uma instrução, sem `SELECT` antes.** "O jogador salvou isto" é última-escrita-vence por
  natureza: a configuração é substituída inteira, nunca mesclada. Sem read-modify-write não há
  corrida entre duas abas do mesmo jogador.
- **Não participa da trava de linha** da emissão de ticket nem da exclusão (FUN-53): não abre
  transação, não segura a linha, não depende de nada que esteja nela.
- **O `game` não recebe o repositório nem o `Content`** — recebe `saveBotConfig` e
  `acceptBotConfig`, funções estreitas, do mesmo jeito que o `api` recebe `settleProgress`.
- **A ordem é aceitar → aplicar → persistir.** Aplicar antes de gravar faz a hunt em curso usar a
  regra nova na hora; falhar ao gravar não desfaz o que já vale. Há teste afirmando isso.
- **Sem banco configurado o `game` roda igual**, e a configuração vale na sessão e some no
  logout. Degradação, não falha.

O caminho de LEITURA é outro e não se cruza com este: a configuração chega pelo **ticket**, que
o `api` monta lendo a linha — mesmo caminho de level, XP e gold, e pela mesma razão (invariante 4).

Se um dia aparecer uma segunda escrita no `game`, o ADR 0021 deixa de valer como precedente:
duas escritas já são um repositório, e aí a pergunta é se a divisão de processos ainda descreve
o sistema.

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

Testes de integração que importam: reanexar a uma sessão em andamento; matar o processo e recuperar
do snapshot; drenar em deploy e conferir o extrato; duas requisições simultâneas competindo pelo
terceiro slot de personagem.

## Armadilhas conhecidas

- Ações do jogador são processadas **na chegada**, não enfileiradas para o tick. Enfileirar
  adiciona até 100 ms de jitter em cima do ping — irrelevante na hunt, fatal no PvP manual.
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

## Testes de autenticação e admissão

`TEST_REDIS_URL` deve apontar para um Redis descartável; os bancos listados em `testing/redis.ts`
são apagados pelos testes — hoje 1 a 10, e a lista é verificada, não confiada.
`DATABASE_TEST_URL` aponta para Postgres de teste, com um schema exclusivo por suíte. O CI
fornece os dois. Ver ADR 0017 para a ordem Postgres → Redis e separação entre sessão HTTP,
`state` e ticket. Nenhum vínculo de conta é decidido somente por e-mail.