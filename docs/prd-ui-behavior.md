# PRD — Comportamento da Interface e Automações do Draconya

> **Origem:** documento do dono do produto (v2, 2026-09-14 — a v1, maior e menos precisa, fica
> fora do repositório). Versionado em 2026-09-16 como a especificação funcional do motor de ações
> e automações do plano de fidelidade ao kit (ADR 0030; `docs/kit-fidelity-plan.md`, M18). Como
> todo PRD, é instantâneo: o comportamento realmente construído vai para `docs/product/`.

**Tipo:** requisitos de produto  
**Escopo:** comportamento funcional, regras, casos de uso e critérios de aceite  
**Uso:** fonte para criação de épico e posterior decomposição em execução  
**Fora de escopo:** arquitetura, implementação, design visual, componentes, tarefas e estimativas

## 1. Objetivo

Definir o comportamento funcional da interface de jogo do Draconya a partir das referências fornecidas: HUD inspirado no Tibia v8, fluxos do Tibinha-Idle, configuração de ações, condições, automações de supply/equipamento, prioridade entre ações, cooldowns compartilhados, analisador de caçada e carregamento contínuo do viewport.

Este documento define **o que o produto deve fazer**. Não define como implementar.

---

## 2. Regras globais

### RG-001 — Atualização em tempo real
A interface deve refletir mudanças de HP, Mana, experiência, level, skills, equipamento, inventário, criaturas visíveis, alvo, cooldown, quantidade de consumíveis, automações e estatísticas da hunt sem reload.

### RG-002 — Interface não bloqueante
Abrir ou fechar menu, modal ou configuração não pausa a hunt, não interrompe cooldowns e não desliga automações.

### RG-003 — Estado compartilhado
A mesma informação exibida em locais diferentes deve usar o mesmo estado. HP lateral e circular, Mana lateral e circular, alvo da battle list e alvo operacional, equipamento e automações, inventário e action bar não podem divergir.

### RG-004 — Persistência
Configurações do jogador persistem entre sessões, exceto dados explicitamente restritos à hunt atual.

### RG-005 — Execução válida
Uma ação somente pode executar quando todos os requisitos necessários forem válidos: condição, recurso, cooldown, alvo, vocação, level, item disponível e prioridade.

### RG-006 — Condições múltiplas
Duas ou mais condições usam lógica AND. Todas precisam ser verdadeiras no mesmo ciclo de avaliação.

### RG-007 — Ação sem condição
Uma ação ativa sem condição configurada é elegível sempre que seus requisitos naturais forem válidos e não houver bloqueio de prioridade/cooldown.

---

## 3. Menus e modal de personagem

### Comportamento
Menus superiores e modais podem ser usados durante a hunt sem pausar o jogo.

O modal de personagem deve expor, quando disponível: nome, vocação, level, experiência, HP, Mana, velocidade, capacidade, Magic Level, skills, regeneração, stamina, atributos de combate, outfit, bônus e progressões.

### UC-CHAR-001 — Abrir personagem
**Quando** o jogador abrir o modal, **então** os dados atuais devem ser carregados.

### UC-CHAR-002 — Atualização com modal aberto
**Quando** experiência, level, HP, Mana ou skill mudar, **então** o modal deve atualizar sem ser fechado/reaberto.

### UC-CHAR-003 — Alterar aba
Trocar a aba interna não fecha o modal nem reinicia seus dados.

### Critérios de aceite
- abertura não pausa o jogo;
- dados permanecem vivos;
- subir level recalcula valores derivados.

---

## 4. Painel de skills

### Skills disponíveis
- experiência total;
- level;
- Magic Level;
- Fist Fighting;
- Club Fighting;
- Sword Fighting;
- Axe Fighting;
- Distance Fighting;
- Shielding;
- Fishing.

### Comportamento
O jogador pode adicionar, remover e reordenar skills acompanhadas. Cada skill mostra valor atual e progresso percentual quando aplicável.

### UC-SKL-001 — Adicionar
Adicionar uma skill ainda não exibida deve incluí-la imediatamente e persistir a escolha.

### UC-SKL-002 — Remover
Remover uma skill afeta somente sua exibição.

### UC-SKL-003 — Reordenar
A nova ordem deve ser persistida.

### UC-SKL-004 — Atualizar
Ganho de experiência ou skill atualiza automaticamente o item correspondente.

### Critérios de aceite
- não permite duplicidade;
- alteração de uma skill não altera outras;
- ordem persiste.

---

## 5. Painel de automações

### Comportamento
Cada automação possui:
- identificação;
- estado ativa/inativa;
- configuração;
- remoção.

O jogador pode criar, editar, ativar, desativar e remover.

### UC-AUT-001 — Criar
Selecionar “Adicionar automação” abre a configuração do tipo escolhido. Após salvar, ela aparece na lista.

### UC-AUT-002 — Ativar
Uma automação ativa passa a ter suas condições avaliadas.

### UC-AUT-003 — Desativar
Desativar interrompe novas execuções, mas mantém a configuração.

### UC-AUT-004 — Editar
Editar carrega os valores atuais e substitui a configuração após salvar.

### UC-AUT-005 — Remover
Remover elimina apenas aquela automação.

### Critérios de aceite
- configuração incompleta não ativa;
- alteração vale sem reload;
- desativar não apaga dados.

---

## 6. Renovação de anel e colar

### Comportamento
Permite renovar/substituir automaticamente o item do slot quando a regra configurada for satisfeita.

### Regras
A troca só ocorre se:
- automação estiver ativa;
- condição for verdadeira;
- item estiver disponível;
- slot for compatível;
- não houver bloqueio de execução aplicável.

### UC-EQP-001 — Renovar anel
Ao atingir a condição, equipar o anel configurado e atualizar o set.

### UC-EQP-002 — Renovar colar
Mesmo comportamento aplicado ao necklace.

### Critérios de aceite
- não simular sucesso se o item não existir;
- não repetir equipagem se o item correto já estiver equipado;
- não alterar outros slots.

---

## 7. Swap de Energy Ring

### Parâmetros
- condição de entrada;
- Energy Ring ou item equivalente;
- condição de retorno;
- item de retorno;
- ativo/inativo;
- opcionalmente: somente em combate e intervalo mínimo entre trocas.

### UC-ER-001 — Entrar no Energy Ring
**Dado que** a automação está ativa e HP satisfaz a condição de entrada, **quando** o item estiver disponível, **então** o Energy Ring deve ser equipado.

### UC-ER-002 — Não repetir
Se o Energy Ring já estiver equipado, a automação não tenta equipá-lo novamente enquanto a condição permanecer verdadeira.

### UC-ER-003 — Retornar
Quando a condição de retorno for satisfeita, o sistema tenta restaurar o anel configurado.

### UC-ER-004 — Item de retorno indisponível
Se o anel de retorno não estiver disponível, a restauração não pode ser considerada concluída.

### UC-ER-005 — Desativar
Desativar impede novas trocas e mantém a configuração.

### Critérios de aceite
- set atualiza imediatamente;
- não entra em loop de troca;
- estado real do slot sempre prevalece.

---

## 8. Troca de munição e equipamento

### Comportamento
Permite trocar automaticamente ammo, arma, shield/off-hand ou outras peças de set por condição.

### Condições suportadas
- HP;
- Mana;
- quantidade de alvos;
- estado de combate;
- condições adicionais suportadas pelo builder.

### UC-GEAR-001 — Ammo por número de alvos
Ao atingir o número configurado de alvos, equipar a munição alternativa.

### UC-GEAR-002 — Retornar ammo
Quando a condição deixar de ser verdadeira e houver regra de retorno, restaurar a munição padrão.

### UC-GEAR-003 — Arma/shield por condição
Ao satisfazer a condição, alterar apenas o slot configurado.

### UC-GEAR-004 — Peça por HP
Ao cruzar o limiar de HP, equipar a peça defensiva configurada.

### UC-GEAR-005 — Restaurar peça
Ao satisfazer a condição de retorno, restaurar o item padrão.

### Critérios de aceite
- não repete troca já satisfeita;
- falta de item bloqueia a ação;
- troca manual atualiza o estado observado pela automação.

---

## 9. HP e Mana

### Comportamento
HP e Mana devem apresentar valor atual, máximo e proporção.

### UC-STATUS-001 — Dano/cura
Mudanças de HP atualizam todos os indicadores e todas as condições dependentes.

### UC-STATUS-002 — Consumo/recuperação de Mana
Mudanças de Mana atualizam indicadores e elegibilidade de ações.

### UC-STATUS-003 — Mudança de máximo
Ao mudar HP/Mana máximo, recalcular percentual imediatamente.

### Critérios de aceite
- barras laterais e indicadores circulares nunca divergem;
- automações usam o mesmo valor exibido.

---

## 10. Indicadores circulares

### Comportamento
HP e Mana circulares ao redor do personagem são uma segunda representação do mesmo estado.

### Critérios de aceite
- dano e cura atualizam HP circular;
- consumo e regeneração atualizam Mana circular;
- proporções equivalem às barras laterais.

---

## 11. Set do personagem

### Comportamento
O set reflete o equipamento atual.

### UC-SET-001 — Equipar manualmente
Equipar um item válido atualiza o slot.

### UC-SET-002 — Trocar item
Ao substituir um item, slot e inventário são atualizados de forma consistente.

### UC-SET-003 — Desequipar
Remove o item do slot somente se existir destino válido conforme regra do jogo.

### UC-SET-004 — Swap automático
Troca automática deve aparecer imediatamente no set.

### Critérios de aceite
- set e automações usam o mesmo estado;
- item incompatível não equipa.

---

## 12. Postura de combate

### Estados
- defensiva;
- balanceada;
- atacante.

### Regra
Apenas uma postura pode estar ativa por vez.

### UC-COMBAT-001 — Alterar postura
Selecionar nova postura desativa a anterior e torna a nova o estado atual.

### Critérios de aceite
- nunca duas posturas simultâneas;
- estado ativo é visível e sincronizado.

---

## 13. Battle list

### Comportamento
Representa criaturas válidas na área de combate.

### UC-BTL-001 — Entrada
Criatura que entra na área válida aparece.

### UC-BTL-002 — Saída/morte
Criatura morta ou fora da área é removida.

### UC-BTL-003 — HP
Dano/cura da criatura atualiza sua informação.

### UC-BTL-004 — Selecionar alvo
Selecionar criatura define o alvo atual.

### UC-BTL-005 — Trocar alvo
Selecionar outra criatura remove o estado de alvo anterior.

### UC-BTL-006 — Alvo morre
Criatura morta deixa imediatamente de ser alvo válido.

### Critérios de aceite
- battle list e alvo operacional permanecem sincronizados;
- criatura inválida não pode continuar alvo.

---

## 14. Bolsa e mochila

### Comportamento
Itens e quantidades refletem o inventário atual.

### UC-INV-001 — Usar item
Validar quantidade, cooldown e requisitos antes do consumo.

### UC-INV-002 — Equipar item
Mover item válido para o set e atualizar origem/destino.

### UC-INV-003 — Receber item
Adicionar item atualiza quantidade sem reload.

### Critérios de aceite
- item consumido atualiza também slots da barra que usam esse item;
- movimentação nunca duplica item.

---

## 15. Barra de ações

### Tipos suportados
- magia;
- runa;
- item;
- potion;
- troca de equipamento;
- suporte.

### Estado por slot
- ação;
- quantidade;
- cooldown;
- custo;
- condições;
- habilitada/desabilitada;
- disponibilidade;
- bloqueio por prioridade.

### UC-BAR-001 — Trocar conjunto
Selecionar outro conjunto carrega seus slots sem modificar os demais conjuntos.

### UC-BAR-002 — Abrir configuração
Abrir um slot carrega sua configuração atual.

### UC-BAR-003 — Cooldown
Após execução, o slot deve indicar indisponibilidade até o cooldown terminar.

### UC-BAR-004 — Consumível
Após consumo, atualizar quantidade.

### UC-BAR-005 — Desabilitar rapidamente
A referência suporta `Shift + clique para desligar`. Ao usar o atalho, a ação permanece configurada, fica desabilitada e deixa de participar de execução/prioridade.

### Critérios de aceite
- ação desabilitada não executa;
- desabilitar não apaga;
- conjunto não interfere nos demais.

---

## 16. Editor de ações

### Categorias
- Magias;
- Runas;
- Itens.

### Dados da ação
Quando disponíveis:
- nome;
- descrição;
- custo;
- cooldown;
- efeito;
- dano/cura;
- requisito de level;
- restrição de vocação;
- alvo;
- condições;
- estado habilitada/desabilitada.

### UC-ACTION-001 — Criar
Selecionar categoria, ação, alvo/condições e salvar associa a ação ao slot.

### UC-ACTION-002 — Editar
A edição deve carregar os parâmetros existentes.

### UC-ACTION-003 — Remover
Remove somente aquela ação.

### UC-ACTION-004 — Prévia
Prévia é informativa e nunca executa a ação real.

### Critérios de aceite
- configuração inválida não ativa;
- edição não duplica ação;
- salvar substitui o estado anterior do slot.

---

## 17. Construtor de condições

### Estrutura
`Sujeito + Atributo + Operador + Valor + Unidade`

### Sujeitos identificados
- Você;
- Aliado;
- Área.

### Atributos identificados
- HP;
- Mana;
- número de alvos;
- Preso;
- Paralisado;
- Magic Shield.

### Operadores mínimos
- menor que;
- menor ou igual;
- maior que;
- maior ou igual;
- igual.

### UC-COND-001 — HP
Exemplo: `Você | HP | menor ou igual | 75%`.

### UC-COND-002 — Mana
Exemplo: `Você | Mana | maior ou igual | 20%`.

### UC-COND-003 — Área
Exemplo: `Área | Alvos | maior ou igual | 3`.

### UC-COND-004 — Estados
Preso, Paralisado e Magic Shield devem poder ser usados como condição.

### UC-COND-005 — Múltiplas condições
Todas precisam ser verdadeiras simultaneamente.

### UC-COND-006 — Remover condição
Remove apenas aquela condição e recalcula a regra.

### Critérios de aceite
- condição incompleta impede ativação;
- mudança no estado do jogo provoca nova avaliação;
- ação sem condição segue RG-007.

---

## 18. Cura própria e potions

### UC-HEAL-001 — Cura por HP
Se HP satisfizer a condição, houver Mana e cooldown estiver livre, a magia de cura pode executar.

### UC-HEAL-002 — Não curar acima do limite
Condição falsa impede execução.

### UC-POTION-001 — Potion de HP
Usar quando HP satisfizer a regra e houver item disponível.

### UC-POTION-002 — Potion de Mana
Usar quando Mana satisfizer a regra.

### UC-POTION-003 — Custo em gold
Quando o item tiver custo em gold, cobrar somente após uso válido.

### Critérios de aceite
- sem item/Mana/gold/cooldown válido não executa;
- tentativa bloqueada não consome recurso.

---

## 19. Cura de aliado

### Comportamento
Magia de cura em aliado possui alvo de cura e condições.

### UC-ALLY-001 — Selecionar membro
O jogador escolhe um membro válido da party.

### UC-ALLY-002 — Curar
Quando HP do aliado satisfizer a condição e Mana, cooldown, alcance e alvo forem válidos, a cura executa.

### UC-ALLY-003 — Trocar membro
Após salvar novo alvo, a automação observa o novo membro.

### UC-ALLY-004 — Alvo inválido
Aliado morto, distante, fora da party ou inelegível bloqueia a ação.

---

## 20. Magias de suporte, ofensivas e AoE

### UC-SUP-001 — Reaplicar suporte
Buff como Haste pode ser reaplicado após expirar, se a ação estiver ativa e elegível.

### UC-OFF-001 — Magia em alvo
Magia que exige alvo só executa com alvo válido.

### UC-AOE-001 — Quantidade mínima
Exemplo: `Área | Alvos | >= | 3`.

### UC-AOE-002 — Mana mínima
Pode combinar com `Mana >= 20%`.

### UC-AOE-003 — Execução
AoE só executa se todas as condições forem verdadeiras.

### Critérios de aceite
- não desperdiçar AoE abaixo do mínimo;
- suporte não reaplica continuamente se o efeito já estiver ativo;
- magia de alvo não executa sem alvo.

---

## 21. Runas e itens

### UC-RUNE-001 — Configurar
Runa pode possuir alvo, condições, quantidade e cooldown.

### UC-RUNE-002 — Executar
Só executa com item disponível, alvo válido quando necessário e condições satisfeitas.

### UC-ITEM-001 — Item por condição
Item associado à barra pode ser usado automaticamente quando sua condição for verdadeira.

### Critérios de aceite
- consumo atualiza inventário e barra;
- item indisponível bloqueia execução.

---

## 22. Alvo operacional

### Comportamento
A barra pode manter um alvo operacional para ações dependentes.

### UC-TARGET-001 — Selecionar
Trocar o alvo deve refletir imediatamente nas ações dependentes.

### UC-TARGET-002 — Alvo inválido
Se o alvo deixar de existir ou ficar inelegível, ações dependentes ficam bloqueadas.

---

## 23. Prioridade entre ações e cooldown compartilhado

### Objetivo
Resolver de forma determinística quando duas ou mais ações estão simultaneamente elegíveis e compartilham o mesmo cooldown.

### Comportamento de referência
No exemplo fornecido:
- Divine Missile está configurada e elegível;
- Ethereal Spear também está elegível;
- as duas compartilham cooldown;
- Ethereal Spear possui prioridade;
- quando ambas podem disparar, Ethereal Spear executa primeiro;
- Divine Missile fica bloqueada;
- o tooltip informa: `Bloqueado por Ethereal Spear — mesmo cooldown`;
- o tooltip explica que a ação prioritária dispara primeiro sempre que ambas puderem executar.

### RP-001 — Prioridade determinística
Em um mesmo grupo de cooldown, apenas uma ação pode vencer cada ciclo de execução.

### RP-002 — Prioridade pela ordem configurada
A ordem dos slots define prioridade entre ações que compartilham cooldown. A ação anterior possui precedência sobre ações posteriores, desde que esteja elegível.

### RP-003 — Apenas ações elegíveis disputam prioridade
Uma ação só bloqueia outra se ela própria puder executar naquele instante, exceto pelo cooldown compartilhado que será iniciado por sua execução.

### RP-004 — Ação prioritária inelegível não bloqueia
Se a ação anterior estiver:
- desabilitada;
- sem Mana;
- sem item;
- sem alvo;
- com condição falsa;
- com requisito inválido;
ela é ignorada na disputa e a próxima ação elegível pode executar.

### RP-005 — Bloqueio não altera configuração
Uma ação bloqueada por prioridade:
- continua ativa;
- continua configurada;
- não perde condições;
- apenas não executa naquele ciclo.

### RP-006 — Cooldown compartilhado
Quando uma ação vencedora executar, todas as ações do mesmo grupo ficam indisponíveis durante o cooldown compartilhado correspondente.

### RP-007 — Cooldown individual
Cooldown individual e cooldown compartilhado são estados distintos. Uma ação pode estar livre individualmente e ainda bloqueada pelo grupo.

### RP-008 — Reavaliação após cooldown
Quando o cooldown compartilhado terminar, todas as ações do grupo devem ser avaliadas novamente usando o estado atual do jogo.

### RP-009 — Mudança de prioridade
Alterar a ordem das ações deve alterar a prioridade nos ciclos seguintes.

### RP-010 — Desabilitação imediata
`Shift + clique` ou outra ação de desabilitar remove a ação da disputa de prioridade imediatamente, sem apagar sua configuração.

### RP-011 — Informação de bloqueio
Uma ação bloqueada por outra deve disponibilizar:
- ação bloqueadora;
- motivo: cooldown compartilhado;
- indicação de prioridade.

### UC-PRIO-001 — Duas ações elegíveis
**Dado que** A e B compartilham cooldown e ambas estão elegíveis, **quando** o ciclo for avaliado, **então** apenas a ação de maior prioridade executa e a outra fica bloqueada.

### UC-PRIO-002 — Prioritária sem Mana
Se A possui prioridade, mas não tem Mana, B pode executar se estiver elegível.

### UC-PRIO-003 — Prioritária com condição falsa
Se A possui prioridade, mas sua condição é falsa, B pode executar.

### UC-PRIO-004 — Prioritária desabilitada
Se A for desabilitada, deixa de bloquear B imediatamente.

### UC-PRIO-005 — Fim do cooldown
Ao terminar o cooldown, o sistema não repete automaticamente a decisão anterior: reavalia as condições atuais.

### Critérios de aceite
- nunca executar duas ações do mesmo cooldown simultaneamente;
- prioridade sempre previsível;
- ação inelegível nunca bloqueia ação posterior elegível;
- tooltip identifica ação bloqueadora;
- fim de cooldown provoca nova avaliação;
- alteração de ordem muda prioridade;
- não existe loop de tentativa de execução.

---

## 24. Tooltip de ação

### Deve informar, quando aplicável
- nome;
- Mana/gold;
- descrição;
- cooldown;
- dano/cura;
- condição;
- alvo;
- status habilitada/desabilitada;
- motivo de bloqueio;
- ação de maior prioridade responsável pelo bloqueio.

### UC-TIP-001 — Bloqueada por cooldown compartilhado
Exibir a ação responsável e o motivo.

### UC-TIP-002 — Desabilitar
Quando `Shift + clique para desligar` for acionado, a ação permanece configurada e deixa de executar imediatamente.

### Critérios de aceite
- tooltip nunca indica disponibilidade quando a ação está bloqueada;
- motivo visual corresponde ao estado real.

---

## 25. Analisador de caçada

### Métricas
- duração;
- tempo estimado para próximo level;
- experiência total;
- XP/h;
- loot total;
- loot/h;
- lucro;
- lucro/h;
- kills;
- distribuição por criatura;
- outras métricas disponíveis da sessão.

### UC-HUNT-001 — Experiência
Ganho de experiência atualiza total, XP/h e estimativas.

### UC-HUNT-002 — Loot
Novo loot atualiza total e taxas.

### UC-HUNT-003 — Kill
Morte de criatura incrementa sua contagem.

### UC-HUNT-004 — Fechar modal
Fechar não reinicia a sessão.

### Critérios de aceite
- métricas independem de o modal estar aberto;
- sessão muda apenas conforme regras de início/fim da hunt.

---

## 26. Estado da hunt

### Comportamento
A interface pode mostrar:
- local;
- tempo restante;
- saída;
- troca de local.

### UC-SESSION-001 — Sair
Solicitar saída executa o fluxo válido e atualiza o estado.

### UC-SESSION-002 — Trocar local
Solicitar troca muda o local conforme regras da hunt e atualiza a sessão exibida.

---

## 27. Viewport e carregamento contínuo

### RV-001 — Sem loading bloqueante
Novas áreas entram no viewport sem tela de loading que interrompa a caminhada.

### RV-002 — HUD fixo
Mapa/câmera se movem; HUD permanece em coordenadas de tela.

### RV-003 — Animações contínuas
Carregar nova região não congela animações já visíveis.

### RV-004 — Estado preservado
HP, Mana, cooldowns, buffs, hunt e automações continuam ativos durante deslocamento.

### UC-WORLD-001 — Entrar em nova região
O personagem continua andando enquanto novos tiles/objetos aparecem, sem remontagem completa do HUD.

### Critérios de aceite
- HUD não pisca ou desaparece;
- caminhada não é interrompida por loading visual;
- automações continuam sendo avaliadas.

---

## 28. Cooldowns e recursos

### Tipos de cooldown
- individual;
- compartilhado.

### UC-CD-001 — Executar
Após executar, iniciar cooldown aplicável.

### UC-CD-002 — Finalizar
Ao terminar, ação/grupo volta a ser avaliado.

### UC-RES-001 — Mana
Sem Mana suficiente, magia não executa.

### UC-RES-002 — Item
Sem item, ação não executa.

### UC-RES-003 — Gold
Sem saldo suficiente, ação com custo não executa. O custo só é debitado após execução válida.

### Critérios de aceite
- tentativa bloqueada não consome recurso;
- cooldown impede duplicação;
- cooldown compartilhado respeita prioridade.

---

## 29. Sincronização

### HP
Sincroniza:
- lateral;
- circular;
- cura;
- Energy Ring;
- set swap;
- condições.

### Mana
Sincroniza:
- lateral;
- circular;
- condições;
- disponibilidade de magia.

### Equipamento
Sincroniza:
- set;
- inventário;
- automações.

### Inventário
Sincroniza:
- bolsa;
- mochila;
- action bar;
- automações.

### Alvo
Sincroniza:
- battle list;
- action bar;
- magias;
- runas;
- cura/alvo quando aplicável.

---

## 30. Conflitos entre automações

### RC-001 — Mesmo slot
Duas regras que tentam alterar o mesmo slot devem ter resolução determinística.

### RC-002 — Estado já satisfeito
Se o item desejado já estiver equipado, não executar novamente.

### RC-003 — Reavaliação
Após qualquer automação alterar estado, a próxima avaliação deve usar o novo estado.

### RC-004 — Sem loop
Regras de entrada/retorno ou automações concorrentes não podem produzir alternância infinita.

### Critérios de aceite
- sem spam de equipagem;
- sem ações duplicadas no mesmo ciclo;
- sem loops entre duas automações.

---

## 31. Estados inválidos

### Casos
- item acabou;
- aliado saiu da party;
- alvo morreu;
- alvo saiu da área;
- Mana insuficiente;
- requisito de level/vocação inválido;
- configuração incompleta.

### Comportamento
- ação não executa;
- configuração permanece salva;
- execução não é exibida como sucesso.

---

## 32. Persistência

Devem persistir:
- skills selecionadas;
- ordem das skills;
- automações;
- parâmetros;
- estados ativo/inativo;
- ações da barra;
- condições;
- conjuntos;
- ordem/prioridade;
- preferências aplicáveis.

### Critérios de aceite
- reabrir sessão não duplica configurações;
- conjuntos permanecem independentes;
- prioridade preserva a ordem configurada.

---

## 33. Critérios gerais de aceite

- [ ] menus e modais não pausam o jogo;
- [ ] estado do personagem atualiza em tempo real;
- [ ] skills podem ser adicionadas, removidas e reordenadas;
- [ ] automações podem ser criadas, editadas, ativadas, desativadas e removidas;
- [ ] renovação de anel e colar funciona;
- [ ] Energy Ring possui condição de entrada e retorno;
- [ ] ammo pode ser trocada por número de alvos;
- [ ] arma, shield e peças podem ser trocadas por condição;
- [ ] HP e Mana permanecem sincronizados em todas as representações;
- [ ] set reflete ações manuais e automáticas;
- [ ] posturas são mutuamente exclusivas;
- [ ] battle list adiciona/remove criaturas e sincroniza alvo;
- [ ] bolsa/mochila sincronizam com action bar;
- [ ] barra suporta magia, runa, item, potion, equipamento e suporte;
- [ ] múltiplos conjuntos permanecem independentes;
- [ ] ação pode ser desabilitada sem ser removida;
- [ ] Shift + clique desabilita ação quando habilitado para esse fluxo;
- [ ] conditions builder suporta HP, Mana, quantidade de alvos, Preso, Paralisado e Magic Shield;
- [ ] múltiplas condições usam AND;
- [ ] cura própria funciona;
- [ ] potion automática funciona;
- [ ] cura de aliado funciona;
- [ ] magias ofensivas respeitam alvo;
- [ ] AoE respeita quantidade mínima de alvos;
- [ ] runas respeitam alvo, quantidade e cooldown;
- [ ] cooldown individual funciona;
- [ ] cooldown compartilhado funciona;
- [ ] ações no mesmo cooldown respeitam prioridade por ordem;
- [ ] ação prioritária inelegível não bloqueia a seguinte;
- [ ] somente ações elegíveis disputam prioridade;
- [ ] tooltip identifica ação bloqueadora e motivo;
- [ ] fim do cooldown reavalia o estado atual;
- [ ] analisador mantém métricas da sessão;
- [ ] fechar analisador não reinicia a hunt;
- [ ] viewport permite caminhada sem loading bloqueante;
- [ ] HUD permanece fixo durante deslocamento;
- [ ] animações ambientais continuam;
- [ ] automações continuam durante deslocamento;
- [ ] configurações persistem;
- [ ] conflitos não geram loops;
- [ ] ação inválida não consome recurso nem gera falso sucesso.

---

## 34. Fora de escopo

Este PRD não especifica:
- épicos;
- histórias;
- tarefas;
- estimativas;
- arquitetura;
- APIs;
- banco de dados;
- estrutura de código;
- componentes;
- CSS;
- cores;
- dimensões;
- tipografia;
- design system.

A decomposição futura deve usar estas regras como fonte de verdade funcional.
