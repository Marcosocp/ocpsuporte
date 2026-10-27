# OCP Suporte

Portal de chamados de suporte de TI da OCP para os clientes (`suporte.ocp.com.br`).
Plano completo em [docs/01-plano.md](docs/01-plano.md); andamento por fase em `docs/`.

Node 22 + TypeScript, Express 5, EJS, MySQL 8.4 (migrações SQL próprias em `migracoes/`). Roda no ZGX em Docker.

## Produção (ZGX)

```bash
cp .env.example .env            # preencher (chmod 600); nunca vai para o Git
docker compose up -d --build    # MySQL + app em 127.0.0.1:3200
tailscale serve --bg --https=3200 http://127.0.0.1:3200   # painel da OCP, só na tailnet
docker compose exec app npm run criar-admin -- "Nome" email@ocp.com.br   # primeiro administrador (convite por e-mail)
bash scripts/backup.sh          # backup criptografado em backups/ (cron diário)
```

A internet (Cloudflare Tunnel, Fase 4) só enxerga login, conta e portal do cliente (`src/publico.ts`).

## Testes

Tudo que cria ou altera dados roda **só** na instância isolada (porta 3210, banco em memória, e-mails em arquivo):

```bash
bash scripts/instancia_teste.sh subir
bash scripts/instancia_teste.sh admin "Admin Teste" admin@teste.ocp   # mostra o link de senha
bash scripts/instancia_teste.sh emails
bash scripts/instancia_teste.sh descer
```
