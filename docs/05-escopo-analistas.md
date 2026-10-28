# Escopo dos analistas (clientes e áreas)

Data: 2026-10-28 · Pedido do usuário antes da Fase 4: "tenho analista locado em cliente que só atende ele".

## Como funciona

Cada pessoa da equipe tem dois ajustes, em **Equipe → editar**:

| Ajuste | Opções |
|---|---|
| Clientes que atende | **Todos os clientes** · **Só os selecionados** (lista) |
| Áreas | **Todas as áreas** · **Só as selecionadas** (lista) |

**O analista vê** os chamados atribuídos a ele e os que caem ao mesmo tempo **num cliente e numa área que ele
atende**. Exemplos:

- **Alocado na Tury**: clientes "só os selecionados" (Tury) e áreas "todas". Vê tudo da Tury, inclusive os chamados
  novos ainda sem área, e nada dos outros clientes.
- **Especialista Protheus da OCP**: clientes "todos" e áreas "Protheus". Vê os chamados de Protheus de qualquer
  cliente, depois que recebem a área.

O administrador vê tudo, e esses ajustes não se aplicam a ele. As pessoas que já existiam continuam como estavam:
todos os clientes, com as áreas que tinham.

## Onde o escopo vale
- **Filas e chamados**: o analista só abre o que está no escopo.
- **Filtro de clientes** da fila e **"abrir chamado em nome do cliente"**: só os clientes dele.
- **Lançar horas e assumir**: só em chamados que ele vê.
- **Distribuição**: a lista de responsáveis de um chamado só mostra quem atende aquele cliente, e o servidor recusa
  outro nome ("Esse analista não atende este cliente").
- **Avisos**: o analista alocado recebe o e-mail de **chamado novo** do cliente dele e o aviso de **prazo vencendo**
  quando o chamado ainda não tem responsável.
- **Triagem**:
  - o assistente só pode sugerir quem atende o cliente;
  - **se houver analista alocado no cliente que atenda a área, a sugestão é ele**. Essa regra está no código, não
    depende do modelo.
- **Página do cliente**: mostra "Analista(s) alocado(s) neste cliente".

## Mudança na triagem (descoberta nos testes)

Num cliente **sem sistemas cadastrados**, o modelo travava emitindo espaços até estourar o limite, e a triagem
falhava:
- a causa era a decodificação guiada pelo esquema JSON: quando a gramática não deixa o modelo escrever o que ele
  quer (`null`, um número), ele "foge" para espaços em branco;
- a opção do vLLM que proíbe esses espaços (`disable_any_whitespace`) só existe para o servidor inteiro, o que
  exigiria reiniciar o vLLM do Hermes. Por requisição ela não é respeitada (testado).

**Solução**: o modelo passou a escrever o JSON livremente, guiado só pelo prompt, e **o código confere tudo** antes de
usar (`validarFicha`):
- ids só valem se estiverem na lista permitida (áreas, quem atende o cliente, sistemas do cliente, chamados parecidos
  mostrados); fora disso, são descartados;
- tipo, impacto e prioridade fora das opções voltam aos valores do chamado;
- textos e listas têm tamanho máximo;
- resposta cortada ou ilegível: uma nova tentativa na hora; depois disso, as 3 tentativas da fila e, por fim, o
  chamado segue para a equipe sem ficha.

Resultado: a triagem desses chamados caiu de ~35 s (com travamentos) para ~9 s, sem falhas. A garantia de segurança
se mantém: nada que o modelo escreve é usado sem passar pela conferência do código.

## Testes
- Suíte de escopo: visibilidade, filas, filtro, abrir em nome do cliente, distribuição recusada, assumir e horas fora
  do escopo, avisos, mudança de escopo, e triagem (alocado sugerido na Tury, nunca na Dapp).
- As suítes das fases 1, 2 e 3 rodadas de novo.
