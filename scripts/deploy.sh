#!/usr/bin/env bash
# Deploy do Avante Mail para o VPS Contabo (stack em Docker Compose).
# Uso: ./scripts/deploy.sh  (a partir da raiz do projeto)
set -euo pipefail

SERVER=root@169.58.32.104
DIR=/root/avante-mail

echo "→ Enviando arquivos..."
# .env.local e .env NÃO são enviados: os do servidor são a fonte da verdade
# em produção (.env.local = envs do app; .env = segredos de interpolação do
# compose). O exclude de uploads é ANCORADO (/uploads) — sem a âncora o rsync
# também pularia app/uploads/ e app/api/uploads/ (rotas do código!).
rsync -az --exclude node_modules --exclude .next --exclude .git \
  --exclude .env.local --exclude .env --exclude /uploads ./ "$SERVER:$DIR/"

echo "→ Build da imagem, migrações e subida dos contêineres..."
# --wait segura até os healthchecks passarem (sem ele, as migrações correm
# antes do Postgres aceitar conexões no primeiro boot do volume).
# O `|| exit 1` no loop é obrigatório: sem ele, só o status da ÚLTIMA
# migração contaria e falhas anteriores passariam em silêncio.
ssh "$SERVER" "cd $DIR \
  && sed -i 's|^NEXT_PUBLIC_BASE_URL=.*$|NEXT_PUBLIC_BASE_URL=https://mail.avantetools.com.br|' .env.local \
  && docker compose build \
  && docker compose up -d --wait db redis \
  && for m in scripts/migrate-*.ts; do \
       [ -e \"\$m\" ] || continue; \
       echo \"  migrando: \$m\"; \
       docker compose run --rm --no-deps app npx tsx \"\$m\" || exit 1; \
     done \
  && docker compose up -d \
  && docker image prune -f >/dev/null"

echo "→ Verificando saúde do app..."
ssh "$SERVER" 'for i in $(seq 1 30); do
  if curl -sf -m 5 http://127.0.0.1:3000/api/health | grep -q "\"ok\":true"; then
    echo "  health OK"; exit 0
  fi
  sleep 2
done
echo "  FALHA: app não respondeu saudável em 60s"
cd /root/avante-mail && docker compose logs --tail 30 app
exit 1'

echo "✓ Deploy concluído — https://mail.avantetools.com.br"
