#!/usr/bin/env bash
# Hook PreToolUse (matcher "Bash") do Claude Code.
#
# Recebe no stdin o JSON do evento de hook e le tool_input.command. Se o comando for um
# `git commit` com mensagem inline (-m ou --message), valida o formato contra o padrao do
# projeto (docs/harness-plan.md secao 4.1, CLAUDE.md):
#
#   <tipo>(<escopo>): <descricao no imperativo> (#nn)
#
#   tipo:   feat | fix | refactor | perf | docs | test | chore
#   escopo: sim | protocol | content | server | client | tools | docs | deps
#
# (#nn) e obrigatorio, exceto para tipo chore ou docs -- nn e a issue do GitHub. (FUN-nn), a issue
# do Linear, continua aceito so para branch aberta antes de 2026-09-12; trabalho novo nao usa.
#
# Contrato do hook: exit 0 deixa a chamada passar; exit 2 bloqueia a chamada e devolve o
# stderr para o modelo. Na duvida -- JSON que nao parseia, comando que nao e git commit,
# mensagem que nao conseguimos extrair com confianca -- o script deixa passar. O objetivo e
# travar commit fora do padrao, nunca travar o agente por um caso que este script nao soube
# interpretar. Quem pega o que escapar daqui e o hook de verdade do git:
# .githooks/commit-msg (precisa de `git config core.hooksPath .githooks` para valer).
#
# Limitacoes conhecidas, aceitas de proposito:
# - `git commit` e `-m`/`--message` precisam estar na mesma linha fisica. Um comando que
#   quebra os dois com `\` de continuacao de linha nao e reconhecido. Corrigir isso juntando
#   linhas continuadas antes do scan corromperia corpo de heredoc que termine uma linha em
#   `\` de proposito -- preferimos a lacuna ao dano.
# - So o primeiro `-m`/`--message` do comando e considerado (e o que o git usa como assunto).
# - A deteccao de merge em andamento olha o repositorio de `cwd` (o diretorio da sessao), nao
#   um `cd` embutido no proprio comando. Um `cd outro-repo && git commit` durante um merge la
#   dentro seria validado como commit normal. Fica de fora pelo mesmo motivo do item acima:
#   interpretar o `cd` exigiria simular o shell, e quem pega o que escapa daqui e o
#   .githooks/commit-msg, que roda dentro do repositorio certo por definicao.

set -u

TYPES='feat|fix|refactor|perf|docs|test|chore'
SCOPES='sim|protocol|content|server|client|tools|docs|deps'

fail() {
  cat >&2 <<MSG
commit rejected by hook validate-commit: $1

expected format:
  <type>(<scope>): <imperative description in English> (#nn)

  type:   feat | fix | refactor | perf | docs | test | chore
  scope: sim | protocol | content | server | client | tools | docs | deps

(#nn) -- the GitHub issue -- is required except for chore and docs commits.
(FUN-nn) is only accepted for branches opened before the move to GitHub issues.
example: feat(sim): advance simulation using elapsed time (#150)
MSG
  exit 2
}

# --- 1. ler o input do hook -----------------------------------------------------------
input="$(cat)"
[ -n "$input" ] || exit 0

# --- 2. extrair tool_input.command ------------------------------------------------------
command=""
session_dir=""
if command -v jq >/dev/null 2>&1; then
  command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  # Diretorio da sessao, usado so para achar o repositorio na checagem de merge abaixo. Sem
  # jq ele fica vazio e a checagem cai no cwd do proprio processo, que e o mesmo diretorio.
  session_dir="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
else
  # fallback sem jq: pega o valor bruto de "command" respeitando aspas escapadas dentro da
  # string JSON, depois desfaz o escaping. Best-effort -- se nao achar nada com confianca,
  # comando fica vazio e o passo seguinte deixa passar.
  raw="$(printf '%s' "$input" | tr -d '\n' | sed -n -E 's/.*"command"[[:space:]]*:[[:space:]]*"((\\.|[^"\\])*)".*/\1/p')"
  if [ -n "$raw" ]; then
    raw="${raw//\\\"/\"}"
    raw="${raw//\\n/$'\n'}"
    raw="${raw//\\t/$'\t'}"
    raw="${raw//\\\\/\\}"
    command="$raw"
  fi
fi

[ -n "$command" ] || exit 0

# filtro barato: se "git" nem aparece, nem vale montar o loop linha a linha abaixo.
printf '%s' "$command" | grep -q 'git' || exit 0

# --- 3. varredura linha a linha, ciente de heredoc alheio -------------------------------
# Um comando pode legitimamente conter, dentro de um heredoc que nao tem nada a ver com
# commit (por exemplo escrevendo um arquivo de exemplo ou um script de teste), um trecho de
# texto que parece um `git commit -m ...`. Sem rastrear heredoc, isso vira falso positivo:
# o hook bloquearia uma chamada Bash que so estava *escrevendo texto*, nunca commitando.
# Por isso o scan pula o corpo inteiro de qualquer heredoc que nao seja o da propria
# mensagem do commit.
pat_sq="<<-?~?[[:space:]]*'([A-Za-z_][A-Za-z0-9_]*)'"
pat_dq='<<-?~?[[:space:]]*"([A-Za-z_][A-Za-z0-9_]*)"'
pat_bare='<<-?~?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*$'

is_commit_line() {
  # "verdadeiro" se a linha tem `git commit` E `-m`/`--message`.
  printf '%s' "$1" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit([[:space:]]|$)' || return 1
  printf '%s' "$1" | grep -Eq -- '(^|[[:space:]])(-m|--message)([[:space:]=]|$)'
}

opens_heredoc() {
  # se a linha abre um heredoc, ecoa o delimitador e retorna 0.
  local line="$1"
  if [[ "$line" =~ $pat_sq ]] || [[ "$line" =~ $pat_dq ]] || [[ "$line" =~ $pat_bare ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

in_other_heredoc=0
other_delim=""
in_msg_heredoc=0
msg_delim=""
commit_line=""
subject=""

while IFS= read -r line; do
  if [ "$in_msg_heredoc" -eq 1 ]; then
    if [ "$line" = "$msg_delim" ]; then
      break
    fi
    if [ -z "$subject" ] && [ -n "${line//[[:space:]]/}" ]; then
      subject="$line"
      break
    fi
    continue
  fi

  if [ "$in_other_heredoc" -eq 1 ]; then
    [ "$line" = "$other_delim" ] && in_other_heredoc=0
    continue
  fi

  if [ -z "$commit_line" ] && is_commit_line "$line"; then
    commit_line="$line"
    if d="$(opens_heredoc "$line")"; then
      msg_delim="$d"
      in_msg_heredoc=1
      continue
    fi
    break
  fi

  if d="$(opens_heredoc "$line")"; then
    other_delim="$d"
    in_other_heredoc=1
  fi
done <<< "$command"

# nenhuma linha "de verdade" (fora de heredoc alheio) tinha git commit + -m/--message
[ -n "$commit_line" ] || exit 0

# --- 3.5 commit de merge e isento -------------------------------------------------------
# Mesma regra do .githooks/commit-msg, pelo mesmo motivo: merge nao descreve uma mudanca,
# descreve uma juncao, e o assunto que o git gera ("Merge branch 'x' into y") nunca bate no
# formato. Detectamos por MERGE_HEAD, que so existe entre o inicio de um merge e o commit
# que o conclui -- e nao pelo prefixo "Merge " do assunto, que qualquer commit normal pode
# ter. O unico commit criado com MERGE_HEAD presente e o proprio merge.
#
# A checagem so roda depois de confirmarmos que a chamada e um `git commit`: nao vale pagar
# um processo de git em toda chamada Bash da sessao.
if [ -n "$session_dir" ]; then
  git -C "$session_dir" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && exit 0
else
  git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && exit 0
fi

# --- 4. extrair a primeira linha da mensagem, se ainda nao veio do heredoc --------------
if [ -n "$subject" ]; then
  subject="$(printf '%s' "$subject" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
fi

# sem heredoc: valor de -m/--message entre aspas duplas, na propria commit_line
if [ -z "$subject" ]; then
  raw="$(printf '%s\n' "$commit_line" | grep -Eo -- '(^|[[:space:]])(-m|--message)[[:space:]=]+"([^"\\]|\\.)*"' | head -n1)"
  if [ -n "$raw" ]; then
    raw="${raw#*\"}"
    raw="${raw%\"}"
    raw="${raw//\\\"/\"}"
    raw="${raw//\\\\/\\}"
    subject="$raw"
  fi
fi

# sem heredoc: valor de -m/--message entre aspas simples
if [ -z "$subject" ]; then
  raw="$(printf '%s\n' "$commit_line" | grep -Eo -- "(^|[[:space:]])(-m|--message)[[:space:]=]+'[^']*'" | head -n1)"
  if [ -n "$raw" ]; then
    raw="${raw#*\'}"
    raw="${raw%\'}"
    subject="$raw"
  fi
fi

[ -n "$subject" ] || exit 0   # nao conseguimos extrair com confianca -> deixa passar

subject="$(printf '%s' "$subject" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
[ -n "$subject" ] || exit 0

# --- 5. validar contra o padrao ----------------------------------------------------------
if [[ "$subject" =~ ^([A-Za-z0-9_-]+)\(([A-Za-z0-9_-]+)\):[[:space:]]*(.*)$ ]]; then
  type="${BASH_REMATCH[1]}"
  scope="${BASH_REMATCH[2]}"
  remainder="${BASH_REMATCH[3]}"
else
  fail "\"$subject\" does not match <type>(<scope>): <description> (#nn)"
fi

if [[ ! "$type" =~ ^($TYPES)$ ]]; then
  fail "type \"$type\" is invalid in \"$subject\" -- use one of: feat, fix, refactor, perf, docs, test, chore"
fi

if [[ ! "$scope" =~ ^($SCOPES)$ ]]; then
  fail "scope \"$scope\" is invalid in \"$subject\" -- use one of: sim, protocol, content, server, client, tools, docs, deps"
fi

description="$remainder"
has_issue=0
if [[ "$remainder" =~ ^(.*[^[:space:]])[[:space:]]+\((#[0-9]+|FUN-[0-9]+)\)[[:space:]]*$ ]]; then
  has_issue=1
  description="${BASH_REMATCH[1]}"
fi

if [ -z "$description" ]; then
  fail "empty description in \"$subject\""
fi

if [[ "$type" != "chore" && "$type" != "docs" && "$has_issue" -eq 0 ]]; then
  fail "missing (#nn) in \"$subject\" -- required for type '$type' (only chore and docs are exempt)"
fi

exit 0
