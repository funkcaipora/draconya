# 0021 — O processo `game` escreve a configuração do bot

**Status:** aceito
**Data:** 2026-09-10
**Contexto técnico:** `server` — divisão de responsabilidade entre `api`, `game` e `jobs`

## Contexto

Até a FUN-81 a divisão era limpa e fácil de descrever: **o `api` e o `jobs` falam com o Postgres,
o `game` não.** O `game` só conhece Redis — diretório de sessão, ticket, snapshot, extrato — e
essa fronteira é o que sustenta a regra do `AGENTS.md` do pacote: *"nenhuma leitura ou escrita de
banco no caminho crítico de uma ação"*.

A configuração do bot quebra essa arrumação, e quebra dos dois lados:

- ela é **dado durável do personagem**: o jogador a monta uma vez e ela vale nas hunts seguintes,
  inclusive depois de fechar o navegador. Isso é linha de Postgres;
- ela é **editada com o jogador conectado**, e quem tem a conexão e a sessão é o `game`. O §13
  descreve o jogador ajustando a cura enquanto caça, não abrindo outra tela.

A FUN-57 §6 deixou o critério: *não criar um segundo caminho de escrita da linha do personagem
sem necessidade.* A pergunta é se existe necessidade.

## Decisão

**A escrita vai pelo socket, e o `game` ganha uma escrita de banco — uma só, estreita e
injetada. A leitura continua sendo do `api`, pelo ticket.**

| | quem | como |
|---|---|---|
| escrever | `game` | mensagem `bot-config` no socket → `UPDATE character SET bot_config` |
| ler | `api` | lê a linha na emissão do ticket, e a configuração viaja em `InitialCharacter` |

O `game` não recebe o repositório: recebe a função `saveBotConfig(characterId, config)`, do mesmo
jeito que o `api` recebe `settleProgress`. E não recebe o `Content`: recebe
`acceptBotConfig(raw, level)`, que julga vocabulário, slots, catálogo e gate de level. Quem cuida
de socket não precisa conhecer balanceamento.

## Alternativas descartadas

**Rota HTTP no `api`, e o `game` lê o valor de algum lugar.** É a que preserva o writer único, e
foi a primeira escolha até a conta fechar. O problema não é a escrita, é a **propagação**: o
`game` precisa do valor para compilar a hunt e para aplicar a edição na hunt em curso, e sem
Postgres ele teria que saber por pub/sub ou por polling. Trocar uma escrita de uma instrução por
um mecanismo distribuído novo é pagar mais caro pela mesma arrumação. Além disso o cliente
passaria a precisar de sessão HTTP viva para uma ação de jogo, tendo o socket aberto na frente.

**Guardar a configuração no Redis.** Resolve a propagação e não resolve a durabilidade: Redis é a
camada quente do projeto, e uma configuração que some com um `flushdb` é uma configuração que o
jogador vai remontar.

**Passar a configuração dentro da mensagem `enter-hunt`.** Faria o cliente ser a fonte da
configuração a cada entrada — e o cliente é justamente quem não pode ser fonte de nada
(invariante 4). Um cliente modificado entraria com um bot que o servidor nunca aceitou.

## Consequências

**O que fica seguro por construção:**

- A escrita é uma instrução, sem `SELECT` antes. "O jogador salvou isto" é última-escrita-vence
  por natureza — a configuração é substituída inteira, nunca mesclada —, então não há
  read-modify-write e não há corrida entre duas abas do mesmo jogador para resolver.
- Ela **não** participa da trava de linha da emissão de ticket e da exclusão de personagem
  (FUN-53): não abre transação, não segura a linha, e não depende de nada que esteja nela.
- Não é caminho crítico de tick. É uma ação rara do jogador — algumas por sessão —, não um
  vencimento de evento.

**O que muda de verdade:** o `game` passa a ter uma dependência de Postgres, e um `game` montado
sem banco (o teste, o modo autônomo) precisa continuar funcionando. Ele funciona: sem
`saveBotConfig` a configuração vale na sessão e some no logout, e o log diz. Degradação, não
falha.

**A ordem dentro do handler é aceitar → aplicar → persistir**, e ela é decisão. Aplicar antes de
gravar faz a hunt em curso usar a regra nova na hora, e uma falha do Postgres não deixa o jogador
sem a cura que acabou de configurar. O preço é uma configuração que vale nesta sessão e não volta
na próxima; é o lado certo para errar, e há teste afirmando isso.

**Se um dia o `game` precisar de uma segunda escrita**, este ADR deixa de valer como precedente e
a conversa é outra: duas escritas já são um repositório, e aí a pergunta passa a ser se a divisão
de processos ainda descreve o sistema.
