# 0013 — Imagens multi-arquitetura (amd64 e arm64)

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** build, CI, deploy, e a medição de custo da FUN-46

## Contexto

Três ambientes previsíveis do projeto puxam para arquiteturas diferentes:

- **Desenvolvimento** — Apple Silicon, `arm64`.
- **Validação sem custo** — Oracle Cloud Always Free, que é **exclusivamente ARM** (Ampere A1).
  As microinstâncias AMD que acompanham o tier são pequenas demais para o `game`.
- **VPS paga em São Paulo** — Hostinger, Vultr e Contabo são `x86_64`. VPS ARM no Brasil é rara.

Como a escolha de hospedagem é decidida por latência até São Paulo, e não por arquitetura, fixar
uma única arquitetura fecharia porta em algum dos três — ou obrigaria emulação em desenvolvimento.

A stack aguenta as duas sem trabalho extra: a única dependência nativa é o `uWebSockets.js`, que
publica binário pré-compilado para `linux/arm64`, e o `sim` — onde a lógica de jogo vive — é
TypeScript sem dependência, portanto indiferente à arquitetura por construção.

## Decisão

Publicar **imagens multi-arquitetura** (`linux/amd64` e `linux/arm64`) desde o primeiro Dockerfile,
via `docker buildx`. Desenvolvimento roda nativo em `arm64`; o destino de deploy fica livre.

## Alternativas

- **Só `amd64`** — descartada porque obrigaria emulação no desenvolvimento e fecharia a porta do
  Oracle Always Free, que é a rota de validação sem custo.
- **Só `arm64`** — descartada porque fecharia as VPS pagas em São Paulo, que são o destino provável
  quando houver jogadores de verdade.
- **Decidir depois** — descartada porque é justamente o tipo de decisão barata agora e cara depois:
  retrofitar multi-arch exige mexer no Dockerfile, no CI e na base de comparação da medição.

## Consequências

- O build de CI leva mais tempo. Em runner nativo `arm64` o custo é pequeno; com emulação QEMU,
  o build `arm64` fica sensivelmente mais lento. Vale usar runner nativo quando disponível.
- **A medição de custo da FUN-46 passa a ser dependente de arquitetura.** O tick da simulação é
  single-thread, então o que importa é desempenho por core — e um OCPU Ampere, um core de EPYC e
  um core M-series rendem valores diferentes. Medir no laptop e extrapolar para o servidor erra, e
  em direções distintas conforme o caso. **A medição precisa rodar na arquitetura de destino**, e
  o relatório precisa dizer em qual rodou.
- Toda dependência nativa nova passa a ter um requisito: precisa de binário para as duas
  arquiteturas, ou de compilação viável nas duas. Vale conferir isso **antes** de adicionar, não
  depois de o build de CI quebrar.

## Invariantes afetados

Nenhum diretamente. Reforça o invariante 1: `sim/` ser puro é o que torna a arquitetura irrelevante
onde ela mais poderia doer.

## Emenda — 2026-09-08: a checagem de `arm64` no CI está suspensa

**A decisão acima continua valendo.** O que foi suspenso é a forma de impor uma parte dela: o job
de imagem do CI passou a construir só `linux/amd64`.

O motivo é o custo que a seção de Consequências já previa e que virou concreto: o runner do GitHub
é `amd64`, então o build `arm64` roda sob QEMU, e a emulação respondia por quase todos os ~5
minutos do job — contra ~45 segundos de todo o resto do CI. Num repositório onde cada PR espera o
CI, isso é o passo que ensina a não esperar.

O que a suspensão custa de verdade é menor do que o número sugere. O desenvolvimento roda em Apple
Silicon, então **`arm64` continua sendo construído nativamente a cada build local** — o CI passa a
cobrir justamente a arquitetura que a máquina de quem desenvolve não cobre, e as duas juntas ainda
cobrem as duas. O que se perde é a checagem automática, no PR, de que uma dependência nativa nova
publica binário para `arm64`; ela passa a depender de alguém conferir, que é exatamente o tipo de
regra que este repositório prefere não ter.

Por isso a suspensão é temporária e tem gatilho escrito. **Religar antes de:**

- o primeiro deploy em `arm64` — o Oracle Ampere é a rota de validação sem custo, e é ARM
  exclusivo, então lá a imagem `arm64` deixa de ser hipótese;
- adicionar qualquer dependência nativa nova. Hoje a única é o `uWebSockets.js`.

Religar são duas linhas em `.github/workflows/ci.yml`: devolver o passo `docker/setup-qemu-action`
e a segunda plataforma em `platforms`. O comentário no job diz isso no lugar onde alguém vai olhar.

A regra do `AGENTS.md` — dependência nativa nova precisa de binário para as duas arquiteturas —
**continua valendo**. Ela só deixou de ser verificada pelo CI, e passou a ser conferida à mão.

## Emenda — 2026-09-15: dependência de GitHub é referenciada por tarball, não por `github:`

O `uWebSockets.js` não está no npm; `packages/server/package.json` o declarava como
`github:uNetworking/uWebSockets.js#v20.69.0`. O `pnpm` resolvia isso para o tarball
`https://codeload.github.com/...` no lockfile de `main`, e funcionava — até o Dependabot regenerar
o lockfile: ele reescreve a mesma entrada como `git+ssh://git@github.com/...`, e o runner do CI
não tem chave SSH. Toda PR do Dependabot (#181–#184) morria no `pnpm install --frozen-lockfile`
com `Host key verification failed`, antes de qualquer teste — inclusive bump de segurança (#222).

**Decisão:** dependência hospedada no GitHub é declarada pela **URL do tarball com o SHA do
commit** — `https://codeload.github.com/<org>/<repo>/tar.gz/<sha>` —, nunca por `github:` nem por
`git+ssh`. É a forma que o lockfile já usava, que qualquer runner sem credencial resolve e que o
Dependabot não reescreve. Atualizar a versão é trocar o SHA (a tag `v20.69.0` aponta para
`dddd8ffd…`); o Dependabot não acompanha essa dependência, e isso é aceito — ela anda junto com o
Node maior, como a emenda anterior já diz.

Descartada: `git config url."https://github.com/".insteadOf "git@github.com:"` no `ci.yml` e no
`Dockerfile` — funciona, mas exige que cada consumidor novo (Coolify, o laptop de quem clonar)
lembre da mesma linha; a URL de tarball não depende de ninguém lembrar de nada.
