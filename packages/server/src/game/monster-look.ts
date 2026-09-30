// A apresentação do monstro no fio (#620): cores e addons do outfit, raça, luz e falas.
//
// O `sim` não conhece nada disto — é o que o cliente PINTA e MOSTRA, lido do conteúdo fixado na
// sessão (invariante 7) por quem monta o `creature-appear` e o `session-state`. Não há estado, não
// há sorteio e nada aqui toca a fila ou o `Rng` da sessão: a fala periódica é sorteada no
// CLIENTE (`monster.voices`), e a hunt rende exatamente o mesmo com ou sem alguém olhando
// (invariante 3).

import { DEFAULT_MONSTER_RACE, NEUTRAL_MONSTER_OUTFIT } from '@draconya/content';
import type { Monster } from '@draconya/content';
import type { CreatureLight, CreatureVoices, MonsterRace, OutfitColors } from '@draconya/protocol';

/** Os campos de apresentação que o `creature-appear` e a criatura do `session-state` compartilham. */
export interface MonsterLook {
  colors?: OutfitColors;
  addons?: number;
  race?: MonsterRace;
  light?: CreatureLight;
  voices?: CreatureVoices;
}

/**
 * O que o cliente precisa para desenhar UM monstro, a partir da definição dele. Espalhado no
 * literal da mensagem (`...monsterLookOf(definition)`), e não como campos `undefined`: a chave
 * ausente é o que o cliente lê como o default, e uma chave com `undefined` não sobrevive ao JSON
 * de qualquer jeito — o codec a apagaria em silêncio, e o tipo passaria a mentir sobre o que foi
 * mandado.
 *
 * - **`colors` sai SEMPRE que há definição**, inclusive tudo 0: o neutro do Canary é o branco da
 *   paleta, e o cliente sem cor nenhuma pintaria o monstro com as de personagem novo — um
 *   template de duas camadas todo amarelo e azul. Sem definição (host de teste sem catálogo) o
 *   monstro continua sem cores, como sempre foi.
 * - **`addons`, `race`, `light` e `voices` saem só quando diferem do default**, para a mensagem
 *   do monstro comum (sem addon, `blood`, sem luz, mudo) não crescer. O cliente lê a ausência
 *   como o default.
 */
export function monsterLookOf(definition: Monster | undefined): MonsterLook {
  if (definition === undefined) return {};
  const outfit = definition.outfit ?? NEUTRAL_MONSTER_OUTFIT;
  const race = definition.race ?? DEFAULT_MONSTER_RACE;
  const { light, voices } = definition;
  return {
    colors: { head: outfit.head, body: outfit.body, legs: outfit.legs, feet: outfit.feet },
    ...(outfit.addons > 0 ? { addons: outfit.addons } : {}),
    ...(race === DEFAULT_MONSTER_RACE ? {} : { race }),
    ...(light === undefined ? {} : { light: { level: light.level, color: light.color } }),
    ...(voices === undefined
      ? {}
      : {
        voices: {
          intervalMs: voices.intervalMs,
          chance: voices.chance,
          // `yell` só vai quando é grito: ausente é fala, e o texto comum não paga o campo.
          lines: voices.lines.map((line) => (line.yell ? { text: line.text, yell: true } : { text: line.text })),
        },
      }),
  };
}

/**
 * O efeito do golpe FÍSICO que atinge um alvo de raça `race`: a linha de `appearances.hits.byRace`,
 * ou `melee` quando a raça não tem (o sangue de sempre). `undefined` é golpe sem efeito — o
 * `CONST_ME_NONE` do Canary, sem `melee` para cair.
 */
export function hitEffectOf(
  hits: { readonly melee?: number | undefined; readonly byRace?: Readonly<Partial<Record<MonsterRace, number>>> | undefined },
  race: MonsterRace | undefined,
): number | undefined {
  return hits.byRace?.[race ?? DEFAULT_MONSTER_RACE] ?? hits.melee;
}
