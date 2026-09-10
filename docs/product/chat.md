# Chat

**Status:** parcial — canal `local` implementado (FUN-58); `party`, `guild` e canal global não existem
**PRD:** não há seção de chat. O documento não cobre canais, e isso é informação: o desenho aqui é nosso.
**Épico:** E1 (sessão e visualizador). Chat é apresentação, não simulação.
**Referência técnica:** ADR 0004 (Cidade como protect zone) — é onde o chat importa.

## Comportamento

O cliente manda `say { channel, text }`; o servidor decide quem recebe e devolve `chat-message
{ channel, author, text }` a cada visualizador da **mesma sessão**, o autor inclusive — duas abas
do mesmo personagem recebem as duas, e a que falou também: é o eco que confirma que a mensagem
saiu. Quem está em outra sessão nunca recebe.

O chat **não passa pelo `sim`**: não muda resultado de simulação nenhuma, e pôr texto de jogador
dentro do motor puro só criaria estado para snapshotar sem motivo. O `SessionHost` roteia direto.
Nada é persistido: mensagem de chat que sobrevive a uma retomada de seis horas é notificação, não
conversa.

## Canais

| Canal | Quem recebe | Estado |
| -- | -- | -- |
| `local` | quem está na **mesma sessão** — 1–4 pessoas numa hunt; todos os da sessão na Cidade | implementado |
| `party` | — | não existe: party não existe. O canal não nasce antes do grupo |
| `guild` | — | não existe: guilda existe no PRD e não no código |
| global | — | não existe: é decisão de produto sobre o que a Cidade é |

Canal desconhecido é **recusado no servidor**, não no schema do protocolo, que segue `string` livre
dos dois lados. Enum no protocolo fixaria a lista e obrigaria a mexer nele para cada canal novo;
reavaliar quando houver o terceiro canal.

## Regras

- O alcance é a **sessão inteira**, não raio em tiles. Interest management é a FUN-33, e inventar
  raio agora seria decidir duas vezes. Na Cidade isso passou a significar a praça inteira só na
  FUN-71: antes dela cada personagem tinha a própria cópia da Cidade, e "sessão inteira" era uma
  pessoa. Ver [`city.md`](./city.md).
- Toda recusa é **silenciosa**: canal desconhecido, texto vazio ou só espaço, texto com caractere
  de controle (`\p{C}` — zero-width e bidi override falsificam o nome do autor na tela). Um cliente
  com bug mandando em laço não pode gerar tráfego de volta. Texto acima de 255 já é recusado pelo
  protocolo antes de chegar.
- O `author` é o **nome do personagem vindo do banco**, pelo ticket (FUN-12) — o cliente não
  escolhe como aparece para os outros. Ticket emitido por um `api` anterior à FUN-58 não traz
  nome, e o host assina com o id: degradação durante deploy em rolagem, não perda.
- Personagem morto fala. Morrer não emudece — o ADR 0004 só proíbe combate na Cidade.
- A mensagem sai **no lote do ciclo**, nunca furando a fila: 100 ms de atraso é invisível, e
  passar na frente poria o chat antes de deltas que já esperavam.
- `authenticate` e `client-ready` chegam pelo mesmo socket e são **ignoradas de propósito**, com
  `case` explícito: a autenticação é do handshake, e aceitar credencial pelo socket seria um
  segundo caminho de autenticação. `client-ready` não tem consumidor.

## Parâmetros de balanceamento

Nenhum. Não há número de chat em `packages/content`.

## Em aberto

- [ABERTO] Histórico, moderação, silenciamento e filtro de palavra — tudo produto, sem PRD.
- [ABERTO] Canais `party` e `guild`, quando os grupos existirem.
- [ABERTO] Canal global — depende de decidir o que a Cidade é (FUN-33).

## Divergências do PRD

Nenhuma: o PRD não especifica chat.
