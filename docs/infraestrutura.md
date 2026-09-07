# Infraestrutura e custos

Fornecedores, recursos e ordem de grandeza de custo em três estágios. As escolhas de biblioteca
estão no [ADR 0011](adr/0011-stack-de-bibliotecas.md); aqui é só onde as coisas rodam.

> **Preços e limites são ordem de grandeza, para decidir.** Confirme na documentação do
> fornecedor antes de contratar — tier gratuito e tabela mudam com frequência, e mais de um
> fornecedor desta lista já mudou. O limite do Oracle Always Free nesta página já foi corrigido
> uma vez contra a documentação oficial; trate os demais com o mesmo ceticismo, inclusive a
> franquia de egresso do próprio Oracle.

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

## Correção — latência escolhe o fornecedor, não preço por core

A primeira versão deste documento recomendou Hetzner no estágio 3 com base em custo e tráfego
incluído. **Isso subponderou latência, e a correção muda a recomendação.**

A Hetzner não tem data center na América do Sul: o mais próximo é a Virgínia (~120 ms do Brasil)
e a Alemanha fica em ~200 ms. Para a hunt idle isso não incomoda — ninguém está olhando. **Para a
Guild War, incomoda muito**, e a Guild War é o diferencial do produto. A predição no cliente cobre
só o próprio passo; empurrar alguém e ver o resultado é ida e volta completa. PvP tático em grade,
com público brasileiro, rodando na Virgínia é uma decisão que se sente no empurrão.

**O critério que escolhe o fornecedor é presença em São Paulo.** Preço por core desempata depois.

| Fornecedor | Região BR | Observação |
|---|---|---|
| **Hostinger VPS** | São Paulo | Preço promocional agressivo no primeiro período, renovação bem mais alta. Cobrança em BRL |
| **Vultr** | São Paulo | Preço estável, sem jogo de renovação |
| **Contabo** | São Paulo | Barato por core; reputação de I/O irregular |
| **Oracle Cloud Free Tier** | São Paulo | 2 OCPUs ARM + 12 GB, **sempre grátis**. Cobre validação; aperta no lançamento pequeno |
| **Hetzner** | não tem | Melhor preço por core e 20 TB inclusos, mas ~120 ms de latência |

**Sobre o Oracle Free Tier.** O Always Free dá **1.500 horas de OCPU e 9.000 GB-hora por mês**
no VM.Standard.A1.Flex, o que equivale a **2 OCPUs e 12 GB rodando 24/7** — não os 4 OCPUs e 24 GB
que circulam em material mais antigo. As microinstâncias AMD (E2.1.Micro) que vêm junto são
pequenas demais para o `game`.

Dois OCPUs e 12 GB **cobrem bem a validação** e ficam **apertados no lançamento pequeno**, onde a
estimativa do estágio 2 é de 4 vCPU. Ressalvas reais: capacidade de ARM em região popular costuma
faltar, conta ociosa pode ser recuperada, e ARM exige build `arm64`. Não apostaria a operação nele, mas
para validar sem gastar é difícil bater.

**O que continua valendo do estágio 3:** em escala, a conta é dominada por banda, e fornecedor com
tráfego incluído continua sendo a rota barata. A correção não é sobre isso — é sobre em que
continente o servidor fica.

---

## O caminho decidido: local primeiro, VPS depois

**Nada é hospedado até a Fase 2 terminar.** O critério de saída da Fase 1 — fechar o navegador,
voltar depois e encontrar a sessão rodando — é testável inteiro em `localhost`, incluindo o
`kill -9` no nó e a drenagem em deploy. O `docker-compose.yml` já cobre. Hospedar antes disso
só adiciona a classe de problema "funciona aqui e não lá" na fase cujo propósito é provar uma
propriedade de arquitetura.

**Destino: VPS em São Paulo.** É também a opção mais agent friendly da lista — SSH e
`docker compose` são inteiramente script, inteiramente verificáveis do terminal, sem nenhum
passo de painel.

### O que "preparar para migrar" exige

Se estas quatro coisas valerem desde o começo, trocar de máquina ou de fornecedor é uma tarde:

1. Tudo em container, com `docker compose` como única forma de subir.
2. Configuração **só** por variável de ambiente — já é o caso, e `carregarConfiguracao` derruba
   o boot se faltar alguma.
3. Nenhum estado em disco local além do volume do Postgres e da pasta de assets.
4. Deploy que seja `git pull && docker compose up -d`, sem passo manual.

### A única coisa que não pode ficar para depois

**Backup do Postgres.** Assumir a VPS é assumir backup, e `account` e `ledger` são a joia da coroa
— ainda mais com a venda de personagem entre contas prevista no §35 do PRD. "Configuro backup
depois" é literalmente como se perde dado. `pg_dump` diário para o R2, com restauração testada
pelo menos uma vez, é meia hora de trabalho.

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
