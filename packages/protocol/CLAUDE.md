# @draconya/protocol

## Propósito

Fonte única do protocolo entre cliente e servidor: o mapa de mensagens, os tipos de cada uma, as
duas tabelas de opcode derivadas dele, a validação de schema na entrada e o codec de frame binário.

## Fronteiras

**Pode importar:** nada interno. Este pacote é a base da pilha.
**Não pode importar:** `content`, `sim`, `server`, `client`, `tools`.

O motivo é direção de dependência: todo mundo depende do protocolo, então o protocolo não pode
depender de ninguém, ou o grafo vira ciclo.

## Invariantes locais

- **Opcodes vivem só aqui** (invariante 5), num arquivo, como fonte única. As duas tabelas —
  nome→opcode para envio, opcode→nome para recepção — são geradas desse mapa, nunca escritas à mão.
- O **tipo textual nunca vai no fio**, só o número. O corpo do frame é `[opcode, props]`.
- Adicionar mensagem nova é tocar **um** arquivo. Se exigir tocar dois, o desenho está errado.
- Toda mensagem recebida passa por validação de schema **antes** de virar estado.

## Como testar

```
pnpm vitest run packages/protocol
```

Cobertura que importa aqui: ida e volta do codec (frame simples, comprimido, em lote, corrompido),
e recusa de mensagem malformada com erro tipado em vez de estado corrompido.

## Armadilhas conhecidas

- O codec embaralha tudo a partir do byte 4 com xorshift keyed na chave do frame. Isso é
  ofuscação, **não criptografia** — não trate como segurança.
- Lote e compressão precisam existir desde o começo. Retrofitar batching depois que dezenas de
  sistemas já publicam mensagens é doloroso.

Issues: FUN-6 (opcodes e tipos), FUN-7 (codec).
