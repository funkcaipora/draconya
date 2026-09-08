# 0017 — Autenticação e admissão de personagens

**Status:** aceito
**Data:** 2026-09-08
**Contexto técnico:** `server`, FUN-10/FUN-11, integração com FUN-12/FUN-13/FUN-14/FUN-15

## Contexto

A implementação inicial separava a sessão HTTP do ticket, mas verificava a exclusão e a
emissão em operações independentes. Ambas podiam observar o personagem disponível. O slot
de ativo também expirava enquanto a sessão de jogo permanecia viva. A autenticação guardava
o prazo de `state` somente no navegador e associava identidades distintas pelo e-mail.

## Decisão

- A identidade é ligada exclusivamente por `external_auth_id`. E-mail coincidente não
  transfere uma conta, mesmo quando ela nasceu em desenvolvimento. Vínculos legados exigem
  migração explícita, depois de verificar a identidade fora do login automático.
- Sessão HTTP e `state` ficam em namespaces distintos no Redis, com TTL. `state` é consumido
  uma única vez; um login substitui e revoga a credencial local anterior apresentada.
- O adaptador WorkOS usa a API HTTP oficial existente, com timeout, validação de resposta e
  recusa de redirects na troca de código. A aplicação não usa um SDK WorkOS.
- Mutações HTTP verificam a origem do navegador. Respostas de conta não podem ser cacheadas
  e os logs omitem query strings e cookies de autenticação.
- Exclusão e emissão usam a mesma trava de linha do Postgres, sempre na ordem Postgres → Redis.
  A emissão valida posse e ausência de soft delete dentro da trava, antes de reservar o slot.
- Ticket transporta apenas identidade e atributos iniciais obtidos do banco pelo servidor.
  O nó registra a sessão no diretório antes do upgrade e renova o slot junto com o lease.
  Perda da reserva faz a admissão falhar fechada. O cookie HTTP nunca autoriza um socket.

## Alternativas

Verificar o Redis antes da transação mantém a janela de corrida. Consultar o banco a cada ação
violaria a fronteira da simulação; ler atributos na emissão permite manter o banco fora do nó
de jogo. Reassociar contas por e-mail reduz trabalho de migração, mas não prova identidade.

## Consequências

A emissão mantém uma transação curta aberta durante a reserva no Redis; timeouts limitam
esse custo. Redis indisponível impede login, ticket e exclusão com segurança. A política de
revogação externa continua a do ADR 0012: sessões locais duram até o TTL ou logout local.
Retomada após queda, fencing entre nós e persistência de progresso continuam nas issues
próprias; esta alteração não implementa a máquina de estados da FUN-16.

## Invariantes afetados

Nenhum é alterado. As verificações reforçam os invariantes 4, 8 e 9 na borda de admissão.
