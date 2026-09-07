# Bosses

**Status:** não implementado
**PRD:** §27, §43.7
**Épico:** E11

## Comportamento

O jogador acessa Boss por um menu dedicado, monta ou é convidado para uma party, e entra em uma instância própria, com capacidade máxima de 10 jogadores. No MVP, cada boss permite uma tentativa/recompensa por dia, conforme a regra de conteúdo — a arquitetura precisa suportar limites diferentes ou custo crescente no futuro, mas isso não é necessário no vertical slice.

Quando o boss começa, a sala fecha: ninguém novo pode entrar. A única exceção é o modo Iniciante, no qual um jogador que morreu pode retornar à instância. O MVP entrega inicialmente esse modo Iniciante: todo participante elegível que causou dano ao boss recebe sua própria recompensa individual ao final, independentemente de ter morrido e retornado durante a luta. A capacidade do sistema também deve prever dois modos futuros mais punitivos — Profissional, em que quem morre não volta à luta, e Herói, em que uma única morte pode encerrar a tentativa de todo o grupo —, mas os detalhes finais de elegibilidade de loot nesses dois modos ainda não foram fechados.

Ao derrotar o boss, cada jogador recebe uma tela de recompensa individual, na qual itens lendários podem ser sorteados. O loot lendário é definido por sorte pura; o MVP não tem pity system.

## Regras

- Tamanho máximo do grupo: 10 jogadores.
- Frequência no MVP: 1 tentativa/recompensa por dia (regra de conteúdo).
- Sala fecha ao iniciar; ninguém novo entra depois.
- Exceção de retorno: só no modo Iniciante, para quem morreu.
- Modo Iniciante (MVP): todo participante elegível que causou dano recebe recompensa individual ao final.
- Modo Profissional (futuro): quem morre não retorna à luta.
- Modo Herói (futuro): pode encerrar a tentativa do grupo inteiro com uma única morte.
- Recompensa é individual, por tela própria ao final; lendários podem ser sorteados nela.
- Sem pity system no MVP.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanho máximo do grupo | 10 | caminho previsto: `packages/content/bosses` |
| Tentativas/recompensas por dia (MVP) | 1 | caminho previsto: `packages/content/bosses` |
| Pity system | inexistente no MVP | caminho previsto: `packages/content/bosses` |

## Em aberto

- Regras finais de elegibilidade de recompensa nos modos Profissional e Herói (§27.5, §43.7).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
