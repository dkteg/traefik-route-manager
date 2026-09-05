# Traefik Route Manager

A modern, streamlined web UI and management console for Traefik v2/v3 dynamic configuration files — routers, services, middlewares, and serversTransports.

![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)

## Features

- **Dashboard & Runtime Health** — Real-time overview of routes, services, middlewares, and live Traefik status
- **Route Topology & Pipeline** — Visual flow diagram (`[Entrypoint] ➔ [Rule] ➔ [Middlewares] ➔ [Service] ➔ [Backends]`)
- **Full Protocol Coverage** — Create, edit, and delete both HTTP and TCP routers, services, and middlewares
- **ServersTransports Management** — Manage HTTP and TCP `serversTransports` (e.g. `insecureSkipVerify`, custom root CAs, SNI serverName)
- **Smart Slide-Over Drawers** — Smooth editing panels with real-time Live YAML preview as you type
- **Middleware Templates & Presets** — 1-click presets for Authentik/Authelia ForwardAuth, RedirectRegex, Security Headers, BasicAuth, and IPAllowList
- **In-Browser YAML Code Editor** — Edit raw YAML files directly in the browser with syntax validation without stripping comments
- **Auto-Backup & Unified Diff** — Pre-modification timestamped backups with visual line-by-line unified diff comparison before restoring
- **Command Palette (`Ctrl+K` / `Cmd+K`)** — Quick keyboard navigation across views, actions, and routes
- **Traefik Observability Suite** — Live Access Log viewer (`access.log`), ACME certificate inspector (`cloudflare-acme.json`), and static `traefik.yml` inspector
- **Cloud-Native Design System** — Ultra-clean zinc/slate aesthetic with status badges and responsive layout

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
| `TRAEFIK_ROOT_DIR` | `/etc/traefik` | Optional root directory containing `traefik.yml`, `logs/`, and `certs/` |
| `TRAEFIK_API_URL` | `http://localhost:8080` | Optional Traefik API endpoint for runtime status badges |

```yaml
volumes:
  - /etc/traefik/dynamic:/config
  # Optional: Mount full /etc/traefik as read-only to activate static config, access log, and certificate inspection
  - /etc/traefik:/etc/traefik:ro
```

### Local Development

```bash
npm install
CONFIG_DIR=/etc/traefik/dynamic npm start
```

## Testing

The project includes an extensive integration test suite:

```bash
node test.js
```

Or via Docker:

```bash
docker compose run --rm traefik-route-manager npm test
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files` | List dynamic config files with counts |
| `GET` | `/api/files/:name` | Parsed file contents |
| `GET` | `/api/files/:name/raw` | Raw YAML text |
| `PUT` | `/api/files/:name/raw` | Save raw YAML directly (with validation) |
| `GET` | `/api/overview` | Dashboard stats & counts |
| `POST/PUT/DELETE` | `/api/files/:name/routers/:id` | CRUD HTTP routers |
| `POST/PUT/DELETE` | `/api/files/:name/services/:id` | CRUD HTTP services |
| `POST/PUT/DELETE` | `/api/files/:name/middlewares/:id` | CRUD HTTP middlewares |
| `POST/PUT/DELETE` | `/api/files/:name/serversTransports/:id` | CRUD HTTP serversTransports |
| `POST/PUT/DELETE` | `/api/files/:name/tcp/routers/:id` | CRUD TCP routers |
| `POST/PUT/DELETE` | `/api/files/:name/tcp/services/:id` | CRUD TCP services |
| `POST/PUT/DELETE` | `/api/files/:name/tcp/middlewares/:id` | CRUD TCP middlewares |
| `POST/PUT/DELETE` | `/api/files/:name/tcp/serversTransports/:id` | CRUD TCP serversTransports |
| `GET` | `/api/backups` | List backups |
| `GET` | `/api/backups/:name/diff` | Unified diff comparison with active file |
| `POST` | `/api/backups/:name/restore` | Restore a backup |
| `GET` | `/api/traefik/capabilities` | System inspection capabilities check |
| `GET` | `/api/traefik/entrypoints` | Auto-discovered Traefik entrypoints |
| `GET` | `/api/traefik/status` | Live Traefik v3 API status bridge |
| `GET` | `/api/traefik/logs` | Tail and filter access logs |
| `GET` | `/api/traefik/certificates` | Active ACME TLS certificates |
| `GET` | `/api/traefik/static` | Static `traefik.yml` configuration |

## License

MIT
