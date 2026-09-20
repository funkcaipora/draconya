# 0035 — Party v2: eixos mutáveis, bolsa com reserva e elegibilidade, entrada em curso e bot cooperativo

**Status:** aceito
**Data:** 2026-09-18
**Contexto técnico:** `packages/sim` (`party.ts`, `rulesets/hunt.ts`, `session.ts`, `casting.ts`,
`bot.ts`), `packages/content` (`party/`, `spells/`, `supplies/`, vocabulário do bot),
`packages/protocol` (opcodes novos de intenção e de follow, `party-state`/`party-bag`/`party-settlement`/`analyzer`
v2), `packages/server` (`api/party`, `party-store`, `tickets`, `api/friends`, `game/host`),
`packages/client`. Sistemas: party, economia de sessão, bot, analisador, Premium.
**Emenda:** ADR 0027 (decisões 5, 8 e 9), ADR 0026 (decisão 5). Desenho e exemplos em
`docs/party-vip-plan.md`.

## Contexto

O M13 (ADR 0027) entregou a party como uma sessão de hunt com N donos, formada por HTTP antes da
hunt, com um modo fixo (`split` | `shared`) escolhido na proposta, bolsa com capacidade igual à
soma das capacidades e venda dividida entre os presentes a cada saída. O PRD "Party e VIP" de
2026-09-16 muda cinco coisas que essas decisões não comportam: (1) rateio e divisão de lucro
são **dois** interruptores do líder, mutáveis **durante** a hunt; (2) o líder escolhe o que
coletar e o que vender automaticamente, com limite de tipos pelo Premium dele; (3) a bolsa
reserva capacidade **proporcional** de cada membro, entra em OVERWEIGHT e nunca perde item; (4) a
receita de cada loot pertence a quem estava presente no drop; (5) quem aceita uma party entra na
instância **em curso** do líder — por sala pública ou por convite da Social. O bot ganha follow
de membro e cura com alvo. A issue #359 (SV-23) já pedia a decisão de produto sobre os dois
eixos; o PRD é essa decisão — e o M15 (#359, PR #366) já gravou os dois como `shareCosts?` e
`splitLoot?` opcionais em `PartyOptions`, **fixados na proposta**; este ADR os torna mutáveis. O
ADR 0032 (decisão 14) põe no M20 o DPS/HPS por membro e o "sim de todos" para encerrar.

## Decisão

1. **Dois eixos independentes, mutáveis pelo líder.** `PartyOptions { leaderId, mode, shareCosts?,
   splitLoot? }` (o que o #359 gravou, fixo na proposta) vira estado mutável do ruleset:
   `{ leaderId, shareCosts, splitLoot, collect, autoSell, premiumByCharacter }`. `shareCosts`
   decide a purse rateada (poção, runa **e munição**); `splitLoot` decide bolsa versus sorteio.
   O líder muda por `configureParty`, chamado pelo host entre avanços a partir de um opcode C2S
   `party-settings` — intenção, validada no servidor (líder, catálogo, limite). Desligar
   `splitLoot` liquida a bolsa. `mode` continua no fio e no snapshot como derivado (os helpers
   `shareCostsOf`/`splitLootOf` já fazem a leitura); snapshot antigo migra na leitura, sem bump.
2. **Coleta e venda automática.** `collect: string[] | null` (`null` = tudo) filtra depois de
   `rollLoot`; item fora da lista fica no cadáver. `autoSell` vira gold no drop
   (`value × quantidade`), dividido entre os elegíveis; a lista guarda além do limite e só os
   `autoSellLimit` primeiros valem. O limite vem de `party.autoSellItemTypes { free: 5,
   premium: 20 }` e é do **personagem líder**: o PRD diz "conta", o schema e `monetization.md`
   dizem personagem (ADR 0014 — não se renomeia contrato persistido). `InitialCharacter.premium`
   passa a viajar no ticket; a penalidade de morte passa a ler o premium do morto.
3. **Reserva proporcional e OVERWEIGHT.** `R_i = W × B_i / ΣB` sobre a capacidade
   **disponível** (`capacity − inventory.weight`), em ponto flutuante; `overweight = W > ΣB`.
   Em OVERWEIGHT item com peso não é coletado; autovenda e gold continuam. A reserva desconta
   da mochila por um `Wearer` derivado (o loot pessoal na mochila é a decisão 12 do ADR 0032; a
   reserva vale sobre ela igual). Recalculado nos gatilhos do §13, nunca por tick.
4. **Elegibilidade por entrada.** Cada item e cada gold da bolsa registram os presentes no
   drop; toda venda — automática ou settlement — divide entre `eligible ∩ presentes`.
5. **Settlement a cada saída, no fim e ao desligar `splitLoot`** (mantido do ADR 0027 e
   estendido). É o que preserva "um extrato por saída" (invariante 10) e faz o cenário do PRD
   §15 (bolsa acima da capacidade depois de uma saída) não existir: a bolsa esvazia na saída.
6. **A party sobrevive ao `start`** (`state: 'hunting'`, `sessionId`), e `join` numa party em
   curso emite um ticket de entrada (`party.join: true`, um membro) para o nó da sessão; o host
   chama `session.enter` dentro do ciclo da sessão dona; `onEnter` recusa acima de
   `maxMembers`, emite `party-state` e rebalanceia; o extrato de quem entrou tarde filtra os
   eventos notáveis por `joinedAtMs`. A lotação viva é lida pelo `api` no `directory`.
7. **Sala pública e Amigos.** `publish { minLevel, maxLevel }` / `unpublish` / `rooms`; `join`
   sem convite exige sala publicada e level na faixa. A fila de matchmaking (#199) coexiste.
   Amigos é o mínimo do §21: tabela `friend` por personagem, adicionar por nome, listar com
   online/onde, convidar. Convites ficam visíveis em `GET /api/party/mine` (`invites[]`) por um
   índice reverso, com `decline`; `/invite` recusa party cheia.
8. **Liderança por tempo de party.** `participants[0]` já é o mais antigo; `leaderId` passa a
   ser reescrito quando o líder sai, o limite de venda é recalculado e `party-state` avisa.
9. **Follow de membro** é `botConfig.follow` (nenhum / líder / membro), separado da postura.
   Substitui a rota: passo guloso até ficar adjacente; combate continua. Alvo indisponível
   interrompe **sem** escolher outro e emite S2C `follow-state`; o mesmo alvo voltando
   a ser válido retoma. "Desconectado" não é estado do `sim` (invariante 3).
10. **Cura e suporte com alvo.** `rule.target` (eu / menor HP % / membro) em `heal`, `potion`
    e `support`; com alvo ≠ eu a condição `hp` é do candidato; menor **percentual**, desempate
    pela ordem de entrada; membro específico inválido espera. Magia e poção ganham
    `target: 'friend'` com `range`; Exura Sio sai da lista de excluídas (emenda ao ADR 0026
    d.5). `castSpell`/`useSupply` recebem `recipient`; quem paga continua sendo quem lança.
11. **Analisador** ganha `analyzer.party` (jogadores, vocações únicas, %, XP e supplies totais,
    eixos, valor e peso da bolsa, `autoSell used/limit`), o mesmo bloco em
    `session-state.partySummary` — `session-state.party` já é o roster (#196).
12. **8 membros**: `maxMembers: 8`, tabela até "8" = 200; `null` continua contando como vocação.
13. **Do ADR 0032, decisão 14, no M20:** DPS/HPS por membro (acumulador por evento, janela de
    60 s aparada na leitura, nada por tick) em `party-state.members[]` e no analisador; e
    **encerrar para todos exige o sim de todos** — proposta do líder, aprovação por membro em
    60 s, encerramento com settlement; sair sozinho continua livre. Duas issues (#431 PT-01, #432 PT-02)
    entram no milestone depois das 18 do plano.

## Alternativas

- **Deixar os dois eixos fixos na proposta (como o #359 gravou)** — o PRD diz que o líder os
  muda durante a hunt; fixá-los faria o interruptor do kit ser decoração.
- **Toggles pelo `api` (HTTP)** — as configurações são estado quente da sessão (invariante 9);
  o `api` é stateless e não escreve na sessão. Opcode C2S de intenção é o único caminho.
- **Reserva em quantidade fixa por membro** — o PRD a proíbe (§11): penaliza vocação de pouca
  capacidade.
- **Capacidade total (não disponível) na reserva** — é o que o M13 faz e conta a mesma
  capacidade duas vezes (bolsa e mochila).
- **Vender só no fim, com livro de elegibilidade para pagar quem saiu** — exigiria uma segunda
  linha de ledger por membro depois do extrato; sair já liquida.
- **Item não coletado / em OVERWEIGHT para a caixa do líder** — é "coletar" com outro nome, e
  o PRD diz que em OVERWEIGHT nada com peso é coletado.
- **Apagar a party no `start` e reconstruí-la para o join** — não há de onde reconstruir; a
  party em curso precisa existir para ser listada, convidar e contar lotação.
- **`game` escrevendo a lotação viva em Redis** — o `directory` já diz em que sessão cada
  personagem está; oito lookups por listagem custam menos que um segundo escritor.
- **Follow como postura** — `posture.follow` já significa perseguir o monstro; um campo
  separado evita reinterpretar configuração salva.
- **Reaproveitar `selectTarget` (menor HP absoluto) para membros** — o PRD exige percentual.
- **Amigos completo (pedidos, bloqueios)** — o §21 só precisa de "convidar um amigo"; o resto
  espera o épico social.
- **VIP como status de conta** — renomear/mover `premium_until` é migração sem ganho; "a
  conta do líder" lê-se como "o personagem líder".

## Consequências

- `packages/sim`: `party.ts` ganha `reserveProportionally`, entradas com elegibilidade e
  settlement por entrada; o ruleset ganha `configureParty`, `#rebalanceBag`, follow de membro,
  alvo de cura, `partySummary`; `session.ts` ganha `joinedAtMs` e o filtro do extrato;
  `casting.ts` ganha `recipient`. Todo estado novo é opcional no snapshot — sem bump.
- `packages/content`: `party/baseline.json` (8, tabela, limites), `target`/`range` em cura,
  Exura Sio, `follow` e `target` no vocabulário do bot (sem subir a versão: têm default).
- `packages/protocol`: um opcode C2S (`party-settings`) e um S2C (`follow-state`), numerados
  com o próximo livre ao pousar — o ADR 0032 também reserva opcodes (`use-slot`,
  `select-target`, `set-stance`, `dispatch-loot`) e a ordem de merge decide; v2 de quatro
  mensagens com campos opcionais; `catalogue.bot.*.targets`.
- `packages/server`: premium no ticket; `party-settings` roteado; ticket `join`; a party em
  Redis vive até a sessão morrer; salas, convites reversos, `decline`, `friend` (migration
  0008); `session.enter` em sessão hospedada.
- `packages/client`: sobre o M17 — switches, Encontrar Party, Amigos, diálogo de convite,
  config de loot, Party loot v2, seção PARTY, Follow e alvo da cura.
- Divergências a registrar em `party.md`: Premium por personagem (§8/§42), "desconectado"
  como alvo inválido (§25.1/§30), settlement a cada saída em vez de OVERWEIGHT por saída
  (§15), item não coletado fica no cadáver (§7/§14 não dizem), `null` conta como vocação (§3.1).
- O que piora: a capacidade efetiva da bolsa cai (disponível, não total); o caminho quente
  ganha laços de até 8 por abate, supply e golpe; a party em Redis passa a ter estado de longa
  duração que precisa de poda lazy; o `api` faz até oito lookups por listagem de sala.

## Invariantes afetados

Nenhum muda de texto. O 4 ganha um opcode de intenção (`party-settings`) e um de apresentação
(`follow-state`), no mesmo espírito de `bot-config`. O 9 continua absoluto: `configureParty` e `session.enter` são
chamados pelo host da sessão dona, e o `api` só lê o `directory`. O 10 é preservado pela
decisão 5. O 3 é a razão de "desconectado" não existir no `sim`. O 2 é a razão de
`#rebalanceBag` só rodar em gatilhos.
