# PRD da interface do cliente

**Versão:** 1.0

**Data:** 16/09/2026

**Status:** consolidado para orientar a evolução da interface

**Natureza:** instantâneo

**Escopo:** cliente web do Draconya, da entrada à sessão de jogo
**Documentos normativos relacionados:** ADR 0007, ADR 0008, ADR 0012, ADR 0022, ADR 0026, ADR 0027 e ADR 0029

---

## 1. Propósito e autoridade

Este PRD consolida as decisões de produto, experiência e direção visual da interface do Draconya.
Ele responde a uma pergunta prática: o que o jogador deve ver, onde deve encontrar cada sistema e
quais interações a interface pode oferecer sem contrariar a autoridade do servidor.

O documento usa como referência visual o handoff de design do projeto e sua captura de HUD. Esse
handoff é um protótipo de alta fidelidade, não código nem especificação funcional completa. Cores,
tipografia, proporções, estados e densidade informacional são referência; nomes de personagens,
valores, criaturas, inventário, sprites e menus disponíveis no protótipo não são dados canônicos.

Este é um documento instantâneo, como o PRD principal. Mudanças reais de arquitetura exigem uma
nova ADR; mudanças no comportamento já entregue exigem a atualização do documento vivo em
docs/product/. Este arquivo não reabre ADRs aceitos silenciosamente.

### 1.1 Convenções

- **[DECIDIDO]**: requisito de produto ou experiência já fixado.
- **[IMPLEMENTADO]**: comportamento que a documentação funcional declara existir.
- **[PLANEJADO]**: direção aprovada que ainda depende de entrega posterior.
- **[BLOQUEADO]**: não pode entrar como UI funcional antes do contrato de servidor ou produto.
- **[FORA DO ESCOPO]**: não deve aparecer como função disponível nesta fase.

---

## 2. Visão da experiência

Draconya é um MMORPG idle-first. A interface precisa comunicar que o personagem continua existindo
e progredindo quando o navegador fecha, sem fazer o jogador sentir que está diante de um dashboard
genérico.

### 2.1 Princípios de experiência

1. **Densidade de MMORPG.** Equipamento, mochila, bot, battle list, analisador e chat ficam
   acessíveis sem encobrir permanentemente o mundo.
2. **Mundo antes de painel.** O viewport é a camada visual dominante; o HUD é uma casca em DOM
   sobre ele, não uma grade que reduz o mundo a uma célula pequena.
3. **Geografia estável.** Um jogador encontra inventário, bot, vitais, battle list e chat no mesmo
   lugar em cidade, hunt e conteúdo manual.
4. **Idle é legítimo.** A interface configura e observa a automação; ela não presume que o jogador
   esteja trapaceando por usar o bot oficial.
5. **O cliente expressa intenção, não resultado.** Nunca calcula ou fabrica dano, posição
   resolvida, loot, XP, capacidade, preço, saldo ou êxito de uma transação.
6. **A interface não promete sistema inexistente.** Ícone, botão ou métrica só aparecem quando
   há comportamento de produto e dado que os sustentem.
7. **Ausência não é zero.** Dado opcional ainda não recebido aparece como traço ou fica omitido;
   zero só é mostrado quando o servidor afirmou zero.

---

## 3. Fronteiras obrigatórias

| Fronteira | Direção decidida |
|---|---|
| Mundo | Renderizado pelo viewport; a interface não substitui o mapa vivo por uma cena fictícia. |
| HUD | Renderizado em DOM sobre o mundo, independente do ritmo de desenho do viewport. |
| Estado | Lido de stores externas ao React; componentes visuais não se tornam donos do estado de jogo. |
| Servidor | É a fonte de verdade de atributos, inventário, party, alvo, analítica e efeitos. |
| Conteúdo | Não contém arte; itens, criaturas e efeitos se conectam à arte por appearanceId e outfitId. |
| Assets | Permanecem em pacote versionado e separado; fontes e chrome do HUD são servidos pela mesma origem do jogo. |
| Segurança | Autenticação permanece delegada ao WorkOS; a UI do jogo não coleta senha local. |

Essas fronteiras preservam os invariantes de simulação pura, sessão autoritativa, intenção do
cliente, conteúdo sem arte e versão de conteúdo fixada por sessão.

---

## 4. Linguagem visual

### 4.1 Tom

- Português do Brasil, solene, direto e em segunda pessoa.
- Frases curtas, sem emoji na interface.
- Kicker em caixa alta com espaçamento amplo.
- CTA no infinitivo e em caixa alta.
- Dados de HUD em mono, abreviados quando necessário e com separador de milhar pt-BR.

### 4.2 Paleta e tipografia

| Elemento | Direção |
|---|---|
| Fundo | Pretos quentes de cinza; nunca azul-preto. |
| Ação e perigo | Vermelho-sangue. |
| Acento, bordas e títulos | Ouro velho. |
| Texto | Tons de pergaminho; nunca branco puro como cor-base. |
| Elementos e vocações | Cada elemento e vocação preserva matiz próprio. |
| Display | Cinzel. |
| Corpo | IBM Plex Sans. |
| Dados | JetBrains Mono. |

### 4.3 Componentes e estados

- Painéis usam vidro ferro-forjado: borda fina, anel interno escuro, fio dourado superior e
  sombra profunda.
- Slots têm três tamanhos: 36 px para ações futuras, 30 px para equipamento e party, 26 px para
  containers.
- Hover adiciona borda ou brilho dourado; foco tem anel de ouro; pressionar desloca um pixel;
  desabilitado reduz opacidade.
- O chrome é CSS. Sprites de item, outfit e mundo continuam vindo do pacote de assets.
- Arte ausente usa fallback explícito, nunca uma imagem inventada ou um caminho de arquivo dentro
  do conteúdo.

---

## 5. Geografia da interface

### 5.1 Desktop

**[DECIDIDO]** O desktop é a referência principal do HUD.

| Região | Medida e papel |
|---|---|
| Barra superior | 65 px; identidade, navegação e estado de conexão. |
| Coluna esquerda | 232 px; automação, personagem e party durante a hunt. |
| Centro | Mundo em tela cheia sob o HUD; contexto de hunt e modais aparecem sobre ele. |
| Coluna direita | 232 px; vitais, set, containers, batalha, bolsa da party e analisador. |
| Chat | Janela flutuante fixa no canto inferior esquerdo; nasce aberta e pode ser fechada. |

O protótipo visual usa uma tela-base de 1800 × 1010. Essa medida é referência de composição e
captura, não autorização para escalar o canvas inteiro com transformações fracionárias. O mundo
mantém zoom inteiro para preservar pixel art; o chrome se adapta por CSS.

### 5.2 Mobile

**[DECIDIDO]** Abaixo de 720 px, o cliente preserva um modo-página: mundo em faixa visual e
seções empilhadas. O HUD desktop não é simplesmente reduzido por escala.

Jogabilidade mobile completa, atalhos avançados e rearranjo livre de painéis não são requisito
prioritário. A prioridade é leitura, navegação, foco acessível e ausência de sobreposição que
esconda controles.

### 5.3 Modais e janelas

- Painel fixo para o loop diário; modal para uma visita pontual.
- Apenas um modal por vez, com scrim e foco contido.
- Painéis podem ser minimizados quando isso não oculta informação necessária.
- Não há janelas arrastáveis nem redimensionáveis nesta fase. A posição do analisador e da bolsa
  da party pertence à geografia da tela, não a coordenadas persistidas pelo navegador.

---

## 6. Barra superior

### 6.1 Informações permanentes

A barra superior mostra:

- retrato do personagem ou fallback seguro;
- nome, vocação e level;
- gold confirmado pelo servidor;
- wordmark Draconya;
- estado de conexão;
- navegação para sistemas disponíveis.

A contagem de jogadores online só entra quando existir uma mensagem de servidor própria. Coins,
cristais e Loja só entram junto do sistema de monetização.

### 6.2 Navegação

Os destinos disponíveis nesta fase são Hunts, Bot, Inventário, Analisador, Cyclopedia e Chat.
Personagem é painel fixo, não um segundo modal. O ícone ativo indica a janela ou modal aberto.

Loja, Guild, Amigos, Prey e Configurações são direções de produto futuras. Eles não recebem
botão inerte, modal vazio, texto “em breve” ou dado fictício apenas para reproduzir a referência
visual.

---

## 7. Coluna esquerda

| Painel | Papel | Estado |
|---|---|---|
| Bot | Configuração de regras server-side, por categoria, com estado de salvamento. | [IMPLEMENTADO] |
| Personagem | Experiência, level, HP, mana, capacidade e stamina. | [IMPLEMENTADO] |
| Party na hunt | Companheiros, status e contexto da sessão compartilhada. | [IMPLEMENTADO] |
| Skills | Skills, magic level e speed com progresso. | [PLANEJADO] — depende de contrato de apresentação. |
| Automações simplificadas | Renovação de anel/colar, troca de munição, troca de arma e alimentação. | [BLOQUEADO] — exige vocabulário e sistemas além das regras atuais. |

O bot não é rebatizado como automação se a interface esconder a semântica real de suas regras.
Quando automações de alto nível existirem, elas serão uma camada de configuração sobre ações
servidor-autoritativas, nunca macros locais.

---

## 8. Coluna direita

| Painel | Direção |
|---|---|
| Vitais | Barras de HP e mana no topo, com valor legível sobre o preenchimento. |
| Set | Dez posições de equipamento no arranjo 3 × 4; lugar vazio mostra rótulo, não arte do pacote. |
| Capacidade | Exibe valor confirmado pelo servidor. |
| Mochila e bolsa | Containers com sprites por appearanceId, quantidade e fallback quando a arte não estiver disponível. |
| Batalha | Criaturas visíveis, vida percentual e alvo destacado. |
| Bolsa da party | Só no modo compartilhado; peso, capacidade, gold e itens vêm do servidor. |
| Analisador | Sessão, taxas por hora e eventos; não aparece na cidade sem sessão creditável. |
| Postura defensiva/balanceada/atacante | [BLOQUEADO] — não confundir com stand, follow e keep-distance do bot. |

---

## 9. Mundo e contexto de hunt

O mundo mantém tiles, criaturas, itens e efeitos renderizados pelo viewport. O HUD pode sobrepor:

- nome e vida de criatura;
- destaque de alvo;
- retrato ou arcos de HP e mana do personagem;
- badge de EXP;
- nome da área;
- condições e buffs temporários;
- latência e FPS;
- pills de caçada.

Cada overlay aparece somente quando sua informação existe. Alvo, condições ativas e área precisam
de contrato de servidor antes de serem apresentados como verdade.

### 9.1 Caçada

- Na Cidade, a pill abre a escolha de caçada.
- Durante a hunt, a pill permite sair e expõe regras de saída já suportadas.
- A escolha de hunt é um modal; a formação da party ocupa sua coluna interna.
- A party durante a hunt é um painel fixo, não uma cópia de um segundo fluxo de formação.
- A tela não mostra estimativa oficial de XP por hora ou gold por hora antes da entrada.

### 9.2 Action bar e hotkeys

**[BLOQUEADO]** A barra de ações 2 × 12 da referência não entra como decoração.

O produto ainda não possui a intenção de protocolo para conjurar ou usar item manualmente. Enquanto
a ação de combate é resolvida pelo bot server-side, uma barra que aparente disparar habilidade
seria enganosa. Ela pertence ao motor manual do E10, quando houver intenção, validação e resposta
do servidor para cada ação.

O tutorial pode continuar a planejar presets de hotkeys, mas deve tratá-los como conteúdo futuro
até o motor manual existir.

---

## 10. Party, bot e análise

### 10.1 Party

Party é uma única sessão de hunt com múltiplos donos. A interface precisa deixar isso claro:

- formação, proposta, aprovação e início pertencem à escolha de hunt;
- cada membro pode observar a mesma sessão sem precisar estar conectado;
- party compartilhada possui bolsa única e acerto final rastreável;
- o cliente não calcula cota, peso, gold, gasto ou XP dos membros.

Dados como vocação, mana, DPS, HPS, custo médio, reserva de capacidade e dano recebido por
criatura só devem ser exibidos quando forem definidos e publicados pelo servidor.

### 10.2 Bot avançado

Lure dinâmico e ring swap continuam sendo configurações do bot, com gates, validações e
histerese próprios. A interface deve explicar o efeito e a condição configurada, mas não executar
a regra localmente.

“Postura” do bot significa comportamento de deslocamento, como parar, seguir ou manter distância.
Não é a postura defensiva/balanceada/atacante exibida no protótipo, que exigiria uma mecânica de
combate separada.

### 10.3 Analisador

O analisador apresenta somente agregados registrados pela sessão:

- duração;
- XP, gold, gastos, saldo e mortes;
- taxas por hora derivadas dos valores confirmados;
- loot, supplies, maior golpe, maior magia e eventos notáveis quando recebidos.

Tabs de dano causado, dano recebido, lista detalhada de loot e previsão de próximo level são
futuras até haver campos adequados. O cliente não estima progresso econômico ou de combate.

---

## 11. Entrada, conta e onboarding

### 11.1 Entrada

- A identidade é delegada ao WorkOS AuthKit.
- O CTA Entrar e Criar conta encaminha para o fluxo de autenticação delegado.
- A interface não coleta e-mail, senha, recuperação de senha nem credencial local.
- Não há seletor de idioma persistido nem i18n nesta fase.
- A seleção de personagem mostra apenas os estados e atributos que a conta fornece.

### 11.2 Personagem e vocação

- O personagem nasce sem vocação.
- A vocação é escolhida uma única vez a partir do level 8, durante o jogo.
- Os cards de vocação da referência são reutilizados nessa decisão, não na criação inicial.
- O jogo não possui worlds ou realms; a interface mostra o estado do personagem, não um nome de
  mundo inventado.

### 11.3 Tutorial

O tutorial deve apresentar progressivamente vitais, inventário, leitura do mundo, hunt e bot.
Action bar e presets de hotkeys só podem virar etapas funcionais quando o motor manual correspondente
for definido. Até lá, a documentação de onboarding os classifica como planejados.

---

## 12. Sistemas futuros e regra de disponibilidade

| Sistema | Direção visual | Condição para aparecer |
|---|---|---|
| Skills e magic level | Painel esquerdo com progresso. | Campos de apresentação no servidor. |
| Alvo, área e condições | Overlay do mundo. | Mensagens de sessão próprias. |
| Jogadores online | Subtítulo do wordmark. | Contagem publicada pelo servidor. |
| Ring swap | Modal de configuração. | Itens e efeito simulados. |
| Action bar manual | Barra inferior e presets. | Motor manual, intenções e protocolo. |
| Loja e leilão | Modal econômico e saldo de coins. | Sistema de monetização/market. |
| Guild | Navegação e modal social. | Sistema de guildas. |
| Amigos | Navegação e modal social. | Sistema de amigos. |
| Prey | Navegação e modal de cartas. | Sistema de Prey. |
| Configurações | Modal de preferências. | Preferências de conta e contrato de produto. |

O padrão é conservador: um sistema futuro pode ser documentado e desenhado, mas não é exposto ao
jogador antes de poder responder a uma intenção ou apresentar informação verdadeira.

---

## 13. Não objetivos desta versão

- Não transformar o protótipo em código por cópia.
- Não escalar o canvas inteiro com transformações fracionárias.
- Não usar fonte por CDN ou asset visual fora da origem controlada.
- Não reintroduzir login com senha por estética.
- Não mover a escolha de vocação para a criação do personagem.
- Não criar action bar visual sem ação suportada.
- Não usar janelas arrastáveis como substituto de responsividade.
- Não mostrar menus vazios, dados mockados ou valores calculados no cliente.
- Não gravar caminhos de sprite no conteúdo.

---

## 14. Critérios de aceitação de interface

Uma entrega de interface está pronta quando:

1. usa os tokens e a linguagem visual definidos;
2. respeita a geografia fixa e o comportamento mobile correspondente;
3. mostra apenas dados disponíveis no contrato de servidor;
4. preserva acessibilidade de teclado, foco, texto alternativo e estado desabilitado;
5. não cria estado de jogo no React nem altera a autoridade do servidor;
6. usa fallback explícito para arte ausente;
7. atualiza a documentação funcional quando mudar o que o jogador realmente consegue fazer;
8. passa pelos checks de documentação, tipo, lint e testes aplicáveis ao cliente.

Para fidelidade visual, capturas devem comparar a composição do HUD em uma cena estável. Regiões
dinâmicas do mundo podem variar; dados fictícios não podem ser usados para mascarar ausência de
contrato.

---

## 15. Rastreabilidade

| Assunto | Fonte normativa |
|---|---|
| HUD em DOM e mundo separado | ADR 0007 |
| Arte por identificador e pacote separado | ADR 0008 |
| Entrada delegada ao WorkOS | ADR 0012 |
| Fonte e cliente na mesma origem | ADR 0022 |
| Vocação, kit inicial, containers e geografia fixa | ADR 0026 |
| Party como uma hunt de vários donos | ADR 0027 |
| Tokens, chrome, chat, modais e exclusões do handoff | ADR 0029 |
| Direção de marca | docs/design-system.md |
| Plano do design system e lacunas de protocolo | docs/design-system-plan.md |
| Comportamento real de hunt, party, bot, itens e onboarding | docs/product/ |

---

## 16. Direção de evolução

A evolução segue dois trilhos, que não devem ser confundidos:

1. **Paridade visual:** aprimora casca, tipografia, painéis, composição, overlays e responsividade
   sem inventar comportamento.
2. **Paridade funcional:** adiciona dados, intenções, simulação e sistemas para que cada controle
   planejado tenha efeito verdadeiro.

Se uma decisão futura quiser reintroduzir action bar, janelas arrastáveis, login headless, novos
ícones de topo ou um frame escalado, ela deve registrar por ADR qual decisão substitui, qual
invariante continua preservado e como o mobile se comporta.
