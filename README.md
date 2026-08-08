# CI360 Realtime App - JavaScript + MySQL

This package contains the React/Vite frontend and Express/Socket.IO backend converted to JavaScript and updated from SQLite to MySQL for Hostinger Node.js App Hosting.

## Preserved application features

- Admin and client login
- JWT authentication
- Client management
- Job creation, status updates and TAT calculations
- Support ticket creation, replies, priorities and statuses
- Support ticket attachments
- Audit logs
- Realtime Socket.IO refresh events
- React dashboard served by the same Node.js application in production

## Requirements

- Node.js 20 or newer
- npm
- MySQL 8.x or compatible MariaDB

## Localhost setup

### 1. Create a MySQL database

Using phpMyAdmin, MySQL Workbench or the MySQL terminal, create a database:

```sql
CREATE DATABASE ci360_realtime CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

The application automatically creates all tables on first startup. You may alternatively import `database/mysql-schema.sql`.

### 2. Configure the backend

Copy the example file:

Windows PowerShell:

```powershell
Copy-Item server/.env.example server/.env
```

macOS/Linux:

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
NODE_ENV=development
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=ci360_realtime
DB_USER=root
DB_PASSWORD=your-local-mysql-password
DB_CONNECTION_LIMIT=10
SEED_DEMO_DATA=true
SUPER_ADMIN_ID=superadmin
SUPER_ADMIN_PASSWORD="replace-with-a-strong-super-admin-password"
SUPER_ADMIN_NAME=Super Admin
SUPER_ADMIN_EMAIL=owner@example.com
```

### 3. Install packages

From the project root:

```bash
npm install
```

### 4. Start frontend and backend

```bash
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/api/health`

Demo logins are inserted only when the database has no clients and `SEED_DEMO_DATA=true`:


- Client: `acme` / `acme123`
- Client: `beta` / `beta123`

## Production build test

```bash
npm run build
npm start
```

The React build is copied into `server/dist/public`, and the Express application serves both the frontend and API.

## Hostinger Node.js App Hosting setup

### 1. Create MySQL database in hPanel

In hPanel, create a MySQL database and database user. Save the database name, username and password. For a Hostinger Node.js application using a database on the same hosting account, use `localhost` as the database host and port `3306`.

### 2. Upload the ZIP or connect GitHub

Create a Node.js Web App in hPanel and upload this project ZIP, or deploy it from a GitHub repository.

### 3. Configure build and start commands

Use:

```text
Build command: npm install && npm run build
Start command: npm start
```

The project root must be the folder containing the root `package.json`.

### 4. Add Hostinger environment variables

Add these through the Node.js app deployment screen or import an edited copy of `hostinger.env.example`:

```env
NODE_ENV=production
CLIENT_ORIGIN=https://your-domain.com
JWT_SECRET=use-a-long-random-production-secret
DB_HOST=localhost
DB_PORT=3306
DB_NAME=u123456789_ci360
DB_USER=u123456789_ci360user
DB_PASSWORD=your-hostinger-mysql-password
DB_CONNECTION_LIMIT=10
SEED_DEMO_DATA=false
SUPER_ADMIN_ID=your-super-admin-login-id
SUPER_ADMIN_PASSWORD="replace-with-a-strong-super-admin-password"
SUPER_ADMIN_NAME=Super Admin
SUPER_ADMIN_EMAIL=owner@example.com
```

Do not publish your real database password, JWT secret, or Super Admin password. Hostinger supplies the application port at runtime, so the server reads `process.env.PORT` automatically.

### 5. Database schema

On the first successful startup, the backend creates all required MySQL tables automatically.

For manual setup, open phpMyAdmin and import:

```text
database/mysql-schema.sql
```

### 6. First production administrator

For production, keep `SEED_DEMO_DATA=false` and set `SUPER_ADMIN_ID`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME`, and `SUPER_ADMIN_EMAIL`. On startup, the backend creates that account if it does not exist, or upgrades the existing matching user ID to the protected Super Admin role. If `SUPER_ADMIN_PASSWORD` is set, the matching account password is reset to that value on startup.

If the password contains `#`, `&`, `%`, or spaces, wrap it in quotes in `.env` files. In Hostinger's environment variable UI, enter the raw value exactly once, without adding extra quote characters unless hPanel explicitly asks for dotenv-style content.

### 7. Verify deployment

Visit:

```text
https://your-domain.com/api/health
```

Expected response:

```json
{"ok":true}
```

Then open the main domain and test login, job creation and support ticket creation. Confirm records appear in phpMyAdmin.

## Important files

```text
client/                    React frontend
server/src/index.js        Express API and Socket.IO server
server/src/db.js           MySQL pool, schema, transactions and seed data
database/mysql-schema.sql  Optional phpMyAdmin schema import
server/.env.example        Localhost environment template
hostinger.env.example      Hostinger environment template
CONTRIBUTING.md            Developer workflow for branches, builds and PRs
docs/github-team-setup.md  GitHub team, review and branch protection checklist
```
