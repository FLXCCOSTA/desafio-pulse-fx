#!/bin/sh
# Aplicador de migrations.
#
# Roda uma vez na subida do ambiente, num serviço próprio do Compose, e não
# dentro da API: aplicar schema no boot da aplicação significa que N réplicas
# tentam migrar ao mesmo tempo.
#
# Mantém a tabela schema_migrations para que reaplicar seja seguro — o Compose
# pode subir várias vezes sobre o mesmo volume.

set -eu

echo "Aguardando o PostgreSQL aceitar conexão..."
until psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1; do
  sleep 1
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );"

for file in /migrations/*.sql; do
  name=$(basename "$file")

  applied=$(psql "$DATABASE_URL" -tAc \
    "SELECT 1 FROM schema_migrations WHERE filename = '$name'")

  if [ "$applied" = "1" ]; then
    echo "  = $name (já aplicada)"
    continue
  fi

  echo "  + $name"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO schema_migrations (filename) VALUES ('$name');"
done

echo "Migrations aplicadas."
