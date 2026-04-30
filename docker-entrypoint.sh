#!/bin/sh
set -eu

DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-}"

if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo "[Startup] Faltan variables DB_HOST, DB_USER o DB_NAME."
  exit 1
fi

# Limita el nombre de base de datos para evitar inyecciones en SQL dinámico.
case "$DB_NAME" in
  *[!a-zA-Z0-9_]* )
    echo "[Startup] DB_NAME contiene caracteres no permitidos. Usa solo letras, numeros y guion bajo."
    exit 1
    ;;
esac

export MYSQL_PWD="$DB_PASSWORD"

echo "[Startup] Verificando acceso a MariaDB en ${DB_HOST}:${DB_PORT}..."
retries=30
until mysqladmin ping -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" --silent >/dev/null 2>&1; do
  retries=$((retries - 1))
  if [ "$retries" -le 0 ]; then
    echo "[Startup] No se pudo conectar a MariaDB con las credenciales proporcionadas."
    exit 1
  fi
  sleep 2
done

echo "[Startup] Conectado. Creando base de datos si no existe..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  -e "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "[Startup] Verificando permisos sobre la base de datos..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  -e "CREATE TABLE IF NOT EXISTS $DB_NAME.__startup_check (id INT PRIMARY KEY); DROP TABLE IF EXISTS $DB_NAME.__startup_check;"

echo "[Startup] Generando Prisma Client..."
npx prisma generate

echo "[Startup] Ejecutando migraciones Prisma..."
npx prisma migrate deploy

echo "[Startup] Iniciando API..."
exec node src/app.js
