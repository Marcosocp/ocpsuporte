# Fase 3 — Prazos e horas

Data: 2026-10-28 · Status: **concluída, aguardando aprovação para a Fase 4 (produção em suporte.ocp.com.br)**

## Prazos de atendimento (SLA)

- **Horário útil**: segunda a sexta, 08h–18h (Brasília), sem feriados. **1 dia útil = 10 h.**
- **Prazos padrão** (1ª resposta / solução):

  | Prioridade | 1ª resposta | Solução |
  |---|---|---|
  | Crítica | 1 h | 4 h |
  | Alta | 4 h | 1 dia |
  | Normal | 1 dia | 3 dias |
  | Baixa | 2 dias | 5 dias |

  Ficam em **Configurações**. Um cliente pode ter prazos próprios para qualquer prioridade (na página dele); as
  prioridades que ficam em branco usam o padrão.
- **Quando conta:**
  - o prazo começa quando o chamado **chega à equipe**, ou seja, depois da triagem (o tempo que o cliente leva
    respondendo ao assistente não conta);
  - **1ª resposta**: até a primeira resposta da equipe ao cliente;
  - **solução**: até "resolvido". Fica **pausado** enquanto se espera o cliente ("aguardando cliente" ou "resolvido"
    aguardando confirmação). Quando o cliente responde, o prazo é empurrado pelo tempo útil da pausa. Se o cliente
    reabrir, o prazo volta a correr de onde parou.
  - mudar a prioridade recalcula os prazos na hora.
- **Feriados**: os nacionais de 2026 a 2028 já vêm cadastrados, incluindo Carnaval, que é ponto facultativo; dá para
  tirar. Feriados estaduais, municipais e emendas se acrescentam em Configurações. Mudar os prazos ou os feriados
  recalcula todos os chamados abertos.
- **No painel:**
  - a fila tem a coluna **Prazo** ("vence em 2h30", ⏰ perto de vencer, ⛔ atrasado, ⏸ pausado);
  - a fila fica **ordenada pelo que vence primeiro**;
  - há uma aba nova, **"Prazo estourado"**;
  - o chamado mostra os dois prazos, com data e hora, e se foram cumpridos.
- **Avisos por e-mail** (verificação a cada 5 minutos, um aviso por prazo):
  - **⏰ vencendo** (quando falta 25% do prazo, no máximo 1 h útil): vai para o responsável, ou para os
    administradores se ninguém assumiu;
  - **⛔ estourado**: vai para o responsável **e** para os administradores (escalonamento).
- **O cliente não vê prazos.**

## Horas trabalhadas

- No chamado, a equipe lança **data, horas, minutos e o que foi feito**.
  - Não aceita data futura. O analista lança até 60 dias para trás; o administrador, qualquer data passada.
  - Só o administrador pode marcar um lançamento como "não conta no pacote" (retrabalho, cortesia).
  - Quem lançou remove o próprio lançamento dentro do mesmo mês; o administrador remove qualquer um.
- **Consumo do pacote**: horas faturáveis do mês contra o contrato vigente. As horas **zeram todo mês**. A página do
  cliente mostra o mês atual, com uma barra de consumo.
- **Avisos aos administradores**: quando o consumo chega a **80%** e a **100%** do pacote (uma vez por mês cada).
- **Relatório (menu Horas)**:
  - por mês: pacote, usadas, saldo, **excedente e valor do excedente** (hora excedente do contrato);
  - por cliente: lançamentos agrupados por chamado, com **"Imprimir / salvar PDF"** e **"Baixar planilha (CSV)"**.
    A planilha abre direto no Excel; um assunto que comece com "=" não vira fórmula.
- **O cliente nunca vê horas.** Quando pedir, o relatório em PDF é enviado a ele.
- O relatório e as configurações são só do administrador. O analista lança horas, mas não vê o relatório.

## Técnica
- `src/expediente.ts`: calendário útil (funções puras, com teste unitário de 15 casos).
- `src/prazos.ts`:
  - `aposMudanca()` é chamado depois de toda mudança no chamado: abre/fecha pausas, marca o início e recalcula;
  - avisos e escalonamento;
  - o que as telas mostram.
- `src/horas.ts`: lançamentos, consumo, alertas, relatório e CSV.
- Migração `004-prazos-horas.sql`: `prazos_padrao`, `prazos_cliente`, `feriados`, `chamado_pausas`, `apontamentos`,
  `alertas_horas` e os campos de prazo no chamado.

## Testes (instância isolada)

Suíte de 49 verificações, **todas aprovadas**. As suítes das fases 1 (63) e 2 (45, modelo real) seguem aprovadas.
Os prazos são conferidos com um **contador independente, minuto a minuto**, movendo as datas no banco de teste:
- início numa sexta 17h + 1 dia útil, com Finados na segunda → terça 17h;
- prioridades (normal 1 dia / 3 dias, crítica 1 h / 4 h) e troca de prioridade;
- pausa de 2 h úteis empurra a solução em 2 h e não mexe na 1ª resposta;
- aviso de "vencendo" uma vez, só para o responsável; estouro uma vez, para responsável + administrador;
- aba de atrasados e ordem da fila;
- prazos próprios do cliente e recálculo ao mudar prazo padrão ou incluir feriado;
- horas: totais, avisos de 80% e 100% uma vez cada, excedente de 0:45 = R$ 112,50, lançamento fora do pacote,
  validações, permissões, CSV (BOM e fórmula neutralizada);
- o cliente não vê prazos, horas nem lançamentos.

## Pendências
- Valor da hora excedente: cadastrar no contrato de cada cliente (Clientes → Contrato).
- Tempo mínimo por chamado: não adotado (conta só o tempo lançado). Dá para incluir se for regra dos contratos.
