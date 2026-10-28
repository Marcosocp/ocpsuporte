# OCP Suporte — Plano do projeto

Data: 2026-10-28 · Status: **Fases 1 a 3 concluídas; Fase 4 em andamento (código pronto, falta configurar a Cloudflare — ver 07-fase4-producao.md)**

## 1. Objetivo

Portal de chamados de suporte de TI da OCP para os clientes, em `suporte.ocp.com.br`.
O cliente abre o chamado pelo portal, pelo WhatsApp ou por e-mail. Uma IA local faz a **triagem**:
- entende o pedido;
- pergunta só o que falta;
- monta uma **ficha técnica** pronta para o atendimento.

A IA **nunca executa nada**: só pergunta, organiza e sugere. Quem decide e atua é a equipe da OCP.
O administrador (Marcos) distribui o chamado para um analista ou fica com ele. Os analistas também podem ser
acionados pelo WhatsApp.

## 2. Decisões já tomadas

| Item | Decisão |
|---|---|
| Construção | Sistema próprio, reaproveitando a base do OCPSign (não Zammad/GLPI) |
| Endereço | `suporte.ocp.com.br`, no ZGX, publicado pelo **Cloudflare Tunnel** (igual ao `assina`) |
| Escopo | Tudo de TI: Protheus, portais, infraestrutura, desenvolvimento, dúvidas, melhorias |
| Departamentos | **Dos dois lados**: do cliente (Financeiro, Logística, Estoque…) e áreas de atendimento da OCP |
| Analistas | Fora da rede da OCP; painel atrás do **Cloudflare Access** (ver 6.2) |
| Contratos | Pacote mensal de horas por cliente (ex.: 100 h, 80 h/mês). Horas não usadas **zeram** no mês seguinte. O **cliente não vê horas** no portal; quando pedir, a OCP gera um relatório |
| Horário de atendimento | Segunda a sexta, 08h às 18h (os prazos só contam nesse horário) |
| Prazos padrão | Crítica 1 h/4 h · Alta 4 h/1 dia · Normal 1 dia/3 dias · Baixa 2 dias/5 dias (1ª resposta/solução, em horário útil) |
| IA | **Modelo local** no ZGX (o vLLM do Hermes); dados dos clientes não saem da OCP |
| WhatsApp | Número único de atendimento, **API oficial da Meta** (WhatsApp Cloud API) |
| Clientes iniciais | Dapp e Tury (cadastrados à mão; sem importação) |
| Pasta / repositório | `~/ocpsuporte`, repositório privado `Marcosocp/ocpsuporte` |

## 3. Perfis

| Perfil | Lado | Pode |
|---|---|---|
| Administrador | OCP | Tudo: cadastros, contratos, distribuição, relatórios, configuração da IA |
| Analista | OCP | Atender chamados da sua fila ou atribuídos a ele, notas internas, apontar horas |
| Gestor do cliente | Cliente | Ver todos os chamados da empresa, cadastrar usuários e departamentos |
| Usuário do cliente | Cliente | Abrir e acompanhar os próprios chamados (opcional: os do seu departamento) |

**Isolamento entre clientes é regra de segurança.** Toda consulta filtra pelo cliente da sessão. Um cliente
nunca vê dados de outro, e há testes automáticos disso em todas as fases.

## 4. Cadastros

- **Cliente**: razão social, CNPJ, situação, observações internas.
- **Contrato**:
  - horas por mês e vigência;
  - prazos (SLA) por prioridade;
  - regra de horas excedentes (valor/hora) e se o saldo acumula.
- **Departamentos do cliente**: Financeiro, Logística, Estoque…
- **Usuários do cliente**: nome, e-mail, celular (WhatsApp), departamento(s), perfil.
- **Sistemas e ambientes do cliente**, o "mapa" que a IA consulta. Exemplos:
  - *Protheus*: acesso pelo Workspace, ambientes de produção e homologação, módulos usados;
  - *Portal X*: endereço `https://…`, quem usa;
  - servidores, e-mail, rede, impressoras…

  **Nunca guarda senha**, só como se acessa. Cada departamento indica os sistemas que usa. Assim, quando
  alguém do Estoque abre um chamado sobre "o portal", a IA já sabe qual é e pergunta as coisas certas.
- **Áreas da OCP**: Protheus, Portais/Desenvolvimento, Infraestrutura, Geral… e os analistas de cada uma.

## 5. Ciclo do chamado

```
em triagem → aguardando distribuição → atribuído → em atendimento ⇄ aguardando cliente → resolvido → fechado
                                                                                           ↘ reaberto
```

- **Em triagem**: a IA conversa com o cliente.
  - Ela faz no máximo 3 rodadas de perguntas, e o cliente pode "enviar assim mesmo" a qualquer momento.
  - Se a IA estiver fora do ar, o chamado segue direto para distribuição; **o cliente nunca fica travado**.
- **Aguardando cliente**: pausa a contagem do prazo.
- **Resolvido**: o cliente confirma ou o chamado fecha sozinho em X dias. Se o cliente responder, o chamado
  reabre.
- Toda mudança fica no histórico (quem, quando, de onde).

## 6. Componentes

### 6.1 Portal do cliente (internet, `suporte.ocp.com.br`)
- Login com e-mail e senha, **verificação em duas etapas** (código por e-mail; app autenticador opcional),
  limite de tentativas e recuperação de senha.
- Abrir chamado (texto, prints, anexos), conversar com a IA e acompanhar a situação.
- Responder ao chamado e avaliar o atendimento.
- O gestor do cliente vê os chamados da empresa. **Horas não aparecem no portal.**

### 6.2 Painel da OCP (analistas e administrador)
- **Fila de distribuição**: chamados triados com a sugestão da IA (área, analista, prioridade). O administrador
  aceita ou muda com um clique.
- **Minha fila / quadro**: por situação e prazo, com destaque para o que está perto de estourar.
- **Tela do chamado**: ficha técnica da IA no topo, conversa com o cliente, **notas internas** (o cliente não
  vê), chamados parecidos, apontamento de horas e histórico.
- **Acesso**: analistas fora da rede. Duas opções, a decidir:
  - **Cloudflare Access (decidido)**: o painel fica atrás de uma política da Cloudflare (gratuita até 50
    pessoas) que libera só e-mails autorizados, com código por e-mail. Somam-se o login do sistema e a
    verificação em duas etapas. O analista não instala nada e não entra na rede do ZGX.
  - **Tailscale**: cada analista entra na tailnet. Isso **exige configurar ACLs antes**, para que ele
    alcance só a porta do painel e não o Hermes, o SSH ou o OCPSign.

### 6.3 IA de triagem (modelo local)
- Usa o vLLM do Hermes (`Qwen3.6-35B-A3B`) por uma rede Docker dedicada, só entre o app e o vLLM.
- Roda **em fila**, um chamado de cada vez, para não disputar a GPU com o Hermes. O cliente vê "analisando…" e
  depois as perguntas.
- **Roteiros por tipo**, editáveis no painel:

  | Tipo | O que a IA levanta |
  |---|---|
  | Erro / incidente | Mensagem exata, print, passos para repetir, desde quando, afeta quem, ambiente |
  | Dúvida | O que quer fazer, onde está travado |
  | Solicitação | Acesso, cadastro, instalação: o que, para quem, até quando |
  | Melhoria | Objetivo, como é hoje, como deveria ser, quem usa, exemplo |

- **Saída da triagem**, em JSON validado e gravado com a versão do modelo:
  - tipo, sistema e ambiente, impacto (pessoa/setor/empresa) e prioridade sugerida;
  - resumo e passos para reproduzir;
  - hipótese de causa e próximos passos sugeridos;
  - área e analista sugeridos;
  - chamados parecidos (busca textual no histórico; busca semântica depois).
- **Segurança**: o texto do cliente é tratado como dado, nunca como instrução. A IA não tem nenhuma ferramenta
  que altere algo, e o que ela devolve é conferido contra os cadastros (ex.: só sugere analistas que existem).
- **Prints**: testar na Fase 2 se o modelo lê imagem; se não, extrair o texto com OCR.
- **Áudio do WhatsApp**: transcrição local, reaproveitando a voz do Hermes.

### 6.4 WhatsApp (número único)
- WhatsApp Cloud API oficial. **Não** usar sessão não oficial (risco de banir o número).
- Cliente:
  - um número cadastrado é reconhecido; um desconhecido informa o e-mail e confirma com um código;
  - abre o chamado conversando com a IA;
  - recebe os avisos ("atribuído", "precisamos de mais informações", "resolvido");
  - responde e avalia pelo próprio WhatsApp.
- Analistas:
  - recebem "novo chamado para você: resumo + link" e os avisos de prazo;
  - mais tarde, poderão responder ao chamado pelo WhatsApp.
- Mensagens que a OCP inicia (fora da janela de 24 h) usam **modelos aprovados pela Meta** e são cobradas por
  mensagem. As respostas dentro da conversa iniciada pelo cliente são livres.
- Requer a **verificação da OCP no Meta Business**. É o mesmo cadastro que o OCPSign usará para enviar
  códigos por WhatsApp.

### 6.5 Contratos e horas
- O analista aponta as horas em cada chamado (início/fim ou duração), com descrição.
- O saldo do mês aparece **só para a OCP**. O administrador recebe aviso ao atingir **80 %** e **100 %** do
  pacote. As horas não usadas zeram na virada do mês.
- O excedente vai para um relatório mensal por cliente (faturamento, ou para enviar quando o cliente pedir), exportável em PDF/planilha.

### 6.6 Melhorias → desenvolvimento
- Uma melhoria vira **especificação** (objetivo, regras, critérios de aceite, dúvidas em aberto) e recebe uma
  estimativa de horas/valor.
- O orçamento é **assinado pelo cliente no OCPSign**.
- O botão "exportar para desenvolvimento" gera uma *issue* no GitHub ou um pacote de contexto para o Claude Code.

### 6.7 Depois do básico
- **Base de conhecimento**: a solução de um chamado vira artigo; a IA sugere artigos antes de abrir um chamado.
- **Pesquisa de satisfação** (1 a 5) ao resolver.
- **Painéis**:
  - chamados por cliente, tipo e área;
  - tempo de primeira resposta e de solução;
  - horas consumidas;
  - problemas recorrentes.

## 7. Infraestrutura e segurança

- Mesmo modelo do OCPSign:
  - Node 22 + TypeScript, Express 5, EJS, MySQL 8, migrações SQL próprias;
  - Docker Compose com rede interna e rede pública;
  - Cloudflare Tunnel;
  - `publico.ts`, que libera da internet só as rotas do portal do cliente;
  - backup diário criptografado;
  - instância de teste isolada (dados de teste e e-mails em arquivo, nunca enviados de verdade).
- Anexos fora da pasta pública, servidos só depois de conferir a permissão. Há limite de tamanho e de tipo.
- Senhas com argon2, CSRF, CSP, limites de requisição e auditoria de tudo.
- Segredos (`.env`, tokens da Meta/Cloudflare) nunca no Git.
- **LGPD**:
  - dados dos clientes e conversas ficam no ZGX;
  - a IA é local;
  - o sistema não guarda senhas dos sistemas dos clientes e avisa o usuário para não enviá-las no chamado;
  - há prazo de retenção de anexos a definir.

## 8. Fases

1. **Base**:
   - repositório, estrutura e instância de teste;
   - cadastros: clientes, contratos, departamentos, usuários, sistemas/ambientes, áreas e analistas;
   - login com verificação em duas etapas;
   - portal do cliente: abrir, acompanhar, responder, anexos;
   - painel: fila, atribuição, notas internas, histórico;
   - avisos por e-mail (`notifications@ocp.com.br`).
2. **IA de triagem**:
   - fila de triagem com o vLLM e roteiros por tipo;
   - perguntas ao cliente e ficha técnica;
   - sugestão de área, analista e prioridade, e chamados parecidos;
   - prints (visão ou OCR).
3. **Prazos e horas**: SLA por contrato, pausa "aguardando cliente", avisos e escalonamento, apontamento de
   horas, saldo do pacote e relatório mensal.
4. **Produção**: `suporte.ocp.com.br` no Cloudflare Tunnel, acesso dos analistas pelo Cloudflare Access,
   backup, cadastro da Dapp e da Tury e primeiros chamados reais.
5. **WhatsApp oficial**: verificação Meta Business, número único, abertura e acompanhamento pelo cliente,
   acionamento dos analistas, transcrição de áudio.
6. **Melhorias e desenvolvimento**: especificação, orçamento assinado no OCPSign, exportação para GitHub/Claude
   Code.
7. **Base de conhecimento, satisfação e painéis.**

Cada fase termina com testes na instância isolada, documentação em `docs/` e envio ao GitHub. A próxima só começa
com aprovação.

## 9. Pendências de decisão

- Valor da hora excedente (cadastrado por contrato na Fase 3).
- O apontamento de horas conta só o tempo trabalhado, ou também um tempo mínimo por chamado?
- Plantão fora do horário comercial (por ora, não há).
