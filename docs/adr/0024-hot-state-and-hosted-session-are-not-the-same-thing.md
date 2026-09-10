# 0024 — Estado quente e sessão hospedada não são a mesma coisa

**Status:** aceito
**Data:** 2026-09-10
**Contexto técnico:** invariantes 8 e 9; `server` (processo `game`, processo `api`, processo `jobs`)

## Contexto

Dois invariantes passaram a prometer mais do que o código entrega. Os dois casos vieram de
mudanças que estão certas; o que ficou errado foi o texto.

**O invariante 8** dizia: *"todo personagem está sempre em exatamente uma sessão, cidade
inclusive"*. A FUN-52 recolhe a sessão de Cidade depois de cinco minutos sem visualizador, e o
personagem fica sem sessão hospedada nenhuma. Ele continua na Cidade — pela coluna
`characters.state`, e a API reporta assim —, mas "uma sessão" deixou de ser verdade na letra.

**O invariante 9** dizia: *"estado quente só é escrito pela sessão dona; nenhum outro processo
toca"*, com o porquê *"não precisa de lock adicional porque nunca há duas fontes de escrita ao
mesmo tempo"*. A FUN-56 fez `POST /api/tickets` liquidar o extrato pendente antes de ler a linha
do personagem, para que reconectar dentro da janela do `jobs` não mostrasse XP e gold menores do
que são. Com isso, quem escreve `character.xp`, `gold`, `level` e `staminaMs` passou a ser
`{jobs, api}` — duas fontes, separadas por `SELECT … FOR UPDATE` e pela `UNIQUE (session_id,
seq)`. Que é, literalmente, o "lock adicional" que o invariante dizia não precisar.

As duas mudanças foram registradas como pendentes de contestação na FUN-57, em vez de corrigidas
em silêncio. Esta é a contestação resolvida.

## Decisão

**A fronteira não é "sessão", é "quente".** Os dois invariantes passam a dizer isso.

**Invariante 8** — todo personagem está sempre em exatamente um **estado**, e um estado ATIVO é
sempre exatamente uma sessão hospedada. Repouso é o estado sem sessão.

O que o invariante existe para garantir continua inteiro, porque a garantia nunca foi sobre
sessões: era *"não existe lugar onde o personagem esteja em dois estados ao mesmo tempo"*. Um
personagem em repouso é uma linha em `characters.state`. Uma linha não é ambígua.

**Invariante 9** — estado **quente** só é escrito pela sessão dona, e isso não tem exceção: o
`CharacterRuntime` em memória tem um dono, sempre. A linha do Postgres **não é estado quente**;
ela é durável, e é escrita por `jobs` e por `api`.

## Alternativas

- **Manter a letra do invariante 8** e nunca recolher a sessão de Cidade. Descartada: cada
  personagem parado seguraria um slot de nó para sempre, e a Cidade — que não simula nada (§37)
  — viraria a maior consumidora de recurso do servidor. É exatamente o que a FUN-52 evitou.
- **Reverter a FUN-56**, com só o `jobs` escrevendo a linha. Descartada: devolve o defeito que
  ela corrigiu — reconectar dentro da janela do `jobs` mostra o personagem com progresso zerado,
  e o jogador vê XP e gold andarem para trás.
- **Deixar o texto como estava.** Descartada pela regra que o próprio `AGENTS.md` impõe: mudança
  que toca os onze invariantes atualiza o arquivo no mesmo commit. Um norte que não bate com o
  código para de ser consultado — e começa a ser contornado, que é pior que não existir.
- **Escrever a linha do Postgres só pela sessão dona**, com o `api` esperando o `jobs`.
  Descartada: o extrato só existe DEPOIS que a sessão dona acabou. Não há dono para esperar.

## Consequências

- **A separação quente/durável passa a ser explícita**, e é ela que responde a próxima pergunta
  desta forma quando aparecer. O critério: se dois processos podem escrever, aquilo não é quente.
- **O lock deixa de ser exceção e vira mecanismo declarado.** A trava de linha e a chave única
  não foram acrescentadas para a FUN-56 — elas existiam por causa do invariante 10, e a FUN-56 se
  apoiou nelas. O que muda é o invariante 9 parar de afirmar que elas são desnecessárias.
- **O invariante 9 fica mais forte no que importa**, não mais fraco: antes ele misturava duas
  garantias de força diferente numa frase só, e a mais fraca contaminava a leitura da mais forte.
- **Repouso sem sessão é observável**, e alguém vai tropeçar nisso: um personagem em repouso não
  aparece no diretório de sessões. É o comportamento certo — não há sessão para aparecer — e é
  por isso que a consulta de estado é a coluna, nunca o diretório.
- Nenhuma mudança de comportamento em runtime. Este ADR é texto alcançando o código.

## Emenda de escopo — a liquidação rodava antes da posse, em DOIS lugares

Em `POST /api/tickets` a liquidação roda antes da checagem de posse porque precisa da trava de
linha e a checagem já a segura. O efeito: uma conta autenticada dispara a liquidação de um
personagem que não é dela — sem mudar valor nenhum, sem receber nada de volta, e sem descobrir
nada sobre ele, mas escrevendo no ledger e na linha de outra conta.

**A auditoria de conformidade desta entrega achou a mesma forma num segundo lugar**, que a
FUN-57 não mencionava: `POST /api/characters/:id/select` liquidava o id do path antes do
`getCharacter(accountId, …)` da linha seguinte. Ali não valia nem o argumento da trava — não há
transação em jogo, e a checagem estava a uma linha de distância.

As duas foram fechadas junto com este ADR. O argumento de que "custaria uma consulta a mais em
todo login" não se sustenta contra o que a fresta é — ação sobre dado de outra conta, num endpoint
autenticado — e nem contra o preço real:

- no ticket, é um lookup por chave primária, mais barato que o `SCAN` do `resolveNode` que já
  roda ao lado;
- no `select`, o caso comum continua sendo **uma** consulta ao Postgres, porque a releitura só
  acontece quando a liquidação escreveu alguma coisa. Quem paga a segunda leitura é quem tinha
  progresso a receber.

Que a segunda instância só tenha aparecido na auditoria é o argumento a favor de rodá-la: a
primeira estava documentada, discutida e registrada numa issue, e a irmã dela a dez arquivos de
distância não estava em lugar nenhum.

## Invariantes afetados

8 e 9 — o texto dos dois, nesta mesma entrega. Nenhuma garantia removida.
