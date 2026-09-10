# 0023 — A Cidade é um shard: uma cópia, muitos personagens

**Status:** aceito
**Data:** 2026-09-10
**Contexto técnico:** `sim` (`Session`, ruleset da Cidade), `server` (`SessionHost`, fábrica de
sessão)

## Contexto

O invariante 8 diz que todo personagem está sempre em exatamente uma sessão, cidade inclusive.
A implementação leu isso ao pé da letra pelo lado errado: `createCitySessionFactory` criava uma
`Session` **por personagem**, e a praça passou a existir N vezes — vazia em todas.

Medido no host real, com dois personagens:

```json
{"sessionCount":2,"sameSession":false,"participantsPerSession":[["p1"],["p2"]],
 "hasLeave":false,"p1SawMove":0,"p2SawOwnMove":1,"p1SawChat":0}
```

Ninguém via ninguém. O `say` de alcance "sessão inteira" (FUN-58) alcançava só o autor. E o
critério da FUN-33 — *500 clientes não fazem a transmissão crescer quadraticamente* — passava por
vacuidade, porque a transmissão era zero.

O obstáculo estrutural era um só: `Session` tinha `enter` e não tinha `leave`. Sair de uma sessão
era encerrá-la, então um jogador saindo da praça encerraria a praça.

## Decisão

**A Cidade é uma sessão compartilhada — o shard.** Uma cópia por processo `game`, muitos
personagens dentro. As demais sessões continuam instanciadas por quem entra.

Três peças sustentam isso:

1. **`Ruleset.shared`.** Ausente é `false`, que é a sessão de sempre: um personagem, dono do que
   ela produz. `true` muda o que "sair" significa.
2. **`Session.leave(characterId)`.** Tira um participante de uma sessão que continua viva e
   chama `Ruleset.onLeave`, para o ruleset desfazer o que a entrada fez.
3. **O shard não tem extrato nem snapshot.** A Cidade não credita nada (§37), então não há
   progresso a guardar; e o que um snapshot guardaria é a praça inteira, uma cópia por
   participante, a cada dez segundos. Quem entra, entra do zero.

O repouso (FUN-52) passa a ser contado **por personagem**, não por sessão: num shard, o jogador
que fecha o navegador não pode recolher a praça em que os outros estão.

### O invariante 8 não muda; muda a leitura

Continua valendo na letra — todo personagem está em exatamente uma sessão. O que passa a ser
verdade é o outro lado da relação: **uma sessão pode ter muitos personagens**. O que o invariante
protege é "não existe lugar onde o personagem esteja em dois estados ao mesmo tempo", e isso
continua de pé: `#sessionIdByCharacter` mapeia um personagem para uma sessão, e `leave` e `enter`
acontecem no mesmo passo síncrono da transição.

O invariante 9 — estado quente só é escrito pela sessão dona — também continua: a dona do estado
de cada personagem na praça é a praça, e ela roda num processo só.

### Cópia vazia é descartada

Quando o último sai, a cópia deixa de existir; a próxima entrada cria outra. Não é economia de
memória: a versão de conteúdo é **fixada na criação** (invariante 7), então uma praça que ninguém
frequenta e atravessa três deploys continuaria rodando a versão do primeiro.

### Chegar na praça é `placeNear`, não `place`

O ponto de entrada é um tile só, e tile é exclusivo. O segundo a chegar encontrava o primeiro
parado exatamente ali e `place` recusava — o personagem ficava fora do mapa, invisível e sem
andar, com o log dizendo que ele entrou. Agora a chegada procura o livre mais próximo, na mesma
ordem fixa do respawn.

### Sair libera o tile REMONTANDO a ocupação

`onLeave` chama `world.reset(session.participants)` em vez de liberar o tile pela posição de quem
saiu. Quando a saída acontece numa transição, quem sai **já foi colocado** no mapa da hunt para
onde vai, e `TileOccupancy` guarda coordenada, não dono: liberar por `character.position`
liberaria um tile da praça usando coordenada de outro mapa, em cima de quem estivesse parado ali.
É o defeito que a FUN-72 corrigiu no `place`, entrando pela mesma porta.

## Alternativas

- **Manter uma sessão por personagem e sincronizar entre elas.** É reimplementar sessão
  compartilhada com outro nome, e sem o ponto em que a ordem dos eventos é decidida — duas
  sessões avançando em paralelo não têm um relógio comum.
- **Uma praça global entre nós, com estado no Redis.** Quebra o invariante 9: o estado quente
  passaria a ter mais de um escritor, e a praça viraria o único lugar do jogo precisando de lock.
  Uma cópia por nó entrega o mesmo produto — o §13 do PRD já prevê "Cidade 2".
- **Dar extrato e snapshot ao shard.** O extrato de uma sessão com duzentos donos não tem
  significado, e creditar o mesmo agregado N vezes é pior que não creditar. O snapshot guardaria
  a praça inteira por participante.
- **Deixar `place` recusar e o personagem esperar um tile livre.** Um jogador que entra e não
  aparece, sem nada explicando, é o pior sintoma possível.

## Consequências

O `say` de alcance "sessão inteira" passa a alcançar a praça inteira — que é o que a FUN-58
especificava e o que a Cidade privada silenciosamente não fazia.

A transmissão da Cidade passa a existir, e a **FUN-33 passa a ter o que cortar**: cada passo vai
para todos os visualizadores da cópia. É a premissa que faltava para AOI por célula e para o teto
de população por cópia.

Um personagem desconectado continua de pé na praça durante a carência de repouso (FUN-52), agora
visível para os outros. É o mesmo comportamento de antes, com testemunhas.

O teto de população por cópia **não entra aqui**. Uma cópia por nó é o que esta decisão entrega;
escolher o número e distribuir entre cópias é a FUN-33, e fixá-lo agora seria inventar
balanceamento.

## Invariantes afetados

O 8 continua de pé, com a leitura acima explicitada. Nenhum dos outros dez muda.
