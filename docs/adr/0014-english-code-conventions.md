# 0014 — Código e caminhos em inglês

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** todos os pacotes, scripts, hooks, contratos e caminhos (FUN-49)

## Contexto

O código inicial misturava português e inglês, inclusive em APIs públicas, mensagens e campos
persistidos. O padrão definido para o projeto passa a ser inglês em todo código e em nomes de
arquivos e pastas; documentação e comentários continuam em português.

## Decisão

- Identificadores, nomes de arquivos/pastas, tipos, métodos, configurações, logs, erros,
  descrições de testes, commits e títulos de PR ficam em inglês.
- Documentação, comentários e descrições de PR podem continuar em português. Exemplos de código
  e referências a símbolos usam inglês. Os documentos históricos mantêm sua narrativa;
  renomear seus caminhos e corrigir links não altera as decisões que registram.
- Os seis pacotes são migrados juntos. Não há aliases das APIs TypeScript antigas.
- O protocolo passa à versão `0.2.0` e mantém opcodes e formato de frame. Os campos de payload e valores de enum passam
  para inglês. Como o WebSocket ainda não integra um cliente jogável, cliente e servidor devem
  ser atualizados juntos; não há negociação ou tradução automática de payload antigo.
- O snapshot passa ao formato **2**. O núcleo recusa formato desconhecido ou antigo sem
  descartar seu conteúdo. A persistência periódica e a recuperação ainda não estão conectadas;
  fixtures/snapshots antigos precisam ser convertidos explicitamente antes da restauração.
- O diretório Redis mantém as chaves e aceita o campo legado `tipo` na leitura durante a
  expiração dos leases antigos; novas escritas usam `type`. Valores legados `cidade` e `treino`
  são normalizados para `city` e `training`. Esta é compatibilidade de dados, não uma API em português.
- As propriedades Drizzle, colunas e índices ficam em inglês. Bancos existentes são atualizados
  com `packages/server/src/db/rename-legacy-schema.sql`: renomeação transacional e preservação de
  linhas, relações e unicidade do ledger. Os nomes portugueses nesse SQL são referências ao
  schema legado que ele precisa encontrar, não nomes aceitos para código novo.

## Alternativas

- Mudar só instruções: rejeitado, pois manteria o código atual como exemplo do padrão antigo.
- Manter nomes SQL antigos atrás de propriedades em inglês: rejeitado, pois perpetuaria dois
  vocabulários para os mesmos campos.
- Recriar tabelas: rejeitado, pois renomear preserva dados e restrições existentes.

## Consequências

Imports e ferramentas locais precisam usar os caminhos novos. A variável de assets é
`THINGS_VERSION`; o backup usa `BACKUP_DIR`, `RETENTION_DAYS` e `SERVICE`. Atualize configurações
locais que usavam os nomes antigos antes de executar essas ferramentas.

A alteração do schema deve ocorrer com os processos antigos parados. Use `psql` com
`ON_ERROR_STOP=1` e o script de renomeação em banco legado; banco novo deve ser criado a partir
do schema atual. Não use `drizzle-kit push` para adivinhar renomeações de um banco legado.
A validação da entrega usa um banco temporário, sem aplicar migração no banco de desenvolvimento.

Reverter o código depois de migrar um banco exige também inverter os `RENAME` e os valores de
estado antes de subir a versão antiga. O SQL é transacional: erro antes do `COMMIT` não deixa
uma migração parcial. Nenhum script apaga linhas para adequar o idioma.

## Invariantes afetados

Nenhum é alterado. Pureza de `sim`, tempo por `dtMs`, autoridade do servidor, identidade de
opcodes e idempotência do ledger continuam obrigatórios.
