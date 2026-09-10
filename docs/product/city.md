# Cidade

**Status:** parcial — protect zone com mapa, ponto de entrada e movimento (FUN-60, FUN-69) e
**shard compartilhado** com entrada, saída e visibilidade entre jogadores (FUN-71); faltam
interest management e teto de população (FUN-33), loja, depósito e Market (E5, E13)
**PRD:** §6, §37
**Épico:** E1 (sessão e visualizador)
**Referência técnica:** [ADR 0004](../adr/0004-city-as-protect-zone.md) (Cidade como protect
zone), [ADR 0023](../adr/0023-the-city-is-a-shard.md) (a Cidade é um shard)

## Comportamento

A Cidade é onde o personagem está quando não está em outra coisa. Não é um menu nem um estado
"sem sessão": é uma sessão como qualquer outra, com mapa, tiles e movimento — só que **orientada
a evento**, sem laço de simulação. Ela custa perto de zero quando ninguém faz nada.

Entrar no jogo é entrar na Cidade. Morrer devolve para ela, com vida e mana cheias (§26.1). Sair
de uma hunt, por regra do bot ou por vontade do jogador, devolve para ela. É o invariante 8 em
comportamento: "a hunt acabou" nunca significa "ele ficou sem sessão".

**É protect zone:** nada causa dano, nada morre. Combate na Cidade não existe, e não porque foi
esquecido — é o ADR 0004.

## Uma cópia, muitos personagens (FUN-71)

A Cidade é o **shard**: uma cópia por processo `game`, com todo mundo daquele nó dentro. É a única
sessão do jogo assim — hunt, quest, boss e guild war são instanciadas por quem entra.

Até a FUN-71 ela era o contrário disso, e ninguém tinha notado: `createCitySessionFactory` criava
uma sessão **por personagem**, então a praça existia N vezes, vazia em todas. Dois jogadores no
mesmo lugar do mundo não se viam, e o `say` de alcance "sessão inteira" alcançava só o autor.

O que a cópia compartilhada dá:

- cada um vê os outros no `session-state` ao entrar;
- quem chega manda `creature-appear` para quem já estava, e quem sai manda `creature-disappear`
  para quem fica — esquecer o segundo deixa fantasma na tela, um boneco parado que não
  corresponde a ninguém;
- o passo de um chega aos outros como `creature-move`;
- o `say` alcança a praça, que é o que a FUN-58 sempre especificou.

**"Cidade 2" nasce de dois nós.** Dois processos `game` já são duas cópias, sem nada a mais. O teto
de população por cópia e a escolha de qual entrar são a FUN-33.

### Chegar e sair

O ponto de entrada é **um tile**, e tile é exclusivo. Quem chega entra nele ou no **livre mais
próximo**, na mesma ordem fixa que o respawn da hunt usa. Sem isso, o segundo a chegar ficaria
fora do mapa — invisível, sem andar, com o log dizendo que entrou.

Sair é `Session.leave`, não `end`. Antes da FUN-71 sair só sabia ser encerrar, e um jogador
fechando o jogo na praça levaria a praça junto. Quando o **último** sai, a cópia é descartada; a
próxima entrada cria outra, já na versão de conteúdo do momento — uma praça que ninguém frequenta
e atravessa três deploys continuaria rodando a versão do primeiro (invariante 7).

### A praça não tem extrato nem snapshot

A Cidade não credita nada (§37): não há progresso a guardar. E um snapshot dela guardaria a praça
inteira, uma cópia por participante, a cada dez segundos. **Quem entra, entra do zero.**

Isso tem uma obrigação junto: ao voltar de uma hunt, o snapshot **da hunt** é apagado, não apenas
deixado de reescrever. Sem isso, quem morre volta para a praça, o snapshot da hunt já creditada
fica de pé no Redis, e a próxima conexão retoma uma hunt encerrada.

### Desconectar não tira ninguém da praça na hora

A carência de repouso (FUN-52) vale por **personagem**, não pela sessão: cinco minutos sem ninguém
olhando para ELE, e o personagem é recolhido. Contar por sessão diria o contrário do que a regra
quer — um jogador com o navegador aberto seguraria todo mundo na memória do nó.

Durante esses cinco minutos o personagem desconectado **fica de pé na praça**, visível para os
outros. É o mesmo comportamento de antes da praça compartilhada; a diferença é que agora há
testemunhas.

## Regras

- Protect zone: nada causa dano, ninguém morre (ADR 0004, §37).
- Orientada a evento — `hz` é 0. Nenhum evento é agendado na Cidade, e receber um é bug de outro
  sistema: o ruleset falha alto em vez de queimar CPU no único espaço compartilhado do jogo.
- Voltar à Cidade cura HP e mana por completo (§26.1). Quem cura é a entrada, não a transição.
- Movimento passa pelo mesmo sistema da hunt e do bot (FUN-69): `movement.ts` é o único escritor
  de posição, e a Cidade não é exceção.
- Uma cópia por processo `game`; muitos personagens por cópia.
- Sair de um shard é `leave` — a sessão continua para quem ficou.
- A cópia vazia é descartada.
- Shard não tem extrato nem snapshot.
- Repouso é por personagem.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Mapa e ponto de entrada | `city.mapId` e `entryPoint` do tilemap | `packages/content/data/maps` |
| Velocidade de passo | 500 ms por tile `[ABERTO — valor provisório: 500]` | `packages/content/data/progression/baseline.json` |
| Raio de busca de tile livre na chegada | 8 tiles | `packages/sim/src/rulesets/city.ts` — geometria, não balanceamento |
| Carência de repouso | 5 min | `packages/server/src/game/host.ts` |
| Teto de população por cópia | `[ABERTO]` — é a FUN-33 | ainda não existe; será configuração de nó, não conteúdo |

## Em aberto

- Interest management por célula e teto de ~200 por cópia (FUN-33, §13 do PRD técnico). O custo
  que ela corta **passou a existir** com a praça compartilhada: até a FUN-71 a transmissão da
  Cidade era zero, e o critério dela passava por vacuidade.
- Loja, depósito e Market na Cidade (E5, E13).
- [ABERTO] O que mais a Cidade é — praça social, hub de navegação, ou as duas. O PRD não decide,
  e é o que trava o canal global do [chat](./chat.md).
