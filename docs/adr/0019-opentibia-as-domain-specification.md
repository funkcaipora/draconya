# 0019 — OpenTibia como especificação de domínio

**Status:** aceito
**Data:** 2026-09-09
**Contexto técnico:** `sim` principalmente; toda decisão de mecânica de jogo daqui para a frente

## Contexto

O Draconya está redescobrindo problemas que engines de MMORPG resolveram há vinte anos.

Não é hipótese. Dois exemplos desta semana, os dois achados por medição e não por leitura:

- o monstro aplicava **uma** ação por tick mesmo quando o tempo decorrido concedia várias, e a
  hunt desanexada — o modo padrão do jogo — era o dobro mais fácil que a mesma hunt com alguém
  olhando (FUN-67);
- o personagem nasce em `(0,0)`, que é parede em qualquer tilemap, porque não existe um lugar
  único que decida se uma posição é legal (FUN-60).

Os dois são casos particulares de coisas que TFS e Canary já têm resolvidas: cadência de criatura
como evento agendado, e legalidade de tile centralizada no `Tile`.

Existe um estudo dessas duas engines, feito contra commits específicos, em
`docs/reference/opentibia-engine-reference.md`. A pergunta que este ADR responde não é se o estudo
é bom — é **o que fazer com ele**, porque um documento de 4.000 linhas com um plano de dez fases
pode virar tanto um atalho quanto uma reescrita que não termina.

## Decisão

**OpenTibia é especificação de domínio. O Draconya continua sendo a engine.**

Antes de implementar qualquer mecânica de jogo nova, consultar a seção correspondente do documento
de referência e responder às cinco perguntas da §75 dele: qual é o mecanismo genérico, quais casos
de borda já são conhecidos, o que é específico do Tibia, o que conflita com o Draconya, e qual é a
versão mínima e original que devemos escrever.

Três limites que valem sempre:

1. **TFS e Canary são GPL v2.** Estuda-se arquitetura, fluxo, contrato e caso de borda; **não se
   copia, traduz nem adapta código linha a linha.** Se alguma vez reutilização direta parecer
   necessária, o trabalho para e a decisão de licença é tomada explicitamente, antes.
2. **"Igual ao Tibia" não é argumento sozinho.** O documento distingue *mecanismo de engine* de
   *regra de produto*, e a distinção é o que impede fórmula oficial de Tibia de entrar por
   fidelidade quando o PRD quer outra coisa. Ataque do jogador que sempre acerta é regra nossa e
   fica.
3. **Adoção é puxada por trabalho, não empurrada por completude.** Um mecanismo do documento só
   entra quando existe defeito medido ou tarefa na fila que o exija. Refatorar por simetria com o
   TFS é o modo de falha que este ADR existe para evitar.

### O que entra agora, e por quê

| Mecanismo | O que força |
|---|---|
| Tempo lógico por sessão e scheduler determinístico | 1,51x de divergência de dano entre hunt anexada e desanexada, medido (FUN-68). Também desarma o cooldown absoluto que guarda relógio de processo dentro do snapshot |
| Sistema de movimento com escritor único e legalidade de tile | `walk`/`walk-to` chegam no socket e não são tratados (FUN-58); nascimento em parede (FUN-60); `creature-move` não é emitido por ninguém |
| Morte e recompensa como pipeline, com atribuição de dano | Loot por abate não existe (FUN-63), e atribuição é o que party, boss e bestiário vão precisar |

### O que fica adiado, explicitamente

Registrado para não ser reproposto a cada leitura do documento:

- **A reestruturação de pastas da §47.** Mover arquivo não corrige defeito, e o custo é o histórico
  de `git blame` de tudo que existe.
- **`GameCommand` e a hierarquia de controllers (§42).** Hoje só o bot produz intenção. A FUN-58
  cria a segunda fonte; a forma mínima que ela pedir é o que se escreve, e não a taxonomia inteira
  antes de haver dois consumidores.
- **Condition engine (§20).** É o mecanismo certo, e nada precisa dele ainda. É pré-requisito da
  primeira magia ou do primeiro dano ao longo do tempo — não do que está na fila.
- **Transação de inventário com containers aninhados (§25).** Depois que equipamento existir.
- **A interface `NavigationPolicy` com A\* (§11.3).** O passo guloso é decisão de produto (ADR
  0009) e fica; a interface de estratégias vem quando Quest precisar de click-to-walk, que é o
  primeiro caso real.
- **Lua e scripting (§35).** O próprio documento adia.
- **`ENGINE_MIGRATION_BASELINE.md` (§50).** O que protege comportamento entregue é teste de
  contrato, não inventário em prosa. Os dois que valem — invariância de frequência e invariância
  de restauração — entram junto com a FUN-68.

## Alternativas

**Executar o plano R0–R10 do documento como programa.** Descartada. As dez fases têm evidência
muito desigual: R1 e R2 têm defeito medido e tarefa parada esperando; R3, R5 e R6 são especulação
até existir conteúdo que as exija. Adotar o bloco inteiro seria trocar um problema real — o jogo
diverge entre anexado e desanexado — por meses de trabalho sem nada visível, que é exatamente a
reescrita que não termina.

**Ignorar o estudo e seguir por demanda.** Descartada, e a FUN-67 é a prova: o defeito estava
descrito na §6.2 do documento, com o nome certo, enquanto uma medição nossa anterior tinha
concluído que estava tudo bem — porque olhou o caminho do jogador e nunca o do monstro.

**Trocar a engine pelo TFS ou pelo Canary.** Descartada por licença (GPL v2 contamina), por
runtime (C++ com mundo global e `Player` acoplado ao protocolo), e por desenho: nenhuma das duas
tem sessão que sobrevive ao socket, que é a propriedade central do Draconya.

## Consequências

O documento de referência vira parte do repositório (`docs/reference/`), não anexo de conversa —
Claude Code e Codex leem o mesmo arquivo, e uma seção citada num PR é verificável.

Fica uma obrigação nova e barata: **toda issue de mecânica de jogo aponta a seção do documento que
consultou, ou diz que não há uma.** É o que transforma "consulte antes de inventar" em algo que
aparece na revisão em vez de depender de disciplina.

Fica também um risco que vale nomear: usar o documento como autoridade em vez de referência. Ele
descreve uma engine de mundo persistente compartilhado; o Draconya é instanciado e idle-first, e
há decisões nossas — Cidade inerte (ADR 0004), sem loot no chão, sem cadáver — em que o TFS é o
exemplo do que **não** fazer. A §64 do documento traz a tabela de adotar/adaptar/rejeitar, e ela
vale mais que qualquer seção descritiva.

## Invariantes afetados

Nenhum muda. Dois ganham mecanismo de verificação que não tinham:

- **invariante 2** (nada por tick) e **invariante 3** (o resultado não depende de haver alguém
  assistindo) passam a ter teste de invariância de frequência como contrato, em vez de dependerem
  de cada chamador lembrar de consumir o tempo decorrido inteiro. Foi a ausência desse contrato
  que deixou a FUN-67 passar por um teste que afirmava exatamente a propriedade que estava quebrada.
