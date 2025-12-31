# Game Control Plane Web Server

Control-plane service for the multiplayer game, providing:
- User account management and authentication
- Game server discovery and registry
- Static file hosting for browser client

## Technology Stack

- **Node.js** (LTS)
- **TypeScript** (strict mode)
- **Fastify** - HTTP framework
- **PostgreSQL** - Database
- **Drizzle ORM** - Type-safe SQL queries
- **argon2** - Password hashing
- **JWT** - Authentication tokens
- **HTTP-only cookies** - Secure token storage

## Project Structure

```
web/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Fastify instance
│   ├── config/
│   │   ├── env.ts            # Environment variables
│   │   └── constants.ts      # App constants
│   ├── db/
│   │   ├── client.ts         # Database connection
│   │   ├── schema.ts         # Table definitions
│   │   ├── migrate.ts        # Migration runner
│   │   └── migrations/       # Generated migrations
│   ├── auth/
│   │   ├── auth.service.ts   # Auth business logic
│   │   ├── auth.routes.ts    # Auth endpoints
│   │   └── password.ts       # Password hashing
│   ├── users/
│   │   ├── users.service.ts
│   │   └── users.routes.ts
│   ├── servers/
│   │   ├── servers.service.ts  # Server registry logic
│   │   └── servers.routes.ts   # Server registry endpoints
│   ├── middleware/
│   │   └── auth.ts           # JWT verification middleware
│   ├── static/
│   │   └── client/           # Built browser client
│   └── types/
│       └── shared.ts         # Shared type definitions
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── dockerfile
```

## Setup

### Prerequisites

- Node.js 20+ (LTS)
- PostgreSQL 14+

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Edit `.env` and set your database URL and secrets

4. Generate database migrations:
```bash
npm run db:generate
```

5. Run migrations:
```bash
npm run db:migrate
```

### Development

Start the development server with hot reload:
```bash
npm run dev
```

### Production

Build and start:
```bash
npm run build
npm start
```

Or use Docker:
```bash
docker build -t game-control-plane .
docker run -p 3000:3000 --env-file .env game-control-plane
```

## API Routes

### Authentication

#### `POST /auth/register`
Create a new user account.

**Body:**
```json
{
  "username": "string",
  "email": "string (optional)",
  "password": "string"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "email": "string | null",
    "createdAt": "timestamp"
  }
}
```

#### `POST /auth/login`
Authenticate a user.

**Body:**
```json
{
  "usernameOrEmail": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "email": "string | null",
    "createdAt": "timestamp"
  }
}
```

#### `POST /auth/logout`
Clear authentication cookies.

**Response:**
```json
{
  "message": "Logged out"
}
```

#### `GET /auth/me`
Get current authenticated user (requires auth).

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "email": "string | null",
    "createdAt": "timestamp"
  }
}
```

### Server Registry (Game Servers Only)

All server registry endpoints require:
```
Authorization: Bearer <SERVER_SHARED_SECRET>
```

#### `POST /servers/register`
Register a game server.

**Body:**
```json
{
  "id": "string",
  "host": "string",
  "port": "number",
  "region": "string",
  "maxPlayers": "number"
}
```

#### `POST /servers/heartbeat`
Update server status.

**Body:**
```json
{
  "id": "string",
  "currentPlayers": "number"
}
```

### Server List (Public)

#### `GET /servers`
Get list of online game servers.

**Response:**
```json
{
  "servers": [
    {
      "id": "string",
      "host": "string",
      "port": "number",
      "region": "string",
      "currentPlayers": "number",
      "maxPlayers": "number"
    }
  ]
}
```

## Database Schema

### users
- `id` (uuid, primary key)
- `username` (text, unique, not null)
- `email` (text, unique, nullable)
- `password_hash` (text, not null)
- `email_verified_at` (timestamp, nullable)
- `created_at` (timestamp, default now)

### sessions
- `id` (uuid, primary key)
- `user_id` (foreign key → users.id)
- `expires_at` (timestamp)
- `created_at` (timestamp, default now)

### game_servers
- `id` (text, primary key)
- `host` (text)
- `port` (integer)
- `region` (text)
- `max_players` (integer)
- `current_players` (integer)
- `last_heartbeat` (timestamp)
- `is_online` (boolean)

## Security Features

- HTTP-only cookies for JWT storage
- CORS protection
- Rate limiting on all endpoints
- Argon2 password hashing
- Shared secret authentication for game servers
- No sensitive data in logs
- Constant-time password comparison
- Automatic server expiry (10 second heartbeat timeout)

## Architecture Notes

This is a **control-plane service only**. It does NOT:
- Contain gameplay logic
- Simulate game state
- Proxy gameplay traffic
- Match players directly

Game servers connect directly to this API for registration and heartbeats.
Browser clients connect to game servers directly for gameplay after discovering them through this API.

## Cleanup Jobs

A background job runs every 5 seconds to mark game servers as offline if they haven't sent a heartbeat in the last 10 seconds. Offline servers are excluded from the server list.

## License

See [LICENSE](../LICENSE)
