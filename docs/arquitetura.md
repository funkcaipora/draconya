# Draconya — Documento técnico de arquitetura

> Documento de referência para desenho de mecânicas. Descreve **o que o motor torna barato,
> caro ou impossível**, para que as mecânicas sejam desenhadas dentro dessas restrições
> em vez de esbarrarem nelas depois.
>
> Os sistemas de evento (battlefield, zumbi, coliseu, guerra de guild) aparecem apenas como
> requisito estrutural — o detalhamento deles é feito à parte.

---

## 1. O jogo em uma página

**Draconya** é um MMORPG de navegador com visual pixel art em grade de tiles (32 px), inspirado
na estrutura do Tibia. Ele combina dois modos que normalmente não convivem:

**Caçada idle (PvE).** O jogador não controla o combate. Ele monta o equipamento, configura
regras de comportamento (postura, critério de alvo, distância dos inimigos, uso de poção e
magia, auto-loot, condições de saída), escolhe uma zona de caça e assiste. O servidor simula.
A recompensa é XP, gold e itens, medida num painel de análise de sessão (XP/h, gold/h, gasto/h).

**A caçada roda inteiramente no servidor e continua com o navegador fechado.** Não é progressão
offline calculada por estimativa: é a mesma simulação, rodando de verdade, com ou sem alguém
assistindo. O socket do jogador é apenas um visualizador que pode se conectar e desconectar.

**Eventos PvP e conteúdo manual.** Em janelas agendadas — e também em boss, quest e evento — o
jogador **move o personagem manualmente**: anda, escolhe alvo, empurra outros personagens um tile,
posiciona campos mágicos bloqueantes. A camada automática continua ligada por baixo, cuidando de
poção, cura e magia. **Esses modos exigem cliente conectado e ativo**, porque sem input não há jogo.

### Os dois modos de presença

Esta distinção atravessa todo o resto do documento:

| | **Modo desanexado** | **Modo manual** |
|---|---|---|
| Onde | Caçada idle | Boss, quest, PvP, eventos |
| Cliente | Opcional. Fecha o navegador e continua. | Obrigatório e ativo. |
| Quem decide | As regras configuradas | O jogador, com as regras cuidando da manutenção |
| Se a conexão cai | Nada acontece — a sessão segue | Janela de carência e depois uma política explícita |

A frase que define o jogo: **é o Tibia jogado com bot, com o bot oficializado**. A habilidade
se reparte de forma explícita — posicionamento e foco são do jogador, reação é da máquina.
Como todo mundo tem o mesmo bot, a luta não é decidida por quem comprou o script melhor.

---

## 2. Topologia: três tipos de espaço

Esta é a decisão de arquitetura mais importante do projeto. Praticamente tudo é **instanciado**,
e o único espaço compartilhado é deliberadamente inerte.

| Espaço | O que é | O que roda ali | Custo por jogador |
|---|---|---|---|
| **Cidade principal** | Único espaço compartilhado e persistente. **Protect zone**: sem combate, sem dano, sem automação. | Movimento, chat, e interações de UI (loja, depósito, mercado, guild) que são pedido-resposta, não simulação. | Muito baixo |
| **Instância de caçada** | Sala fechada de 1 a 5 jogadores com monstros. **Vive independente da conexão** — encerra por stamina, suprimento ou regra de saída, não por o jogador fechar a aba. | Simulação completa: IA de monstro, combate, loot, motor de regras. | Médio anexada, baixo desanexada |
| **Instância de evento** | Sala fechada de 8 a 40 jogadores, criada por um agendador. Exige clientes ativos. | Simulação com PvP: movimento manual, empurrão, campos mágicos, placar. | Alto |

**Por que a cidade é protect zone.** Um mundo aberto com combate é o item mais caro que existe
num MMO: exige interest management fino, resolução de conflito entre muitos atores, e não
escala horizontalmente porque todo mundo compartilha o mesmo estado. Tirando as ações da cidade,
ela vira um lobby com avatares — o custo por jogador cai para "transmitir passos e mensagens",
e o servidor da cidade deixa de ser o gargalo do jogo.

**A cidade ainda precisa de dois cuidados**, mesmo sendo inerte:

- **Interest management (AOI).** Sem isso, N jogadores na cidade custam O(N²) em transmissão:
  2.000 jogadores dando 2 passos por segundo, cada passo enviado a 2.000 pessoas, são 8 milhões
  de mensagens por segundo. Com AOI — o mapa dividido em células e cada jogador só recebendo
  eventos das células visíveis, algo como 18×14 tiles — cada passo vai para ~30 pessoas em vez
  de 2.000.
- **Shards de cidade.** Mais simples e mais eficaz do que otimizar AOI: capar a cidade em
  ~200 jogadores por cópia e abrir "Cidade 2", "Cidade 3" conforme necessário. Alinha com a
  filosofia de instanciar tudo, e o jogador troca de cópia para encontrar um amigo.

**Consequência para o design de mecânicas:** nada que dependa de jogadores se encontrarem
espontaneamente no mundo pode ser um pilar do jogo. Não há caçada em mapa aberto, não há PvP
de emboscada, não há disputa por ponto de spawn. Encontro é sempre mediado — party, fila de
evento, mercado.

---

## 3. Modelo de simulação

### 3.1 Ações são orientadas a evento, não a tick

Há duas frequências no servidor, e confundi-las é o erro clássico:

- **Ações do jogador** (andar, atacar, empurrar, conjurar, usar item) são processadas **na
  chegada**, imediatamente, validadas contra um cooldown em milissegundos. É como o Tibia
  funciona.
- **O tick de mundo** roda a **10 Hz** e cuida só do que é contínuo: IA de monstro, regeneração,
  expiração de efeitos e campos, dano ao longo do tempo.

Se as ações fossem enfileiradas para o tick, um tick de 10 Hz adicionaria até 100 ms de jitter
em cima do ping — inaceitável no PvP manual, irrelevante na caçada idle.

> **Restrição obrigatória: toda a matemática de combate é função do tempo decorrido, nunca
> "por tick".** Cooldowns, regeneração, dano ao longo do tempo e velocidade de ataque recebem
> `dtMs` e calculam a partir dele. Isso transforma a taxa de tick num botão livre — e é o que
> permite baratear drasticamente as sessões sem ninguém assistindo (seção 6). Se qualquer fórmula
> assumir "10 vezes por segundo", esse botão deixa de existir e a otimização mais valiosa do
> projeto fica indisponível.

### 3.2 Movimento por tile

O personagem não se move livremente em 2D: ele ocupa um tile e leva um tempo determinístico
para pular ao próximo, derivado da velocidade e do terreno (tipicamente 200–500 ms por tile).

Isso é um presente de arquitetura. Como a duração do passo é uma função conhecida:

- o **servidor valida cada passo exatamente** — não há como andar mais rápido do que a fórmula
  permite, e o anti-cheat de movimento é uma comparação de timestamps;
- o **cliente pode prever o próprio passo** — inicia a animação imediatamente e reconcilia se o
  servidor recusar. Sem predição, 80 ms de ping fazem o jogo parecer travado;
- **não é preciso rollback netcode.** A complexidade de um jogo de luta ou de tiro não se aplica
  aqui. O cliente prevê só o próprio movimento; dano, alcance e resultado de empurrão são sempre
  do servidor.

### 3.3 IA de monstro e pathfinding

**Monstros usam passo guloso, não A\*.** O monstro tenta o tile que o aproxima do alvo; se
estiver bloqueado, tenta os adjacentes; se não der, espera. É O(1) por monstro por tick e é
exatamente o comportamento do Tibia, que os jogadores reconhecem como certo.

Isso tem uma consequência importante e contraintuitiva:

> **Campos mágicos bloqueantes (magic wall) são baratos.**
>
> A preocupação natural é que uma parede invalide os caminhos de todas as entidades e force
> recálculo em massa. Isso só vale para entidades que mantêm um caminho calculado. Com passo
> guloso, o monstro não tem caminho guardado — ele reavalia o próximo tile de qualquer forma,
> e a parede é só mais um tile bloqueado. Custo de invalidação: zero.

A\* real é necessário só para o **clique-para-andar** do jogador (`walk-to`), que é um pedido
pontual sobre um mapa pequeno e estático — microssegundos, e o caminho é curto e descartável.
Se uma parede surgir no meio, o caminho é simplesmente recalculado no próximo passo.

O custo de pathfinding, portanto, é **proporcional ao número de entidades que perseguem**, não
ao número de paredes. Numa instância de PvP puro, onde ninguém persegue automaticamente, ele é
praticamente nulo.

### 3.4 Empurrão

Mover-se para um tile ocupado por outro personagem desloca esse personagem um tile na mesma
direção, se o destino for válido. Precisa de: cooldown próprio (senão vira empurrão em rajada),
regra de quem pode empurrar quem, verificação do tile de destino, e um sinal no evento de
movimento para o cliente animar diferente de um passo normal.

É barato — resolução de colisão em O(1) — e é uma das mecânicas mais expressivas do PvP tático
em grade, porque transforma posicionamento em recurso disputado.

---

## 4. A camada de automação — o "bot"

### 4.1 O motor de regras roda no servidor

O jogador escreve as regras na interface. O **servidor** as armazena e as avalia dentro da
simulação. Não é preciosismo: é o que faz o design funcionar.

- **Reação sem latência.** Se a regra fosse avaliada no cliente, "curar abaixo de 40% de vida"
  levaria dois RTT — o servidor avisa que a vida caiu, o cliente decide, a ação volta. Em PvP
  isso é a diferença entre curar e morrer, e puniria quem tem internet pior.
- **Ninguém escreve um bot melhor.** Com a avaliação no servidor, não sobra o que automatizar
  por fora. O arms race de script, que é metade do problema do PvP do Tibia, deixa de existir.
- **O bot vira alavanca de balanceamento.** Sendo um dado que o servidor controla, dá para
  limitar taxa, cobrar cooldown global e ajustar a expressividade sem update de cliente.

### 4.2 O motor precisa ser fechado

Nada de linguagem de script. Expressividade demais vira custo de CPU, superfície de exploit e
um jogo em que a vantagem é saber programar. O formato recomendado é uma **lista de regras
priorizada**, cada uma com condição, ação e cooldown:

```
regra := { prioridade, condição, ação, cooldownMs, ativa }

condição := estatística  op  valor          # vida% < 40
          | alvo.distância op valor          # alvo.distância <= 1
          | efeito.presente(id)              # está envenenado
          | habilidade.pronta(id)            # cooldown zerado
          | aliados.perto(raio) op valor     # cerco
          | e/ou de no máximo 3 condições

ação := usar(slot) | conjurar(id) | equipar(conjunto) | falar(texto)
```

Avaliação **por mudança de estado observada**, não a cada tick de cada jogador: quando a vida
muda, só as regras que olham para vida são reavaliadas. Isso mantém o custo proporcional aos
eventos, não à população.

### 4.3 O freio: atraso de reação

Um bot no servidor cura instantaneamente e sem erro. **Sem freio, dois jogadores bem
configurados nunca se matam** — a luta vira disputa de quem fica sem suprimento primeiro, que é
exatamente a parte chata do PvP do Tibia.

O freio tem duas partes:

- **atraso de reação simulado**, entre o gatilho e a ação (ponto de partida: 150–300 ms);
- **cooldown global de ações automáticas**, limitando quantas ações a máquina executa por
  segundo.

Este é o parâmetro mais sensível do jogo inteiro. Baixo demais e ninguém morre; alto demais e a
automação deixa de ser confiável e o jogador volta a querer um bot externo. **Precisa ser
configuração de servidor desde o primeiro protótipo**, para ser afinado com gente jogando — não
escolhido no papel.

### 4.4 Onde traçar a linha

Cada coisa que entra na automação sai da mão do jogador e o PvP fica menos sobre habilidade.
A divisão proposta:

> **A máquina cuida de você; o jogador cuida do inimigo.**
> Manutenção (cura, mana, buff, troca de equipamento, antídoto) é automática.
> Tudo que aponta para o oponente — escolher alvo, atacar, empurrar, posicionar parede — é manual.

Na caçada idle a linha se move: lá o alvo também é automático, porque não há oponente humano e
o objetivo é justamente não estar presente.

---

## 5. Rede e protocolo

### 5.1 Forma recomendada

WebSocket binário, um frame por mensagem, com um pacote de protocolo **compartilhado entre
cliente e servidor** em TypeScript. O padrão validado em produção por jogos deste gênero:

```
frame := [ chave uint32 LE ][ flags uint8 ][ corpo ]

flags: bit 0 = corpo comprimido (deflate)
       bit 1 = lote (vários frames concatenados com prefixo de tamanho)

corpo := JSON.stringify([ opcode numérico, propriedades ])
```

Pontos que importam:

- **Opcode numérico, nunca o nome textual no fio.** Duas tabelas, uma por direção, geradas do
  mesmo mapa compartilhado. Economiza banda e mantém 300 mensagens administráveis.
- **Validação de schema na entrada**, antes de a mensagem virar estado.
- **Lote e compressão desde o primeiro dia.** Retrofitar batching depois que dezenas de sistemas
  já publicam mensagens é doloroso.
- **Delta com ressincronização de emergência.** O padrão é enviar mudanças (`inventário-delta`,
  `criatura-move`), com uma mensagem de resync completa disponível para quando o cliente
  detectar inconsistência.
- **Feature flags vindas do servidor**, para ligar e desligar sistemas sem deploy de cliente.
- **Autenticação por ticket de vida curta**, pedido por HTTP antes de abrir o socket. A sessão
  de login nunca trafega no socket de jogo.

### 5.2 O cliente não recebe um snapshot por tick

Esta é a decisão que torna a banda viável. Um snapshot 10 vezes por segundo por jogador seria
inviável em escala. Em vez disso, o servidor manda **eventos discretos** e o cliente interpola:

- um passo é enviado **uma vez**, com origem, destino e duração; o cliente anima os 400 ms;
- dano, cura, morte, loot e efeito são eventos pontuais;
- barras de vida só são enviadas quando mudam, com throttle.

Ordem de grandeza resultante: **0,5 a 1,5 KB/s por jogador**. Para 15.000 jogadores simultâneos,
algo entre 10 e 20 MB/s de saída (100–160 Mbps) antes da compressão. É real, mas é uma conta
que fecha num punhado de máquinas.

---

## 6. Sessão desanexada — a caçada roda sem o navegador

Esta é a decisão que mais define o custo e a forma do servidor.

### 6.1 O modelo: sessão e visualizador

A caçada não é uma conexão, é uma **sessão do servidor**. O socket do jogador é apenas um
visualizador que se anexa e se desanexa.

```
SessãoDeCaçada        # dona do estado, vive no servidor, não depende de ninguém
  ├── personagens[]
  ├── monstros[]
  ├── regras de automação
  ├── log de sessão
  └── visualizadores[]   # 0 ou mais sockets, opcionais
```

Isso simplifica coisas que antes eram casos especiais: reconexão deixa de ser um fluxo próprio e
vira "anexar um visualizador"; assistir a party de um amigo é o mesmo mecanismo; e o modo
observador de administrador sai de graça.

Nos **modos manuais** (boss, quest, PvP, eventos) o visualizador vira obrigatório, porque ele é
também a fonte de input. Sem cliente ativo não há quem mova o personagem.

### 6.2 A consequência de custo: o limite muda de eixo

Antes, o custo era limitado por **conexões simultâneas**. Agora é limitado por
**personagens caçando simultaneamente** — que pode ser várias vezes maior, porque ninguém
precisa estar presente.

Se 15 mil pessoas estão online mas 60 mil personagens estão parados caçando, você simula 60 mil.
**Este é o maior risco de custo do projeto inteiro**, e ele não se resolve com engenharia: se
resolve com mecânica.

### 6.3 Os freios são mecânicas de jogo

Stamina, suprimento e duração de sessão deixam de ser só economia e passam a ser **o mecanismo de
controle de custo de infraestrutura**. Eles precisam ser dimensionados com isso em mente:

- **Stamina.** O personagem só caça por N horas; a stamina cai e a caçada para. É o freio
  principal, é o que o gênero já usa, e ainda funciona como gancho de monetização.
- **Suprimento.** A caçada consome poção e munição; acabou, a sessão encerra. Freio natural que
  também liga o custo de servidor à economia do jogo.
- **Sessões por conta.** Um personagem caçando por conta é o limite mais simples e mais eficaz
  contra farm em massa.
- **Duração máxima de sessão.** Um teto duro (por exemplo 8 h) que força um novo despacho.

Sem pelo menos dois desses, o custo é ilimitado por construção.

### 6.4 A economia: sem plateia, a simulação fica muito mais barata

Aqui está a compensação, e ela é grande. A projeção de custo (seção 10) aponta **banda e número
de conexões** como gargalo provável, não CPU. Uma sessão desanexada **não consome banda nenhuma**
— exatamente o eixo caro.

Além disso, a taxa de tick vira um botão:

- **Com visualizador anexado:** 10 Hz, para a animação ficar fluida.
- **Sem visualizador:** 1 a 2 Hz. Ninguém está vendo; a fidelidade visual não tem valor.
  Economia de 5 a 10× em CPU.

**A regra que mantém isso honesto:** a resolução de combate precisa ser idêntica nos dois casos —
mesmas fórmulas, mesmo gerador aleatório, mesmo resultado. O que cai não é a matemática, é a
**camada de apresentação**: não emitir evento por golpe, não interpolar projétil, não animar.
Só é possível porque toda a matemática é função de `dtMs` (seção 3.1). Se o resultado de uma
caçada mudar conforme o jogador esteja olhando ou não, os jogadores vão descobrir e o jogo perde
credibilidade.

### 6.5 O que precisa existir por causa disso

- **Regras de saída como rede de segurança, não conveniência.** Se o personagem pode morrer às
  3 da manhã com o dono dormindo, a saída automática por vida baixa e por fim de suprimento é
  obrigatória, com um piso não desativável.
- **Log de sessão e reanexação.** Voltar depois de seis horas precisa mostrar o que aconteceu:
  agregados (XP, gold, gasto, loot) mais eventos notáveis (subiu de level, item raro, quase morreu,
  morreu, saiu por qual regra).
- **Notificações.** Com a caçada rodando sem plateia, avisar por push, Telegram ou Discord que a
  sessão acabou, a stamina zerou ou o personagem morreu deixa de ser luxo e vira parte do loop.
- **Drenagem em deploy.** Milhares de sessões em voo sem ninguém conectado significam que reiniciar
  o servidor destrói progresso de gente que não está lá para reagir. É preciso persistir e retomar
  sessões, ou aceitar conscientemente perdê-las — e nesse caso, avisar antes.
- **Limites contra multiconta.** Sem navegador aberto, manter 50 contas farmando fica trivial.
  Os limites da seção 6.3 são a principal defesa.

### 6.6 O navegador ainda importa — nos modos manuais

Tudo abaixo deixa de valer para a caçada e passa a valer só para boss, quest, PvP e eventos:

- **`requestAnimationFrame` para em aba de fundo.** O render congela — o cliente precisa acordar e
  aplicar em bloco o que chegou, sem tentar animar minutos de eventos.
- **Temporizadores são estrangulados** para 1 Hz ou menos. Nenhuma lógica pode depender de
  `setInterval` no cliente.
- **O WebSocket morre em aba suspensa no celular.** Em modo manual isso é perda de controle:
  precisa de janela de carência e de uma política explícita depois dela (personagem parado,
  expulso do evento, ou entregue à automação).
- **Wake Lock** durante conteúdo manual, reaquisitado quando a aba volta a ficar visível.

---

## 7. Persistência

- **A simulação vive em memória.** Nenhuma leitura ou escrita de banco no caminho crítico de uma
  ação — isso mata o tempo de resposta do PvP.
- **Write-behind** para estado de personagem: descarregado a cada N segundos e em marcos
  (subir de level, sair de instância, morrer, receber item raro).
- **Escrita síncrona e log append-only** para o que não pode ser perdido nem duplicado: compra
  com moeda premium, negociação entre jogadores, mercado, transferência de gold. Um crash pode
  custar dois minutos de XP; não pode custar uma transação.
- **Sessões de caçada precisam ser serializáveis.** Como elas vivem sem ninguém conectado, um
  deploy ou uma queda de nó não pode simplesmente descartá-las. A sessão guarda um instantâneo
  periódico suficiente para ser retomada em outro processo — ou, no mínimo, para ser encerrada com
  o progresso creditado em vez de perdido.
- **Postgres** para o estado durável, **Redis** para presença, pub/sub entre nós e filas
  (matchmaking, agendador de eventos).

---

## 8. Assets e renderização

- **Grade de 32 px**, folhas de sprite com quadros por direção e por animação, e um **registro de
  aparências** separado das folhas: um índice que diz, para cada objeto/criatura/item, quais
  quadros usar, o tamanho, os pontos de deslocamento e as camadas.
- Essa separação registro-vs-folha é o que permite **trocar toda a arte depois sem tocar no
  renderizador**. Vale adotar desde o começo, mesmo usando um tileset provisório.
- **A arte precisa ser própria ou licenciada.** Usar os arquivos de um cliente comercial existente
  é risco jurídico direto, não questão de estilo. Caminho recomendado: começar com tileset
  comercial licenciado para destravar a engenharia, e encomendar a arte definitiva quando o jogo
  já se provar.
- **Divisão de renderização:** HUD em DOM (janelas, tabelas, formulários, chat, inventário —
  acessível, estilizável, fácil de iterar) e apenas o mundo em canvas (tiles, criaturas,
  projéteis, efeitos). Essa divisão é a prática consolidada do gênero e vale copiar.
- **Câmera:** ~18×14 tiles visíveis. É o que define o raio de interesse da rede também.

---

## 9. Opções de stack

Nenhuma dessas opções é errada. As diferenças relevantes:

### Servidor

| Opção | A favor | Contra |
|---|---|---|
| **Node 22 + uWebSockets.js** *(recomendado)* | Tipos compartilhados com o cliente em TypeScript — o maior ganho prático do projeto. `uWebSockets` aguenta dezenas de milhares de conexões por processo. Ecossistema e contratação fáceis. | Um único thread por processo; simulação pesada exige dividir em vários processos. GC pode causar picos de latência. |
| **Bun** | API igual à do Node, runtime mais rápido em I/O e startup. | Menos maduro para uso de longa duração; menos material sobre comportamento de GC sob carga. |
| **Go** | Concorrência nativa, latência previsível, sem GC de pausa longa. Excelente para muitas instâncias paralelas. | Perde o protocolo compartilhado em TypeScript — os tipos passam a ser gerados ou duplicados. |
| **Elixir / BEAM** | Modelo de processos isolados é *exatamente* o formato de "milhares de instâncias independentes". Supervisão, isolamento de falha e hot reload de graça. | Simulação numérica mais lenta; comunidade menor; nada compartilhado com o cliente. |
| **Rust** | Teto de desempenho mais alto, sem GC. | Velocidade de desenvolvimento muito menor — errado para a fase de descobrir o jogo. |

**Recomendação:** Node + uWebSockets para todo o projeto, com a simulação escrita como um núcleo
puro e isolado (sem I/O, sem dependência de framework). Se o custo de CPU virar o gargalo, esse
núcleo pode ser reescrito em Rust ou Go **sem tocar no protocolo nem no cliente**. Otimizar antes
de medir é o erro mais caro disponível aqui.

### Cliente

| Opção | A favor | Contra |
|---|---|---|
| **Phaser 4** | Pronto para jogo 2D: cena, câmera, sprites, entrada, áudio. Curva curta. | ~1,4 MB no bundle; traz muito que um jogo de tiles não usa. |
| **PixiJS v8** | Renderizador moderno (WebGPU com fallback WebGL), mais leve, mais controle. | Você escreve a camada de jogo — câmera, cena, entrada. |
| **Canvas 2D próprio** | Menor bundle possível, controle total, suficiente para tiles em grade. | Tudo por sua conta, inclusive batching e desempenho em celular. |

Para o HUD, qualquer framework de componentes serve. O critério de escolha é o que você já
domina — a dificuldade real deste projeto está no servidor, não na interface.

---

## 10. Orçamento de custo

Estimativas de planejamento, **não medições**. A primeira tarefa de engenharia do projeto é
substituí-las por números reais.

O cenário de referência: **15.000 jogadores conectados e 60.000 personagens caçando** — a
diferença entre os dois números é o efeito da sessão desanexada.

| Item | Estimativa | Observação |
|---|---|---|
| Instância de caçada, anexada, por tick | 50–200 µs | 5 jogadores + 10 a 40 monstros, 10 Hz |
| Instância desanexada, por tick | mesmo custo por tick, mas **5–10× menos ticks** | 1–2 Hz em vez de 10 Hz |
| Instâncias por core, anexadas | 200–500 | Já descontando GC e rede |
| 3.000 instâncias anexadas (15 mil jogadores) | 6–15 cores | O que hoje seria "todo mundo online assistindo" |
| 9.000 instâncias desanexadas (45 mil personagens) | 4–9 cores | Graças à redução de tick |
| **Total do cenário de referência** | **10–25 cores** | Duas a quatro máquinas |
| Banda de saída por jogador anexado | 0,5–1,5 KB/s | Protocolo por eventos, lote comprimido |
| Banda total | 10–20 MB/s | Só os 15 mil anexados; desanexado é zero |
| Cidade protect zone | ~10× mais barata por jogador | Sem combate, sem IA, sem motor de regras |

Duas conclusões práticas:

1. **O jogo é viável em poucas máquinas**, e o gargalo provável continua sendo banda e número de
   conexões, não CPU de simulação. Isso reforça a escolha de `uWebSockets` e do protocolo por eventos.
2. **A sessão desanexada é barata no eixo caro.** Ela multiplica o número de personagens simulados
   sem multiplicar a banda — desde que a redução de tick exista. Sem essa otimização, o mesmo
   cenário custa de 30 a 75 cores em vez de 10 a 25.

---

## 11. Restrições que o desenho de mecânicas deve respeitar

Esta é a seção que importa para desenhar mecânicas. **O que é barato, o que é caro, o que não dá.**

### Barato — desenhe à vontade

- Qualquer coisa resolvida por **evento discreto**: dano, cura, aplicar efeito, dropar item.
- **Efeitos por tile e por área em grade**: campos, armadilhas, zonas, auras com raio em tiles.
- **Temporizadores**: cooldowns, duração de efeito, janelas, ciclos.
- **Tabelas de dados**: loot, receitas, requisitos, progressão, preços.
- **Condições e regras** dentro do vocabulário fechado do motor de automação.
- **Instâncias com poucas entidades** — dezenas, não milhares.
- **Empurrão, bloqueio e posicionamento**: colisão em grade é O(1).

### Moderado — dá, mas cobre orçamento

- **Muitos monstros por instância** (acima de ~50): o custo é linear e some rápido.
- **Projéteis com trajetória** e colisão ao longo do caminho.
- **Áreas de efeito grandes**, que tocam muitos tiles e muitas entidades de uma vez.
- **Clique-para-andar** em mapas grandes: é A\* de verdade, ainda que barato por pedido.
- **Invocações e pets**: cada um é mais uma entidade que persegue e é perseguida.

### Caro — evite ou trate como decisão consciente

- **Qualquer coisa que exija mais de 20 Hz** de simulação: mira contínua, física, esquiva por
  reflexo, colisão fora da grade.
- **Mecânicas de caçada que dependam do cliente** — de renderizar, de responder, de estar aberto.
  Na caçada não há cliente. (Nos modos manuais isso é permitido, porque lá o cliente é obrigatório.)
- **Fórmulas escritas "por tick"** em vez de por tempo decorrido — inviabilizam a redução de tick
  da sessão desanexada, que é a otimização mais valiosa do projeto.
- **Caçada sem freio de duração.** Sem stamina, suprimento ou teto de sessão, o custo de servidor
  não tem limite superior.
- **Varredura global periódica**: "a cada minuto, avaliar todos os jogadores do servidor".
  Prefira eventos e índices.
- **Estado compartilhado entre instâncias em tempo real**: placares cruzados ao vivo, interferir
  numa sala a partir de outra.

### Não dá sem trocar a arquitetura

- **Combate ou PvP na cidade.** A cidade é protect zone por decisão de custo; devolver ações
  a ela é reintroduzir o mundo aberto que a arquitetura evita.
- **Mundo aberto persistente e contínuo**, com jogadores se encontrando fora de instâncias.
- **Caçada infinita.** A sessão roda sem o navegador, mas não para sempre: ela é limitada por
  stamina, suprimento e teto de duração, que é o que mantém o custo finito.
- **Conteúdo manual sem cliente.** Boss, quest, PvP e evento exigem input; não há como delegá-los
  à automação sem transformá-los em caçada.
- **Interação em tempo real entre instâncias.** Salas são isoladas por definição — é isso que
  permite escalar.

---

## 12. Perguntas em aberto para o desenho de mecânicas

1. **Onde exatamente termina o bot?** A proposta é "a máquina cuida de você, o jogador cuida do
   inimigo". Escolher alvo automaticamente em PvP é a fronteira a decidir.
2. **Qual o atraso de reação da automação?** Ponto de partida 150–300 ms, mas só testes com
   jogadores definem. É o parâmetro que decide se as lutas terminam.
3. **Morte em PvP tem custo?** Perder XP ou item transforma o PvP em algo que só quem tem folga
   econômica pode praticar.
4. **A árvore de passivas vale nos dois contextos?** Nós de throughput são inofensivos na caçada
   e decisivos na guerra. Ou os nós são sensíveis a contexto, ou a árvore fica restrita ao PvE.
   É a decisão de balanceamento mais cara de reverter depois.
5. **Campos mágicos são consumíveis ou cooldown?** Runa gasta puxa a parede para dentro da
   economia — quem tem mais gold controla mais mapa. Cooldown a mantém como recurso tático puro.
6. **O que acontece quando o personagem morre desanexado?** Volta ao templo, fica no chão até o
   jogador voltar, perde alguma coisa? É a pergunta que mais afeta a confiança no modo idle —
   ninguém deixa o personagem caçando à noite se dormir pode custar caro.
7. **Quantas sessões simultâneas por conta?** Uma só é o limite mais simples contra farm em massa,
   e é também o freio de custo mais previsível.
8. **Quais são os freios de duração?** Stamina, suprimento e teto de sessão precisam de números,
   porque eles definem simultaneamente a economia, a monetização e o custo de infraestrutura.

---

## 13. Resumo executivo

- Instanciar tudo é o que torna o jogo viável; a cidade sendo protect zone é o que impede o único
  espaço compartilhado de virar o gargalo.
- **A caçada é uma sessão do servidor, não uma conexão.** Ela roda com o navegador fechado; o
  socket é só um visualizador. Os modos manuais — boss, quest, PvP, evento — exigem cliente ativo.
- **O limite de custo mudou de eixo:** não é mais conexões simultâneas, é personagens caçando.
  Quem segura esse número são mecânicas — stamina, suprimento, teto de sessão, sessões por conta —
  e não engenharia.
- **Toda fórmula de combate é função do tempo decorrido, nunca "por tick".** É isso que permite
  rodar a 1–2 Hz quando ninguém está assistindo, com resultado idêntico.
- Ações na chegada, tick de mundo a 10 Hz quando anexado, movimento por tile com predição só do
  próprio passo. Nada de rollback netcode.
- Monstros com passo guloso tornam pathfinding e campos bloqueantes baratos — o custo é
  proporcional a quem persegue, não a quantas paredes existem.
- O bot roda no servidor. Isso elimina o arms race de script, iguala a reação entre jogadores e
  transforma o anti-cheat num parâmetro de balanceamento.
- O atraso de reação da automação é o ajuste mais sensível do jogo.
- O gargalo provável é banda e conexões, não CPU. Protocolo por eventos, em lote e comprimido,
  desde o primeiro dia.
- Escreva a simulação como núcleo puro, isolado de I/O e de framework, para poder trocar de
  linguagem depois sem tocar no protocolo nem no cliente.
