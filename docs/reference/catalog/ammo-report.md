# Relatório de importação — ammo

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

15 entidade(s) geradas em 1 fatia(s):

- `ammunition.json`: 15

## Notas

- 25 `<item>` de munição lidos; 10 fora do corte, 0 por slug duplicado.
- Os 5 slugs autorais (arrow, burst-arrow, sniper-arrow, onyx-arrow, power-bolt) nunca são gerados aqui — o preço deles é regravado por `npc-prices.ts` (#574, `AMMO_CANARY_IDS`).
- Preço (`price`): o menor `buy` de `data-otservbr-global/npc/*.lua` por `id` do Canary; sem NPC vendendo, o item fica de fora (munição não tem preço grátis, ADR 0026 d.3).

## Fora do corte (10)

O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).
Reimportar recupera automaticamente o que um schema futuro passar a aceitar.

| id | nome | motivo | fonte |
|---|---|---|---|
| arrow | arrow | já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui | `data/items/items.xml` |
| burst-arrow | burst arrow | já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui | `data/items/items.xml` |
| burst-arrow | burst arrow | já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui | `data/items/items.xml` |
| diamond-arrow | diamond arrow | sem NPC vendendo (buyMinByClientId) — munição sem fallback grátis, ADR 0026 d.3 | `data/items/items.xml` |
| onyx-arrow | onyx arrow | já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui | `data/items/items.xml` |
| poison-arrow | poison arrow | sem NPC vendendo (buyMinByClientId) — munição sem fallback grátis, ADR 0026 d.3 | `data/items/items.xml` |
| power-bolt | power bolt | já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui | `data/items/items.xml` |
| simple-arrow | simple arrow | sem NPC vendendo (buyMinByClientId) — munição sem fallback grátis, ADR 0026 d.3 | `data/items/items.xml` |
| sniper-arrow | sniper arrow | já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui | `data/items/items.xml` |
| spectral-bolt | spectral bolt | sem NPC vendendo (buyMinByClientId) — munição sem fallback grátis, ADR 0026 d.3 | `data/items/items.xml` |
