// Extrato → linha de ledger, e progressão de volta para o personagem (FUN-29, FUN-54).
//
// Creditar é ESCRITA ECONÔMICA, e o invariante 10 diz como: linha append-only com
// `UNIQUE (session_id, seq)`. É essa chave que faz retry nunca duplicar — e retry aqui não é
// hipótese, é o desenho: o `game` grava o extrato no Redis, este código insere, e só depois
// apaga. Morrer entre inserir e apagar custa uma tentativa repetida, e a tentativa repetida é
// operação nula.

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Bestiary, Bosstiary, LearnedSpells, levelForXp, readItemOverlay } from '@draconya/sim';
import type {
  BestiaryState, BosstiaryState, CharacterStorageMap, ItemInstanceOverlay,
} from '@draconya/sim';
import type { Progression } from '@draconya/content';
import type { Database } from '../db/client.js';
import {
  characterStorages, characters, itemInstances, ledger,
} from '../db/schema.js';
import type { Logger } from '../log.js';
import type { ItemPlace, ReceiptStore, SessionReceipt } from '../receipts.js';
import { isLearnedSpellsState } from '../tickets.js';

export interface LedgerSweepOptions {
  readonly database: Database;
  readonly receipts: ReceiptStore;
  readonly logger: Logger;
  /**
   * A curva de XP, para derivar o level novo (FUN-54). Ausente: o ledger é escrito e a linha
   * do personagem não — que é o comportamento de antes desta issue, e serve para um `jobs`
   * montado sem conteúdo em teste.
   */
  readonly progression?: Progression;
  /**
   * Quantas varreduras SEGUIDAS cada extrato já falhou, por identidade (`characterId|sessionId|seq`)
   * (#823). É o que deixa o `jobs` desistir de esperar por um extrato que não liquida: depois de
   * `STUCK_RECEIPT_AFTER` falhas ele deixa de segurar os seguintes do mesmo personagem (ver
   * `writeReceipts`). O mapa vive no ciclo do `jobs`, entre uma varredura e outra, e é podado a
   * cada uma — só ficam os que falharam agora. Ausente (a liquidação do ticket, os testes): o
   * primeiro que falha segura os seguintes SEMPRE, e o ticket é recusado de qualquer jeito.
   */
  readonly failures?: Map<string, number>;
}

export interface LedgerSweepResult {
  readonly written: number;
  readonly failed: number;
}

/**
 * O saldo da SESSÃO: `goldGained - goldSpent`.
 *
 * Sem compras por lote desde a reversão do modelo abstrato: potagem e munição debitam gold no
 * USO, e o `goldSpent` já é o total gasto. É a mesma conta que `applyProgression` escreve na
 * coluna, e as duas têm que bater.
 */
export function creditOf(receipt: SessionReceipt): number {
  return receipt.aggregates.goldGained - receipt.aggregates.goldSpent;
}

/**
 * Quantas varreduras seguidas um extrato pode falhar antes de deixar de segurar os seguintes do
 * mesmo personagem (#823). Cinco ciclos são ~50 s: o `jobs` tolera uma queda de conexão ou um
 * deadlock sem desordenar nada, mas um extrato com dado torto — que falharia para sempre — não
 * pode trancar o personagem até o TTL do Redis. Passado o prazo os seguintes liquidam sem ele, e
 * quando (se) ele liquidar entram só os deltas dele: a guarda de versão já subiu.
 */
export const STUCK_RECEIPT_AFTER = 5;

/** A identidade de um extrato: a mesma da chave do Redis e do `UNIQUE (session_id, seq)` do ledger. */
const identityOf = (receipt: SessionReceipt): string =>
  `${receipt.characterId}|${receipt.sessionId}|${receipt.seq}`;

/** Quantos extratos de um personagem a varredura completa pelo índice — o teto do `pendingFor`. */
const GROUP_LIMIT = 50;

export async function writePendingReceipts(
  options: LedgerSweepOptions,
): Promise<LedgerSweepResult> {
  const scanned = await options.receipts.pending();
  return writeReceipts(await completeGroups(scanned, options.receipts), options);
}

/**
 * Completa, personagem por personagem, o que o `SCAN` achou (#823, OW-02).
 *
 * O `SCAN` não tem ordem e `pending()` corta em 200: com fila grande (um `jobs` que ficou fora do
 * ar, uma drenagem em massa) o extrato MAIS NOVO de um personagem pode vir sem o mais velho, e
 * liquidá-lo assim faria o mais velho chegar depois com a guarda de versão fechada — perdendo o
 * que só ele carrega (o item, que é delta, e tudo o que um extrato de um nó anterior ou parcial
 * deixou de levar). A fonte da ordem de cada personagem é o índice por versão (`pendingFor`), que
 * já é a do ticket: o `SCAN` só diz QUAIS personagens têm pendência.
 *
 * Do `SCAN` sobra só o que o índice não conhece: extrato SEM entrada de índice (de um nó anterior
 * ao #194) e versionado que o índice não lista. Quando o índice está CHEIO (`GROUP_LIMIT`), o
 * versionado que ele não trouxe fica para o ciclo seguinte — liquidá-lo agora deixaria um buraco
 * entre as versões, que é exatamente o que isto existe para não ter.
 */
async function completeGroups(
  scanned: readonly SessionReceipt[],
  store: ReceiptStore,
): Promise<SessionReceipt[]> {
  const found = new Map<string, SessionReceipt[]>();
  for (const receipt of scanned) {
    const group = found.get(receipt.characterId);
    if (group === undefined) found.set(receipt.characterId, [receipt]);
    else group.push(receipt);
  }
  const complete: SessionReceipt[] = [];
  for (const [characterId, scannedOfCharacter] of found) {
    const indexed = await store.pendingFor(characterId, GROUP_LIMIT);
    const known = new Set(indexed.map(identityOf));
    // Um `Map` pela identidade: o `SCAN` pode devolver a mesma chave mais de uma vez.
    const orphans = new Map<string, SessionReceipt>();
    if (indexed.length < GROUP_LIMIT) {
      for (const receipt of scannedOfCharacter) {
        if (!known.has(identityOf(receipt))) orphans.set(identityOf(receipt), receipt);
      }
    }
    complete.push(...indexed, ...orphans.values());
  }
  return complete;
}

/**
 * Liquida agora o que este personagem tem pendente, em vez de esperar a varredura (FUN-56).
 *
 * O problema: entre a sessão encerrar e o `jobs` varrer passam até dez segundos, e quem
 * reconecta dentro dessa janela lê `level` e `xp` da tabela — ainda sem o delta da sessão
 * que acabou. O personagem aparece com o progresso de antes, e como `statsForLevel` deriva
 * HP e mana do level, ele também ENCOLHE. É indistinguível de perda de dados, some sozinho
 * em dez segundos, e ninguém consegue reproduzir de propósito.
 *
 * Isto é o MESMO caminho da varredura, não um paralelo: mesma linha de ledger, mesma chave
 * única, mesma transação. É o que torna o encontro dos dois inofensivo — o `jobs` e esta
 * chamada podem processar o mesmo extrato ao mesmo tempo, e o segundo a chegar bate na
 * `UNIQUE (session_id, seq)`, não aplica nada e apaga um extrato já creditado.
 *
 * Somar o delta pendente por cima do que veio do banco, em vez de liquidar, seria mais
 * barato e estaria errado: entre ler a linha e ler o Redis cabe uma varredura inteira, e o
 * mesmo delta entraria duas vezes na conta que o jogador vê.
 */
export async function settleCharacterProgress(
  characterId: string,
  options: LedgerSweepOptions,
): Promise<LedgerSweepResult> {
  return writeReceipts(await options.receipts.pendingFor(characterId), options);
}

async function writeReceipts(
  pending: readonly SessionReceipt[],
  options: LedgerSweepOptions,
): Promise<LedgerSweepResult> {
  let written = 0;
  let failed = 0;
  const failedNow = new Set<string>();

  // POR PERSONAGEM, em ordem de versão (#823, OW-02): o que o Redis devolve não tem ordem (o
  // `SCAN` é por hash; o índice do ticket só a tem dentro de um personagem), e um personagem
  // com dois ou três extratos pendentes — Cidade → hunt → Cidade — precisa liquidá-los do mais
  // antigo ao mais novo. Personagens diferentes não disputam nada, então a ordem entre eles é a
  // de chegada.
  for (const receipts of groupByCharacter(pending)) {
    for (const [position, receipt] of receipts.entries()) {
      const identity = identityOf(receipt);
      try {
        // Uma transação: ou a linha de ledger e a progressão entram juntas, ou nenhuma das
        // duas. Separadas, uma queda no meio deixaria o gold creditado no ledger sem estar na
        // linha do personagem — e a reconciliação entre os dois é justamente o que o
        // invariante 10 existe para não precisar.
        await options.database.transaction(async (tx) => {
          const inserted = await tx
            .insert(ledger)
            .values({
              id: randomUUID(),
              characterId: receipt.characterId,
              sessionId: receipt.sessionId,
              seq: receipt.seq,
              type: `session-${receipt.reason}`,
              delta: creditOf(receipt),
              ref: {
                xpGained: receipt.aggregates.xpGained,
                kills: receipt.aggregates.kills,
                deaths: receipt.aggregates.deaths,
                durationMs: receipt.aggregates.durationMs,
                notableEvents: receipt.notableEvents,
              },
            })
            // A chave única é a idempotência. `DO NOTHING` transforma o retry em operação nula
            // em vez de erro, que é o que permite apagar o extrato com segurança logo abaixo.
            .onConflictDoNothing({ target: [ledger.sessionId, ledger.seq] })
            .returning({ id: ledger.id });

          // Vazio = a linha já existia, este extrato já foi creditado. Aplicar a progressão
          // agora seria creditar duas vezes um delta que a chave única acabou de recusar.
          if (inserted.length === 0) return;
          await applyProgression(tx, receipt, options.progression);
        });

        await options.receipts.remove(receipt.sessionId, receipt.characterId, receipt.seq);
        written += 1;
      } catch (error) {
        // O extrato FICA no Redis. Perder o crédito em silêncio é o defeito que este arquivo
        // existe para não ter; tentar de novo no próximo ciclo não custa nada.
        failed += 1;
        failedNow.add(identity);
        const attempts = (options.failures?.get(identity) ?? 0) + 1;
        options.failures?.set(identity, attempts);
        options.logger.error(
          { error, sessionId: receipt.sessionId, characterId: receipt.characterId, attempts },
          'Failed to write a session receipt to the ledger; keeping it for the next cycle',
        );

        // **O que falhou SEGURA os seguintes do mesmo personagem** (#823): a guarda de versão só
        // protege o que o extrato mais NOVO carrega. Antes do #823 o `jobs` seguia adiante depois
        // de uma falha, e o extrato de estado da Cidade — que não levava skills, stamina, comida
        // nem storages — liquidava na frente do de hunt que falhou: o da hunt chegava depois com a
        // guarda fechada e esses campos se perdiam para sempre, e o ticket recusado
        // (`progress-not-settled`) convidava o retry que os perdia. Hoje todo extrato é o estado
        // inteiro, mas a ordem continua sendo o que protege o item (`acquired`/`removedInstances`
        // são deltas) e o que um extrato de nó anterior deixou de levar. Parar é seguro: um
        // extrato que falha já trancava o ticket do personagem (`failed > 0` → 503), então segurar
        // os seguintes não tranca nada que já não estivesse trancado.
        //
        // A exceção é o extrato que não liquida NUNCA (dado torto): depois de `STUCK_RECEIPT_AFTER`
        // varreduras seguidas ele deixa de segurar os seguintes, para o personagem não ficar
        // preso até o TTL do Redis. Os absolutos dele se perdem — é a degradação explícita, e
        // vai ao log. Sem `failures` (o ticket) não há desistência.
        const behind = receipts.length - position - 1;
        if (behind === 0) continue;
        if (options.failures !== undefined && attempts >= STUCK_RECEIPT_AFTER) {
          options.logger.error(
            { sessionId: receipt.sessionId, characterId: receipt.characterId, seq: receipt.seq, attempts, behind },
            'A session receipt is stuck; the later receipts of the character settle without it, '
              + 'and its absolute state will be dropped by the version guard',
          );
          continue;
        }
        options.logger.warn(
          { sessionId: receipt.sessionId, characterId: receipt.characterId, behind },
          'Holding the later receipts of the character behind the one that failed',
        );
        break;
      }
    }
  }

  // Só ficam contados os que falharam AGORA: o que liquidou, ou sumiu (TTL), não pode deixar um
  // contador para trás.
  if (options.failures !== undefined) {
    for (const identity of [...options.failures.keys()]) {
      if (!failedNow.has(identity)) options.failures.delete(identity);
    }
  }

  return { written, failed };
}

/**
 * Agrupa os extratos por personagem e ordena cada grupo (#823, OW-02): os VERSIONADOS pela
 * versão, e os SEM versão — de um nó anterior, ou liquidados por fora do `game` — entre eles,
 * pelo relógio em que foram gravados. Sem isso um extrato sem versão passaria à frente de um
 * versionado que já era mais antigo que ele, e o absoluto velho o desfaria.
 *
 * Exportada para o teste. Empate de versão (não acontece: o contador é monotônico) desempata
 * pelo relógio e pelo `seq`, para a ordem ser determinística.
 */
export function groupByCharacter(receipts: readonly SessionReceipt[]): SessionReceipt[][] {
  const groups = new Map<string, SessionReceipt[]>();
  for (const receipt of receipts) {
    const group = groups.get(receipt.characterId);
    if (group === undefined) groups.set(receipt.characterId, [receipt]);
    else group.push(receipt);
  }
  return [...groups.values()].map(inDurableOrder);
}

function inDurableOrder(receipts: readonly SessionReceipt[]): SessionReceipt[] {
  const byClock = (a: SessionReceipt, b: SessionReceipt): number =>
    a.endedAtMs - b.endedAtMs || a.seq - b.seq;
  const versioned = receipts
    .filter((receipt) => receipt.durableVersion !== undefined)
    .sort((a, b) => (a.durableVersion as number) - (b.durableVersion as number) || byClock(a, b));
  const unversioned = receipts
    .filter((receipt) => receipt.durableVersion === undefined)
    .sort(byClock);
  // Intercala as duas listas já ordenadas: o sem versão entra depois do último versionado que
  // foi gravado até o instante dele, nunca antes de um que já era mais velho.
  const ordered: SessionReceipt[] = [];
  let next = 0;
  for (const receipt of unversioned) {
    while (next < versioned.length && (versioned[next] as SessionReceipt).endedAtMs <= receipt.endedAtMs) {
      ordered.push(versioned[next] as SessionReceipt);
      next += 1;
    }
    ordered.push(receipt);
  }
  return [...ordered, ...versioned.slice(next)];
}

/**
 * Escreve a progressão da sessão na linha do personagem (FUN-54).
 *
 * XP e gold entram como DELTA, e o `xpGained` do extrato já é o líquido — inclui a penalidade
 * de morte como número negativo (FUN-37). Estado final não serviria: não é idempotente, e dois
 * extratos do mesmo personagem processados fora de ordem se sobrescreveriam.
 */
async function applyProgression(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  receipt: SessionReceipt,
  progression: Progression | undefined,
): Promise<void> {
  // Lê com trava de linha e decide aqui, em vez de montar `case when` no `UPDATE`.
  //
  // A primeira versão fazia a guarda de stamina em SQL e estava errada de um jeito que só o
  // teste com Postgres de verdade pegou. A trava já é necessária de qualquer forma — o
  // `jobs` é singleton, mas nada impede dois ciclos se cruzarem num deploy —, e com a linha
  // em mãos a regra vira três linhas de TypeScript que qualquer um confere lendo.
  const [current] = await tx
    .select({
      xp: characters.xp,
      gold: characters.gold,
      skillsUpdatedAt: characters.skillsUpdatedAt,
      bestiary: characters.bestiary,
      bosstiary: characters.bosstiary,
      learnedSpells: characters.learnedSpells,
      ammo: characters.ammo,
      staminaUpdatedAt: characters.staminaUpdatedAt,
      durableVersion: characters.durableVersion,
    })
    .from(characters)
    .where(eq(characters.id, receipt.characterId))
    .for('update');
  if (current === undefined) return;

  // Piso de zero: a penalidade de morte chega como número negativo (FUN-37), e XP negativa é
  // um estado impossível que dá erro estranho em todo lugar que a lê depois.
  const xp = Math.max(0, current.xp + receipt.aggregates.xpGained);
  // O gold do personagem é o LÍQUIDO da sessão (`goldGained - goldSpent`): `goldSpent` já é o
  // total debitado no uso (poção, runa e tiro), e a linha de ledger leva o mesmo delta.
  const gold = Math.max(0, current.gold + receipt.aggregates.goldGained - receipt.aggregates.goldSpent);

  // A GUARDA DE VERSÃO (#823, OW-02, ADR 0060 decisão 10e). XP, gold, `acquired` e
  // `removedInstances` são DELTAS — protegidos por `UNIQUE (session_id, seq)`, valem em qualquer
  // ordem e entram SEMPRE. Todo campo ABSOLUTO (ammo, alma, estoques, comida, charms, bênçãos,
  // postura, equipamento, layout, overlays, storages, stamina, skills) é última-escrita-vence, e
  // "a última" precisa ser a de MAIOR versão, não a que o `SCAN` ou o `SMEMBERS` entregou por
  // último: só se escreve quando o extrato é mais novo que o que a coluna já viu, e a coluna sobe
  // na mesma transação. Extrato atrasado entra só com os deltas.
  //
  // **A guarda decide por EXTRATO, não por campo, e só é correta por duas razões** que este código
  // não enxerga: (1) todo extrato versionado é o estado absoluto INTEIRO do personagem naquele
  // instante — `#persistReceipt` (hunt) e `#saveDurableReceipt` (Cidade) levam o mesmo conjunto de
  // campos, inclusive o estoque vazio —, então o mais novo substitui o mais velho por completo e
  // descartar o velho não perde nada; (2) um personagem liquida COMPLETO e em ordem, e o primeiro
  // extrato que falha segura os seguintes (`writeReceipts`), então o velho só chega depois do novo
  // pela desistência explícita de `STUCK_RECEIPT_AFTER`. Quebrar qualquer uma das duas devolve o
  // defeito de um extrato parcial mais novo apagando o que só o mais velho carregava.
  //
  // Extrato SEM versão (nó `game` anterior, ou liquidado por fora dele) segue a regra de antes —
  // escreve os absolutos — e NÃO mexe na coluna. É degradação de deploy em rolagem, não modo de
  // operação. O que é monotônico por natureza — Bestiário (máximo), vocação (`coalesce`) e
  // promoção (`OR`) — não precisa da guarda e também entra sempre: a ordem não os afeta.
  const absolute = receipt.durableVersion === undefined || receipt.durableVersion > current.durableVersion;

  // Stamina é valor absoluto, não soma — e por isso vem com guarda de instante: um extrato
  // atrasado, processado fora de ordem, não pode devolver stamina já gasta.
  //
  // **Os dois lados vêm de relógios DIFERENTES** (FUN-101), e isso é uma premissa, não um
  // detalhe: `current.staminaUpdatedAt` nasce de `defaultNow()`, que é o relógio do Postgres;
  // `receipt.staminaUpdatedAtMs` sai de `materializeStamina(character, now())` no nó `game`,
  // que é o `Date.now()` DELE. A guarda só vale enquanto o skew entre os dois for menor que o
  // tempo entre duas sessões consecutivas do mesmo personagem.
  //
  // Sessão dura segundos no mínimo e NTP mantém máquinas dentro de dezenas de milissegundos,
  // então vale — mas vale por folga, não por construção. Numa falha de NTP que ponha o banco
  // à frente, o sintoma é stamina que não desce, sem erro em lugar nenhum. Se um dia isso
  // acontecer, a correção é o `game` mandar o instante que LEU da linha, e não o próprio.
  const stamina = absolute
    && receipt.staminaMs !== undefined
    && receipt.staminaUpdatedAtMs !== undefined
    && receipt.staminaUpdatedAtMs >= current.staminaUpdatedAt.getTime()
    ? { staminaMs: receipt.staminaMs, staminaUpdatedAt: new Date(receipt.staminaUpdatedAtMs) }
    : {};

  // Skill DEIXOU de ser monotônica (#569): a penalidade de morte agora tira tries — o mesmo
  // percentual que já tira XP —, então "fundir pelo MAIOR de cada uma" reergueria a perda se
  // um extrato mais antigo chegasse depois de um mais novo já aplicado (a mesma janela que
  // `Skills.merge` documenta). A escrita passa a ser ABSOLUTA e guardada por instante, como a
  // stamina (FUN-101) — mas aqui o instante é `endedAtMs`, o relógio de quando a SESSÃO
  // terminou, não um campo por grandeza: como um personagem só está numa sessão de cada vez
  // (invariante 8), as sessões dele terminam em ordem cronológica real, e comparar contra o
  // instante já gravado decide sozinho qual dos dois é o mais recente, sem precisar saber se a
  // skill subiu ou desceu.
  //
  // **Os dois lados vêm de relógios DIFERENTES** (a mesma premissa da stamina): `skillsUpdatedAt`
  // nasce de `defaultNow()` (Postgres); `receipt.endedAtMs` sai do `Date.now()` do nó `game`
  // (`ReceiptStore.save`). Vale por folga (sessão dura segundos no mínimo, NTP mantém as
  // máquinas a dezenas de milissegundos), não por construção.
  //
  // Desde o #823 esta guarda não é mais a única ordem: `absolute` (a versão durável) vem primeiro
  // e não depende de relógio nenhum. Ela fica por cima, para o extrato SEM versão.
  const skills = absolute && receipt.skills !== undefined && receipt.endedAtMs >= current.skillsUpdatedAt.getTime()
    ? { skills: receipt.skills, skillsUpdatedAt: new Date(receipt.endedAtMs) }
    : {};

  // O Bestiário funde pelo MAIOR de cada monstro (FUN-113, DT-02), pela mesma razão das
  // skills: abate nunca desce. A coluna é nulável — `null` é quem nunca abateu nada — e o
  // extrato SEM o campo (sessão de Cidade, nó antigo em deploy) não toca na coluna: gravar
  // `{}` por cima apagaria abates que ninguém pediu para apagar.
  const bestiary = receipt.bestiary === undefined
    ? {}
    : {
      bestiary: Bestiary.merge(
        (current.bestiary as BestiaryState | null) ?? undefined, receipt.bestiary,
      ),
    };

  // O Bosstiary funde pelo MAIOR de cada boss e dos pontos (#629, ADR 0052 d.1), pela mesma razão
  // do Bestiário: abate nunca desce, e os pontos de boss só somam. A coluna é nulável — `null` é
  // quem nunca abateu um boss — e o extrato SEM o campo (Cidade, nó antigo em deploy) não toca
  // nela.
  const bosstiary = receipt.bosstiary === undefined
    ? {}
    : {
      bosstiary: Bosstiary.merge(
        (current.bosstiary as BosstiaryState | null) ?? undefined, receipt.bosstiary,
      ),
    };

  // A munição escolhida (#152): preferência, última escrita vence. Extrato SEM o campo não toca
  // na coluna — é a Cidade, ou um nó antigo, e a escolha continua a de antes.
  const ammo = !absolute || receipt.ammo === undefined ? {} : { ammo: receipt.ammo };

  // Pontos de alma (#593): ABSOLUTO, última-escrita-vence, como `ammo` — NUNCA fundido por
  // MÁXIMO como skills/Bestiário. Alma DESCE (gasta na conjuração), e ficar com o maior de duas
  // gravações fora de ordem reviveria um saldo que a sessão mais nova já gastou.
  const soul = !absolute || receipt.soul === undefined ? {} : { soul: receipt.soul };

  // O estoque de supply/munição do loot (#520): ABSOLUTO e última-escrita-vence, como `ammo` —
  // sobe por loot e desce por uso na MESMA sessão, então o valor final da sessão é o único que
  // os dois lados podem concordar sobre (não monotônico como o Bestiário, que funde pelo maior).
  const supplyStock = !absolute || receipt.supplyStock === undefined
    ? {} : { supplyStock: receipt.supplyStock };
  const ammunitionStock = !absolute || receipt.ammunitionStock === undefined
    ? {} : { ammunitionStock: receipt.ammunitionStock };

  // Comida ativa (#726, ADR 0049 decisão 5): ABSOLUTA e última-escrita-vence, como o estoque
  // acima — drena dentro da sessão, então o valor final é o único que os dois lados concordam.
  const fedMs = !absolute || receipt.fedMs === undefined ? {} : { fedMs: receipt.fedMs };

  // A economia de Charms (M39-02, #602, ADR 0052 d.1): ABSOLUTA e última-escrita-vence, como
  // `ammo`/`equipment` — NÃO fundida pelo maior como o Bestiário: não há aqui um contador
  // externo monotônico a fundir, é o estado final da sessão dona. Extrato SEM o campo (Cidade
  // ou nó antigo em deploy) não toca na coluna.
  const charms = !absolute || receipt.charms === undefined ? {} : { charms: receipt.charms };
  // As magias aprendidas (#624, ADR 0058 d.1): fundidas pela UNIÃO, como o Bestiário é fundido
  // pelo maior — e NÃO última-escrita-vence, como `charms`. O registro só CRESCE (não existe
  // esquecer magia, só a Wheel, que está fora do jogo), então a união é a fusão certa, e ela
  // fecha duas janelas que a última-escrita deixava abertas: extratos pendentes se aplicam em
  // ordem qualquer (o `SCAN` do Redis não ordena), e o mais antigo chegando depois do mais novo
  // derrubaria uma magia já paga (o gold é delta e ficaria debitado); e um extrato que parte de
  // uma base desconhecida (sessão retomada de um snapshot sem registro) carrega só as compras
  // dela, e escreveria por cima da concessão da migração 0024 (ADR 0014). A coluna é nulável —
  // `null` é quem nunca aprendeu nada nem foi migrado — e uma linha torta vira ausente, pela
  // mesma régua do ticket. Extrato SEM o campo não toca na coluna.
  const learnedSpells = receipt.learnedSpells === undefined
    ? {}
    : {
      learnedSpells: LearnedSpells.merge(
        isLearnedSpellsState(current.learnedSpells) ? current.learnedSpells : undefined,
        receipt.learnedSpells,
      ),
    };
  // O familiar (M38-02, #599, ADR 0057 d.3): ABSOLUTO e última-escrita-vence, como `charms` — e
  // NUNCA fundido pelo maior, porque o `summonUntilMs` desce quando o familiar morre. Extrato SEM o
  // campo (Cidade ou nó antigo em deploy) não toca na coluna.
  const familiar = !absolute || receipt.familiar === undefined ? {} : { familiar: receipt.familiar };
  // O registro do Treino (#631, ADR 0059 d.3): ABSOLUTO e última-escrita-vence, como `charms` — o
  // banco de offline training sobe por tempo de sessão e DESCE quando a `api` o gasta, então
  // fundir pelo maior ressuscitaria tempo já gasto. Extrato SEM o campo não toca na coluna.
  const training = !absolute || receipt.training === undefined ? {} : { training: receipt.training };
  // O Hazard (M44-14, #632, ADR 0052 d.1): ABSOLUTO e última-escrita-vence, como `charms` — a
  // escolha de nível desce e sobe, e o teto só sobe por `levelUp` dentro da sessão dona. Extrato
  // SEM o campo (quem nunca tocou no hazard, ou nó antigo em deploy) não toca na coluna.
  const hazard = !absolute || receipt.hazard === undefined ? {} : { hazard: receipt.hazard };
  // As bênçãos (#570, ADR 0052): ABSOLUTAS e última-escrita-vence, NUNCA fundidas pelo maior
  // (ao contrário do Bestiário/skills-antes-do-#569) — bênção DESCE na morte, e "ficar com o
  // maior de cada extrato" ressuscitaria uma bênção recém-consumida se um extrato antigo, fora
  // de ordem, chegasse depois de um mais novo já aplicado.
  const blessings = !absolute || receipt.blessings === undefined ? {} : { blessings: receipt.blessings };
  // A postura de luta (#550, M30-03): ABSOLUTA e última-escrita-vence, como as bênçãos — o jogador
  // troca para qualquer lado, e não existe ordem entre os três modos que uma fusão por máximo
  // pudesse respeitar. Extrato SEM o campo (nó anterior, ou Cidade que não mexeu) não toca a coluna.
  const fightMode = !absolute || receipt.fightMode === undefined ? {} : { fightMode: receipt.fightMode };

  // O que caiu e coube (FUN-88). ANTES do equipamento, porque uma peça que caiu nesta sessão
  // e foi equipada nela precisa existir como linha para o layout ter o que apontar.
  if (receipt.acquired !== undefined && receipt.acquired.length > 0) {
    await tx
      .insert(itemInstances)
      .values(receipt.acquired.map((item) => ({
        id: item.instanceId,
        itemId: item.itemId,
        ownerCharacterId: receipt.characterId,
        quantity: item.quantity,
        // A proveniência vem do `sim` (#154): a arma de vocação é `'vocation-choice'`; o que
        // não diz é loot — inclusive o extrato de um nó anterior.
        origin: item.origin ?? 'loot',
      })))
      // O id vem do `sim` e é determinístico (`sessionId:n`), então inserir de novo é inserir
      // a mesma chave primária.
      //
      // **A proteção principal contra extrato repetido é outra**: a `UNIQUE (session_id, seq)`
      // do ledger, na mesma transação, que faz o segundo processamento inteiro virar operação
      // nula. Isto aqui é o que torna a INSERÇÃO segura por conta própria — sem ele, um item
      // que já existisse derrubaria o extrato inteiro, e gold, XP e skills se perderiam junto
      // com ele. Identidade previsível é o que permite essa segurança sem conferência.
      .onConflictDoNothing();
  }

  // As instâncias vendidas/descartadas nesta sessão (#724, ADR 0048 d.8): apagadas na MESMA
  // transação do ledger — é a primeira vez que uma sessão faz `item_instance` deixar de
  // existir (`items.md` §"Como o item vai e volta do banco" ganha a exceção nomeada).
  // Escopado por DONO, como `acquired`/`applyLayout`: um extrato não apaga item de outra
  // conta, nem que traga o id dela. `DELETE` é idempotente por id — reprocessar o mesmo
  // extrato (retry após falha) apaga zero linhas na segunda vez, nunca erro.
  if (receipt.removedInstances !== undefined && receipt.removedInstances.length > 0) {
    await tx
      .delete(itemInstances)
      .where(and(
        eq(itemInstances.ownerCharacterId, receipt.characterId),
        inArray(itemInstances.id, receipt.removedInstances),
      ));
  }

  // O layout de equipamento (FUN-82). Escopado por dono dentro do próprio `applyEquipment`:
  // um extrato não move item de outra pessoa nem que traga o id dela.
  if (absolute && receipt.equipment !== undefined) {
    await applyEquipment(tx, receipt.characterId, receipt.equipment);
  }
  // E onde cada item está dentro dos containers (#160): último-escrito-vence, como o
  // equipamento — é posição, não valor.
  if (absolute && receipt.layout !== undefined) {
    await applyLayout(tx, receipt.characterId, receipt.layout);
  }
  // E o estado por instância (#604, ADR 0046): último-escrito-vence, como o layout. Depois do
  // `acquired`, pela mesma razão do equipamento: a peça que caiu e foi imbuída nesta sessão
  // precisa já ser linha.
  if (absolute && receipt.overlays !== undefined) {
    await applyOverlays(tx, receipt.characterId, receipt.overlays);
  }
  // E os storages (#731, ADR 0050 d.6 T2): ao contrário do overlay (patch por instância), o
  // extrato manda o mapa INTEIRO — a mesma forma de `supplyStock` — e `applyStorages` o trata
  // como o ESTADO COMPLETO do personagem: toda chave do banco que não aparece nele é apagada.
  if (absolute && receipt.storages !== undefined) {
    await applyStorages(tx, receipt.characterId, receipt.storages);
  }

  await tx
    .update(characters)
    .set({
      xp,
      gold,
      ...skills,
      ...bestiary,
      ...bosstiary,
      ...ammo,
      ...soul,
      ...supplyStock,
      ...ammunitionStock,
      ...fedMs,
      ...charms,
      ...learnedSpells,
      ...familiar,
      ...training,
      ...hazard,
      ...blessings,
      ...fightMode,
      // A vocação (#154, ADR 0026 decisão 1): escrita UMA vez. `coalesce` mantém o que já
      // está na linha — um extrato fora de ordem com outra vocação não sobrescreve.
      ...(receipt.vocation === undefined
        ? {}
        : { vocation: sql`coalesce(${characters.vocation}, ${receipt.vocation})` }),
      // A promoção (#566, ADR 0042 decisão 1): `OR`, não `coalesce` — o boolean não tem
      // "ausente" a preencher uma vez só (a diferença de `vocation`, string nulável). O campo
      // SÓ chega `true` (ver `parseReceipt`), então isto é sempre "vira `true` e não volta".
      ...(receipt.promoted === true
        ? { promoted: sql`${characters.promoted} OR true` }
        : {}),
      // O level é DERIVADO da XP nova, nunca copiado do extrato: copiar faria um extrato
      // antigo, processado fora de ordem, rebaixar um personagem que já subiu.
      ...(progression === undefined ? {} : { level: levelForXp(xp, progression) }),
      ...stamina,
      // A versão sobe na MESMA transação dos absolutos que ela guarda (#823): só quando o extrato
      // é versionado E foi mais novo — o sem versão não a mexe, e o atrasado nunca a faz descer.
      ...(receipt.durableVersion !== undefined && absolute
        ? { durableVersion: receipt.durableVersion }
        : {}),
    })
    .where(eq(characters.id, receipt.characterId));
}

/**
 * A posição de cada instância nos containers (#160). Escopada por dono, como o equipamento:
 * um extrato com o id de um item alheio não move nada. O que não está no layout — equipado,
 * ou desconhecido — fica sem posição, e o ticket o põe no primeiro lugar livre.
 */
async function applyLayout(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  characterId: string,
  layout: Readonly<Record<string, ItemPlace>>,
): Promise<void> {
  const owned = await tx
    .select({ id: itemInstances.id, container: itemInstances.container, slotIndex: itemInstances.slotIndex })
    .from(itemInstances)
    .where(eq(itemInstances.ownerCharacterId, characterId));
  for (const row of owned) {
    const place = layout[row.id];
    const next = place === undefined
      ? { container: null, slotIndex: null }
      : { container: place.container, slotIndex: place.index };
    if (row.container === next.container && row.slotIndex === next.slotIndex) continue;
    await tx.update(itemInstances).set(next).where(eq(itemInstances.id, row.id));
  }
}

/**
 * O overlay de cada instância que o extrato lista (#604, ADR 0046). Escopado por dono, como o
 * layout: um extrato com o id de um item alheio não escreve nada nele. ABSOLUTO só para as
 * instâncias LISTADAS — o `null` apaga o overlay (o imbuement venceu) —; a que não aparece no
 * extrato não é tocada. Cada overlay passa pela mesma leitura defensiva do ticket
 * (`readItemOverlay`), então o banco nunca guarda um overlay que o ticket recusaria.
 */
async function applyOverlays(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  characterId: string,
  overlays: Readonly<Record<string, ItemInstanceOverlay | null>>,
): Promise<void> {
  const owned = await tx
    .select({ id: itemInstances.id, overlay: itemInstances.overlay })
    .from(itemInstances)
    .where(eq(itemInstances.ownerCharacterId, characterId));
  for (const row of owned) {
    if (!Object.hasOwn(overlays, row.id)) continue;
    const next = readItemOverlay(overlays[row.id]) ?? null;
    if (JSON.stringify(readItemOverlay(row.overlay) ?? null) === JSON.stringify(next)) continue;
    await tx.update(itemInstances).set({ overlay: next }).where(eq(itemInstances.id, row.id));
  }
}

/**
 * Os storages do personagem (#731, ADR 0050 d.6 T2). Ao contrário de `applyOverlays` (patch por
 * instância) e como `ammo`/`supplyStock` na coluna de `characters`, aqui o extrato manda o
 * ESTADO INTEIRO — mas como storage é uma linha por chave (não uma coluna `jsonb`), "estado
 * inteiro" precisa de duas metades: upsert de toda chave presente, e DELETE de toda chave que
 * o banco tem e o extrato não lista mais — é essa segunda metade que faz um storage apagado
 * NESTA sessão (voltado a -1, `CharacterRuntime.setStorageValue`) sumir do banco de verdade,
 * em vez de sobreviver como uma linha órfã que o próximo ticket devolve por engano.
 *
 * `readCharacterStorage`/`isCharacterStorageMap` não entram aqui: o mapa já é o que o `sim`
 * gravou (`getState().storages`), e a leitura defensiva mora do lado que LÊ dado alheio (o
 * ticket, `initialCharacterOf`) — a mesma divisão de trabalho de `applyOverlays`, que também
 * não valida de novo o que o próprio `readItemOverlay` já validou na escrita do extrato.
 */
async function applyStorages(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  characterId: string,
  storages: CharacterStorageMap,
): Promise<void> {
  const owned = await tx
    .select({ id: characterStorages.id, storageKey: characterStorages.storageKey, value: characterStorages.value })
    .from(characterStorages)
    .where(eq(characterStorages.characterId, characterId));
  const byKey = new Map(owned.map((row) => [row.storageKey, row]));

  for (const [key, value] of Object.entries(storages)) {
    const current = byKey.get(key);
    if (current !== undefined && current.value === value) continue;
    if (current === undefined) {
      await tx.insert(characterStorages).values({
        id: randomUUID(), characterId, storageKey: key, value,
      });
    } else {
      await tx.update(characterStorages).set({ value }).where(eq(characterStorages.id, current.id));
    }
  }

  // O que o banco tem e o extrato não lista mais voltou a "nunca setado" (-1) NESTA sessão —
  // a linha inteira sai, porque -1 nunca é gravado (ver o schema).
  for (const row of owned) {
    if (Object.hasOwn(storages, row.storageKey)) continue;
    await tx.delete(characterStorages)
      .where(and(eq(characterStorages.characterId, characterId), eq(characterStorages.id, row.id)));
  }
}

/** Só para teste: conta linhas de uma sessão, para provar que o retry não duplica. */
export async function countLedgerRows(database: Database, sessionId: string): Promise<number> {
  const rows = await database.execute(
    sql`select count(*)::int as total from ${ledger} where ${ledger.sessionId} = ${sessionId}`,
  );
  const first = (rows as unknown as Array<{ total: number }>)[0];
  return first?.total ?? 0;
}

/**
 * Põe cada instância no slot que o extrato diz, e tira as que saíram (FUN-82).
 *
 * **Desequipa primeiro**, e a ordem é a razão de isto ser dois passos: o índice único do banco
 * recusa duas peças no mesmo slot, e trocar A por B esbarraria nele se B entrasse antes de A
 * sair.
 *
 * Escopado por dono: um extrato com o id de um item alheio não move nada, porque a consulta que
 * decide o que existe é a das instâncias DESTE personagem.
 */
async function applyEquipment(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  characterId: string,
  equipment: Readonly<Record<string, string>>,
): Promise<void> {
  const wanted = new Map(Object.entries(equipment).map(([slot, id]) => [id, slot]));
  const owned = await tx
    .select({ id: itemInstances.id, equippedSlot: itemInstances.equippedSlot })
    .from(itemInstances)
    .where(eq(itemInstances.ownerCharacterId, characterId));

  for (const row of owned) {
    if (row.equippedSlot === null || wanted.get(row.id) === row.equippedSlot) continue;
    await tx.update(itemInstances).set({ equippedSlot: null }).where(eq(itemInstances.id, row.id));
  }
  for (const row of owned) {
    const slot = wanted.get(row.id);
    if (slot === undefined || slot === row.equippedSlot) continue;
    await tx.update(itemInstances).set({ equippedSlot: slot }).where(eq(itemInstances.id, row.id));
  }
}
