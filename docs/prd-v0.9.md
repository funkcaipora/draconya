# Draconya - Product Requirements Document (PRD)

**Versão:** 0.9 - consolidado para handoff técnico  
**Data:** 07/09/2026  
**Status:** Game design macro consolidado; pronto para definição de arquitetura, stack e plano técnico do MVP  
**Documento-base técnico analisado:** `arquitetura.md`  
**Referências de experiência:** Tibia, Huntera e OTClientV8  

---

## 1. Objetivo deste documento

Este PRD consolida as decisões de produto e game design definidas para o Draconya. Seu objetivo é servir de **handoff para uma etapa separada de definição técnica**, na qual serão escolhidos arquitetura, stack, serviços, modelo de dados, protocolo, infraestrutura, pagamentos, observabilidade e plano de implementação.

O PRD descreve **o que o produto precisa fazer**, quais regras devem ser respeitadas, quais sistemas pertencem ao MVP e quais capacidades devem ficar preparadas para evolução futura. Ele deliberadamente **não escolhe linguagem, banco de dados, framework, engine web ou provedor de infraestrutura**.

O arquivo `arquitetura.md` continua sendo uma referência de restrições técnicas e de custo. Onde uma decisão de produto posterior conflitar com uma hipótese antiga desse arquivo, **a decisão mais recente deste PRD prevalece como requisito de produto**. Exemplo: stamina em zero não encerra mais automaticamente uma hunt; a sessão pode continuar sem gerar XP, loot ou progresso de Livraria.

### 1.1 Convenções

- **[DECIDIDO]**: regra definida e que deve ser tratada como requisito.
- **[PARÂMETRO]**: regra definida, mas número deve permanecer configurável para balanceamento.
- **[ABERTO]**: decisão ainda não fechada; não deve ser inventada na implementação.
- **[MVP]**: obrigatório no vertical slice inicial.
- **[FUTURO]**: fora do MVP, mas pode exigir preparação estrutural.

---

## 2. Visão do produto

Draconya é um MMORPG de navegador, em pixel art e grade de tiles, inspirado na estrutura de progressão do Tibia, mas construído ao redor de uma experiência principal **idle/AFK oficializada no servidor**.

O jogador desenvolve um personagem persistente, sobe de level, evolui skills pelo uso, troca equipamentos, monta builds, completa Livraria, utiliza Prey, enfrenta bosses, realiza quests e participa de guildas. A principal fonte de progressão cotidiana é a hunt automatizada, que continua rodando mesmo com o navegador fechado.

Ao lado dessa progressão persistente, o jogo possui conteúdos manuais instanciados. No MVP, o principal conteúdo competitivo é a **Guild War 15x15 pelo trono**. O objetivo é combinar a profundidade de um MMORPG tradicional com a acessibilidade de jogos modernos em que o usuário consegue entrar em um modo estruturado, jogar e sair sem transformar toda morte em uma perda destrutiva de itens.

### 2.1 Frase de produto

> Um MMORPG no estilo Tibia em que o bot é oficial, server-side e parte do game design: o jogador progride principalmente em hunts idle e usa seu personagem em conteúdos cooperativos e competitivos instanciados.

---

## 3. Princípios de design

### 3.1 Idle é a experiência principal

**[DECIDIDO]** A hunt AFK é o centro da experiência. O jogador não precisa manter o navegador aberto para que a hunt continue. O client é um visualizador e uma interface de configuração da sessão, não a fonte da simulação.

### 3.2 Progressão persistente de RPG

O personagem cresce em level, skills, equipamentos, passivas, Livraria e outros sistemas permanentes. O jogador deve sentir evolução de longo prazo mesmo quando consome conteúdo em sessões curtas.

### 3.3 Multiplayer deve ser incentivado, não punido

Party deve ser economicamente e progressivamente viável. A composição de vocações diferentes gera bônus de XP e os gastos de supplies são equalizados para que vocações naturalmente mais caras não carreguem sozinhas o custo da hunt.

### 3.4 Automação acessível primeiro, profundidade depois

O jogador começa com bot simplificado. O bot avançado é desbloqueado no level 50 e adiciona ferramentas como lure dinâmico e ring swap. A complexidade deve aparecer depois que o jogador já aprendeu o loop básico.

### 3.5 O cliente deve manter densidade de MMORPG

A interface deve parecer um client de RPG, não um dashboard minimalista. Equipamento, mochila, skills, chat, bot e analisadores devem ficar acessíveis sem esconder permanentemente o mundo.

### 3.6 PvP estruturado, sem PvP aberto no mundo

No MVP não há emboscada ou PvP aberto. O PvP acontece em uma instância dedicada de Guild War.

### 3.7 Itens são previsíveis

Equipamentos possuem atributos base fixos. Não há rolagem aleatória de stats. O valor vem do item em si, da raridade, dos imbuements, da forja futura e da economia.

### 3.8 Sem perda de item na morte

A morte pode ser relevante pela perda de XP, inclusive causando perda de level, mas **nunca remove equipamentos ou itens**.

### 3.9 Conteúdo deve ser orientado a configuração

Números de balanceamento - XP, loot, preços, cooldowns, stamina, Prey, Livraria, dificuldades e bônus - devem ser tratados como dados/configuração e não como regras impossíveis de alterar sem uma nova versão do produto.

---

## 4. Escopo do MVP

O MVP é um **vertical slice técnico e de produto**, não um lançamento com volume final de conteúdo.

| Sistema | Escopo do MVP |
|---|---|
| Plataforma | Navegador, foco desktop, responsivo no celular |
| Vocações | 4 |
| Tutorial | Level 1 ao 8 |
| Hunt | 1 hunt para validar o sistema |
| Boss | 1 boss, inicialmente no modo Iniciante |
| Quest | 1 quest |
| Guild War | 1 mapa, 15x15 pelo trono |
| Bot | Básico + avançado desbloqueado no level 50 |
| Treino | Online e offline |
| Stamina | Sim |
| Party / matchmaking | Sim, até 4 em hunts |
| Prey | Sim |
| Livraria | Sim |
| Equipment / inventory | Sim |
| Imbuement | Sim |
| Forja | Não; preparado para futuro |
| Market por gold | Sim |
| Coins | Sim; compra por PIX/cripto e trade por gold |
| Premium | Sim |
| RMT de lendários/personagens | Não; interface "Em breve" |
| Housing | Não |
| Profissões/crafting de coleta | Não |
| Arenas PvP adicionais | Não |
| Eventos sazonais | Não |

### 4.1 Conteúdo de combate no MVP

As magias disponíveis devem usar como **referência de escopo funcional** as magias do Tibia até aproximadamente level 120. O PRD não reproduz catálogo proprietário nem exige reutilização de nomes, assets ou código; o conteúdo final deve ser definido/licenciado adequadamente.

---

## 5. Plataforma e experiência do client

### 5.1 Plataforma

**[DECIDIDO]**

- O produto nasce para navegador.
- O foco inicial de experiência é desktop com teclado e mouse.
- O layout deve ser responsivo e renderizar adequadamente no celular.
- Jogabilidade mobile completa não é requisito prioritário do MVP.
- Client nativo futuro permanece em aberto.

### 5.2 Referência de interface

A principal referência de organização é o **OTClientV8**, combinado com a aparência moderna observada no Huntera.

A referência ao OTClientV8 é de **estrutura, fluxo e ergonomia**: painéis laterais, containers, hotkeys, battle list, densidade de informação, organização do HUD e comportamento de janelas. O repositório OTClientV8 é distribuído sob licença MIT, mas isso **não concede direito de reutilizar assets, sprites, marcas ou conteúdo proprietário do Tibia**.

Referência: `https://github.com/OTCv8/otclientv8`

### 5.3 Geografia da UI

**Lateral direita:**

- set/equipamentos;
- bolsa/mochilas;
- skills;
- módulos persistentes de personagem.

**Lateral esquerda:**

- bot/automação;
- configurações da hunt;
- ferramentas avançadas quando desbloqueadas.

**Centro:**

- viewport do mundo;
- janelas grandes e temporárias, como seleção de hunt, Prey, boss, quest, market e configurações.

**Canto inferior esquerdo:**

- chat, minimizável.

**Topo:**

- menus principais, incluindo Hunt, Prey, Quest, Boss, Guild/War, Market e demais sistemas habilitados.

### 5.4 HP e Mana

**[DECIDIDO]** Usar indicadores circulares de vida e mana inspirados no client moderno do Tibia, posicionados para leitura rápida sem deslocar o olhar para longe da ação.

### 5.5 Continuidade de interface entre PvE e PvP

**[DECIDIDO]** Entrar em conteúdo manual não deve reorganizar completamente a tela. Inventário, equipamento, chat, HP/Mana e informações persistentes permanecem nos mesmos lugares. Em Guild War, hotkeys manuais ganham protagonismo, mas a geografia principal do client permanece familiar.

### 5.6 Janelas

Alguns módulos são persistentes nas laterais; outros abrem sobre o centro. O produto deve suportar minimizar os módulos de chat e analisador de hunt. O nível exato de redimensionamento/reorganização livre de painéis ainda é **[ABERTO]**.

---

## 6. Estados exclusivos do personagem

**[DECIDIDO]** Cada personagem pode estar em apenas um estado principal de atividade por vez:

1. PZ / Cidade;
2. Hunt;
3. Treino;
4. Quest;
5. Boss;
6. Guild War.

Um personagem não pode, por exemplo, estar simultaneamente em treino e hunt.

### 6.1 Presença do client

- **Hunt:** client opcional; a sessão continua sem navegador.
- **Treino online:** client ativo.
- **Treino offline:** continua até o limite permitido.
- **Quest/Boss/Guild War:** modo manual; personagem depende do input do jogador quando conectado.

### 6.2 Reconexão

**[DECIDIDO]** Em conteúdo manual, desconectar não remove o personagem. Ele permanece fisicamente no local, parado e vulnerável. Ao reconectar, o client simplesmente se reanexa ao personagem existente, exatamente no estado e posição em que ele estiver naquele momento.

---

## 7. Conta, personagens e identidade

### 7.1 Personagens por conta

**[DECIDIDO]**

- Quantidade de personagens por conta: ilimitada.
- Máximo de personagens simultaneamente logados por conta: 2.
- Os dois podem estar em hunts AFK ao mesmo tempo.
- Cada personagem é independente e isolado em progressão, inventário, stamina, Livraria, Premium e sessões.

### 7.2 Coins

Coins pertencem à **conta**, não a um personagem específico.

### 7.3 Premium

Premium é adquirido **por personagem**, mesmo que a moeda usada para comprá-lo esteja na conta.

### 7.4 Nome, aparência e criação inicial

**[DECIDIDO]**

- O nome é a primeira escolha do jogador.
- O jogador entra no tutorial antes de escolher vocação.
- A aparência pode ser personalizada depois do tutorial.
- Vocação é escolhida no level 8.

---

## 8. Onboarding e tutorial

### 8.1 Estrutura

**[DECIDIDO]** O tutorial ocorre entre os levels 1 e 8 e ensina fazendo, sem depender de o jogador descobrir a interface sozinho.

Deve introduzir:

- barras de HP/Mana;
- action bar/hotkeys;
- skills;
- movimentação e interação básicas;
- noção de hunt idle;
- noção de equipamentos e mochila;
- leitura básica do client.

### 8.2 Hotkeys guiadas

Cada vocação/estágio deve possuir presets de hotkeys preparados pelo produto. O jogador recebe uma barra funcional e, conforme novas habilidades são desbloqueadas, o jogo pode atualizar o preset de maneira orientada. Depois, o usuário pode customizar a configuração.

### 8.3 Escolha de vocação no level 8

No level 8, o jogador recebe uma explicação curta de cada uma das quatro vocações: papel, resistência, dano, cura/suporte e estilo geral. Depois escolhe sua vocação.

---

## 9. Vocações, level e progressão

### 9.1 Vocações

O jogo terá quatro arquétipos equivalentes aos papéis clássicos:

- Cavaleiro;
- Druida/Curandeiro;
- Feiticeiro;
- Arqueiro.

Os nomes finais de classe e de promoção ainda são **[ABERTO]**.

### 9.2 Promoção de vocação

**[DECIDIDO]** Haverá inicialmente uma única promoção permanente de classe, obtida por quest. A maioria das magias é liberada automaticamente por level; as magias mais fortes ficam condicionadas à promoção.

O sistema deve permitir promoções adicionais no futuro sem exigir remodelagem completa do personagem.

### 9.3 Atributos por level

Os atributos são concedidos automaticamente por vocação, sem distribuição manual de HP/Mana.

Definições já dadas:

- Cavaleiro: +20 HP e +5 Mana por level.
- Arqueiro: +15 HP e +10 Mana por level.
- Feiticeiro/Mago: +5 HP e +25 Mana por level.
- Druida: **[ABERTO]**.

### 9.4 Skills por uso

**[DECIDIDO]** Skills sobem pelo uso, seguindo o paradigma do Tibia, e não simplesmente pelo level.

### 9.5 Árvore de passivas

**[DECIDIDO]** Cada personagem recebe pontos de passiva ao longo da progressão e os distribui em uma árvore própria da vocação, permitindo caminhos como dano, suporte e sustain.

**[DECIDIDO]** Os pontos podem ser redistribuídos livremente em PZ, quantas vezes o jogador quiser.

**[ABERTO]** A curva exata de ganho de pontos e o teto final ainda não foram fechados. Foi discutida uma desaceleração progressiva em levels altos; a implementação deve deixar a tabela configurável.

---

## 10. Stamina

### 10.1 Capacidade e recuperação

**[DECIDIDO]**

- Stamina máxima: 24 horas.
- Recuperação: 1 minuto fora de hunt = 1 minuto de stamina.
- Estar em treino conta como estar fora de hunt e recupera stamina.

### 10.2 Stamina em zero

Quando chega a 0:

- personagem continua dentro da hunt;
- continua andando;
- continua atacando;
- continua usando supplies e gastando gold;
- pode morrer normalmente;
- não recebe XP;
- não recebe loot;
- não contabiliza abates para a Livraria.

A hunt não é encerrada automaticamente por stamina zerada.

---

## 11. Treino

### 11.1 Entrada

O jogador escolhe o modo Treino e é enviado para uma instância dedicada.

### 11.2 Funcionamento

**[DECIDIDO]**

- Dois Trainer Monks atacam o personagem continuamente.
- Os ataques dos trainers não causam dano efetivo.
- O objetivo é manter evolução de shielding/defesa e permitir treino de skills.
- Supplies usados no treino são infinitos e não custam gold.
- Poções, runas e munição necessárias ao treino não geram custo.

### 11.3 Online e offline

- Com client ativo, o personagem pode permanecer treinando.
- Ao desconectar, continua treinando offline.
- Free: até 6 horas de treino offline.
- Premium: até 12 horas de treino offline.
- Após o limite, o treino offline para.
- Durante todo o tempo de treino elegível, stamina recupera na proporção normal de 1:1.

---

## 12. Modelo de combate

### 12.1 Referência

**[DECIDIDO]** A matemática e comportamento geral de combate devem usar o Tibia como referência funcional, salvo as exceções explicitamente definidas neste PRD. A definição técnica deve tratar fórmulas e parâmetros como conteúdo configurável, não como dependência de código proprietário.

### 12.2 Acerto e Dodge

- Ataques realizados por jogadores sempre acertam o alvo.
- Não há miss ofensivo do jogador.
- Existe atributo Dodge para o defensor.
- Quando Dodge ativa, o ataque recebido causa **50% do dano que causaria normalmente**.
- Dodge pode ativar contra qualquer ataque recebido, incluindo magia e ataques de bosses.
- A chance de Dodge é percentual e pode ser obtida por sistemas como Livraria.

### 12.3 PvE x PvP

Bônus permanentes da Livraria são **PvE-only**. O PvP não deve herdar automaticamente vantagens de farm de Livraria.

---

## 13. Sistema de automação / Bot

### 13.1 Princípio

A automação é parte oficial do produto e deve executar no servidor. O jogador configura regras; o client não precisa permanecer aberto para que a hunt funcione.

### 13.2 Bot básico e avançado

- Do início até level 49: bot simplificado, inspirado na experiência do Huntera.
- A partir do level 50: bot avançado.
- Ferramentas como lure dinâmico e ring swap pertencem ao conjunto avançado.

O subconjunto exato de opções do bot básico ainda é **[ABERTO]** e deve ser definido a partir do bot completo abaixo.

### 13.3 Categorias e slots

**Magias de cura:** 3 slots.

Condições possíveis incluem HP e Mana com operadores `<`, `>`, `<=`, `>=`.

**Potions:** 4 slots.

- 2 slots de vida;
- 2 slots de mana;
- Spirit Potion pode ser elegível para ambas as categorias.

**Magias de ataque:** 10 slots.

Condições podem incluir:

- quantidade de alvos;
- vida do alvo;
- Mana do personagem;
- outras variáveis previstas no vocabulário fechado do bot.

**Runas e itens:** 10 slots.

**Magias de suporte:** 10 slots.

Incluem, entre outras:

- haste/correr;
- buffs;
- cura de aliado.

### 13.4 Prioridade de execução

**[DECIDIDO]** Não existe prioridade global entre categorias.

Cada categoria possui cooldown próprio e avalia seus slots de cima para baixo. A primeira regra válida é executada.

Exemplo:

1. HP <= 30% -> cura forte;
2. HP <= 55% -> cura média;
3. HP <= 80% -> cura fraca.

Se a regra 1 for válida, as demais daquela categoria não executam naquele ciclo.

### 13.5 Cooldowns por categoria

**[DECIDIDO]** Existe cooldown de 1 segundo por tipo de ação, além do cooldown próprio da magia/item quando houver.

Categorias independentes:

- Cura;
- Runa;
- Potion;
- Magia de ataque;
- Magia de suporte.

Uma ação de uma categoria não deve, por padrão, consumir o cooldown independente de outra categoria.

### 13.6 Targeting

O bot deve suportar:

- alvo mais próximo;
- menor HP;
- maior HP;
- priorizar criaturas específicas;
- ignorar criaturas específicas;
- seguir o alvo;
- permanecer parado;
- manter distância configurada.

### 13.7 Lure dinâmico - Bot avançado

O jogador configura um intervalo mínimo/máximo de monstros.

Exemplo:

- mínimo = 4;
- máximo = 8.

Com a quantidade abaixo do mínimo, o personagem volta a percorrer a rota acumulando inimigos. Ao atingir o máximo, para e limpa o grupo. Depois volta a correr quando a quantidade cai novamente abaixo do mínimo.

### 13.8 Ring swap - Bot avançado

O bot deve permitir uma máquina de estados para Energy Ring e anéis semelhantes.

Exemplo:

- HP < 50% -> equipar Energy Ring;
- HP >= 60% -> retirar Energy Ring;
- Mana < 10% -> desativar/retirar Energy Ring.

Ao retirar, o jogador escolhe entre:

- restaurar o anel anteriormente equipado;
- deixar o slot vazio.

A separação entre limiar de entrada e saída deve evitar troca repetitiva perto do mesmo percentual.

### 13.9 Regras automáticas de saída da hunt

O jogador pode configurar duas regras de saída:

1. **Sair se alguém da party sair ou morrer.**
2. **Sair se meu gold acabar.**

Se não ativar a segunda regra e o gold acabar, o personagem permanece na hunt, fica sem conseguir pagar seus supplies e pode morrer.

---

## 14. Hunts

### 14.1 Instâncias

**[DECIDIDO]** Hunts são instâncias isoladas. Não há disputa aberta por spawn nem exploração contínua do mundo para chegar à hunt.

### 14.2 Acesso

O jogador abre o menu de Hunt no client e escolhe uma hunt disponível.

Hunts base ficam acessíveis por padrão. Algumas hunts especiais podem depender de:

- quest;
- conquista/controle de guilda;
- requisito específico futuro.

VIP/Premium não deve ser usado no MVP como trava para uma hunt de loot superior.

### 14.3 Informação mostrada na seleção

Mostrar **level recomendado** da hunt. Não mostrar estimativa oficial de XP/h ou gold/h antes da entrada.

### 14.4 Rota

**[DECIDIDO]** Cada hunt possui uma rota única, fixa e predeterminada. O bot não escolhe caminhos alternativos.

A rota deve formar um loop lógico, podendo ser circular ou usar subidas/descidas que retornem ao ponto de origem.

### 14.5 Spawns

- Pontos de respawn são definidos por design.
- Quantidade e composição de monstros são dados da hunt/dificuldade.
- Não existe variação aleatória de densidade para o MVP.

### 14.6 Dificuldades

Quatro dificuldades:

1. Iniciante;
2. Profissional;
3. Herói;
4. Lendário.

A referência inicial de densidade discutida foi aproximadamente 2 / 4 / 8 / 12 monstros por ponto, mas **a composição real é por hunt e deve permanecer configurável**.

Além de aumentar quantidade, dificuldades mais altas podem introduzir variantes mais fortes coerentes com a temática.

Exemplo conceitual: uma hunt de vampiros pode começar apenas com vampiros básicos e adicionar variantes cerimoniais/escuras em dificuldades superiores.

### 14.7 Mudança de dificuldade

O jogador pode mudar a dificuldade durante sua jornada, mas isso **encerra a instância atual e cria uma nova**. Não existe alteração dinâmica dentro da mesma instância.

Em party, a troca exige votação/aprovação dos membros.

### 14.8 Encerramento

A hunt pode terminar por:

- ação manual do jogador;
- regra automática de saída configurada;
- morte;
- demais condições específicas de sessão que venham a ser adicionadas depois.

Stamina zero, por si só, não encerra a hunt.

---

## 15. Party e matchmaking para hunt

### 15.1 Tamanho

**[DECIDIDO]** Party de hunt: máximo 4 jogadores.

### 15.2 Matchmaking

O matchmaking **forma a party**, mas não escolhe nem inicia automaticamente a hunt.

Fluxo:

1. jogadores procuram outros interessados;
2. matchmaking reúne jogadores compatíveis;
3. líder escolhe a hunt;
4. participantes aprovam;
5. party inicia.

A party pode começar com menos de 4 jogadores se todos os membros atuais aprovarem iniciar naquela composição.

### 15.3 Composição e bônus de XP

A intenção de design é premiar **vocações únicas**.

- Vocações repetidas não geram bônus adicional.
- XP do grupo é calculada a partir de um pool coletivo e dividida pelos membros.
- Cada vocação única adicional aumenta o bônus coletivo.

**[ABERTO - balanceamento obrigatório]** A conversa teve exemplos numéricos conflitantes sobre a fórmula final. A regra qualitativa acima está decidida, mas o multiplicador exato deve ser confirmado antes de balanceamento final. O sistema técnico deve aceitar uma tabela/configuração por número de membros e número de vocações únicas.

### 15.4 Equalização de gastos

Supplies abstratos consumidos durante a hunt - poções, runas e munições pagas em gold - têm seus gastos equalizados entre os membros da party.

Exemplo: se dois jogadores consumirem 50k e 100k em supplies, o custo total de 150k deve ser repartido de forma justa, resultando em 75k de custo efetivo para cada um.

Anéis e colares consumíveis **não entram** nessa equalização.

**[ABERTO]** O momento contábil exato da compensação (tempo real ou settlement periódico/final) é decisão técnica desde que o resultado econômico seja o mesmo e seja auditável.

### 15.5 Loot em party

- Não existe prioridade por last hit.
- Não existe prioridade por maior dano.
- Cada membro parte da mesma chance base de loot.
- Cada jogador aplica seus próprios modificadores individuais, como Prey e Livraria.
- O sorteio é individual por personagem.

Se um membro sair ou morrer, os demais podem continuar normalmente na instância. Cada personagem decide previamente se deseja sair automaticamente nessas situações.

---

## 16. Analisador de hunt e relatório de sessão

### 16.1 Painel em tempo real

O analisador fica disponível durante a hunt e pode ser minimizado.

Deve mostrar, no mínimo:

- tempo de sessão;
- XP obtida;
- XP/h;
- gold obtido;
- gold/h;
- gastos;
- gasto/h;
- saldo;
- saldo/h;
- inimigos mortos;
- loot obtido;
- supplies consumidos;
- maior hit do ataque básico;
- maior hit registrado de cada skill utilizada.

### 16.2 Retorno após período offline

Ao reanexar o client a uma hunt que continuou sem visualizador, o jogador deve recuperar o estado atual e ter acesso aos agregados da sessão.

A arquitetura de referência também recomenda eventos notáveis e notificações para fim de sessão/morte/stamina; **canais e escopo exatos permanecem [ABERTO]** e podem ser priorizados depois do vertical slice.

---

## 17. Monstros e IA

### 17.1 Comportamento

**[DECIDIDO]** Monstros comuns usam comportamento simples e previsível inspirado no Tibia.

Não é objetivo do MVP criar IA sofisticada para mobs comuns. A profundidade da hunt vem principalmente da configuração do bot, composição do spawn, distância e lure.

### 17.2 Bosses

Bosses futuros podem utilizar comportamentos mais inteligentes e mecânicas específicas, sem transformar isso em requisito para todos os monstros.

---

## 18. Livraria / Bestiário

### 18.1 Objetivo

A Livraria recompensa o jogador por abater grandes quantidades de uma criatura e cria progressão permanente orientada a famílias de monstros.

### 18.2 Marcos

**[DECIDIDO]** Cada monstro pode possuir cinco marcos:

- 10.000 kills;
- 25.000 kills;
- 50.000 kills;
- 100.000 kills;
- 200.000 kills.

### 18.3 Recompensa padrão

Na maioria das criaturas, cada marco concede **+1% de XP PvE permanente**.

### 18.4 Marcos especiais

Alguns monstros substituem um ou mais bônus de XP por recompensas especiais.

Tipos permitidos já discutidos:

- bônus de loot PvE;
- Dodge PvE;
- resistência física PvE;
- resistência elemental PvE;
- redução de penalidade de morte;
- outros bônus especiais aprovados por conteúdo.

Os bônus são individuais ao personagem.

### 18.5 Escopo PvE

**[DECIDIDO]** Bônus de Livraria valem em PvE. Não devem gerar vantagem automática em Guild War.

### 18.6 Stamina

Abates realizados com stamina 0 não contam para a Livraria.

---

## 19. Prey

### 19.1 Slots

- 1 slot liberado para Free;
- +1 slot para personagem Premium;
- +1 slot desbloqueável com Coins;
- máximo atual: 3 slots.

### 19.2 Rolagem

Cada slot recebe 1 rolagem gratuita a cada 24 horas.

Reroll adicional: **10.000 gold**.

### 19.3 Pool de monstros

Cada monstro deve possuir um **level recomendado**.

O sorteio de Prey pode selecionar monstros cujo level recomendado esteja até aproximadamente **70 levels abaixo ou 70 levels acima** do level atual do personagem.

Exemplo: personagem level 200 -> pool aproximado de monstros recomendados para 130 a 270.

### 19.4 Bônus

O tipo é aleatório; a intensidade é fixa:

- +10% XP contra a criatura;
- +10% loot da criatura;
- +10% dano causado à criatura;
- -10% dano recebido da criatura.

### 19.5 Duração

**[DECIDIDO]** Cada bônus dura 4 horas.

**[ABERTO]** Ainda precisa ser definido se as 4 horas consomem tempo real ou apenas tempo efetivo de hunt/combate contra a criatura. A camada técnica deve evitar hardcode dessa semântica.

---

## 20. Supply

### 20.1 Modelo abstrato

Poções, runas e munições comuns não são itens físicos carregados em inventário durante a hunt. Seu uso consome gold diretamente.

Quando um monstro "dropa" esse tipo de supply, o valor correspondente entra como gold/economia, e não como pilha física do consumível.

### 20.2 Preços

- Poções e runas: usar preços do Tibia como referência inicial de balanceamento.
- Arrows e demais munições: **[ABERTO]**, serão definidos depois.

Os valores devem ser configuráveis.

### 20.3 Gold insuficiente

Se o gold acabar:

- com regra "Sair quando meu gold acabar" ativa -> personagem sai da hunt;
- sem a regra -> permanece, deixa de conseguir pagar os supplies necessários e pode morrer.

---

## 21. Itens, equipamento e inventário

### 21.1 Origem dos equipamentos

**[DECIDIDO]** Equipamentos completos são obtidos por:

- drops de monstros;
- recompensas/drops de bosses.

Não existe craft de equipamento completo no MVP.

### 21.2 Atributos

- Cada item possui atributos base fixos.
- Não existe random roll de atributos.
- Equipamentos melhores são itens diferentes, não versões infinitamente evoluídas do mesmo item.
- Requisitos de uso seguem o paradigma Tibia: level e vocação, sem requisito adicional de força/inteligência.
- Atributos base ficam enxutos; efeitos avançados entram por imbuement e sistemas paralelos.

### 21.3 Durabilidade

Equipamentos comuns não têm durabilidade.

Exceções:

**Anéis:** consumíveis por tempo.

**Colares:** consumíveis por cargas. Exemplo: colar defensivo com N cargas, consumindo uma carga quando a condição de uso ocorre.

Ao esgotar, o item é destruído permanentemente.

### 21.4 Reposição de anéis e colares

Se houver mais unidades do mesmo item na mochila/stack, o sistema pode repor automaticamente o item consumido. Quando a pilha acabar, não há reposição.

### 21.5 Inventário e capacidade

- Capacidade segue o paradigma do Tibia.
- Stack máximo: 100.
- Não existem itens físicos no chão.

### 21.6 Caixa de Loot da Sessão

Se um item for obtido e o personagem não tiver espaço/capacidade, o item vai para a **Caixa de Loot da Sessão**.

- A caixa pode ser consultada/retirada após liberar espaço e capacidade.
- Ela permanece disponível por 30 minutos após o encerramento da sessão.
- Depois desse prazo, os itens restantes expiram.

---

## 22. Loot e autovenda

### 22.1 Autovenda

O jogador escolhe tipos de item que serão vendidos automaticamente ao serem dropados.

- Free: até 5 tipos de item configurados.
- Premium: até 20 tipos.

Para esses itens:

`drop -> venda automática -> gold creditado`

Eles não passam pela mochila.

### 22.2 Loot não configurado

Itens não marcados para autovenda tentam entrar no inventário. Se faltar espaço/capacidade, vão para a Caixa de Loot da Sessão.

---

## 23. Imbuement

### 23.1 Referência

**[DECIDIDO]** O sistema usa o imbuement do Tibia como referência funcional.

### 23.2 Regras gerais

- Slots de imbuement são fixos por tipo/item de equipamento.
- Imbuements são temporários.
- Duração: **24 horas de tempo efetivo de hunt**.
- Fora de hunt, o relógio não diminui.
- Aplicação exige materiais e taxa em gold.
- Sistema deve suportar múltiplos tiers de efeito, seguindo a lógica de progressão do sistema de referência.

### 23.3 Materiais e economia

Materiais devem cair de monstros de diferentes faixas de level. Um objetivo de design é fazer personagens de level baixo produzirem materiais relevantes para personagens avançados, mantendo demanda por conteúdo antigo e fazendo o mercado girar.

### 23.4 Catálogo

**[ABERTO]** Efeitos, materiais, valores e compatibilidade exata por slot serão definidos em conteúdo/balanceamento.

---

## 24. Forja

**[FUTURO - fora do MVP]**

O sistema de forja terá 3 níveis e permitirá uma melhoria pequena e limitada do atributo base do item, sem transformar o equipamento em uma linha de evolução infinita.

Exemplo conceitual: Attack 43 podendo chegar até 46.

A forja servirá como sink de gold e materiais. Fórmulas, chance de sucesso, custos e atributos elegíveis serão definidos depois.

O MVP deve nascer **sem Forja**.

---

## 25. Itens lendários

### 25.1 Origem

Lendários podem vir diretamente de monstros ou da recompensa individual de bosses.

Não são craftados.

### 25.2 Vinculação

- Nunca ficam soulbound.
- Continuam negociáveis mesmo depois de utilizados/equipados.
- Sem limite semanal de negociação.

### 25.3 Proveniência

Todo lendário deve registrar permanentemente, no mínimo:

- personagem que o obteve originalmente;
- data;
- horário;
- origem relevante (monstro/boss, quando aplicável).

Esse histórico é requisito desde o MVP porque sustenta o marketplace futuro e o valor histórico do item.

---

## 26. Morte e respawn

### 26.1 PvE normal

**[DECIDIDO]** Morte:

- encerra a hunt;
- devolve o personagem à área inicial/PZ;
- HP e Mana voltam cheios;
- não aplica debuff temporário;
- não perde item;
- não perde equipamento;
- não possui sistema de bless.

### 26.2 Perda de XP

A penalidade base é **60% da quantidade de XP necessária para completar o level atual**.

Premium reduz essa penalidade para **54%**.

A morte pode causar perda de level.

**Proteção:** personagem nunca pode cair abaixo do level 8 por penalidade de morte.

---

## 27. Bosses

### 27.1 Acesso

O jogador acessa Boss pelo menu dedicado, monta/convida uma party e entra em instância própria.

### 27.2 Tamanho

Máximo de 10 jogadores.

### 27.3 Frequência

No MVP, boss: **1 tentativa/recompensa por dia**, conforme regra de conteúdo.

A arquitetura deve ser capaz de suportar no futuro bosses com limites diferentes ou custo crescente, mas isso não é necessário no vertical slice.

### 27.4 Fechamento da sala

Quando o boss começa, ninguém novo pode entrar.

Exceção: no modo Iniciante, jogador que morreu pode retornar à instância.

### 27.5 Modos suportados

A capacidade do sistema deve prever:

**Iniciante - MVP inicial**

- morreu -> pode voltar;
- todos os participantes elegíveis que causaram dano ao boss recebem sua recompensa individual ao final.

**Profissional - capacidade futura**

- morreu -> não volta à luta.

**Herói - capacidade futura**

- modo mais punitivo, podendo fazer uma morte encerrar a tentativa do grupo.

Os detalhes finais de elegibilidade de loot dos modos Profissional/Herói permanecem **[ABERTO]**.

### 27.6 Recompensa

Ao derrotar o boss, o jogador recebe uma tela de recompensa individual. Itens lendários podem ser sorteados nessa etapa. Loot lendário continua sendo sorte puro; não existe pity system no MVP.

---

## 28. Quests

### 28.1 Natureza

Quests usam mapas instanciados, potencialmente maiores e mais exploráveis que uma hunt. Nelas o personagem pode precisar andar manualmente, descobrir caminhos e resolver o objetivo.

### 28.2 Party

- Pode ser solo ou party.
- Não existe tamanho mínimo global.
- Tamanho máximo é definido individualmente por quest.

### 28.3 Checkpoints

**[DECIDIDO]** Não existem checkpoints no modelo inicial.

### 28.4 Repetibilidade

Depende da quest:

- algumas são únicas;
- outras podem ser repetíveis.

O framework deve permitir ambas.

### 28.5 Quest de promoção

A promoção de vocação é um caso importante de quest única e permanente.

---

## 29. Guildas

### 29.1 Estrutura do MVP

Guildas começam simples.

- Sem tamanho máximo de membros.
- Cargos: Líder, Vice-líder, Membro.

### 29.2 Permissões

- Líder: administração total.
- Vice-líder: pode expulsar membros comuns.
- Vice-líder não pode expulsar outro Vice nem o Líder.

Progressão de guilda, árvore de guilda e sistemas adicionais ficam para depois.

---

## 30. Guild War - PvP do MVP

### 30.1 Escopo

**[DECIDIDO]** No MVP, o único PvP estruturado é a Guild War.

- 15x15 por time.
- Uma guilda pode montar vários times.
- Líder e Vice-líder escolhem os integrantes.
- Sem level mínimo inicialmente.
- Tiers por level podem ser adicionados no futuro.

### 30.2 Matchmaking

Times são pareados de acordo com o **level médio dos jogadores do time**.

O sistema deve permitir vários times da mesma guilda simultaneamente.

Detalhes de faixa/tolerância de matchmaking, proteção contra rematch e tratamento de quantidade ímpar de times permanecem **[ABERTO]**.

### 30.3 Mapa e trono

O mapa é predeterminado. O trono ocupa **um único tile**.

Para dominar o trono, um jogador precisa ficar exatamente sobre esse tile.

Como apenas um personagem pode ocupar o tile, push, bloqueio e posicionamento são centrais ao modo.

### 30.4 Pontuação

- Permanecer 60 segundos contínuos sobre o trono = 1 ponto.
- Se o jogador sair, morrer ou for empurrado antes dos 60 segundos, a contagem zera.
- Quando alguém volta ao tile, uma nova contagem começa em 0.
- A cada 5 pontos, o trono muda para outra posição predeterminada.
- Mudanças ocorrem em 5, 10 e 15 pontos.
- Vence o primeiro time a 20 pontos.
- Não existe duração máxima.
- Não existe empate: a partida continua até alguém chegar a 20.

Se o timestamp de 60 segundos for atingido antes do evento de morte/push ser processado, o ponto é válido.

### 30.5 Morte e respawn

- Sem perda de XP a cada morte durante a partida.
- Morto aguarda 5 segundos.
- Respawn na base do próprio time.
- Retorna com HP e Mana cheios.
- Pode morrer e retornar quantas vezes for necessário.

### 30.6 Resultado

**Time derrotado:** sofre penalidade de XP ao final equivalente a uma morte aplicável ao personagem. Portanto, regra atual: 60% da XP do level para Free e 54% para Premium, respeitando o piso de level 8.

**Time vencedor:** os personagens que efetivamente participaram recebem por 24 horas:

- +10% XP;
- +10% loot.

O bônus é dos personagens participantes, não de todos os membros da guilda.

### 30.7 Horário

A Guild War será um evento diário. O horário exato ainda é **[ABERTO]**; foram discutidos 20h/21h como referências iniciais.

### 30.8 Roster após início

**[ABERTO]** Regra final de substituição/entrada após início da partida ainda deve ser definida. A recomendação de produto é roster fechado ao iniciar, mas isso não foi confirmado explicitamente.

---

## 31. PvP fora da Guild War

**[MVP]** Não existe PvP aberto, arena ranqueada, duelo ou outros modos no vertical slice.

Arenas e modos competitivos padronizados podem ser explorados futuramente, inclusive formatos com personagens normalizados, mas estão fora do escopo atual.

---

## 32. Economia e gold

### 32.1 Fontes

Gold entra principalmente por:

- loot/venda de itens;
- autovenda;
- recompensas de quests quando aplicável.

Daily quests com pequenas recompensas podem existir depois, mas não são pilar econômico do MVP.

### 32.2 Sinks

Gold sai por:

- poções/runas/munições abstratas;
- taxa de imbuement;
- rerolls adicionais de Prey;
- compras de itens/Coins no Market;
- sistemas futuros como Forja.

### 32.3 Market sem taxa

**[DECIDIDO]** O Market global não cobra taxa de listagem nem comissão sobre venda.

---

## 33. Market

### 33.1 Escopo

Market é global e acessível a partir de qualquer cidade/PZ relevante.

### 33.2 Itens

Todo item físico negociável pode ser colocado no Market por gold, respeitando suas regras de existência. Supplies abstratos, por não existirem como itens físicos, não são listados como pilhas tradicionais.

### 33.3 Coins por gold

**[DECIDIDO]** Coins podem ser vendidas no Market por gold.

- Coins pertencem à conta.
- Ao vender, são transferidas da conta vendedora para a compradora.
- Isso cria uma ponte oficial entre dinheiro real e economia de gold.

Essa transação deve ser altamente auditável e consistente.

---

## 34. Premium e monetização

### 34.1 Compra de Coins

Coins podem ser compradas com:

- PIX;
- criptomoeda.

O detalhe de provedores, custódia, blockchain e fluxo financeiro pertence ao handoff técnico/comercial.

### 34.2 Períodos de Premium

Premium é comprado por personagem em pacotes de:

- 7 dias;
- 30 dias;
- 90 dias.

### 34.3 Benefícios Premium

**[DECIDIDO]**

- +10% XP;
- treino offline de até 12h em vez de 6h;
- até 20 itens configuráveis na autovenda em vez de 5;
- segundo slot de Prey;
- penalidade de morte reduzida de 60% para 54% da XP necessária para o level atual.

### 34.4 Slot adicional de Prey

Um terceiro slot pode ser desbloqueado com Coins, independentemente do segundo slot Premium, conforme regras comerciais finais.

### 34.5 Filosofia

Premium possui vantagens reais de progressão/conveniência. O produto deve monitorar o impacto desses bônus na diferença entre Free e Premium e manter os valores configuráveis.

---

## 35. Marketplace por dinheiro real - Fase 2

### 35.1 Itens lendários

Lendários poderão ser vendidos por dinheiro real/cripto em um marketplace oficial.

### 35.2 Personagens

Personagens poderão ser colocados à venda e transferidos definitivamente para outra conta, preservando identidade e progresso.

### 35.3 MVP

No MVP:

- essas transações não são habilitadas;
- a UI pode apresentar **"Em breve"**;
- modelo de dados deve preservar proveniência e transferibilidade para evitar migração destrutiva depois.

### 35.4 Requisitos futuros

A Fase 2 exigirá desenho específico de:

- pagamento;
- custódia;
- comissão;
- histórico de propriedade;
- fraude;
- disputa;
- chargeback quando aplicável;
- transferência atômica de ativos;
- requisitos legais/compliance.

Esses itens não devem inflar o MVP além do necessário para preparar dados e IDs estáveis.

---

## 36. Achievements e rankings

### 36.1 Achievements

**[DECIDIDO]** Achievements são cosméticos por enquanto. Não concedem poder permanente.

### 36.2 Rankings

**[ABERTO / não bloqueia MVP]** Rankings de level, skills, Livraria, bosses e Guild War podem ser adicionados, mas não foram definidos como requisito obrigatório do vertical slice.

---

## 37. Cidade / PZ

A cidade é espaço seguro e de serviço, sem PvP ou combate. Serve como lobby e ponto para:

- Market;
- inventário/depósito quando aplicável;
- guilda;
- preparação;
- reset de árvore de passivas;
- entrada/seleção de atividades.

Housing não faz parte do MVP.

---

## 38. Requisitos de sessão e persistência percebidos pelo produto

Sem escolher tecnologia, o produto exige os seguintes comportamentos:

### 38.1 Hunt desacoplada da conexão

Fechar o navegador não encerra a hunt. Ao voltar, o jogador deve se reanexar à mesma sessão enquanto ela estiver ativa.

### 38.2 Dois personagens simultâneos

A plataforma deve suportar até dois personagens da mesma conta logados/ativos simultaneamente, inclusive os dois em hunts AFK.

### 38.3 Conteúdo manual desconectado

Quest, Boss e Guild War mantêm o personagem no mapa quando a conexão cai. O servidor continua sendo autoridade sobre sua posição, vida, efeitos e morte.

### 38.4 Reinício de serviço

Uma hunt AFK não pode simplesmente desaparecer silenciosamente em restart/deploy. A solução técnica deve suportar recuperação da sessão ou encerramento consistente com crédito de progresso conforme estratégia escolhida pela arquitetura.

---

## 39. Requisitos de configuração e LiveOps

Os seguintes elementos devem poder ser alterados por dados/configuração, preferencialmente sem mudança de lógica central:

- XP por monstro;
- loot e chances;
- level recomendado de monstros/hunts;
- preços de supplies;
- cooldowns;
- stamina;
- recuperação de stamina;
- parâmetros do bot;
- densidade/composição de dificuldades;
- Prey;
- Livraria;
- Premium;
- penalidade de morte;
- boss cooldown/limites;
- regras de Guild War configuráveis;
- bônus de eventos/guilda;
- itens de autovenda;
- imbuements;
- feature flags de sistemas.

O objetivo é permitir balanceamento sem reescrever a simulação.

---

## 40. Telemetria e auditoria mínimas

O MVP deve produzir dados suficientes para avaliar economia, progressão, confiabilidade do idle e abuso.

Eventos relevantes:

- início/fim de hunt;
- duração e motivo de encerramento;
- stamina consumida/zerada;
- XP e gold gerados;
- supplies gastos;
- morte;
- loot raro/lendário;
- item enviado para Caixa de Loot;
- expiração da Caixa de Loot;
- autovenda;
- party criada/iniciada/abandonada;
- boss iniciado/concluído;
- reward do boss;
- Prey roll/reroll;
- marco de Livraria;
- Market list/buy/cancel;
- transferência de Coins por Market;
- compra de Coins;
- ativação/expiração de Premium;
- Guild War start/end, times, score, throne capture e resultado.

Transações de gold, Coins, Market, Premium e lendários devem possuir trilha de auditoria adequada à criticidade econômica.

---

## 41. Requisitos de segurança e autoridade

Sem definir stack, os seguintes princípios são obrigatórios:

- combate e resultado da hunt são server-authoritative;
- bot é avaliado no servidor;
- client não decide dano, loot, XP ou resultado de transação;
- limite de dois personagens simultâneos por conta é validado no servidor;
- gold e Coins não podem ser duplicados em falha/retry;
- Market deve transferir ativo e pagamento de maneira consistente;
- compra de Coins precisa ser reconciliável com o provedor de pagamento;
- lendários precisam de identidade/proveniência estável;
- ações administrativas sensíveis precisam ser auditáveis.

---

## 42. Fora do MVP / backlog explícito

Não devem ser puxados para o vertical slice sem nova decisão de escopo:

- Forja;
- Housing;
- profissões de coleta/crafting;
- arenas PvP adicionais;
- duelos;
- PvP aberto;
- torneios com personagem padronizado;
- eventos sazonais/feriados;
- sistema complexo de progressão de guilda;
- tiers de Guild War por level;
- marketplace de dinheiro real para lendários;
- venda real de personagens;
- client nativo;
- produção de grande volume de hunts/bosses/quests.

---

## 43. Parâmetros e decisões ainda abertas

Estas lacunas **não impedem a definição de arquitetura**, desde que os sistemas sejam configuráveis.

### 43.1 Progressão

- Nome final das vocações e promoções.
- HP/Mana por level do Druida.
- Curva exata e teto da árvore de passivas.
- Catálogo final de magias e números de balanceamento.

### 43.2 Party

- Fórmula numérica final do bônus de XP por vocações únicas.
- Critérios exatos de matchmaking de hunt por faixa de level.

### 43.3 Bot

- Subconjunto exato do bot simplificado pré-level 50.
- Vocabulário final de todas as condições possíveis.

### 43.4 Prey

- Se as 4 horas são tempo real ou tempo efetivo de hunt.
- Regras comerciais finais do terceiro slot.

### 43.5 Supply

- Preço de arrows e munições.

### 43.6 Imbuement

- Catálogo de efeitos;
- materiais;
- valores;
- compatibilidade por equipamento.

### 43.7 Boss

- Regras finais de elegibilidade de recompensa nos modos Profissional/Herói.

### 43.8 Guild War

- Horário diário exato;
- tolerância do matchmaking por level médio;
- roster/substituição após início;
- tratamento de fila com quantidade ímpar de times;
- possibilidade ou não de times da mesma guilda se enfrentarem.

### 43.9 UI

- Grau de customização/reordenação livre dos painéis laterais.
- Fluxos mobile detalhados.

### 43.10 Notificações

- canais e eventos que geram push/alerta fora do jogo.

---

## 44. Critérios de aceitação do vertical slice

O MVP técnico deve conseguir demonstrar de ponta a ponta, no mínimo, os fluxos abaixo.

### 44.1 Onboarding

1. criar/escolher nome;
2. iniciar tutorial;
3. progredir do level 1 ao 8;
4. receber orientação de hotkeys/UI;
5. escolher uma das quatro vocações.

### 44.2 Treino

1. entrar na instância de treino;
2. skills evoluírem pelo uso;
3. Trainer Monks atacarem sem dano efetivo;
4. supplies não consumirem gold;
5. desconectar;
6. treino continuar pelo limite Free/Premium;
7. stamina recuperar 1:1.

### 44.3 Hunt solo AFK

1. selecionar hunt e dificuldade;
2. configurar bot;
3. iniciar sessão;
4. fechar navegador;
5. servidor continuar a hunt;
6. reconectar e receber estado correto;
7. XP/gold/loot e analisador refletirem a sessão;
8. stamina chegar a zero sem encerrar a hunt e bloquear recompensas;
9. gold zerar e produzir o comportamento configurado;
10. morte encerrar a hunt e aplicar penalidade correta.

### 44.4 Party Hunt

1. matchmaking formar grupo;
2. líder propor hunt;
3. membros aprovarem;
4. party iniciar com até 4 ou menos mediante unanimidade;
5. XP usar composição de vocações;
6. gastos de supplies serem equalizados;
7. loot ser sorteado individualmente;
8. saída/morte de membro respeitar regra de cada personagem.

### 44.5 Loot e Market

1. autovenda converter drop diretamente em gold;
2. loot comum entrar no inventário;
3. falta de capacidade enviar item à Caixa de Loot;
4. item ser retirado após liberar capacidade;
5. expirar após 30 minutos pós-sessão;
6. listar/comprar item no Market sem taxa;
7. listar/comprar Coins por gold.

### 44.6 Prey e Livraria

1. rolar Prey dentro do range de level recomendado;
2. aplicar um dos bônus de 10%;
3. reroll cobrar 10k gold;
4. kills avançarem Livraria somente com stamina > 0;
5. marco conceder recompensa PvE permanente.

### 44.7 Boss

1. montar grupo com até 10;
2. iniciar boss e fechar sala;
3. jogador morrer e retornar no modo Iniciante;
4. concluir boss;
5. reward individual ser gerado;
6. lendário, quando ocorrer, registrar proveniência.

### 44.8 Guild War

1. guilda montar time de até 15;
2. matchmaking usar level médio;
3. entrar no mapa;
4. ocupar tile do trono;
5. contador zerar se ocupante sair/morrer/for empurrado;
6. 60s contínuos gerar ponto;
7. trono trocar em 5/10/15;
8. morte gerar respawn em 5s;
9. primeiro a 20 vencer;
10. perdedor receber penalidade de XP;
11. participantes vencedores receberem +10% XP/+10% loot por 24h.

### 44.9 Premium

1. comprar Coins via pelo menos um fluxo de pagamento habilitado no ambiente de teste;
2. adquirir Premium de 7/30/90 dias para personagem escolhido;
3. benefícios serem aplicados corretamente;
4. expiração restaurar limites Free sem perder dados/configurações inválidas de forma destrutiva.

---

## 45. Handoff para arquitetura e stack

A próxima etapa deve receber este PRD e o arquivo técnico `arquitetura.md`, mas está livre para revisar as escolhas de stack anteriores. Ela deve produzir pelo menos:

1. arquitetura lógica de serviços/processos;
2. modelo de sessão para Hunt, Treino e conteúdos manuais;
3. modelo de dados de conta, personagem, item, market, Coins, Premium, Livraria e Prey;
4. estratégia de persistência e retomada de hunts AFK;
5. protocolo client-servidor e sincronização/reconexão;
6. arquitetura do motor de bot server-side;
7. sistema de configuração de conteúdo e balanceamento;
8. fluxo de pagamentos PIX/cripto para Coins;
9. consistência transacional de gold/Coins/Market;
10. observabilidade, telemetria e auditoria;
11. segurança/anti-abuso;
12. estratégia de deploy e recuperação;
13. plano de testes de carga;
14. definição de stack do client web e renderização 2D;
15. plano de implementação do vertical slice por fases;
16. estimativa de custos para escala inicial e cenários de crescimento.

### 45.1 Restrições que a arquitetura não pode quebrar

- Hunt continua com navegador fechado.
- Resultado da hunt não depende de haver alguém assistindo.
- O bot executa no servidor.
- Um personagem só ocupa um estado principal de atividade.
- Dois personagens da mesma conta podem estar ativos simultaneamente.
- Não há mundo aberto de combate/PvP no MVP.
- Hunts usam rota fixa e instâncias isoladas.
- Conteúdo manual preserva personagem ao desconectar.
- Market/Coins precisam de consistência econômica e auditoria.
- Lendários precisam de proveniência estável.
- Configurações de balanceamento não devem depender de alteração da lógica central.
- O client do MVP é web, desktop-first e responsivo.

---

## 46. Glossário

**AFK / Idle:** sessão que continua sem input e sem necessidade de client aberto.  
**PZ:** Protect Zone; cidade/área segura sem combate.  
**Hunt:** instância automatizada de PvE.  
**Supply:** poções, runas e munições abstratas pagas diretamente em gold.  
**Livraria:** progressão permanente por quantidade de kills de cada criatura.  
**Prey:** bônus temporário associado a uma criatura sorteada.  
**Bot:** motor oficial de regras de automação server-side.  
**Lure:** acumular múltiplos monstros antes de parar para combater.  
**Autovenda:** converter automaticamente certos drops em gold sem passar pelo inventário.  
**Imbuement:** efeito temporário aplicado ao equipamento e consumido apenas em tempo efetivo de hunt.  
**Coins:** moeda premium pertencente à conta, comprável com dinheiro real e negociável por gold no Market.  
**Premium:** status temporário comprado para um personagem usando Coins.  
**Guild War:** modo PvP 15x15 pelo controle de um tile de trono.  
**Caixa de Loot da Sessão:** armazenamento temporário para drops que não couberam no inventário/capacidade.  
**RMT:** real-money trading; marketplace futuro de lendários e personagens.

---

## 47. Resumo executivo para a equipe técnica

Draconya deve ser tratado como um MMORPG de navegador **server-authoritative e idle-first**. A hunt é uma sessão persistente do servidor, não uma extensão da conexão do client. O jogador configura um bot oficial, fecha o navegador e retorna depois para a mesma simulação. Conteúdos manuais - Quest, Boss e Guild War - usam o mesmo personagem persistente, mas exigem input quando o jogador está conectado.

O MVP deve provar o loop inteiro com pouco conteúdo: uma hunt, um boss, uma quest e um mapa de Guild War. A complexidade está nos **sistemas reutilizáveis**, não no volume de mapas. Esses sistemas incluem bot server-side, stamina, treino offline, party, economia de supply em gold, loot individual, Market, Coins, Premium, Livraria, Prey, imbuement, persistência/reconexão e Guild War.

A etapa técnica não deve otimizar prematuramente para conteúdo em escala, mas deve preservar as propriedades que são difíceis de migrar depois: sessões AFK retomáveis, autoridade do servidor, transações econômicas consistentes, IDs/proveniência de itens, configuração data-driven, e separação entre simulação e apresentação.

**Fim do PRD consolidado v0.9.**
