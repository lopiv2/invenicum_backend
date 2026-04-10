# Invenicum Backend

API backend for the Invenicum project.

## Overview

This repository contains the Node.js/Express backend services for Invenicum, including API routes, database schema (Prisma), authentication, and CI workflow to build and publish container images. It is intended to be run as a service behind a reverse proxy or in a container platform.

## Features

- REST API built with Express
- Database schema and migrations managed with Prisma
- JWT-based authentication
- GitHub Actions workflow for building and publishing container images
- Endpoints for version checking and integrations

## Requirements

- Node.js 18+ (LTS recommended)
- npm or yarn
- Docker (if you plan to run the container locally)
- GitHub repository secrets configured for CI (e.g., `FRONTEND_RELEASE_TOKEN`, `GITHUB_TOKEN`)

## Quick start (development)

1. Install dependencies

```bash
npm install
```

2. Copy environment example and set secrets

Create a `.env` file and configure database URL, JWT secret and any API keys required by your environment.

3. Run Prisma migrations (if needed)

```bash
npx prisma migrate deploy
# or for development
npx prisma migrate dev
```

4. Start the app (development)

```bash
npm run dev
```

The API will be available on the configured port (default 3000).

## Docker (build & run)

Build the image locally using the repository's Dockerfile or use the provided GitHub Actions workflow which publishes to GitHub Container Registry.

```bash
docker build -f Dockerfile.selfhosted -t ghcr.io/<owner>/invenicum:latest .
```

Run the container:

```bash
docker run -p 3000:3000 --env-file .env ghcr.io/<owner>/invenicum:latest
```

## CI / Releases

The repository contains a GitHub Actions workflow at `.github/workflows/docker-publish.yml` which builds and pushes a container image for tag events and can synchronize releases to the frontend repository. Ensure the required secrets are configured in the repository settings.

## Security & Privacy

This repository previously contained a local file `FIGURE_VERSIONS.md` used for CI mapping. That file has been removed and release names must now be provided through the workflow inputs or managed manually.

If you need to fully remove sensitive files from the repository history, use `git filter-repo` or `bfg-repo-cleaner` and coordinate a force-push with collaborators.

## Contributing

- Follow the existing coding style and linting rules
- Run tests (if available) before creating PRs
- Update documentation and changelogs for breaking changes

## License

Add license information here.
