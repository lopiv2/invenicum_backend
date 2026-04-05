# Self-Hosted Deploy (Imagen Publicada)

Este backend incluye frontend Flutter web embebido. Solo necesitas una imagen y un `docker compose`.

## 1) Construir imagen para publicar

Desde la raiz de `Invenicum_backend`:

```bash
docker build \
  -f Dockerfile.selfhosted \
  --build-context frontend=../Invenicum/invenicum \
  --build-arg API_URL=/api/v1 \
  --build-arg APP_VERSION=1.0.0 \
  -t ghcr.io/lopiv2/invenicum:1.0.0 \
  -t ghcr.io/lopiv2/invenicum:latest \
  .
```

## 2) Publicar en GHCR

```bash
echo <GITHUB_PAT> | docker login ghcr.io -u lopiv2 --password-stdin
docker push ghcr.io/lopiv2/invenicum:1.0.0
docker push ghcr.io/lopiv2/invenicum:latest
```

`GITHUB_PAT` necesita el scope `write:packages`.

## 3) Archivos para usuarios finales

Publica estos dos archivos en tu web/documentacion:

- `docker-compose.stack.yml`
- `.env.stack.example` (renombrado a `.env` por el usuario)

## 4) Despliegue del usuario final

```bash
docker compose -f docker-compose.stack.yml --env-file .env up -d
```

## 5) Actualizacion

```bash
docker compose -f docker-compose.stack.yml --env-file .env pull
docker compose -f docker-compose.stack.yml --env-file .env up -d
```

## Notas

- La imagen valida acceso a DB, crea la base si no existe, ejecuta migraciones Prisma y arranca la API.
- El usuario de DB debe tener permisos de `CREATE DATABASE` (al menos en el primer arranque).
- Si no quieres exponer puerto 3000 en host, ajusta `HOST_PORT` en `.env`.
