# 0002 — Bot avaliado no servidor

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `sim/` (motor de regras), `server` (processo `game`), `content/` (`bot_config`, vocabulário versionado)

## Contexto

Draconya se define como "o Tibia jogado com bot, com o bot oficializado": a automação de
manutenção (cura, poção, magia, troca de equipamento) precisa existir para todo mundo, de forma
igual. Se essa automação fosse avaliada no cliente, decidir "curar abaixo de 40% de vida"
custaria dois RTT — o servidor avisa a queda de vida, o cliente decide, a ação volta — o que em
PvP é a diferença entre curar e morrer, e penaliza quem tem internet pior. Avaliação no cliente
também reabre o arms race de scripts externos, hoje apontado como metade do problema do PvP do
Tibia: quem tivesse o bot melhor venceria, não quem jogasse melhor.

O PRD (§13) já especifica um motor implementável: cinco categorias independentes — Cura (3
slots), Potions (4: 2 vida, 2 mana), magias de ataque (10), runas e itens (10), magias de
suporte (10) — cada uma com cooldown próprio de 1 s, avaliadas de cima para baixo com a primeira
regra válida executando.

## Decisão

Rodar o motor de regras de automação inteiramente no servidor, com vocabulário fechado e
versionado de condições (`hp%`, `mana%`, `distânciaAlvo`, `efeitoPresente`, `habilidadePronta`,
com `< > <= >=`) e ações (`conjurar`, `usarPotion`, `usarRuna`, `equipar`, `desequipar`) — nunca
uma linguagem de script. Cinco categorias independentes, cada uma com cooldown de 1 s, avaliação
de cima para baixo com a primeira regra válida executando.

## Alternativas

- Avaliar o bot no cliente e o servidor só validar a ação recebida — descartada pelo custo de
  dois RTT em reação e por reabrir o arms race de scripts externos.
- Linguagem de script configurável pelo jogador — descartada: expressividade demais vira custo
  de CPU, superfície de exploit, e um jogo em que a vantagem é saber programar.
- Reavaliar todas as regras de todos os jogadores a cada tick de mundo — descartada em favor de
  avaliação disparada por evento (mudança de HP, expiração de cooldown de categoria), que mantém
  o custo proporcional a eventos, não à população.
- Interpretar as regras a cada avaliação, percorrendo a estrutura salva — descartada em favor de
  compilar as regras uma vez, ao entrar na sessão, para um vetor de predicados fechados.

## Consequências

- A reação da automação fica igual para todo mundo: ping ruim deixa de ser desvantagem, e não há
  mais espaço para script externo melhor que o de outro jogador.
- O bot vira alavanca de balanceamento controlada pelo servidor — dá para limitar taxa e ajustar
  expressividade sem tocar no cliente.
- Cria a necessidade de um segundo freio deliberado: sem atraso de reação simulado (150–300 ms
  como ponto de partida), duas configurações boas nunca se matam em PvP, e a luta vira disputa de
  quem fica sem suprimento primeiro. Esse cooldown por categoria é o freio de reação que era uma
  pergunta em aberto na análise de restrições do motor, e passa a ser o parâmetro mais sensível
  do jogo — precisa ser ajustável em produção, não fixado no código.
- Vocabulário fechado significa que qualquer condição ou ação nova exige mudança no servidor;
  versionar o vocabulário junto de `bot_config` é obrigatório para não invalidar configurações
  salvas quando o vocabulário crescer.
- Compilar regras uma vez por entrada na sessão implica que mudar uma regra em pleno combate
  exige recompilar o vetor de predicados, não só atualizar um campo.

## Invariantes afetados

4 (o cliente só manda intenção — a decisão de curar, atacar etc. nunca se origina nele), 11 (a
automação é legítima, "parece bot" nunca é sinal de punição). Reforça também o 9, já que as
regras compiladas vivem como estado quente da sessão dona do personagem.
