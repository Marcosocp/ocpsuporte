# Link de cadastro por cliente (com aprovação)

Data: 2026-10-28 · Pedido do usuário: "gerar um link por cliente para cadastro de usuários, mas ele só vale após a
minha aprovação".

## Como funciona
1. **Página do cliente → Link de cadastro**:
   - "Gerar link", com validade de 7, 30 (padrão) ou 90 dias, ou sem prazo;
   - botão **Copiar** para mandar por e-mail ou num grupo de WhatsApp;
   - **Revogar** a qualquer momento. Gerar um link novo também invalida o anterior; cada cliente tem no máximo um
     link valendo.
2. Quem abre o link vê o nome do cliente e preenche:
   - nome, e-mail, celular e cargo;
   - os departamentos do cliente.

   A tela responde "Pedido enviado. Quando a OCP aprovar, você vai receber um e-mail…". **Nenhuma conta é criada
   nesse momento.**
3. Os administradores recebem um e-mail, e o menu mostra **"Pedidos de acesso (N)"**.
4. **Aprovar** pode ser feito na página do cliente ou na lista geral (`/painel/pedidos`). O administrador escolhe o
   perfil (usuário ou gestor) e ajusta os departamentos. Aí o usuário é criado e recebe o convite normal para definir a
   senha.
5. **Recusar** não avisa a pessoa.

## Segurança
- O link só permite **pedir** acesso. Por isso o token fica guardado em claro, para o administrador copiá-lo de novo
  (os links de senha continuam guardados só como hash).
- O link é um token aleatório de 43 caracteres. Link vencido ou revogado, ou cliente desativado, dá "link não é
  válido".
- A resposta é sempre a mesma, mesmo se o e-mail já tem conta (nada é gravado nesse caso). Assim não se descobre
  quem é cliente.
- Departamento de outro cliente é recusado. O formulário tem CSRF e um campo-armadilha contra robôs.
- Limites contra abuso:
  - 20 pedidos por hora por IP;
  - no máximo 30 pendentes por cliente;
  - o mesmo e-mail pedindo de novo atualiza o pedido pendente, sem criar outro.
- Só o administrador gera links e aprova ou recusa. Analistas não veem nada disso.
- Duas aprovações seguidas não criam a conta duas vezes. Se a criação falhar, o pedido volta a pendente.
- A auditoria registra gerar, revogar, pedir, atualizar, ignorar, aprovar e recusar, com o IP de quem pediu.

## Atenção até a Fase 4
O link usa o endereço base do sistema (`BASE_URL`). Hoje esse endereço é o do Tailscale, que os clientes não
conseguem abrir. **Só distribua links depois que `suporte.ocp.com.br` estiver no ar (Fase 4).**

## Técnico
- Migração `006-links-cadastro.sql`: tabelas `links_cadastro` e `solicitacoes_cadastro`.
- Código:
  - `src/autocadastro.ts` (regras);
  - `src/rotas/autocadastro.ts` (página pública em `/conta/cadastro/:token`, que já fica na parte pública do
    túnel);
  - rotas do administrador em `src/rotas/cadastros.ts`.
- Testes: suíte `suporte5.mjs`, **53 verificações aprovadas**. A suíte da Fase 1 (63) segue aprovada.
