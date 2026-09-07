# Infraestrutura e custos

Fornecedores, recursos e ordem de grandeza de custo em três estágios. As escolhas de biblioteca
estão no [ADR 0011](adr/0011-stack-de-bibliotecas.md); aqui é só onde as coisas rodam.

> **Preços são ordem de grandeza, para decidir.** Confirme no site antes de contratar — tier
> gratuito e tabela mudam com frequência, e mais de um fornecedor desta lista já mudou.

---

## O critério "agent friendly"

Vale explicitar, porque ele desempata mais de uma escolha aqui. Um fornecedor é agent friendly quando:

- tem **CLI de verdade**, e não um passo obrigatório de painel web;
- roda **localmente** de forma fiel, para o teste não depender de nuvem;
- é **determinístico e verificável do terminal** — dá para conferir o resultado sem abrir o navegador;
- tem documentação que serve de referência sem tutorial em vídeo.

Todos os escolhidos abaixo passam nos quatro. Onde um fornecedor mais popular foi descartado,
o motivo está dito.

---

## Estágio 1 — Validação

Dezenas de testadores. Objetivo: provar o loop com gente de verdade, gastando quase nada.

| Peça | Fornecedor | Recurso | Custo/mês |
|---|---|---|---|
| Cliente web | **Cloudflare Pages** | build estático do Vite | R$ 0 |
| Pacote de assets | **Cloudflare R2** | ~200 MB de folhas de sprite | R$ 0 |
| Postgres | **Supabase** | free tier | R$ 0 |
| Autenticação | **Supabase Auth** | free tier | R$ 0 |
| Redis | container no mesmo host | — | R$ 0 |
| `game` + `api` + `jobs` | **Fly.io** | 1 máquina, 1 vCPU / 1 GB | ~R$ 25 |
| CI | **GitHub Actions** | 2.000 min/mês em repo privado | R$ 0 |
| Erros | **Sentry** | free tier | R$ 0 |
| Métricas e log | **Grafana Cloud** | free tier | R$ 0 |
| | | **Total** | **~R$ 25** |

**Por que Cloudflare Pages e não Vercel.** O Hobby do Vercel é para uso não comercial; um jogo que
vende Coins não cabe nele, e a saída é o Pro a US$20/mês. O Pages não tem essa restrição e o tier
gratuito é mais folgado. Se o Vercel já estiver no fluxo por outro motivo, ele funciona igual —
só orce o Pro desde o começo.

**Por que R2 para os assets.** O pacote passa de 100 MB e é baixado por todo jogador novo. O que
custa em servir arquivo é **egresso**, e o R2 não cobra egresso. É a diferença entre custo zero e
uma conta que cresce junto com o sucesso.

**Por que Redis no próprio host, e não gerenciado.** O lease de sessão é renovado a cada poucos
segundos por sessão. Um salto de rede por renovação, num Redis serverless cobrado por comando, é
caro e mais lento sem ganho nenhum nesta escala. Gerenciado entra quando houver mais de um nó.

**Por que Fly.io.** É CLI-first, nasceu com WebSocket de vida longa, cobra por segundo e sobe um
container sem cerimônia. O Render foi descartado porque o serviço gratuito hiberna sem tráfego —
e hibernar é exatamente o que o `game` não pode fazer.

---

## Por que o `game` não cabe em serverless

Vale registrar, porque a pergunta volta.

O `game` segura sessões em memória, tica continuamente e **precisa seguir rodando quando ninguém
está conectado**. Função serverless não tem razão de existir sem requisição, e o Vercel não
hospeda servidor WebSocket de vida longa. Não é limitação a contornar: é o contrário da premissa.

O contorno que aparece sozinho — cron periódico creditando progresso estimado — **reverte o
[ADR 0001](adr/0001-sessao-desacoplada-da-conexao.md) em silêncio**. A hunt deixa de ser a mesma
simulação e vira estimativa, que é justamente a alternativa que o ADR descartou. Se um dia isso
for aceitável, tem que ser decisão explícita com ADR próprio, e não consequência acidental de
escolha de hospedagem.

**A exceção honesta:** Cloudflare Durable Objects. É a única primitiva serverless que de fato
encaixa — objeto com estado em memória, WebSocket hibernável e alarme para o tick. Encaixa bem
demais para não ser mencionada. Descartada por ora porque obriga o runtime de Workers, elimina o
uWebSockets e contraria os ADRs 0005 e 0011. É a porta a reabrir se o custo de máquina virar
problema.

---

## Estágio 2 — Lançamento pequeno

Centenas a poucos milhares de jogadores conectados.

| Peça | Fornecedor | Recurso | Custo/mês |
|---|---|---|---|
| Cliente e assets | Cloudflare Pages + R2 | | R$ 0 |
| `game` + `api` + `jobs` | **Hetzner** CX32 ou Fly | 4 vCPU / 8 GB | R$ 40 (Hetzner) · R$ 200 (Fly) |
| Postgres | Supabase Pro | 8 GB, backup diário | ~R$ 140 |
| Redis | mesmo host | | R$ 0 |
| Observabilidade | Grafana Cloud free | | R$ 0 |
| | | **Total** | **~R$ 180 a 350** |

É aqui que a diferença entre Hetzner e nuvem gerenciada começa a aparecer: mesma capacidade,
quatro a cinco vezes o preço.

---

## Estágio 3 — Cenário de referência

12 mil conexões, 60 mil personagens em sessão, 10 a 25 cores de simulação.

**A conta que domina tudo é banda, não CPU** — exatamente como a projeção de arquitetura previu.

```
12.000 jogadores anexados × ~1 KB/s  ≈  12 MB/s
12 MB/s × 2,6 milhões de segundos/mês ≈  31 TB/mês de egresso
```

E é aí que a escolha de fornecedor vira decisão de ordem de grandeza:

| Modelo de cobrança | 31 TB/mês |
|---|---|
| Hetzner — tráfego incluído (~20 TB por servidor) | **~R$ 0 extra** |
| Fly, AWS, GCP — por GB | **R$ 3.000 a 9.000** |

| Peça | Escolha | Custo/mês |
|---|---|---|
| Simulação | 3× Hetzner CCX33 (8 vCPU dedicado) | ~R$ 1.100 |
| Postgres | Supabase Team ou Postgres gerenciado | ~R$ 700 |
| Redis | gerenciado ou nó dedicado | ~R$ 150 |
| Assets | Cloudflare R2 | ~R$ 0 |
| Egresso de jogo | incluído no Hetzner | ~R$ 0 |
| Observabilidade | Grafana Cloud pago | ~R$ 300 |
| | **Total** | **~R$ 2.300** |

O mesmo desenho em nuvem por GB passa de R$ 10 mil. **A decisão de onde hospedar o `game` é, na
prática, uma decisão de custo de banda** — e ela só aparece quando o jogo dá certo, que é o pior
momento para descobri-la.

Duas mitigações que já estão no desenho e ajudam aqui: sessão desanexada **não consome banda
nenhuma** ([ADR 0003](adr/0003-tick-variavel-por-sessao.md)), e o protocolo é por evento com
lote comprimido, não snapshot por tick.

---

## O que ainda não foi escolhido

| Peça | Quando | Candidatos |
|---|---|---|
| PSP para PIX | F6 | Asaas, Pagar.me, Mercado Pago |
| Cripto | F6 | a definir |
| Push e notificação | F7 | Telegram Bot API (grátis), Discord webhook, web push |

Notificação importa mais neste jogo que na média, porque a hunt roda sem plateia: fim de sessão,
stamina zerada e morte precisam alcançar quem não está olhando. Telegram e Discord são gratuitos
e resolvem, sem custo de e-mail transacional.

---

## Consequência para o schema

Se ficar Supabase Auth em vez de WorkOS, o [ADR 0012](adr/0012-autenticacao-delegada-ao-workos.md)
precisa ser revisto — a decisão não muda de forma, só de fornecedor: `account.external_auth_id`
continua sendo o vínculo, e `senha_hash` continua nulável e reservado. É uma troca de integração,
não de modelo de dados. Foi exatamente para isso que a coluna existe.

**Armadilha do Supabase que morde cedo:** o pooler em modo transaction (Supavisor) não suporta
prepared statements, e o Drizzle com `postgres.js` usa por padrão. Sem `prepare: false` na
conexão, os erros aparecem intermitentes e difíceis de ler.
