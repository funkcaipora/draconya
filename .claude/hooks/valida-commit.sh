#!/usr/bin/env bash
# Hook PreToolUse (matcher "Bash") do Claude Code.
#
# Recebe no stdin o JSON do evento de hook e le tool_input.command. Se o comando for um
# `git commit` com mensagem inline (-m ou --message), valida o formato contra o padrao do
# projeto (docs/plano-harness.md secao 4.1, CLAUDE.md):
#
#   <tipo>(<escopo>): <descricao no imperativo> (FUN-nn)
#
#   tipo:   feat | fix | refactor | perf | docs | test | chore
#   escopo: sim | protocol | content | server | client | tools | docs
#
# (FUN-nn) e obrigatorio, exceto para tipo chore ou docs.
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

set -u

TIPOS='feat|fix|refactor|perf|docs|test|chore'
ESCOPOS='sim|protocol|content|server|client|tools|docs'

falha() {
  cat >&2 <<MSG
commit rejeitado pelo hook valida-commit: $1

formato esperado:
  <tipo>(<escopo>): <descricao no imperativo> (FUN-nn)

  tipo:   feat | fix | refactor | perf | docs | test | chore
  escopo: sim | protocol | content | server | client | tools | docs

(FUN-nn) e obrigatorio, exceto para tipo chore ou docs.
exemplo: feat(sim): tick por dtMs em vez de contador (FUN-25)
MSG
  exit 2
}

# --- 1. ler o input do hook -----------------------------------------------------------
input="$(cat)"
[ -n "$input" ] || exit 0

# --- 2. extrair tool_input.command ------------------------------------------------------
comando=""
if command -v jq >/dev/null 2>&1; then
  comando="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  # fallback sem jq: pega o valor bruto de "command" respeitando aspas escapadas dentro da
  # string JSON, depois desfaz o escaping. Best-effort -- se nao achar nada com confianca,
  # comando fica vazio e o passo seguinte deixa passar.
  bruto="$(printf '%s' "$input" | tr -d '\n' | sed -n -E 's/.*"command"[[:space:]]*:[[:space:]]*"((\\.|[^"\\])*)".*/\1/p')"
  if [ -n "$bruto" ]; then
    bruto="${bruto//\\\"/\"}"
    bruto="${bruto//\\n/$'\n'}"
    bruto="${bruto//\\t/$'\t'}"
    bruto="${bruto//\\\\/\\}"
    comando="$bruto"
  fi
fi

[ -n "$comando" ] || exit 0

# filtro barato: se "git" nem aparece, nem vale montar o loop linha a linha abaixo.
printf '%s' "$comando" | grep -q 'git' || exit 0

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

eh_linha_de_commit() {
  # "verdadeiro" se a linha tem `git commit` E `-m`/`--message`.
  printf '%s' "$1" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit([[:space:]]|$)' || return 1
  printf '%s' "$1" | grep -Eq -- '(^|[[:space:]])(-m|--message)([[:space:]=]|$)'
}

abre_heredoc() {
  # se a linha abre um heredoc, ecoa o delimitador e retorna 0.
  local linha="$1"
  if [[ "$linha" =~ $pat_sq ]] || [[ "$linha" =~ $pat_dq ]] || [[ "$linha" =~ $pat_bare ]]; then
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
assunto=""

while IFS= read -r linha; do
  if [ "$in_msg_heredoc" -eq 1 ]; then
    if [ "$linha" = "$msg_delim" ]; then
      break
    fi
    if [ -z "$assunto" ] && [ -n "${linha//[[:space:]]/}" ]; then
      assunto="$linha"
      break
    fi
    continue
  fi

  if [ "$in_other_heredoc" -eq 1 ]; then
    [ "$linha" = "$other_delim" ] && in_other_heredoc=0
    continue
  fi

  if [ -z "$commit_line" ] && eh_linha_de_commit "$linha"; then
    commit_line="$linha"
    if d="$(abre_heredoc "$linha")"; then
      msg_delim="$d"
      in_msg_heredoc=1
      continue
    fi
    break
  fi

  if d="$(abre_heredoc "$linha")"; then
    other_delim="$d"
    in_other_heredoc=1
  fi
done <<< "$comando"

# nenhuma linha "de verdade" (fora de heredoc alheio) tinha git commit + -m/--message
[ -n "$commit_line" ] || exit 0

# --- 4. extrair a primeira linha da mensagem, se ainda nao veio do heredoc --------------
if [ -n "$assunto" ]; then
  assunto="$(printf '%s' "$assunto" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
fi

# sem heredoc: valor de -m/--message entre aspas duplas, na propria commit_line
if [ -z "$assunto" ]; then
  bruto="$(printf '%s\n' "$commit_line" | grep -Eo -- '(^|[[:space:]])(-m|--message)[[:space:]=]+"([^"\\]|\\.)*"' | head -n1)"
  if [ -n "$bruto" ]; then
    bruto="${bruto#*\"}"
    bruto="${bruto%\"}"
    bruto="${bruto//\\\"/\"}"
    bruto="${bruto//\\\\/\\}"
    assunto="$bruto"
  fi
fi

# sem heredoc: valor de -m/--message entre aspas simples
if [ -z "$assunto" ]; then
  bruto="$(printf '%s\n' "$commit_line" | grep -Eo -- "(^|[[:space:]])(-m|--message)[[:space:]=]+'[^']*'" | head -n1)"
  if [ -n "$bruto" ]; then
    bruto="${bruto#*\'}"
    bruto="${bruto%\'}"
    assunto="$bruto"
  fi
fi

[ -n "$assunto" ] || exit 0   # nao conseguimos extrair com confianca -> deixa passar

assunto="$(printf '%s' "$assunto" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
[ -n "$assunto" ] || exit 0

# --- 5. validar contra o padrao ----------------------------------------------------------
if [[ "$assunto" =~ ^([A-Za-z0-9_-]+)\(([A-Za-z0-9_-]+)\):[[:space:]]*(.*)$ ]]; then
  tipo="${BASH_REMATCH[1]}"
  escopo="${BASH_REMATCH[2]}"
  resto="${BASH_REMATCH[3]}"
else
  falha "\"$assunto\" nao segue <tipo>(<escopo>): <descricao> (FUN-nn)"
fi

if [[ ! "$tipo" =~ ^($TIPOS)$ ]]; then
  falha "tipo \"$tipo\" invalido em \"$assunto\" -- use um de: feat, fix, refactor, perf, docs, test, chore"
fi

if [[ ! "$escopo" =~ ^($ESCOPOS)$ ]]; then
  falha "escopo \"$escopo\" invalido em \"$assunto\" -- use um de: sim, protocol, content, server, client, tools, docs"
fi

descricao="$resto"
tem_fun=0
if [[ "$resto" =~ ^(.*[^[:space:]])[[:space:]]+\(FUN-[0-9]+\)[[:space:]]*$ ]]; then
  tem_fun=1
  descricao="${BASH_REMATCH[1]}"
fi

if [ -z "$descricao" ]; then
  falha "descricao vazia em \"$assunto\""
fi

if [[ "$tipo" != "chore" && "$tipo" != "docs" && "$tem_fun" -eq 0 ]]; then
  falha "faltando (FUN-nn) em \"$assunto\" -- obrigatorio para tipo '$tipo' (so chore e docs dispensam)"
fi

exit 0
