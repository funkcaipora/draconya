// Fonte única do protocolo. Este é o ÚNICO arquivo do repositório onde um opcode aparece
// (invariante 5). As tabelas de tradução por direção são derivadas daqui, nunca escritas à mão.
//
// REGRA QUE NÃO PODE SER QUEBRADA: opcode nunca é reciclado. Mensagem removida deixa o número
// queimado, listado abaixo. Reaproveitar um número faz um cliente antigo interpretar a mensagem
// nova como a velha — e o sintoma aparece longe da causa.

export const CLIENT_TO_SERVER = {
  authenticate: 1,
  ping: 2,
  'client-ready': 3,
  'session-attach': 4,
  walk: 5,
  'walk-to': 6,
  say: 7,
  logout: 8,
  'enter-hunt': 9,
  'leave-hunt': 10,
  'bot-config': 11,
  equip: 12,
  unequip: 13,
  /**
   * Escolher a munição (#152, ADR 0026 decisão 3). INTENÇÃO: o cliente diz QUAL munição, e
   * quem decide se o level basta é o servidor (invariante 4). A escolha aparece de volta em
   * `player-stats.ammo`; a recusa vira `system-message`, como a de equipar.
   */
  'select-ammo': 14,
  /** Escolher a vocação (#154, ADR 0026 decisão 1). 15: o 14 é do `select-ammo` (#152). */
  'choose-vocation': 15,
  /** Mover um item entre lugares (#160, ADR 0026 decisão 6). */
  'move-item': 16,
  /**
   * Disparo manual de um slot da barra (AB-09, ADR 0032 d.3). INTENÇÃO: o cliente diz QUAL
   * slot; elegibilidade, estoque, mana, cooldown e recusa são do servidor (invariante 4).
   */
  'use-slot': 17,
  /**
   * Escolher o alvo no mundo/Batalha (AB-09, ADR 0032 d.5). INTENÇÃO: o cliente diz QUAL
   * criatura pelo id numérico do servidor; quem decide se é alvo válido é o servidor.
   */
  'select-target': 18,
  /**
   * O líder muda rateio, divisão de lucro, coleta ou venda automática EM TEMPO DE HUNT
   * (#393, ADR 0035 decisão 1). INTENÇÃO, sempre: um patch parcial — cada campo ausente
   * mantém o valor atual — e quem decide se quem mandou é o líder e se os ids do catálogo
   * existem é o servidor (invariante 4). Sucesso é `party-state` (v2) refletindo o estado
   * novo; recusa (`not-leader`, item fora do catálogo, `value: 0` na venda) é
   * `system-message` — não existe um `party-settings-result` dedicado, porque a tela já
   * reflete a verdade no próprio `party-state`, e não o eco do que foi mandado.
   *
   * 19: o 17 e o 18 são do `use-slot` e do `select-target` (AB-09), que chegaram antes.
   */
  'party-settings': 19,
  /**
   * A votação de encerrar a hunt para todos (#432, ADR 0032 decisão 14). INTENÇÃO, como tudo:
   * `approve: true` é o líder PROPOR (a proposta carrega o sim dele) e é o membro APROVAR a
   * proposta em curso; `approve: false` é recusar — derruba a votação e a sessão segue. Quem
   * decide se quem mandou pode propor é o servidor, dentro da sessão dona (invariante 4/9), e a
   * recusa vira `system-message`. Sair sozinho continua `leave-hunt` (10), livre.
   *
   * 20: o 19 é do `party-settings`.
   */
  'party-end-vote': 20,
  /**
   * Vender N itens da mochila/bolsa ao `value` do catálogo (#724, ADR 0048 d.8 — a
   * generalização do "Despachar loot" do ADR 0032 d.12). INTENÇÃO: o cliente diz QUAIS
   * instâncias; existir, estar na mochila/bolsa (nunca equipada) e ter `value > 0` é conferido
   * pelo servidor (invariante 4). Sucesso é `inventory` reenviado; recusa
   * (`not-carried`/`not-for-sale`) é `system-message`.
   *
   * 21: o 20 é do `party-end-vote`.
   */
  'sell-items': 21,
  /**
   * Descartar um item da mochila/bolsa, destruindo-o sem gold (#724, ADR 0048 d.8). A
   * confirmação ("tem certeza?") é do cliente; o servidor não pergunta de novo.
   *
   * 22: o 21 é do `sell-items`.
   */
  'discard-item': 22,
  /**
   * Abrir a janela do cadáver (#722, ADR 0048 d.4). INTENÇÃO: o cliente diz QUAL item do chão;
   * dono, elegibilidade, distância (≤ 1, mesmo andar) e se o cadáver ainda existe são do
   * servidor (invariante 4). Sucesso é `corpse-contents`; recusa é `system-message`
   * (`too-far-away`/`not-yours`/o cadáver já apodreceu).
   *
   * 23: o 21 e o 22 são do `sell-items`/`discard-item` (#724, PR #741).
   */
  'open-corpse': 23,
  /**
   * Pegar do cadáver o que sobrou do Quick Loot automático (#722, ADR 0048 d.4). INTENÇÃO:
   * `instanceId: null` é o clique — aplica o MESMO filtro de Quick Loot do personagem a tudo
   * que ainda está no cadáver; um `instanceId` é arrastar ESTE item específico, ignorando o
   * filtro (o "segunda chance" do Canary). Dono/elegibilidade, distância e capacidade são do
   * servidor. Sucesso é `corpse-contents` (o que sobrou) + `inventory`; recusa é
   * `system-message`.
   *
   * 24: o 23 é do `open-corpse`.
   */
  'take-loot': 24,
  /**
   * Usar um item da mochila/bolsa/equipado, OU uma unidade do estoque de suprimento — comida,
   * carga de bênção, poção ou runa (#726, ADR 0049 decisão 3). INTENÇÃO: o cliente diz QUAL
   * `ref` (`{ instanceId }` ou `{ supplyId }`) e, quando o efeito precisa (runa/poção de dano
   * ou cura), o MESMO `target` opcional de `use-slot` (decisão 2) — mira de aliado, monstro ou
   * posição. O catálogo, a exaustão, o estoque e o efeito são do servidor (invariante 4); a
   * resposta é `use-result`, tipada como `slot-result` (FUN-73).
   *
   * 25: o maior opcode reservado até aqui é o 24 (#722, ainda sem código nesta branch).
   */
  'use-item': 25,
  /**
   * Usar um item/suprimento COM alvo obrigatório — a runa/poção de dano ou cura mirada. A
   * ferramenta (machete, pá…) sobre um tile fica de fora (ADR 0050, issue própria, ainda não
   * implementada): recusa `not-usable` até lá. Mesma forma de `use-item`, com `target`
   * obrigatório em vez de opcional (#726, ADR 0049 decisão 3).
   *
   * 26: o 25 é do `use-item`.
   */
  'use-item-on': 26,
  /**
   * Usar o que está NO TILE (#729, ADR 0050 d.7): porta, alavanca, capim, stone pile. INTENÇÃO:
   * o cliente diz QUAL posição; alcance (`canUse`, mesmo andar e adjacente), estado, requisito
   * e ferramenta são do servidor (invariante 4). `seq` é o mesmo padrão de `select-target`: o
   * cliente descarta resposta obsoleta, quando manda mais de um pedido em sequência. Sucesso é
   * `tile-update` (broadcast, DT-01); recusa é `system-message`.
   *
   * 27: o 26 é do `use-item-on` (#726, PR #752).
   */
  'use-on-map': 27,
  /**
   * Olhar uma posição (#729, ADR 0050 d.7): o "You see …" do Tibia, para placa e cenário. Sem
   * `creatureId`/`instanceId` nesta entrega (DT-04, spec da #729) — sem gatilho de UI hoje.
   *
   * 28: o 27 é do `use-on-map`.
   */
  look: 28,
  /**
   * Promover a vocação (#566, ADR 0042 decisão 1). INTENÇÃO sem payload: o cliente só pede;
   * vocação escolhida, level ≥ 20, gold ≥ 20.000 e "ainda não promovido" são do servidor
   * (invariante 4). Só na Cidade (ADR 0042 — serviço de Cidade). Sucesso é `player-stats`
   * (`promoted: true`); recusa é `system-message`.
   *
   * 29: o 28 é do `look`.
   */
  'promote-vocation': 29,
  /**
   * Comprar UMA bênção na Cidade (#570, ADR 0052 decisão 2). INTENÇÃO: o cliente diz QUAL
   * bênção (`blessingId` do catálogo `content.blessings`); preço por level, saldo e "já tem
   * esta bênção" são conferidos pelo servidor (invariante 4), dentro da sessão de Cidade —
   * nunca um endpoint `api` (o personagem na Cidade tem o `CharacterRuntime` quente,
   * invariante 9). Gold sai pelo ledger (`session.credit`, invariante 10); sucesso é
   * `blessings` refletindo o bitmask novo, e `player-stats`/`inventory` NÃO mudam — bênção
   * não é item nem vital. Recusa é `system-message` (`not-enough-gold`, `already-blessed`,
   * `unknown-blessing`, `blessing-service-unavailable`).
   *
   * 30: o 29 é do `promote-vocation` (#566).
   */
  'buy-blessing': 30,
  /**
   * Desbloquear o próximo tier de um Charm (M39-02, #602; ADR 0052 d.2, ADR 0053 d.3).
   * INTENÇÃO: o cliente diz QUAL charm; quem decide se os pontos/echoes derivados do Bestiário
   * bastam é o servidor (invariante 4). Tratada pela sessão de Cidade E pela hunt — sem
   * rolagem, o mesmo caminho aceita as duas (ADR 0052 d.4). Sucesso é `charms` reenviado;
   * recusa é `system-message`.
   *
   * 31: o 30 é do `buy-blessing` (#570).
   */
  'charm-unlock': 31,
  /**
   * Atribuir um Charm desbloqueado a um monstro (ADR 0053 d.4). INTENÇÃO: `monsterId` é o id de
   * CONTEÚDO do bestiário, não uma criatura da hunt — Charms se gerem de qualquer lugar
   * (ADR 0052 d.4), inclusive olhando o Cyclopedia fora de sessão nenhuma de combate.
   *
   * 32: o 31 é do `charm-unlock`.
   */
  'charm-assign': 32,
  /**
   * Remover a atribuição de um Charm (ADR 0053 d.4): custa `level × 100` gold pelo ledger
   * (invariante 10) — o servidor debita, nunca o cliente informa quanto pagou.
   *
   * 33: o 32 é do `charm-assign`.
   */
  'charm-remove': 33,
  /**
   * Desistir da saída da hunt que o jogador pediu (#802). INTENÇÃO sem payload: `leave-hunt`
   * (10) agora só PEDE a saída — o `sim` conclui quando o `exitDelayMs` vence e o personagem está
   * fora de combate (#625) —, e este é o "esquece". Só a saída MANUAL pode ser desfeita; a de uma
   * regra do bot não (a regra dispararia de novo). Quem decide se há o que cancelar é o
   * servidor (invariante 4); sem saída pendente é um no-op, e o estado novo é `exit-pending`.
   *
   * 34: o 33 é do `charm-remove`.
   */
  'cancel-exit': 34,
  /**
   * Escolher a postura de luta (M30-03, #550; ADR 0040): ofensiva (`attack`), balanceada
   * (`balanced`) ou defensiva (`defense`) — o `fightMode` do Canary. INTENÇÃO: o cliente diz
   * QUAL modo; o efeito (o fator de ataque, o de defesa e o da mitigação) é do servidor
   * (invariante 4), na sessão dona (invariante 9). A escolha aparece de volta em
   * `player-stats.fightMode`. Aceita na Cidade e na hunt, como `select-ammo`.
   *
   * 35: o 33 é do `charm-remove`, e o 34 é do `cancel-exit` (#802).
   */
  'set-fight-mode': 35,
  /**
   * Aprender UMA magia por gold (#624, ADR 0058 d.2; ADR 0052 d.2/d.4) — o `StdModule.learnSpell`
   * do Tibia, como tela de serviço, sem diálogo de NPC. INTENÇÃO: o cliente diz QUAL magia
   * (`spellId` do catálogo `content.spells`); vocação, level, "já aprendida", preço
   * (`learnPrice`) e saldo são conferidos pelo servidor (invariante 4), dentro da sessão dona do
   * personagem — nunca um endpoint `api` (invariante 9). Aceita na Cidade E na hunt: não há
   * rolagem (ADR 0052 d.4), e no Tibia aprender magia não exige protect zone. O gold sai pelo
   * ledger (invariante 10). Sucesso é `learned-spells` com o registro novo; recusa é
   * `system-message`.
   *
   * 36: o 35 é do `set-fight-mode` (#550).
   */
  'learn-spell': 36,
  /**
   * Entrar numa sessão de Treino com uma exercise weapon (#631, M44-13; ADR 0059 d.1). INTENÇÃO:
   * o cliente diz QUAL instância da mochila; existir, ser uma exercise weapon com cargas e o
   * personagem estar na Cidade são conferidos pelo servidor (invariante 4). Sucesso é a troca de
   * cena de sempre (`instance-enter` + `session-state` com `sessionType: 'training'`); recusa é
   * `system-message`. Sair do treino é o `leave-hunt` (10), como sair de qualquer sessão privada.
   *
   * 37: o 36 é do `learn-spell` (#624), e o 35 é do `set-fight-mode`.
   */
  'enter-training': 37,
  /**
   * Escolher a skill do offline training — o "livro" do Tibia (#631, ADR 0059 d.3, ADR 0052 d.2).
   * INTENÇÃO de Cidade: `skillId: null` desmarca. Só as skills que o conteúdo oferece
   * (`catalogue.training.offlineSkills`) são aceitas; o gasto do banco é da `api`, na próxima
   * emissão de ticket, nunca deste pedido. Sucesso é `training-state` reenviado.
   *
   * 38: o 37 é do `enter-training`.
   */
  'set-offline-training-skill': 38,
  /**
   * Comprar UM item por gold na Cidade (#631, ADR 0059 d.2) — o mínimo que a exercise weapon
   * precisa enquanto a loja geral (E5) não existe. INTENÇÃO: só o id; `purchasable`, preço, saldo
   * e capacidade são do servidor (invariante 4), e o gold sai pelo ledger (invariante 10). Sucesso
   * é `inventory` (+ `player-stats` com o saldo novo); recusa é `system-message`.
   *
   * 39: o 38 é do `set-offline-training-skill`.
   */
  'buy-item': 39,
  /**
   * Escolher o nível de Hazard de uma zona (M44-14, #632; ADR 0052 d.2/d.5). INTENÇÃO: o cliente
   * diz QUAL zona e QUAL nível; quem decide se o nível cabe no teto desbloqueado é o servidor
   * (invariante 4), na sessão dona (invariante 9). Só na Cidade — uma hunt em curso tem o nível
   * FIXO desde a entrada, como a versão de conteúdo (invariante 7). Sucesso é `hazard`
   * reenviado; recusa é `system-message`.
   *
   * 40: o 39 é do `buy-item` (#631), o 36 do `learn-spell` (#624) e o 35 do `set-fight-mode`.
   */
  'set-hazard-level': 40,
} as const;

export const SERVER_TO_CLIENT = {
  pong: 1,
  welcome: 2,
  'session-state': 3,
  'instance-enter': 4,
  'creature-appear': 5,
  'creature-move': 6,
  'creature-disappear': 7,
  'creature-health': 8,
  'player-stats': 9,
  'experience-gain': 10,
  'system-message': 11,
  'chat-message': 12,
  'session-ended': 13,
  /**
   * O catálogo do que existe: hunts (FUN-79) e vocabulário do bot (FUN-89).
   *
   * **Uma mensagem, e não duas.** As duas telas perguntam a mesma coisa — "o que este servidor
   * tem" —, chegam no mesmo instante e mudam pela mesma razão (a versão de conteúdo, que é
   * fixada na sessão). Separar daria dois pacotes que nunca aparecem um sem o outro.
   *
   * Nasceu como `hunt-catalogue` e foi generalizada no mesmo dia, antes de a UI do bot existir.
   * O opcode não muda: é o mesmo assunto, com mais dentro.
   */
  catalogue: 14,
  'bot-config-result': 15,
  inventory: 16,
  /**
   * O que o combate MOSTRA (FUN-109): o número que flutua sobre a criatura, a animação no
   * tile e o projétil de A a B.
   *
   * **Três mensagens, e não uma com campos opcionais.** Cada uma tem destino diferente no
   * cliente — o número vai na criatura, o efeito vai no tile, o projétil vai entre dois —, e
   * uma magia dispara as três de uma vez enquanto um golpe de corpo a corpo dispara duas.
   * Uma mensagem só faria o cliente inspecionar quais campos vieram para decidir o que
   * desenhar, e a combinação "veio `missile` sem `to`" passaria a ser um estado possível.
   *
   * Só S2C, de propósito (invariante 4): o cliente não diz "acertei 40", ele vê que acertou.
   */
  'creature-hit': 17,
  effect: 18,
  missile: 19,
  /**
   * O analisador AO VIVO (§16.1): os agregados e os eventos notáveis da sessão, sempre que
   * um deles muda. Antes só saíam no `session-state` e no `session-ended`, e a janela ficava
   * em zero a hunt inteira — o loop que o M9 fecha não fechava na tela.
   */
  analyzer: 20,
  /**
   * O Bestiário do personagem (§18, FUN-113): quantos de cada monstro ele já abateu. Sai no
   * attach e sempre que um contador muda — é progressão permanente, e a tela precisa ver o
   * marco chegar.
   */
  bestiary: 21,
  /**
   * Um item no chão (FUN-123): hoje, o cadáver de um monstro — só visual, sem loot. Aparece
   * com posição e aparência, e some pelo id quando apodrece. Só S2C: o cliente não põe nada
   * no chão.
   */
  'ground-item-appear': 22,
  'ground-item-disappear': 23,
  /**
   * A party (#196, ADR 0027; v2 no #393, ADR 0035). Quatro mensagens só S2C: quem está nela
   * (`party-state` — sai no attach e quando composição, liderança ou configuração mudam), o
   * que há na bolsa compartilhada (`party-bag` — a cada mudança), o que o settlement pagou
   * (`party-settlement` — a cada saída, no fim, ao desligar `splitLoot`, e a cada venda
   * automática) e — desde o #393 — como o Follow do bot está (`follow-state`, por
   * personagem). C2S: sair é `leave-hunt` (10); mudar configuração em tempo de hunt é
   * `party-settings` (19). Formar a party continua HTTP (ADR 0027 decisão 8).
   */
  'party-state': 24,
  'party-bag': 25,
  'party-settlement': 26,
  /**
   * Condições ativas do jogador (haste, buff, magic shield, cura ao longo do tempo).
   * Sai no attach/enter e sempre que as condições ativas mudam (aplicadas ou expiradas).
   */
  'active-conditions': 27,
  /**
   * O total de jogadores online, agregado entre todos os nós `game` (SV-07): cada nó publica,
   * no próprio batimento do diretório de sessões, quantos personagens distintos tem conectados
   * agora; quem manda esta mensagem já somou os nós vivos. Mandada a cada 30 s, para TODA
   * sessão hospedada neste nó — a barra do topo do kit (Hud.jsx:21) aparece tanto na Cidade
   * quanto na hunt.
   *
   * Não é comparada como `player-stats`/`analyzer`/`bestiary` (sem `sameX`): é republicada sem
   * checar se mudou. O próprio intervalo de 30 s já é o teto de banda que se aceita gastar com
   * isto, e guardar "o último valor mandado por VIEWER" custaria mais memória do que o campo
   * economiza em rede — um inteiro pequeno, a cada 30 s, para quem estiver conectado.
   */
  'player-count': 28,
  /**
   * O gasto de cada membro da party e a prévia do rateio do settlement (#354, SV-18): quanto
   * cada um já gastou em supply nesta sessão, e — em modo `shared` — quanto receberia se a
   * bolsa fosse liquidada AGORA. Broadcast, como `party-bag`: o Mapa de Capacidade do protocolo
   * (docs/reviews/kit-fidelity-audit-2026-09-16.md, AVISO 4) registra que `analyzer` — que TEM
   * `goldSpent` por participante — só vai a quem olha aquele personagem; "gasto de cada membro
   * visível a todos" não é ligar um campo, é agregar e mandar a TODOS os visualizadores, o que
   * só `party-bag`/`party-state`/`party-settlement` fazem hoje.
   */
  'party-spending': 29,
  /**
   * O estado de cada slot do conjunto ATIVO (AB-09, ADR 0032 d.3). Só S2C: a CONTAGEM não vem
   * aqui — ela é do `inventory` (invariante 4, o servidor manda o número, não a regra). Sai no
   * attach e quando o par `(state, reason)` de algum slot muda; o `remainingMs` é o instante da
   * entrega, e o cliente anima o cooldown localmente.
   */
  'slot-state': 30,
  /** A resposta ao `use-slot` (AB-09, ADR 0032 d.3): `ok:false` carrega o motivo para o tooltip. */
  'slot-result': 31,
  /**
   * O Follow do bot mudou de estado (#393, ADR 0035 decisão 9): ligou, desligou, ou foi
   * interrompido porque o alvo morreu, saiu ou ficou inalcançável. Por PERSONAGEM — cada
   * membro segue quem quiser. Nunca escolhe outro alvo sozinho: `active: false` é o fim da
   * história até o jogador escolher de novo (ou o mesmo alvo voltar a ser válido).
   *
   * 32: o 30 e o 31 são do `slot-state` e do `slot-result` (AB-09), que chegaram antes.
   */
  'follow-state': 32,
  /**
   * O estado da votação de encerrar a hunt para todos (#432, ADR 0032 decisão 14): o líder
   * propôs, `approved` lista quem já aprovou e `active` diz se a janela de 60 s ainda corre.
   * Sai quando a proposta abre, a cada aprovação, ao expirar e ao ser recusada — e no attach,
   * para quem reconecta no meio da votação. `active: false` é o fim dela.
   *
   * 33: o 32 é do `follow-state`.
   */
  'party-end-vote': 33,
  /**
   * O alvo autoritativo do jogador (#470, AB-09). Confirma a seleção (`creatureId` positivo)
   * ou o cancelamento aceito (`creatureId: null`), e substitui `player-stats.targetId` — que
   * era batimento geral e mascarava confirmação e recusa de input (DT-01). `seq` devolve o
   * número do `select-target` que originou a confirmação, para o cliente descartar ack
   * obsoleto (RF-02). Sem `seq`, a mudança veio do auto-target do servidor (#444).
   *
   * 34: o 32 é do `follow-state` e o 33 é do `party-end-vote` (#432).
   */
  'target-changed': 34,
  /**
   * A recusa do `select-target` (#470): a criatura não é alvo válido, e nada mudou. É
   * deliberadamente distinta de `target-changed { creatureId: null }` — uma é recusa, a outra
   * é cancelamento confirmado (RF-04).
   *
   * 35: o 34 é do `target-changed`.
   */
  'target-cancel': 35,
  /**
   * O conteúdo do cadáver, para quem o abriu (#722, ADR 0048 d.4): quanto ouro e quais itens
   * ainda estão lá, depois do Quick Loot automático do abate. Sai ao `open-corpse` bem-sucedido
   * e a cada `take-loot` bem-sucedido — nunca some sozinho: o cadáver decai pelo
   * `ground-item-disappear` de sempre, e o cliente fecha a janela quando ele chegar.
   *
   * 36: o 35 é do `target-cancel`.
   */
  'corpse-contents': 36,
  /**
   * A resposta ao `use-item`/`use-item-on` (#726, ADR 0049 decisão 3), tipada como
   * `slot-result` (FUN-73): `ok: false` carrega o motivo em palavras. `ok: true` também sai
   * quando a ação foi ACEITA mas ADIADA pela exaustão compartilhada (decisão 6) — o jogador não
   * vê erro nenhum, e o efeito de verdade chega depois pelo `inventory`/`player-stats`/
   * `creature-hit` de sempre, quando a ação de fato executa.
   *
   * 37: o 36 é do `corpse-contents` (#722, PR #749) — conferido no diff de #741, #742 e #749
   * antes de escolher o número (as três param em 35, exceto a #749, que usa 36).
   */
  'use-result': 37,
  /**
   * O tile mudou de aparência (#729, ADR 0050 d.7): a pilha do tile na posição, com os pares
   * `{ from, to }` de id de aparência que o cliente troca — a mesma indireção de
   * `ground-item-appear` resolvendo `corpses`, aqui resolvendo `appearances.scenery`
   * (invariante 6: quem sabe a arte é o servidor, nunca o `content`). Broadcast para todos os
   * viewers da sessão (DT-01) — cenário é compartilhado, ao contrário de `player-stats`.
   *
   * 38: o 37 é do `use-result` (#726, PR #752).
   */
  'tile-update': 38,
  /**
   * A resposta ao `look` (#729): o texto — placa, ou uma descrição padrão do `kind` de
   * cenário. Só para quem pediu, nunca broadcast.
   *
   * 39: o 38 é do `tile-update`.
   */
  'look-result': 39,
  /**
   * Um campo de tile apareceu (#561, M31-06): fogo, veneno, energia — a MESMA indireção de
   * `ground-item-appear` resolvendo `corpses`, aqui resolvendo `appearances.fields`
   * (invariante 6). Cobre vários tiles de uma vez (`tiles`), porque um campo nasce de uma
   * área inteira (`applyField`, `packages/sim/src/rulesets/hunt.ts`), nunca um tile só.
   * Relançar o MESMO `id` (o id de CONTEÚDO do campo, não um id sequencial) REINICIA — o
   * cliente substitui a entrada, como o servidor substitui no `Fields` do `sim`. Broadcast
   * para todos os viewers da sessão, como `tile-update`: campo é compartilhado.
   *
   * 40: o 39 é do `look-result`.
   */
  'field-appear': 40,
  /**
   * O campo sumiu — o prazo (`expiresAtMs`) venceu (#561, M31-06). Só o `id` de conteúdo.
   *
   * 41: o 40 é do `field-appear`.
   */
  'field-disappear': 41,
  /**
   * O campo trocou de estágio (#560, `decayTo` do Canary — `items.xml:4212-4246`): o fire
   * field enfraquece antes de sumir de vez. `id` de conteúdo e o `appearanceId` JÁ RESOLVIDO
   * pelo hospedeiro (invariante 6, `appearances.fieldStages[id][stageIndex - 1]`) — a mesma
   * indireção de `field-appear`, sem repetir `tiles` (a área não muda entre estágios, e o
   * cliente já a tem do `field-appear`/catch-up). Campo sem entrada na tabela troca de estágio
   * MUDO: nem chega a sair esta mensagem.
   *
   * 42: o 41 é do `field-disappear`.
   */
  'field-stage-change': 42,
  /**
   * As bênçãos do personagem (#570, ADR 0052): o BITMASK que `CharacterRuntime.blessings`
   * guarda — um bit por `order` de `content.blessings` (invariante 6: nada de nome de bênção
   * aqui, o cliente resolve pelo catálogo que `catalogue` já manda). Sai no attach/enter e a
   * cada mudança: compra (`buy-blessing`) ou consumo na morte — nunca broadcast, como
   * `slot-state`/`active-conditions`: bênção é de UM personagem, mesmo na Cidade compartilhada.
   *
   * 43: o 42 é do `field-stage-change` (#560).
   */
  blessings: 43,
  /**
   * A economia de Charms do personagem (M39-02, #602, ADR 0052 d.1): pontos/echoes gastos,
   * tier de cada charm e as atribuições por monstro — o registro cru, como `bestiary` manda os
   * abates crus. O que cada charm CUSTA e RENDE é do `catalogue` (fixado na sessão, invariante
   * 7); o cliente deriva ganho/disponível do mesmo jeito que já deriva o bônus de XP do
   * Bestiário (`bestiary-progress.ts`). Sai no attach e sempre que uma intenção de Charm muda o
   * registro.
   *
   * 44: o 43 é do `blessings` (#570).
   */
  charms: 44,
  /**
   * A saída da hunt do personagem está pendente (#802): o jogador pediu (`leave-hunt`) ou uma
   * regra do bot disparou, e o `sim` só a conclui depois do `exitDelayMs` e fora da janela de
   * combate de 60 s (#625). `active: false` é o fim da espera — concluída (a `session-ended` vem
   * junto), desfeita (`cancel-exit`) ou recusada. Por PERSONAGEM, como `active-conditions`: a
   * saída de um membro da party não é da tela dos outros. Sai no attach (só quando há saída
   * pendente, como `party-end-vote`) e a cada mudança de fase ou de prazo — um golpe novo em
   * combate empurra `remainingMs`, e a contagem local do cliente não pode mentir.
   *
   * 45: o 44 é do `charms`.
   */
  'exit-pending': 45,
  /**
   * O Bosstiary do personagem (#629, ADR 0052 d.1): os abates por boss (chaveados pelo `raceId`
   * do Canary, em texto), os pontos de boss e nada mais — o registro cru, como `bestiary` manda
   * os abates crus. A tabela de níveis e a raridade de cada boss vêm no `catalogue` (fixadas na
   * sessão, invariante 7); o cliente deriva o nível de cada boss do mesmo jeito que já deriva o
   * marco do Bestiário (`bosstiary-progress.ts`). Sai no attach e sempre que um abate de boss
   * muda o registro. Por PERSONAGEM, como `bestiary`: o Bosstiary é do personagem.
   *
   * 46: o 45 é do `exit-pending`.
   */
  bosstiary: 46,
  /**
   * As magias que o personagem APRENDEU (#624, ADR 0058 d.1): o registro cru de
   * `CharacterRuntime.learnedSpells` (ids de `content.spells`). O que cada magia custa, exige e
   * faz é do `catalogue` (fixado na sessão, invariante 7); a tela deriva "aprendida / à venda /
   * bloqueada" e marca no slot da barra a magia ainda não aprendida — o cast é recusado no
   * servidor (`spell-not-learned`) de qualquer jeito. Só para o DONO, como `blessings`/`charms`.
   * Sai no attach e a cada `learn-spell` aceito.
   *
   * 47: o 46 é do `bosstiary` (#629), e o 45 é do `exit-pending` (#802).
   */
  'learned-spells': 47,
  /**
   * O estado do Treino do personagem (#631, ADR 0059): o banco de offline training e a skill
   * escolhida no livro, as exercise weapons que ele carrega (com as cargas RESTANTES — que moram
   * no overlay da instância e não viajam em `inventory`) e qual delas o Treino em curso está
   * gastando. Só para o dono, como `charms`. Sai no attach e a cada mudança: escolha do livro,
   * compra, e a cada golpe do Treino (cada carga gasta é uma mudança).
   *
   * 48: o 47 é do `learned-spells` (#624), o 46 é do `bosstiary` (#629) e o 45 é do `exit-pending`.
   */
  'training-state': 48,
  /**
   * O Hazard do personagem (M44-14, #632, ADR 0052 d.1): o nível máximo desbloqueado e o
   * escolhido de cada zona — o registro cru, como `charms`. Quais zonas existem, os níveis
   * mínimo e máximo de cada uma e que hunt pertence a qual vêm do `catalogue` (fixado na sessão,
   * invariante 7). Sai no attach e sempre que uma escolha ou uma subida de nível muda o registro.
   *
   * 49: o 48 é do `training-state` (#631), o 47 do `learned-spells` (#624), o 46 do `bosstiary`
   * (#629) e o 45 do `exit-pending`.
   */
  hazard: 49,
} as const;

/** Números que já pertenceram a uma mensagem removida. Nunca reutilize. */
export const BURNED_OPCODES_C2S: readonly number[] = [];
export const BURNED_OPCODES_S2C: readonly number[] = [];

export type C2SName = keyof typeof CLIENT_TO_SERVER;
export type S2CName = keyof typeof SERVER_TO_CLIENT;

function invert(map: Record<string, number>): ReadonlyMap<number, string> {
  const inverted = new Map<number, string>();
  for (const [name, opcode] of Object.entries(map)) {
    const existing = inverted.get(opcode);
    if (existing !== undefined) {
      throw new Error(`opcode ${opcode} duplicated between "${existing}" and "${name}"`);
    }
    inverted.set(opcode, name);
  }
  return inverted;
}

export const OPCODE_TO_NAME_C2S = invert(CLIENT_TO_SERVER);
export const OPCODE_TO_NAME_S2C = invert(SERVER_TO_CLIENT);
