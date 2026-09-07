---
name: delivery
description: Use ao terminar uma issue e antes de fechá-la — roda test e build, invoca conformidade sobre o diff, atualiza o CLAUDE.md do pacote se fronteira ou invariante mudou, invoca adr se houve decisão de arquitetura, invoca produto se um sistema do PRD saiu do papel, monta o commit no padrão <tipo>(<escopo>): <descrição> (FUN-nn) e atualiza a issue no Linear. Acione com "entrega essa issue", "fecha a FUN-nn", "terminei, roda o ritual de fechamento", "prepara o commit e atualiza o Linear".
---

# Ritual de fechamento de issue

A cola do harness. Esta skill não faz nada que as outras quatro não façam sozinhas — garante que
nenhuma seja esquecida antes de dar a issue por fechada, que é o problema real: sob pressão de
prazo, "roda os testes e commita" sobrevive, "atualiza a documentação de produto" não.

## Regra geral, vale para todos os passos

Se qualquer passo abaixo falhar — teste vermelho, build quebrado, violação de invariante, lint de
fronteira reprovando, hook de commit rejeitando a mensagem — **pare e pergunte ao usuário como
prosseguir.** Não pule para o próximo passo, não decida sozinho que a falha "não é grave", e nunca
reporte a issue como entregue com um passo vermelho. Corrigir o problema e repetir o passo é
aceitável; seguir adiante sem corrigir não é.

Execute os passos em ordem — cada um pressupõe que o anterior passou.

## Passo 1 — testes e build

```bash
pnpm test
pnpm build
```

Os dois precisam passar limpos. Falha aqui é sinal de que a issue não está pronta para fechar,
mesmo que o código pareça certo.

## Passo 2 — conformidade

Rode a skill `conformidade` sobre o diff atual (branch atual contra `main`, mais o que ainda não
estiver commitado). Se ela reportar violações, pare e mostre a lista ao usuário — não corrija por
conta própria em silêncio, nem decida sozinho que a violação é aceitável. Só prossiga depois que o
diff sair limpo, ou o usuário decidir explicitamente seguir mesmo assim.

## Passo 3 — `CLAUDE.md` de pacote

Se este trabalho mudou uma fronteira de import ou um invariante local de algum pacote — coisa que
o Passo 2 deveria ter deixado evidente — atualize a seção correspondente (`Fronteiras` ou
`Invariantes locais`) do `packages/<pkg>/CLAUDE.md` afetado antes de continuar. Se nada mudou,
siga para o próximo passo sem alterar nada.

## Passo 4 — ADR

Se alguma decisão de arquitetura foi tomada durante este trabalho — não "implementei o que estava
especificado", mas "decidi fazer X em vez de Y" — invoque a skill `adr` agora, com o trabalho ainda
fresco. Se não houve decisão nova, siga em frente.

## Passo 5 — documentação de produto

Se um sistema do PRD saiu do papel nesta issue (passou de especificado para implementado, ou teve
comportamento relevante alterado), invoque a skill `produto` para o sistema correspondente. Se a
issue foi só correção de bug ou refactor sem mudança de comportamento visível ao produto, siga em
frente.

## Passo 6 — montar e criar o commit

Padrão obrigatório:

```
<type>(<scope>): <imperative description in English> (FUN-nn)
```

```
type:   feat | fix | refactor | perf | docs | test | chore
scope: sim | protocol | content | server | client | tools | docs
```

Exemplo: `feat(sim): advance simulation using elapsed time (FUN-25)`

- **`FUN-nn`:** extraia da branch atual (`git branch --show-current`) — o Linear gera algo como
  `funkcaipora/fun-25-description`, o número está aí. Se não conseguir extrair, pergunte ao usuário
  o identificador da issue antes de montar a mensagem.
- **Escopo:** se o trabalho tocou mais de um pacote, escolha o que concentra a mudança relevante —
  não invente um escopo composto fora da lista acima.
- Inclua no commit também os arquivos gerados pelos Passos 3–5 (`CLAUDE.md` de pacote, ADR novo,
  `docs/product/*`) — eles fazem parte da entrega, não de um commit separado.
- Prefira `git add` de arquivos específicos a `git add -A`.
- Não use `--no-verify`. Há um hook de `PreToolUse` em `git commit` que valida esse formato — se
  ele rejeitar a mensagem, é porque ela está fora do padrão; corrija a mensagem, não o hook.

## Passo 7 — atualizar a issue no Linear

Com o commit criado, localize a issue pelo identificador `FUN-nn` usando as ferramentas de Linear
disponíveis nesta sessão e registre:

- O que foi entregue (resumo de 2–3 linhas, não a lista de commits).
- O que ficou de fora do escopo original da issue, e por quê (se nada ficou de fora, diga isso).
- Referência ao commit (hash curto) e, se existir, ao PR.

Se o fluxo do time usa um estado de issue tipo "Pronto para review" ou "Concluído", mova a issue
para esse estado como parte desta atualização; se não houver esse padrão estabelecido, o
comentário resumindo o trabalho é suficiente.

## Saída

Reporte, em ordem: resultado de test/build, resultado da conformidade, quais `CLAUDE.md` foram
tocados, se `adr` e/ou `produto` foram invocados e com qual resultado, a mensagem de commit final e
seu hash, e a atualização feita na issue do Linear. Se algum passo parou por falha, reporte isso em
vez de qualquer coisa depois dele — um ritual interrompido não deve parecer um ritual completo.
