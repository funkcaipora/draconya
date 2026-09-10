# 0021 — Deploy integrado no Coolify com origem única

**Status:** aceito
**Data:** 2026-09-09
**Contexto técnico:** Dockerfile, Compose e publicação do cliente web

## Contexto

O primeiro ambiente remoto do Draconya será o projeto Draconya no Coolify. O Compose de VPS
existente publica as portas do servidor diretamente, não serve o cliente e não aplica as
migrações do banco. O servidor exige WorkOS e URLs HTTPS em produção.

## Decisão

Adicionar `compose.coolify.yml`, preservando o Compose de VPS. O serviço `web` serve o build
estático do cliente em Nginx e encaminha `/api/` e `/ws` ao serviço `app`. O proxy do Coolify
termina TLS e publica somente `web:80`. Cliente, callback de autenticação e socket compartilham
a mesma origem; o build usa `VITE_API_URL` vazio.

O serviço `app` roda os três papéis em modo solo e aplica as migrações versionadas antes do
boot. Uma trava consultiva PostgreSQL serializa migrações concorrentes. Falha de migração
impede o boot; sucesso preserva `node` como PID 1 e os 40 segundos para drenagem.

PostgreSQL e Redis usam volumes nomeados, sem portas publicadas no host. Credenciais e URLs
são variáveis do Coolify, nunca conteúdo da imagem. Logs de acesso de `/api/` e `/ws` ficam
desligados no Nginx para não registrar código de autenticação ou ticket na query string.

## Alternativas

- Cliente em Cloudflare Pages: continua possível, mas exigiria um segundo provedor para este
  primeiro deploy e configuração de autenticação entre origens.
- Publicar 3000 e 7171 diretamente: exigiria expor duas entradas adicionais e prover TLS para
  ambas, sem resolver a hospedagem do cliente.
- Aplicar o schema manualmente: deixaria o primeiro boot e as próximas atualizações dependentes
  de uma etapa operacional fácil de esquecer.

## Consequências

O deploy ganha uma imagem estática adicional e um salto interno de proxy. A publicação usa a
mesma origem, e a configuração do Coolify fica restrita à origem HTTPS e às credenciais.

A API de autenticação existe, mas o cliente atual ainda recebe `character` pela query string;
este deploy não implementa as telas futuras de login e seleção de personagem.

Migrações futuras precisam ser compatíveis com o processo anterior durante a atualização.
O journal protege repetição; não substitui revisão de SQL nem backup e teste de restauração.

## Invariantes afetados

Nenhum dos onze invariantes muda. A sessão continua autoritativa no servidor, independente
do navegador, e a drenagem preserva o crédito do progresso.
