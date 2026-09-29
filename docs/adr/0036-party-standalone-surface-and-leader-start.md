# 0036 — Party como superfície própria: fim da aprovação pré-start, sala com composição por vocação e convite social

**Status:** aceito — emenda ao [ADR 0027](0027-party-hunt-one-session-many-owners.md) (decisão 8) e ao [ADR 0029](0029-client-design-system-and-fixed-shell.md) (decisão 6, parte do acoplamento); estende a decisão 7 do [ADR 0035](0035-party-v2-runtime-settings-shared-bag-and-live-join.md)
**Data:** 2026-09-20
**Contexto técnico:** `packages/server` (`api/party`, `party-store` — sala, filtro, Lua de vaga, convite social), `packages/client` (`shell/PartyModal`, `shell/PartyActions`, `shell/HuntsModal`, `shell/party-start.ts`, `party/{api,store}.ts`). Sistemas: party, UX do cliente. Nada em `packages/sim`, `packages/protocol` nem `packages/content`.
**Issues:** #501 (servidor), #502 (convite social na Social), #503 (superfície do cliente), #504 (esta documentação).

## Contexto

O ADR 0027 (decisão 8) fixou o fluxo de formação herdado do PRD §15.2 — propor → **aprovar** →
iniciar — e o ADR 0029 (decisão 6) acoplou a formação ao modal de escolha de caçada ("propor uma
hunt É escolher uma hunt", o `PartyPanel` preso ao `HuntsModal` como coluna dele). Três coisas
que o jogo ganhou desde então fizeram as duas decisões envelhecer juntas:

- **A aprovação não decide nada.** O início é uma decisão do LÍDER (rota `/start`, 403 `not-leader`
  para os outros); a "aprovação" dos membros era um clique ritual sobre um botão que o servidor
  nunca precisaria ler. Com dois membros — o caso de quase toda party —, "todos aprovaram" é o
  líder aprovando para destravar o próprio botão. O estado extra (`approved` em `PartyRecord`,
  chave `party:{id}:approved`, trocar a proposta zerando aprovações) existia só para sustentar a
  cerimônia, e mentia sobre quem decide — o mesmo defeito de "estado de espera" que a DT-07 da
  #503 eliminou do cliente.
- **A coluna de formação dentro do modal de caçadas deixou de ser o caminho natural.** Sem party,
  o jogador tinha de abrir "Escolha uma caçada" para criar uma; com party, gerenciar significava
  reabrir o modal de hunts. A party ganhou vida própria desde o M20 (sala pública, entrada em
  curso, convites pela Social) — ela é um destino, não um anexo de outra tela.
- **A sala pública com faixa de level (`publish { minLevel, maxLevel }`, ADR 0035 d.7) não descreve
  o que uma party de fato quer: COMPOSIÇÃO.** O que o candidato precisa saber é se sobra vaga para
  a vocação DELE — "cavaleiro ×2 · paladino ×1" —, e o `maxLevel` era um número morto que nenhuma
  regra usava. E o candidato sem party nenhuma não tinha convite para aceitar: a formação social
  exigia criar uma party vazia primeiro.

## Decisão

1. **A party tem superfície própria.** O `PartyModal` (um modal, três views internas — `home`
   Criar/Buscar, `mine` roster e configuração do líder, `search` salas) é a formação; o
   `PartyPanel` é aposentado. UMA instância no `Shell`, aberta por TRÊS pontos: a pill permanente
   "Party" (`PartyActions`, na Cidade e na hunt), a engrenagem de `PartyMembers` e o botão
   "Encontrar Party" do `HuntsModal` — que fica SEM coluna de formação e com as duas pontes
   ("Encontrar Party" e "Iniciar com o time"). A view inicial e o filtro de hunt nascem dos props
   a cada montagem; a navegação interna nunca mora na store (ADR 0007).
2. **Fim da aprovação pré-start.** O líder configura (`POST /api/party/:id/configure`, patch
   parcial: `huntId`, `difficulty`, `minLevel`, `vocationTargets`, `shareCosts`, `splitLoot` — cada
   eixo muda sozinho) e inicia (`/start`) sem estado de aprovação: rota `/approve`,
   `PartyStore.approve`, chave `:approved` e campo `approved` removidos. `/propose` sobrevive como
   shim da MESMA escrita de `/configure` até o cliente antigo sumir do deploy. No cliente, "Iniciar
   com o time" (`shell/party-start.ts`) é configure-then-start, e nenhum caminho manda
   `enter-hunt` solo.
3. **A sala pública é descrita por composição.** `vocationTargets` é o TOTAL desejado por vocação
   (incluindo quem já está; chaves do catálogo ∪ `none`; soma ≤ `maxMembers` do conteúdo — recusa
   `composition-too-large`/`unknown-vocation`). `publish` NÃO tem corpo: publica o estado que o
   `configure` gravou, validando caçada + dificuldade (`nothing-proposed`), `minLevel ≥ 1`
   (`not-configured`) e ≥ 1 vaga pública (`no-vocation-slot`); `unpublish` fecha vagas sem
   desfazer. `GET /api/party/rooms?characterId&huntId?` FILTRA NO SERVIDOR pelo candidato —
   publicada, `level ≥ minLevel`, lotação viva e vaga aberta para a vocação dele — e devolve
   `RoomView` com `vocationTargets`/`openSlots`; `maxLevel` sai do contrato (lido, nunca escrito).
   O `join` é a autoridade final: o script Lua reconfere a vaga no mesmo passo, contando os
   membros no hash novo `party:{id}:vocations` (characterId → vocação) — dois joins concorrentes
   pela última vaga da mesma vocação produzem um `no-vocation-slot`. Convidado passa livre dos
   filtros públicos. O join em curso RESERVA a vaga antes de emitir o ticket e faz rollback
   (`releaseSlot` + revogação) se a emissão falhar.
4. **Convite social, e todo convite é da Cidade.** `POST /api/party/invites/social` não exige
   party; o aceite (`POST /api/party/invites/social/:inviteId/accept`) resolve em UM script Lua —
   usar a party do convidador (caso A), criar uma com ele de líder (caso B) ou recusar tipado —
   e é race-safe por construção: dois aceites não criam duas parties. Convite tradicional e
   social têm a MESMA régua de convidador: FORA de hunt (`inviter-in-hunt`), lida pelo diretório
   (`locateSession`), nunca pela coluna `characters.state`. Convites sociais expiram em 15 min
   (`SOCIAL_INVITE_TTL_MS`) e chegam no mesmo `invites[]` do `/mine` — polling único do `Shell`.

## Alternativas

- **Manter a aprovação e só mover a tela** — a aprovação continuaria cerimônia; mover o cenário
  não conserta o Estado que mente sobre quem decide.
- **Manter a formação no modal de caçadas, como uma coluna nova ao lado do detalhe** — três
  colunas num modal de escolha de hunt, e o gerenciamento durante a hunt voltaria a exigir abrir
  o modal de hunts. A party é destino próprio desde o M20.
- **`maxLevel` no lugar da composição** — o servidor já recusa por level no `join`; a faixa de
  cima nunca foi regra de ninguém, e "level 30–40" não diz se sobra vaga para paladino.
- **Validar a vaga por vocação fora do Lua** (contar antes, inserir depois) — TOCTOU: dois joins
  concorrentes contam o mesmo vazio e entram juntos. O `HVALS` dentro do script é o que serializa.
- **Criar a party no envio do convite social** (em vez de no aceite) — cria party vazia para
  convidador que desistiu, e o aceite teria de conciliar a party que o líder criou no meio. O
  aceite é o momento em que a party passa a existir — e o script resolve os dois casos atômicos.
- **Ler "em hunt" da coluna `characters.state`** — coluna não escrita por ninguém
  (`api/characters.ts`); "mentira quieta". O diretório é quem sabe onde o personagem está.

## Consequências

- `packages/server`: `/configure` (patch parcial, validado por conteúdo), `/publish` sem corpo,
  `/rooms` com query e filtro, hash `party:{id}:vocations`, `reserveSlot`/`releaseSlot` com
  rollback no join em curso, `/approve` removida, `/propose` shim, rotas sociais e os erros
  tipados (`room-not-eligible`, `no-vocation-slot`, `inviter-in-hunt`, `inviter-unavailable`,
  `invite-expired`, `invite-not-found`, `composition-too-large`, `unknown-vocation`).
- `packages/client`: `PartyPanel` aposentado; `PartyModal` com views e `huntFilter`;
  `PartyActions` (pill permanente); `party-start.ts` e o botão "Iniciar com o time";
  `REFUSAL` com as frases dos erros novos; polling de `/mine` único no `Shell` (o de salas só
  com a busca montada).
- `docs`: `docs/product/party.md` reescrito nas seções de fluxo e sala; `docs/design-system-plan.md`
  emendado com nota (D6 e DS-16); status lines do 0027, 0029 e 0035 atualizadas.
- O que piora: o membro perde o gesto de "aceitar a proposta" — o que ele não perde é poder:
  quem decide já era o líder, e sair da party continua livre a qualquer momento. O líder perde o
  freio social do "todo mundo confirmou" — compensado por configure-then-start explícito ("Iniciar
  com o time" diz o que vai acontecer). O hash `:vocations` é uma escrita a mais por join/leave
  e um `HVALS` por join e por sala listada.

## Invariantes afetados

Nenhum muda de texto. O **4** é o motivo do desenho: configure/publish/join/invites são intenções,
e o FILTRO da busca é do servidor — validação de UI (soma, pré-requisitos de publish) é
conveniência, não segurança; o `join` reconfere tudo, inclusive dentro do Lua. O **8** é
preservado pela régua de convidador fora de hunt (a Cidade continua o estado sem sessão; quem
caça não é o ponto de partida de nenhuma party) e pelo aceite atômico — um personagem em no
máximo uma party, dois aceites não criam duas. O **9** fica intacto: `vocationTargets`,
`:vocations` e a reserva são roster de FORMULÁRIO em Redis — nunca `CharacterRuntime`; a sessão
continua a única escritora dos N (`session.enter` no ciclo do host). O **5** fica intacto:
formação é HTTP; nenhum opcode novo.
