// Prazos de Redis usados por fixture de teste (FUN-95).
//
// **Nenhum teste espera prazo vencer.** A FUN-62 trocou espera real por asserção: o que se
// afirma é o prazo GRAVADO, e a expiração é provada apagando a chave na mão — que é exatamente
// o que a expiração faz. Testar que o Redis expira é testar o Redis.
//
// O que sobrou do número, então, não é "expira rápido". É o contrário: **ele só precisa
// sobreviver ao próprio teste**. Um lease de 120 ms não protege nada e quebra tudo — sob carga,
// a janela entre gravar e afirmar fecha antes, e o teste reprova com `expected null not to be
// null`. Medido: com dez processos ocupando a CPU, `directory.test.ts` reprovava numa execução
// de cada duas, e a suíte inteira sorteava dois a quatro testes diferentes por execução.
//
// Foi a FUN-62 que criou a armadilha sem querer: ela removeu a espera e deixou os prazos
// minúsculos, que sem a espera tinham deixado de significar alguma coisa.
//
// Os DOIS existem porque vários testes afirmam a RELAÇÃO entre dois prazos — o lease é curto,
// o snapshot é longo, e é isso que define sessão órfã. A relação é o que importa; os dois
// números só precisam ser grandes.

/** O prazo "curto" de qualquer fixture. Curto em relação ao longo, nunca em relação ao teste. */
export const SHORT_MS = 5_000;

/** O prazo "longo". Precisa ser folgadamente maior que `SHORT_MS` para a relação ser visível. */
export const LONG_MS = 60_000;

/**
 * Piso para prazo de Redis em fixture. Abaixo disto o prazo não sobrevive à suíte sob carga.
 *
 * `testing/redis.test.ts` reprova quem ficar abaixo — porque comentário não impede regressão,
 * teste impede. É a mesma razão de existir do teste de colisão de banco, no mesmo arquivo.
 */
export const MINIMUM_MS = 1_000;
