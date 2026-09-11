// O pacote que o deploy serve tem que ser o pacote contra o qual o conteúdo foi conferido
// (FUN-21).
//
// A tabela de aparências é validada contra `packs/<pack>.json`, a sombra de UM pacote. O
// cliente carrega o pacote de `VITE_THINGS_URL`, que é configuração de deploy — e nada
// ligava os dois. Um deploy que aponta `/things/1400` com o conteúdo conferido contra o 1332
// passaria em tudo e desenharia o quadrado invisível que a conferência existe para impedir,
// sem erro nenhum para alguém ignorar.
//
// O elo é `THINGS_VERSION`: o `compose.coolify.yml` deriva `VITE_THINGS_URL` dela, e aqui o
// `game` recusa subir quando ela não bate com `content.pack.version`. Conteúdo sem inventário
// (fixture) não tem o que comparar.

import type { Content } from '@draconya/content';

/** O problema, em palavras, ou `null` quando o pacote servido é o conferido. */
export function servedPackProblem(content: Content, thingsVersion: string): string | null {
  if (content.pack === undefined || content.pack.version === thingsVersion) return null;
  return `THINGS_VERSION=${thingsVersion}, mas a tabela de aparências foi conferida contra o `
    + `pacote "${content.pack.id}" (versão ${content.pack.version}): o cliente carregaria um `
    + 'pacote e o conteúdo apontaria ids de outro. Alinhe THINGS_VERSION com packs/ — ou '
    + 'troque o pacote do conteúdo e regenere o inventário com pnpm assets:inventory';
}
