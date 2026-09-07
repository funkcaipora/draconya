# Onboarding e tutorial

**Status:** não implementado
**PRD:** §7.4, §8
**Épico:** E14 (tutorial guiado do level 1 ao 8 com escolha de vocação). E0 cobre o que precede o tutorial — CRUD e criação inicial de personagem.

## Comportamento

O jogador escolhe o nome do personagem antes de qualquer outra coisa — é a primeira decisão do fluxo. Em seguida entra direto no tutorial, sem escolher vocação ainda. O tutorial ocorre entre os levels 1 e 8 e ensina fazendo: o jogador aprende jogando, não lendo telas de explicação separadas da ação.

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
| Quantidade de vocações apresentadas | 4 | caminho previsto: `packages/content/vocacoes` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. O conteúdo exato de cada preset de hotkeys por vocação/estágio não está detalhado no PRD, mas também não está marcado como decisão pendente — é tratado como trabalho de conteúdo a ser produzido, não como lacuna de design.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
