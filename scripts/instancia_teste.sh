#!/usr/bin/env bash
# Instância de teste isolada do OCP Suporte em http://127.0.0.1:3210.
# Testes que criam/alteram/apagam dados rodam SÓ aqui, nunca na produção (3200).
#   bash scripts/instancia_teste.sh subir                 # sobe do zero (banco vazio)
#   bash scripts/instancia_teste.sh admin Nome email      # cria administrador e mostra o link de senha
#   bash scripts/instancia_teste.sh descer                # apaga tudo
#   bash scripts/instancia_teste.sh emails                # lista os e-mails "enviados"
set -euo pipefail
cd "$(dirname "$0")/.."
export OCPSUPORTE_TESTE_DIR="${OCPSUPORTE_TESTE_DIR:-$HOME/.cache/ocpsuporte-teste}"
compose() { docker compose -f docker-compose.teste.yml "$@"; }

case "${1:-}" in
  subir)
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$OCPSUPORTE_TESTE_DIR" && mkdir -p "$OCPSUPORTE_TESTE_DIR/anexos" "$OCPSUPORTE_TESTE_DIR/emails"
    compose up -d
    # Cloudflare Access simulado: par de chaves só da instância de teste (privada em access/privada.pem, para os testes).
    mkdir -p "$OCPSUPORTE_TESTE_DIR/access"
    compose exec -T app-teste node -e '
      const { generateKeyPairSync } = require("node:crypto"); const fs = require("node:fs");
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      fs.writeFileSync("/teste/access/privada.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
      fs.writeFileSync("/teste/access/jwks.json", JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "teste-1", alg: "RS256" }] }));'
    for _ in $(seq 1 60); do
      curl -fs http://127.0.0.1:3210/saude >/dev/null 2>&1 && { echo "Instância de teste pronta: http://127.0.0.1:3210"; exit 0; }
      sleep 2
    done
    echo "Instância de teste não respondeu"; compose logs --tail 30 app-teste; exit 1 ;;
  admin)
    compose exec -T app-teste npx tsx scripts/criar-admin.ts "$2" "$3" ;;
  descer)
    compose down -v --remove-orphans
    rm -rf "$OCPSUPORTE_TESTE_DIR" ;;
  emails)
    ls -1 "$OCPSUPORTE_TESTE_DIR/emails" ;;
  *)
    echo "Uso: $0 subir|admin|descer|emails"; exit 1 ;;
esac
