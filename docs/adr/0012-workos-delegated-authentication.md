# 0012 — Autenticação delegada ao WorkOS

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `server` (processo `api`), tabela `account`

## Contexto

Autenticação própria é trabalho conhecido e chato: hash de senha, verificação de e-mail,
recuperação, rate limit, e — o que mais dói na prática — entregabilidade de e-mail. Nada disso
diferencia o Draconya, e tudo isso é superfície de segurança que passa a ser mantida para sempre.

O encaixe aqui é melhor que o normal por uma razão específica desta arquitetura: **a
autenticação acontece uma vez, na borda.** Depois dela, o fluxo de ticket (FUN-12) assume, e o
socket de jogo nunca toca no provedor. Uma indisponibilidade do WorkOS impede login novo e **não
derruba nenhuma hunt em andamento** — consequência direta de a sessão ser desacoplada da conexão
(ADR 0001). Numa arquitetura em que a autenticação estivesse no caminho quente, a decisão seria outra.

O tier gratuito do AuthKit vai muito além de qualquer projeção deste projeto.

## Decisão

Delegar credencial e fluxos de conta ao **WorkOS AuthKit**. A tabela `account` local continua
existindo e é a dona de tudo que é do jogo: Coins, personagens, ledger, limite de dois ativos.
O vínculo é `account.external_auth_id`.

**A tabela `account` nasce também com `password_hash`, nulável e sem uso.** É uma coluna sem custo
hoje que torna aditiva, e não destrutiva, a eventual decisão de trazer a autenticação para casa —
migrar identidade com usuários reais dentro é caro, e o momento de decidir isso é agora, com a
tabela vazia.

Em desenvolvimento, `AUTH_DEV_MODE=true` aceita qualquer e-mail sem verificação, para não exigir
credencial de provedor em máquina local. A configuração recusa o boot se isso estiver ligado em
produção.

## Alternativas

- **Autenticação própria** (a FUN-10 original) — descartada por custo e por superfície de
  segurança permanente, não por dificuldade técnica.
- **Clerk, Auth0, Supabase Auth** — equivalentes em função. WorkOS foi escolhido pelo tier
  gratuito generoso e por já prever necessidades de conta corporativa que podem aparecer depois.
- **OAuth social apenas** — descartado: exclui quem não quer vincular conta de rede social a um jogo.

## Consequências

- A FUN-10 encolhe: deixa de ser registro, verificação, reset e rate limit, e vira integração
  mais o mapeamento para `account`.
- **O AuthKit é uma página hospedada, com redirect.** Para um jogo que quer entrada imersiva isso
  é uma costura visível. A API de User Management permite modo headless; se ela não cobrir o que
  o produto quer, esta decisão precisa ser reaberta — e é o principal risco em aberto aqui.
- Portabilidade de identidade fica limitada: provedores não exportam hash de senha. `password_hash`
  reduz o custo de sair, mas não zera — quem migrar vai pedir redefinição de senha aos jogadores.
- Detecção de multiconta e RMT continua sendo nossa (invariante 11). O provedor dá sinal de
  dispositivo e sessão, não resolve o problema.
- O jogo funciona com o provedor fora do ar, exceto para login novo. Vale monitorar como
  degradação parcial, não como indisponibilidade total.

## Invariantes afetados

Nenhum. A autenticação fica fora do modelo de sessão e do caminho de simulação.

## Verificação de implementação — 2026-09-07

O risco sobre modo headless foi verificado antes da implementação: a documentação atual do WorkOS confirma que a Authentication API permite construir UI própria, além do Hosted AuthKit. O MVP mantém o Hosted AuthKit porque é o caminho de menor superfície, mas a decisão não fica presa a essa UI.

A sessão do aplicativo é deliberadamente local: depois da troca do authorization code, o `api` grava uma capability opaca no Redis e envia somente o token em cookie httpOnly. Isso preserva a consequência desejada desta ADR — indisponibilidade transitória do WorkOS não invalida requests de uma sessão Draconya já criada. Logout remove a sessão local e, quando existe `sid` no token retornado na autenticação, também fornece a URL de logout do WorkOS.

## Confirmação — 2026-09-10 (FUN-64)

A emenda acima verificou que o modo headless *existe*. A FUN-64 perguntou a pergunta seguinte,
que é de produto e não de API: **vale gastar a costura agora?** A resposta é não, e este registro
existe para que ela não seja reaberta por esquecimento.

O que foi confirmado, com endpoint e não com impressão:

| Caminho | Como se faz | O que custa |
|---|---|---|
| **Hosted AuthKit** (hoje) | `GET /user_management/authorize` → redirect → troca do code | Uma costura visível, no primeiro login |
| **Headless com senha** | `authenticateWithPassword` | Tela própria, recuperação de senha, e a senha em texto claro **transitando pelo nosso `api`** |
| **Headless com Magic Auth** | `createMagicAuth` + `authenticateWithMagicAuth`, código de seis dígitos por e-mail | Tela própria, e o jogador abre o e-mail toda vez que o cookie expira |

**A decisão fica como está: Hosted AuthKit no MVP.** Três razões, em ordem de peso:

1. **Não existe jogador para impressionar ainda.** A costura é real e aparece no pior momento —
   mas o pior momento ainda não chegou, e adiar não o torna mais caro.
2. **Trocar depois é aditivo.** `IdentityProvider` (`packages/server/src/auth/workos.ts`) já é uma
   interface, e o `api` já grava sessão local própria. Virar headless é acrescentar um método e
   uma tela; não é reescrever o fluxo nem migrar identidade.
3. **O headless com senha reintroduz o que esta decisão delegou.** A senha não seria armazenada,
   mas passaria pela memória do nosso processo — a uma linha de log de distância do disco. Se um
   dia formos para headless, o caminho preferido é o **Magic Auth**, porque nele a senha não
   existe: não há o que vazar de um processo que nunca a recebe.

**O que reabre isto:** a costura medir alguma coisa. Abandono na tela de login, ou reclamação de
"parece outro site". Enquanto o sinal for estético e não medido, a resposta continua sendo esta.

O ADR 0012 segue **aceito**, sem alteração na decisão. O risco em aberto que ele mesmo declarou
("a API de User Management permite modo headless; se ela não cobrir o que o produto quer, esta
decisão precisa ser reaberta") está **fechado**: ela cobre, de duas maneiras, e nenhuma delas é
urgente.
