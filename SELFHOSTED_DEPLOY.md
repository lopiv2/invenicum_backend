# Self-Hosted Deploy (Imagen Publicada)

Este backend incluye frontend Flutter web embebido. Solo necesitas una imagen y un `docker compose`.

## Flujo recomendado a partir de ahora (cada mejora)

1. Implementar y probar cambios en local.
2. Elegir nueva version semantica (`X.Y.Z`) para la release.
3. Construir imagen con tag de version y `latest`.
4. Publicar ambas tags en GHCR.
5. Actualizar usuarios para que hagan `pull` + `up -d`.
6. Si algo falla, volver temporalmente a la version anterior.

Este flujo evita que el usuario final tenga que instalar Node o Prisma.

## Publicacion automatica con GitHub Actions

El repositorio incluye workflow en `.github/workflows/docker-publish.yml` para construir y publicar imagen en GHCR sin depender de tu ordenador.

### Que hace

1. Se ejecuta automaticamente en cada `push` a `main`.
2. Construye con `Dockerfile.selfhosted` (backend + frontend).
3. Publica tags:
  - `latest`
  - `sha-<commit>`
  - version semantica si lanzas manualmente con `workflow_dispatch`.

### Configuracion necesaria (una sola vez)

1. En GitHub, crea el secret `FRONTEND_REPO_TOKEN` en el repo backend.
2. Ese token debe tener permiso de lectura sobre el repo frontend (`lopiv2/Invenicum`).
3. En Settings > Actions > General, deja permisos de workflow en `Read and write permissions` para paquetes.

Si el repo frontend es publico, igualmente puedes dejar el secret para mantener un flujo consistente.

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

Sustituye `1.0.0` por la version real de la mejora que vas a publicar.

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

En el primer arranque, la app:

- valida conexion a MariaDB,
- crea la base de datos si no existe,
- ejecuta migraciones,
- arranca la API.

## 5) Actualizacion

```bash
docker compose -f docker-compose.stack.yml --env-file .env pull
docker compose -f docker-compose.stack.yml --env-file .env up -d
```

Si quieres fijar una version concreta (sin `latest`), en `.env` usa:

```env
APP_IMAGE=ghcr.io/lopiv2/invenicum:1.0.0
```

## 6) Rollback rapido (si una release falla)

Cambiar `APP_IMAGE` en `.env` a la version anterior y ejecutar:

```bash
docker compose -f docker-compose.stack.yml --env-file .env up -d
```

## Notas

- La imagen valida acceso a DB, crea la base si no existe, ejecuta migraciones Prisma y arranca la API.
- El usuario de DB debe tener permisos de `CREATE DATABASE` (al menos en el primer arranque).
- Si no quieres exponer puerto 3000 en host, ajusta `HOST_PORT` en `.env`.
