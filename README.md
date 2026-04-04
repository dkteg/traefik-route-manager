# Traefik Route Manager

A modern web UI for managing Traefik's dynamic YAML configuration files — routers, services, and middlewares.

![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)

## Features

- **Dashboard** — Overview of all routes, services, and middlewares
- **CRUD Operations** — Create, edit, and delete HTTP/TCP routers, services, and middlewares
- **File Browser** — View raw YAML of each config file
- **Auto-Backup** — Timestamped backups before every configuration change
- **Backup Restore** — One-click restore from any backup
- **Portable** — Works with any Traefik file-provider setup via Docker volume mount
- **Dark Mode UI** — Modern glassmorphism design, fully responsive

## Quick Start

### Docker Compose (Recommended)

```bash
docker compose up -d
```

The app will be available at `http://localhost:3080`.

#### Configuration

Edit `docker-compose.yml` to adjust:

| Environment Variable | Default | Description |
|---|---|---|
| `CONFIG_DIR` | `/config` | Path to the Traefik dynamic config directory inside the container |
| `BACKUP_DIR` | `/config/.backups` | Directory for automatic backups |
| `PORT` | `3000` | HTTP port inside the container |

Change the volume mount to point at your Traefik dynamic config directory:

```yaml
volumes:
  - /your/traefik/dynamic:/config
```

### Local Development

```bash
npm install
CONFIG_DIR=/etc/traefik/dynamic npm start
```

## How It Works

1. The app reads and writes YAML files from the configured dynamic config directory
2. Traefik's file provider watches this directory and hot-reloads on changes
3. Before every write operation, a timestamped backup is created in `.backups/`
4. The static `traefik.yml` is **not** managed — only dynamic configs are editable

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files` | List config files with counts |
| `GET` | `/api/files/:name` | Parsed file contents |
| `GET` | `/api/files/:name/raw` | Raw YAML text |
| `GET` | `/api/overview` | Dashboard stats |
| `POST/PUT/DELETE` | `/api/files/:name/routers/:id` | CRUD routers |
| `POST/PUT/DELETE` | `/api/files/:name/services/:id` | CRUD services |
| `POST/PUT/DELETE` | `/api/files/:name/middlewares/:id` | CRUD middlewares |
| `POST/PUT/DELETE` | `/api/files/:name/tcp/routers/:id` | CRUD TCP routers |
| `POST/PUT/DELETE` | `/api/files/:name/tcp/services/:id` | CRUD TCP services |
| `GET` | `/api/backups` | List backups |
| `POST` | `/api/backups/:name/restore` | Restore a backup |

## License

MIT
