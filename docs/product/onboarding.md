# Onboarding e tutorial

**Status:** parcial — criação inicial de personagem implementada; a escolha de vocação implementada (#154, ADR 0026) com o kit completo por vocação (#496); o kit de nascimento é dado na criação do personagem (#153); tutorial pendente
**PRD:** §7.4, §8
**Épico:** E14 (tutorial guiado do level 1 ao 8 com escolha de vocação). E0 cobre o que precede o tutorial — CRUD e criação inicial de personagem.

## Comportamento

O jogador já pode criar o personagem escolhendo o nome antes de qualquer outra coisa; o registro nasce sem vocação, como previsto. A entrada automática no tutorial ainda não está implementada. Quando esse fluxo visual entrar, o personagem seguirá direto para o tutorial sem escolher vocação ainda. O tutorial ocorre entre os levels 1 e 8 e ensina fazendo: o jogador aprende jogando, não lendo telas de explicação separadas da ação.

Ao longo do tutorial, o jogo introduz: as barras de HP/Mana, a action bar e suas hotkeys, o funcionamento de skills, movimentação e interação básicas, a noção de que a hunt roda de forma idle, a existência de equipamentos e mochila, e a leitura geral do client.

Cada vocação e estágio de progressão tem um preset de hotkeys preparado pelo produto. O jogador recebe uma barra funcional desde o início; conforme desbloqueia novas habilidades, o jogo atualiza esse preset de forma orientada. Depois do tutorial, o jogador pode customizar livremente.

No level 8, o jogador recebe uma explicação curta de cada uma das quatro vocações — papel, resistência, dano, cura/suporte e estilo geral de cada uma — e então escolhe uma delas. A personalização de aparência do personagem só fica disponível depois que o tutorial termina.

## Regras

- O nome do personagem é a primeira escolha do fluxo, antes do tutorial.
- O tutorial cobre do level 1 ao level 8.
- A vocação é escolhida exatamente no level 8, entre as quatro vocações do jogo.
- A aparência do personagem só pode ser personalizada após o término do tutorial (pós-level 8).
- Presets de hotkeys são fornecidos por vocação e por estágio, atualizados conforme habilidades são desbloqueadas; customização livre fica disponível para o jogador depois.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Level de início do tutorial | 1 | caminho previsto: `packages/content/onboarding` |
| Level de término do tutorial / escolha de vocação | 8 | caminho previsto: `packages/content/onboarding` |
| Quantidade de vocações apresentadas | 4 | caminho previsto: `packages/content/vocations` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. O conteúdo exato de cada preset de hotkeys por vocação/estágio não está detalhado no PRD, mas também não está marcado como decisão pendente — é tratado como trabalho de conteúdo a ser produzido, não como lacuna de design.

## Decidido (ADR 0026)

- **Como se escolhe (implementado, #154; kit completo desde #496):** o jogo oferece as quatro
  vocações quando
  `level >= progression.vocationLevel` (8, e o número vem do catálogo — a tela não o tem em
  código) e a vocação ainda é nula — um diálogo com nome, papel, os três ganhos por level e a
  arma inicial de cada uma —, em qualquer sessão (Cidade ou hunt), sem NPC nem lugar; um clique
  manda `choose-vocation` (opcode 15), e a escolha é uma só, sem troca (`already-chosen`). O
  `sim` grava `vocationId` e concede o **kit completo da vocação** (`startingKit` — arma +
  escudo, desde #496) como `CarriedItem` com `origin: 'vocation-choice'`, vestindo o que
  couber; a machete volta para a mochila. A ordem do kit é contrato — a arma veste antes do
  escudo —, e é por isso que o bow de duas mãos deixa o `wooden-shield` na mochila. Sem
  capacidade para uma peça ela vai para a Caixa de Loot, com mensagem nomeando o item — a
  escolha vale mesmo assim. Os stats NÃO mudam
  na hora: a tabela da vocação vale do próximo level em diante (`progression.md`).
- **Como persiste:** `characters.vocation` é escrita UMA vez pelo `jobs`
  (`coalesce(vocation, $1)`), a partir do extrato — o da hunt, ou o **extrato de estado
  durável** que o shard da Cidade passa a gravar no logout e na drenagem para quem mudou
  vocação ou equipamento (agregados zerados; sem crédito). Volta pelo ticket
  (`InitialCharacter.vocation`) e chega ao cliente em `player-stats.vocationId` e
  `session-state.self.vocationId`. **Limite conhecido:** a Cidade não tem snapshot (ADR 0023) —
  uma escolha feita na praça e um nó que cai sem drenar se perdem juntos; é o mesmo risco que
  `equip` na praça já tinha.
- **Com o que se nasce:** machete na mão, leather helmet/armor/legs/boots no corpo e a mochila
  nas costas — dados na criação do personagem, não dropados (a exceção ao §21.1 registrada em
  `items.md`). No level 8 o kit da vocação entra por cima: a arma troca de lugar com a
  machete e o escudo veste no slot dele. Implementado (#153):
  as peças e os slots estão em `progression.startingKit`
  (`packages/content/data/progression/baseline.json`), e o boot recusa kit com item que não
  existe, no slot errado, que exija level ou vocação, ou com duas peças no mesmo slot. O kit da
  vocação é outro dado (`startingKit` em `vocations/*.json`, #496), conferido pelo boot do
  mesmo jeito — com a diferença de que arma de duas mãos e escudo são válidos lá (é o kit do
  Paladin), porque esse kit passa por `equip` e o estado impedido é alcançável. A
  mochila é um item nas costas até os containers do #160.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
