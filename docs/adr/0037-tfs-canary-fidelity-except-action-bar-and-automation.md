# 0037 — Fidelidade ao TFS/Canary como regra, exceto a barra de ações e a automação

**Status:** aceito — revoga o limite 2 do [ADR 0019](0019-opentibia-as-domain-specification.md) para mecânica de jogo; abre um perfil de combate novo pelo caminho que o [ADR 0031](0031-contrato-de-compatibilidade-de-combate-e-migracao.md) exige
**Data:** 2026-09-24
**Contexto técnico:** `sim` (monstro, combate, progressão, party, spawn), `content` (monstros, itens, magias, vocações, mapas), `server` (migração de dados), `tools` (mapa multiandar, semente local)
**Issues:** M28 — #518 a #527

## Contexto

Em 2026-09-24 o usuário pediu, com estas palavras: *"copie tudo do The Forgotten Server e Open
Tibia. Mantenha apenas o menu de ações e automação que existe, o restante copie tudo como é no
Tibia"*, e fixou o teste que prova isso: uma party de quatro — Knight, Paladin, Sorcerer e Druid,
todos level 200 — caçando na Darashia Dragon Lair, rodando localmente.

Até aqui o ADR 0019 tratava TFS e Canary como **especificação de domínio**, com um freio
explícito: *"igual ao Tibia" não é argumento sozinho* (limite 2). Foi esse freio que manteve
regras nossas no lugar das do Tibia — ataque do jogador que sempre acerta, curva de XP
`20 × level²` escolhida para o level 8 chegar em duas horas, regeneração de 1 HP/s para todas
as vocações, magias caindo numa conversão genérica de Base Power, XP de party `100 + 25 ×
vocações únicas`. A auditoria de 2026-09-24 (quatro agentes contra `main` `34582da`, números
conferidos no `opentibiabr/canary` `main` e no `otland/forgottenserver` `master`) mediu o custo
disso para o teste pedido: o dano de arma de um Knight level 200 sai cerca de 3× abaixo do Canary,
a Mass Healing cerca de 5×, e o monstro não consegue soltar a onda de fogo do dragão, rolar chance
por ataque, se curar, trocar de alvo nem fugir.

## Decisão

1. **O Tibia é a regra, não a referência, para toda mecânica de jogo.** Mecanismo e números vêm do
   TFS/Canary. Quando o Draconya diverge, a divergência é defeito, a menos que caia numa das
   exceções abaixo ou num invariante.

2. **Exceções — o que continua sendo do Draconya:**
   - **a barra de ações** (ADR 0032: slots, loadouts, disparo manual e as automações de entrada
     OU / saída E) e o catálogo de ações que ela mostra (ADR 0033);
   - **a automação**: o bot server-side (ADR 0002, invariante 11), rota, follow, targeting do bot
     e presets;
   - **a arquitetura**: os onze invariantes — sessão instanciada, idle-first, server-authoritative,
     conteúdo fixado por sessão, ledger. Fidelidade de mecânica nunca justifica violar um deles.

3. **O limite 2 do ADR 0019 deixa de valer para mecânica de jogo.** Os limites 1 (licença) e 3
   (adoção puxada por trabalho) continuam. A licença do ADR 0019/0031 não muda: TFS e Canary são
   GPL v2; entram **números e mecanismos**, nunca código copiado, traduzido ou adaptado linha a
   linha. O teste prende o resultado, não a forma.

4. **Precedência de fonte.** O pacote de arte é 13.32 e o Canary é a engine que acompanha o
   cliente moderno, então: **Canary `main`** para fórmulas, magias, runas, poções, itens e
   `vocations.xml`; **TFS** onde o Canary não define ou onde a nossa escala é a clássica — a
   velocidade de monstro fica na escala do TFS (Dragon 172, Dragon Lord 200), porque o nosso
   passo é `ceil50(chão × 1000 / speed)` e o rato e o rotworm já estão nela; o Canary guarda
   metade (86/100) por outra fórmula de cliente. **TibiaWiki** para fato que nenhuma das duas
   engines carrega (preço de NPC, por exemplo).

5. **Perfil de combate novo, `breaking`** — o próximo id livre (o código hoje só declara o
   `combat-v1`; o `combat-v2` que o ADR 0032 planejou para a postura só existe no papel). O
   ADR 0031 exige perfil novo para qualquer mudança de resultado, RNG ou arredondamento. O M28 muda de propósito: dano de arma com a
   fórmula e a variância do Canary, chance de acerto à distância, fórmulas de magia do Canary em
   todo o catálogo, monstro com chance por intervalo. As exceções de produto do PRD §12.2 que o
   `combat-v1` congelou (sempre acerta; Dodge pela metade) saem, a menos que a #522 mostre que o
   Dodge corresponde a uma mecânica do Tibia (o charm Dodge) — nesse caso fica na forma do Tibia.
   Sessão em andamento continua no perfil da versão de conteúdo dela (invariante 7).

6. **Hunt copiada do Tibia usa o spawn do Tibia.** Os pontos vêm do arquivo de spawn do Canary,
   cada um com o seu monstro, a sua posição e o seu `spawntime`, e o respawn espera o jogador sair
   da vista, como no TFS. O modelo de dificuldade por tamanho de pull (`monsterCount`, FUN-123)
   continua para as hunts copiadas do Huntera (Rat Cellars, Rotworm Caves), que são outra fonte.

7. **Dado persistido migra, nunca é descartado** (ADR 0014). A curva de XP do Tibia muda o que
   `xp` significa: quem existe mantém o level e a fração dentro dele.

## Alternativas

**Continuar caso a caso sob o ADR 0019.** Descartada pelo pedido do usuário, e pela medição: cada
regra própria que sobrevive torna o teste da party level 200 incomparável com uma party real na
mesma lair, que é justamente a comparação que o teste existe para fazer.

**Copiar o Canary inteiro, inclusive o que conflita com a arquitetura** (mundo persistente, spawn
compartilhado, cadáver-container, cliente calculando). Descartada: as exceções da decisão 2 são o
que o Draconya é; os invariantes continuam medindo toda decisão.

**Usar a velocidade do Canary para monstro.** Descartada pela decisão 4: exigiria trocar a fórmula
de passo e reescalar o rato e o rotworm sem ganho de fidelidade no que o jogador vê.

## Consequências

- O M28 (#518–#527) aplica a regra ao que a party de dragões exercita: IA de monstro, mapa
  multiandar e spawn por ponto, Dragon e Dragon Lord, curva de XP e progressão, dano de arma,
  magias, kit level 200 e poções, XP compartilhada, semente local e o teste no navegador.
- Mecânica que o M28 não toca continua como está até uma tarefa a tocar — adoção puxada por
  trabalho (limite 3 do ADR 0019). Uma regra própria encontrada fora do M28 vira issue, não
  refatoração oportunista.
- `docs/product/*` passa a marcar como divergência qualquer regra que ainda não é a do Tibia, com
  o motivo.

## Invariantes afetados

Nenhum muda. A decisão 2 existe para que a fidelidade nunca seja argumento contra eles.
