# Fase 1 — Base

Data: 2026-10-27 · Status: **concluída, aguardando aprovação para a Fase 2 (IA de triagem)**

## O que foi feito

### Acesso
- Um só login (`/login`) para a equipe da OCP e para os clientes. Depois do login, a equipe vai para o **painel**
  (`/painel`) e os clientes vão para o **portal** (`/portal`). Um nunca entra na área do outro.
- **Verificação em duas etapas**:
  - depois da senha, a pessoa recebe um código de 6 dígitos por e-mail, válido por 10 minutos;
  - 5 erros bloqueiam o código;
  - "Confiar neste navegador por 30 dias" dispensa o código naquele navegador.
- **Ninguém recebe senha provisória.** Quem é cadastrado recebe um convite por e-mail e define a própria senha
  (o link vale 7 dias e é de uso único).
- "Esqueci minha senha" envia um link de 1 hora e dá a mesma resposta exista ou não o e-mail.
- Trocar ou redefinir a senha cancela os navegadores confiáveis. Desativar um usuário ou um cliente derruba as
  sessões abertas na hora.
- Limites de tentativas:
  - login: 10 por conta e 100 por IP a cada 15 minutos (uma empresa inteira sai pelo mesmo IP);
  - códigos: 10 por hora.

### Cadastros (administrador)
- **Clientes**: nome, CNPJ (com dígito verificador) e observações internas.
- **Contrato**: horas por mês, valor da hora excedente e vigência. Só a OCP vê.
- **Departamentos do cliente.**
- **Usuários do cliente**, com dois perfis:
  - *gestor*: vê todos os chamados da empresa e cadastra colegas e departamentos;
  - *usuário*: vê os próprios chamados.
- **Sistemas e ambientes**: nome, categoria, **como acessa** (Workspace, endereço do portal), ambientes,
  observações e departamentos que usam. Nunca guarda senhas. É a base que a IA vai usar na Fase 2.
- **Equipe da OCP**: administradores e analistas, cada analista com suas **áreas** (Protheus, Infraestrutura…).

### Portal do cliente
- **Abrir chamado**:
  - tipo (erro, dúvida, solicitação, melhoria), assunto, departamento e sistema;
  - impacto (só eu / meu setor / empresa parada) e descrição;
  - até 5 anexos de 10 MB;
  - **colar um print com Ctrl+V** na descrição vira anexo.
- A lista mostra os chamados em andamento e os encerrados. Cada chamado tem a conversa e os anexos.
- "Aguardando sua resposta" quando a equipe pede informação.
- "Resolvido — confirme": o cliente confirma ou responde, e a resposta **reabre** o chamado. Sem retorno, o
  chamado fecha sozinho em 5 dias.
- O cliente pode cancelar o próprio chamado enquanto ele não foi resolvido.
- O gestor tem a tela **Minha equipe** (usuários e departamentos da empresa).

### Painel da OCP
- **Filas**:
  - sem responsável (padrão do administrador);
  - meus (padrão do analista);
  - todos abertos, aguardando cliente e encerrados.

  Há filtro por cliente. A ordem é por prioridade e depois por antiguidade.
- **Tela do chamado**:
  - ficha à direita: cliente, solicitante, departamento, sistema com o **modo de acesso**, impacto, datas, área
    e responsável;
  - conversa;
  - **nota interna** (o cliente não vê nem a nota nem os anexos dela);
  - resposta ao cliente com mudança de situação: em atendimento, **aguardando cliente** ou **resolvido**;
  - histórico de ações e outros chamados do mesmo solicitante.
- **Distribuição** (administrador): área, responsável, prioridade e tipo. O responsável recebe e-mail.
- O analista vê os chamados das suas áreas e os atribuídos a ele. Pode **assumir** um chamado sem responsável,
  e quem responde a um chamado sem responsável passa a ser o responsável.
- O administrador pode cancelar e reabrir chamados e **abrir chamado em nome do cliente** (ex.: pedido por
  telefone).

### E-mails (`notifications@ocp.com.br`)
- Convite, código de acesso e redefinição de senha.
- Para o cliente:
  - confirmação de abertura;
  - resposta da equipe (com o texto);
  - pedido de informação;
  - resolvido.
- Para a equipe:
  - novo chamado (administradores);
  - atribuído a você;
  - resposta do cliente ou reabertura (responsável, ou administradores se não houver responsável).
- Se um e-mail falhar, a ação não é desfeita (o erro vai para o log).

### Anexos
- Ficam fora da pasta pública, com nome gerado pelo sistema.
- São servidos só depois de conferir que a pessoa pode ver o chamado e a mensagem.
- Tipos aceitos: imagens, PDF, Office, ZIP, texto, logs, CSV, XML, JSON e e-mail (.eml/.msg). O conteúdo é
  conferido com a extensão: um "PNG" que não é imagem é recusado. SVG e HTML nunca são aceitos.
- Download com `Content-Security-Policy: sandbox`; só imagens abrem no navegador.

### Endereço público (preparado para a Fase 4)
- Pela internet passam só login, conta, portal e estáticos. **O painel não existe** pelo endereço público até a
  Fase 4 (Cloudflare Access). Hoje, o painel é acessado pelo Tailscale.

## Testes (instância isolada, porta 3210)

Suíte de ponta a ponta com navegador real (Playwright): **63 de 63 verificações aprovadas**. Ela cobre:
- **Fluxo completo**: convites, login com código, navegador confiável, cadastros pela tela, abertura pelo celular
  com anexo e print colado, distribuição, nota interna, pedido de informação, resposta, resolução, confirmação,
  reabertura e cancelamento.
- **Isolamento**:
  - usuário não vê chamado de colega;
  - cliente não vê chamado nem anexo de outro cliente;
  - gestor não vê outro cliente, não usa departamento de outro cliente e não edita usuário de outro cliente;
  - analista não vê chamado de outra área;
  - cliente não vê nota interna nem anexo interno;
  - cliente não entra no painel e analista não entra nos cadastros.
- **Segurança**:
  - POST sem CSRF;
  - `/painel` inexistente pelo endereço público;
  - anexo `.exe` e PNG falso recusados;
  - 5 códigos errados bloqueiam o código;
  - mesma resposta no "esqueci a senha";
  - redefinir a senha derruba a sessão;
  - usuário e cliente desativados perdem o acesso.

### Problemas encontrados pelos testes e corrigidos
1. Os cadastros (só administrador) estavam montados antes das rotas de chamados e bloqueavam os **analistas** em
   todo o painel. A ordem das rotas foi corrigida.
2. O limite de 5 tentativas por IP em "definir senha" e o de 10 logins por IP bloqueariam uma empresa inteira
   aceitando convites do mesmo escritório. Agora:
   - definir senha: 30 por IP;
   - login: 10 por conta e 100 por IP.
3. Quem saía e entrava de novo em menos de 1 minuto ficava sem código (o limite contava códigos já usados).
   Agora o limite só segura enquanto houver um código válido não usado.

## Próximo passo

Fase 2: IA de triagem com o modelo local (perguntas pelo que falta, ficha técnica, sugestão de área, analista e
prioridade).

## Em uso no ZGX (2026-10-27)

- Produção em `127.0.0.1:3200`. O painel é acessado **só pela tailnet**: `https://zgx-ocp.tail8d7ec5.ts.net:3200`
  (`tailscale serve`, nunca Funnel).
- Primeiro administrador: `marcos@ocp.com.br` (convite enviado por e-mail).
- Até a Fase 4 os links dos e-mails apontam para o endereço do Tailscale. Por isso **ainda não convide usuários
  reais de clientes**: eles não conseguiriam abrir o link. Cadastros (clientes, departamentos, sistemas, áreas,
  analistas com Tailscale) já podem ser feitos.
- Backup: `scripts/backup.sh` (testado: o arquivo abre e o dump do banco está completo). Agendar no cron às 03:45.
