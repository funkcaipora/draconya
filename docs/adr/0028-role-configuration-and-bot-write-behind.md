# 0028 — Configuração por papel e persistência do bot sem Postgres no `game`

**Status:** aceito
**Data:** 2026-09-16
**Contexto técnico:** `server` — boot e preferências de personagem; issue #263

## Contexto

`main.ts` só abria Postgres para `api/jobs`, mas `loadConfiguration` exigia `DATABASE_URL`
e credenciais WorkOS de todos os papéis. O `game` separado precisava receber segredos que
não usava e, pior, não recebia `saveBotConfig`: a configuração editada no socket não voltava
na próxima sessão. O modo solo escondia essa diferença.

O [ADR 0021](0021-the-game-process-writes-the-bot-configuration.md) autorizava uma escrita
estreita de Postgres pelo `game`. Esta decisão **substitui essa autorização e o mecanismo de
persistência**, preservando o socket como entrada, a validação pelo conteúdo da sessão e
a aplicação imediata pela sessão dona.

## Decisão

1. `config.ts` resolve `PROCESSES` antes dos requisitos de ambiente, usando exclusivamente
   o objeto de ambiente recebido. Ausente significa `api,game,jobs`; papel desconhecido,
   lista vazia, duplicata e `PROCESSOS` legado recusam o boot. `main.ts` usa essa seleção.
2. Redis é obrigatório para todos; Postgres para `api/jobs`; WorkOS e origens HTTPS para
   `api` em produção. `AUTH_DEV_MODE=true` continua proibido em qualquer processo de produção.
   O endereço anunciado pelo `game` admite apenas `ws/wss`, sem credenciais, query ou
   fragmento; em produção exige `wss`. Caminho e origem não são fixados no runtime, pois
   cada nó pode ter um endereço próprio. O deploy Coolify continua exigindo sua origem e `/ws`.
3. `THINGS_DIR` sai do schema do servidor. As ferramentas continuam lendo essa variável;
   `THINGS_VERSION` continua sendo a conferência de compatibilidade no boot.
4. O `game` aceita e aplica o bot, então escreve uma pendência no hash Redis
   `bot-config:pending`, campo `characterId`, valor `{ id, config }`. O `id` é um UUID por
   edição, inclusive quando o conteúdo é idêntico. Não há TTL. `ok: true` só sai depois
   dessa escrita; não significa que o Postgres já recebeu a preferência.
5. `jobs` processa as pendências no ciclo existente. O `api` executa a mesma gravação
   antes de liquidar progresso e emitir tickets solo/party, ou atualizar a lista de personagens.
   Assim, reconectar antes do próximo ciclo não recupera o bot antigo. Falha recusa a admissão,
   como já acontece com progresso não liquidado.
6. O consumidor trava a linha do personagem, **depois** lê a pendência atual do Redis e
   substitui `bot_config` na transação. Só após o commit confirma a pendência com comparação
   e remoção atômicas no Redis. A ordem serializa `api/jobs`; a comparação protege uma edição
   recebida durante o commit. Uma queda entre commit e confirmação repete a substituição,
   sem repetir movimentação econômica. Personagem inexistente ou excluído não é atualizado.

## Alternativas descartadas

- **Dar Postgres ao `game`:** cumpriria o ADR anterior, mas manteria a dependência que esta
  correção precisa retirar. A preferência não precisa de uma conexão de banco no nó de simulação.
- **Salvar somente no Redis:** retiraria o Postgres como armazenamento durável de preferências.
  Aqui o Redis guarda apenas a pendência; a coluna existente permanece a verdade durável.
- **Esperar o logout/extrato:** perderia a edição em queda da Cidade, que não tem snapshot,
  e deixaria a preferência sem gravação por toda a duração de uma hunt.
- **Fila com todas as edições e timestamp de parede:** faria crescer uma fila de substituições
  já superadas e precisaria ordenar relógios de nós. Uma pendência por personagem e a trava de
  linha resolvem o caso sem migration nem nova coluna de versão.
- **Ler Redis antes de travar a linha:** permite que um consumidor atrasado grave uma edição
  anterior depois de outro já ter gravado a nova. A trava precisa proteger leitura e escrita.

## Consequências

- Modo solo e papéis separados usam exatamente o mesmo caminho. O `game` não precisa de
  Postgres nem WorkOS; nenhuma dependência nova ou alteração do protocolo/schema é necessária.
- A preferência tem uma janela de persistência eventual: em condições normais, o próximo
  ciclo de `jobs` (10 s), ou a próxima admissão, a leva ao Postgres. Não é um prazo garantido
  quando um serviço falha. Redis perdido antes disso pode perder a pendência; AOF e backup
  continuam necessários. A confirmação ao jogador significa aceitação no Redis.
- Redis fora do ar mantém a regra ativa na sessão e devolve falha de salvamento com orientação
  de retry. Postgres fora do ar mantém a pendência para nova tentativa. Conteúdo já gravado
  continua sendo validado pelo conteúdo fixado da sessão ao ser adotado.
- A transação segura uma linha enquanto faz um `HGET` no Redis. É uma operação por edição ou
  admissão, fora do tick, com os timeouts da conexão Redis do boot. A varredura continua
  serializada por personagem e o singleton do `jobs` permanece obrigatório em produção.
- Durante a implantação, subir os consumidores novos (`api/jobs`) antes dos produtores
  (`game`). Para rollback, drenar os produtores e processar pendências com consumidores desta
  versão antes de restaurar a versão antiga. Nunca apagar o hash como forma de rollback.

## Invariantes afetados

- **1 e 2:** `sim/` permanece puro; nenhum I/O ou cálculo por tick é introduzido.
- **4 e 9:** o cliente manda a intenção, a sessão dona valida/aplica; os consumidores só
  escrevem a preferência durável e nunca tocam `CharacterRuntime`.
- **7:** validação usa o conteúdo já fixado da sessão; o consumidor não reinterpreta domínio.
- **10:** não há movimento de valor nesta fila. O ledger e sua idempotência não mudam.

Nenhum dos onze invariantes é alterado. Contrato operacional e matriz de configuração em
[`runtime-configuration.md`](../runtime-configuration.md).
