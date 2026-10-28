# Fase 4: produção (suporte.ocp.com.br e painel pelo Cloudflare Access)

Data: 2026-10-28 · Status: **código pronto e no ar; aguardando a configuração na Cloudflare**

## Endereços

| Endereço | Quem usa | O que abre |
|---|---|---|
| `https://suporte.ocp.com.br` | Clientes | Login, conta, link de cadastro, portal. **Painel: nunca.** |
| `https://painel-suporte.ocp.com.br` | Equipe da OCP | Tudo, depois do Cloudflare Access (código por e-mail) + login do sistema + código |
| `https://zgx-ocp.tail8d7ec5.ts.net:3200` | Administrador (Tailscale) | Tudo, como hoje |

Os dois endereços públicos passam pelo mesmo túnel (container `ocpsuporte-cloudflared`) e chegam ao mesmo app.

## Proteção do painel (três camadas)
1. **Cloudflare Access**: só os e-mails da lista passam, com código por e-mail.
2. **O app confere o token do Access** em cada requisição (`src/cfaccess.ts`):
   - assinatura RS256 com as chaves públicas da equipe;
   - AUD da aplicação, emissor e validade.

   Sem token válido, o painel responde 404, mesmo com sessão aberta. Se o Access for desligado ou mal configurado,
   o painel continua fechado.
3. **Login do sistema** com verificação em duas etapas. O e-mail do Access tem de ser o **mesmo** do usuário.

Além disso:
- a equipe **não consegue fazer login** pelo endereço dos clientes: recebe a orientação de usar o endereço do
  painel e nenhum código é enviado;
- um cliente que passe pelo Access continua sendo cliente.

## Passo a passo na Cloudflare (feito pelo administrador)

### 1. Túnel
Zero Trust → **Networks → Tunnels → Create a tunnel** → Cloudflared → nome `ocpsuporte`.

1. Na tela de instalação, copie o **token**: o texto longo depois de `--token` no comando mostrado. Não precisa
   instalar nada: o container já existe.
2. Em **Public hostnames**, crie dois, os dois com o serviço **HTTP** `ocpsuporte-app:3200`:
   - subdomínio `suporte`, domínio `ocp.com.br`;
   - subdomínio `painel-suporte`, domínio `ocp.com.br`.
3. Grave o token no ZGX. O comando abaixo pede o token sem mostrar na tela e sem deixar no histórico:
   ```bash
   read -rsp "Token: " T && printf 'TUNNEL_TOKEN=%s\n' "$T" > ~/ocpsuporte/secrets/cloudflared.env && chmod 600 ~/ocpsuporte/secrets/cloudflared.env && unset T && echo OK
   ```

### 2. Access do painel
Zero Trust → **Access → Applications → Add an application → Self-hosted**.

1. Configure a aplicação:
   - nome `OCP Suporte - painel`;
   - domínio `painel-suporte.ocp.com.br`, sem caminho;
   - duração da sessão: 24 horas.
2. Crie a política **Equipe OCP**: ação *Allow*, *Include → Emails*, com o seu e-mail e o de cada analista (os
   mesmos e-mails cadastrados no sistema).
3. Método de login: **One-time PIN**.
4. Depois de salvar, abra a aplicação e copie:
   - o **Application Audience (AUD) Tag**;
   - o **team domain**, que fica em Settings → Custom Pages e tem o formato `algo.cloudflareaccess.com`.

   Esses dois valores não são segredo.

**Para incluir ou tirar um analista**, edite essa política. Também desative a pessoa em Equipe no sistema.

### 3. No ZGX (feito pelo Claude, com os valores do passo 2)
1. No `.env`, preencher:
   - `CF_ACCESS_DOMINIO` e `CF_ACCESS_AUD`;
   - `BASE_URL=https://suporte.ocp.com.br`;
   - `PAINEL_URL=https://painel-suporte.ocp.com.br`.
2. Subir o túnel: `docker compose --profile tunel up -d`.
3. Conferir de fora da rede:
   - o portal abre;
   - `/painel` dá 404 em `suporte.ocp.com.br`;
   - o painel pede o código do Access e depois o login.

## Depois de no ar
- Cadastrar a Dapp e a Tury: departamentos, sistemas, contrato e link de cadastro.
- Primeiros chamados reais.
- Backup: as linhas do cron (OCPSign 03:30, OCP Suporte 03:45) continuam pendentes.

## Testes (instância isolada, Access simulado)
A instância de teste gera um par de chaves próprio. A suíte `suporte6.mjs` assina tokens como se fosse a
Cloudflare. **30 verificações aprovadas**:
- sem token, o painel não abre e a equipe não faz login;
- o cliente funciona normalmente pela internet;
- com token válido, entram administrador e analista. O analista continua sem os cadastros do administrador;
- token de outro e-mail e sessão sem token são barrados;
- tokens inválidos dão 404:
  - AUD ou emissor errados;
  - token vencido;
  - assinado com outra chave;
  - `kid` desconhecido;
  - `alg` none ou HS256;
  - e-mail adulterado;
  - lixo;
- pelo Tailscale, tudo continua igual.

As suítes da Fase 1 (63) e do link de cadastro (53) seguem aprovadas.
