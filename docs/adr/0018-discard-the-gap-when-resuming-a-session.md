# 0018 — Retomada descarta o intervalo, não o simula

**Status:** aceito
**Data:** 2026-09-08
**Contexto técnico:** `sim`, `server` (FUN-28), e o extrato do jogador

## Contexto

Uma sessão é gravada a cada dez segundos. Quando o nó morre, o que existe é um snapshot e um
buraco: o tempo entre a última gravação e o momento em que alguém retoma. Esse buraco pode ser
de segundos, se o processo reiniciou sozinho, ou de horas, se o jogador só voltou no dia
seguinte — e o jogo é idle-first, então "voltar no dia seguinte" é o caso normal, não o
extremo.

Alguma coisa precisa ser feita com esse intervalo, e a escolha aparece no extrato de quem joga.

O detalhe técnico que força a decisão: `lastTickMs` no snapshot foi medido pelo relógio
**monotônico** do processo que morreu, e monotônico não é comparável entre processos. Restaurar
sem tratar isso dá um de dois desastres, os dois silenciosos:

- o número do snapshot está à frente do relógio novo, `dtMs` sai negativo, e a sessão **nunca
  mais avança** — a hunt fica parada rendendo zero, sem erro nenhum no log;
- o número está muito atrás, e o primeiro tick chega com um `dtMs` gigante que resolve horas de
  combate num passo só. O personagem morre, ou mata tudo, de uma vez.

## Decisão

**Descartar o intervalo.** Ao retomar, o relógio da sessão é reposicionado no agora do processo
novo (`Session.rebaseClock`), e a simulação continua dali como se nada tivesse acontecido — sem
avançar o tempo pulado, nem de uma vez nem em passos.

O jogador é **avisado**: ao anexar numa sessão retomada, chega uma mensagem de sistema dizendo
que houve retomada e quanto tempo não foi simulado.

## Alternativas

**Simular o intervalo em passos limitados.** Descartada, e não por custo. O combate depende de
onde os monstros estavam, e o estado deles é o de antes da queda: simular meia hora contra
monstros congelados no tempo não reproduz a luta que teria acontecido — inventa outra. O
resultado teria a aparência de progresso legítimo sem ser, e é pior um número errado com cara
de certo do que um número faltando.

**Simular tudo num `dtMs` só.** Descartada pelo que a seção anterior descreve: é o desastre,
não a alternativa.

**Creditar progresso estimado pelo tempo decorrido.** Descartada porque reverteria o
[ADR 0001](0001-session-decoupled-from-connection.md) por dentro. A sessão render sem ninguém
olhando é uma promessa sobre **simulação**, não sobre uma fórmula de tempo × taxa; no dia em que
o crédito estimado existir, a simulação vira decoração e o balanceamento passa a ser da fórmula.

**Não avisar o jogador.** Descartada. O §38.4 diz que uma hunt AFK não pode desaparecer em
silêncio, e uma perda silenciosa é a mesma coisa em escala menor: o extrato não fecha, ninguém
explica, e a confiança no modo idle é a única coisa que sustenta o produto.

## Consequências

- **Perde-se, no pior caso, um intervalo de snapshot** — dez segundos de XP. É aceitável para
  progresso e **inaceitável para transação econômica**, que é exatamente por que o ledger é
  escrito à parte, com `(session_id, seq)` único (invariante 10). Movimento de valor não pode
  depender deste intervalo.
- O tempo em que o servidor esteve fora **não rende nada**, e o jogador vê isso escrito. É a
  resposta honesta: ninguém simulou aquele tempo.
- `Session.rebaseClock` existe em `sim` e é a única forma de mexer no relógio de fora. Fica
  estreita de propósito — o invariante 2 continua valendo, porque todo cálculo segue recebendo
  `dtMs`, e o que muda é só a origem da contagem.
- Quando a hunt existir (FUN-43), esta decisão vale igual, e a mensagem ao jogador vai precisar
  ganhar o que a sessão rendeu até o snapshot, para o extrato fechar.

## Invariantes afetados

Nenhum. Reforça o invariante 2: se algum cálculo dependesse de contagem de tick em vez de
`dtMs`, reposicionar o relógio corromperia o estado — e o fato de não corromper é a evidência
de que a regra está sendo seguida.
