# Enterprise RBAC and Job Board Upgrade

This repository has been upgraded in-place around the existing React/Vite + Express/Socket.IO + MySQL job board. The upgrade deliberately preserves the existing TAT calculation and support-ticket conversation model while completing and hardening the partially implemented RBAC foundation.

## Implemented in this update

### Access and security
- Protected account hierarchy: Super Admin, Admin, Employee and Client.
- Existing database-driven roles, role permissions and per-user grant/revoke overrides remain the single RBAC source of truth.
- Super Admin always resolves to the complete permission catalog and cannot be stripped by overrides.
- Client accounts are forcibly limited to the client-safe permission allowlist, even if unsafe legacy role rows exist.
- Delegated administrators cannot manage users/roles at or above their own role level or grant permissions they do not have.
- A final active Super Admin cannot be deactivated.
- Production startup now requires `JWT_SECRET`; the development fallback is not accepted in production.
- Login attempts are throttled in memory (8 failed attempts per IP/login identifier per 15-minute window).
- `/api/bootstrap` now removes jobs, tickets and administrative TAT configuration when the authenticated user lacks the corresponding permissions.
- Client, job, support-ticket and attachment access is validated server-side.

### Organization and users
- Employee Management supports create/edit flows with Employee ID, joining date, department, designation and reporting manager.
- Employee IDs are uniqueness-checked.
- Reporting-manager validation rejects self-reference and circular hierarchy chains.
- Users & Roles supports database roles, role-level permission editing and per-user overrides.
- Permission override UI shows inherited and effective access.
- Department and designation management remain database-driven.
- Employees with `clients.create` can create clients in their own scope.

### Client management
- Client records support contact name, email, phone, industry, account owner and status.
- Optional `Create Client Login` creates the client and protected Client user atomically.
- Client ownership defaults to the creating internal user unless an authorised owner is selected.
- Users without `clients.view_all` only receive clients they own/created (or their own client organisation for Client accounts).
- Client status/password changes are synchronised to linked login users.

### Job board
- Existing TAT calculation and stored historical hours are preserved.
- Internal job assignment and reassignment validate active internal assignees.
- Assignment changes are transactional and audited.
- New `job_assignments` history records assignee, department, actor, note and timestamp.
- Internal job cards can inspect assignment history.
- `GET /api/jobs` and `GET /api/jobs/:id` provide permission-scoped list/detail APIs.
- Job creation derives the Client organisation from authentication for Client users and validates accessible clients for internal users.
- Client job responses omit internal TAT notes and assignment metadata.

### Support
- Support ticket attachments are authorised through the parent ticket/client scope.
- Clearing ticket conversation history requires `support.manage`; ordinary Clients cannot erase the conversation history.
- Support UI respects create/reply/manage permissions instead of showing actions that the API will reject.
- New support tickets use the neutral `TKT-######` prefix; historical ticket IDs are untouched.

### UI and branding
- Visible product branding uses the existing icon/logo mark only in the login and dashboard shell.
- Dashboard modules are generated from effective backend permissions; an empty permission set no longer falls back to an Admin/Client hard-coded menu.
- Role-specific overview metrics are provided for Super Admin, Admin, Employee and Client.
- Client and Employee management screens were modernised without replacing the existing dashboard design system.
- Placeholder password-reset/Admin-signup forms were changed to explicit disabled states so they no longer pretend to perform production actions.

## Database migration

The runtime initializer in `server/src/db.js` remains idempotent and now also creates/indexes assignment history. For managed deployments, apply:

```sql
SOURCE database/2026-08-enterprise-rbac-job-board.sql;
```

The migration is additive. Back up the database before production deployment.

## Required production environment

At minimum configure:

```env
NODE_ENV=production
JWT_SECRET=<long-random-secret>
DB_HOST=...
DB_PORT=3306
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
CLIENT_ORIGIN=https://your-frontend-origin.example
```

For the controlled initial Super Admin bootstrap, configure the existing environment mechanism:

```env
SUPER_ADMIN_ID=<stable-user-id>
SUPER_ADMIN_EMAIL=<email>
SUPER_ADMIN_NAME=<display-name>
SUPER_ADMIN_PASSWORD=<initial-strong-password>
```

After initial provisioning, rotate credentials according to your deployment policy.

## Default role model

| Capability | Super Admin | Admin | Employee | Client |
|---|---:|---:|---:|---:|
| Dashboard | Yes | Yes | Yes | Yes |
| All jobs | Yes | Yes | No | No |
| Own/assigned jobs | Yes | Yes | Yes | Own organisation |
| Create jobs | Yes | Yes | Yes | Yes |
| Assign jobs | Yes | Yes | No | No |
| TAT administration | Yes | Yes by default | No | No |
| All clients | Yes | Yes by default | No | No |
| Owned clients | Yes | Yes | Yes | Own organisation only |
| Create clients | Yes | Yes by default | Role permission | No |
| Employees | Yes | Permission-driven | Permission-driven | Never |
| Users & Roles | Yes | Permission-driven | Permission-driven | Never |
| Audit logs | Yes | Permission-driven | Permission-driven | Never |
| Support | All | All by default | Own/authorised | Own organisation |

Every non-Super-Admin default can be changed through role permissions/user overrides, subject to hierarchy and Client safety rules.

## Validation performed in this workspace

- `node --check` passed for all server source files.
- TypeScript's parser/transpiler successfully parsed all 12 JavaScript/JSX source files.
- `npm test` passed 4 RBAC catalog/invariant tests.
- A full Vite production build could not be executed because the sandbox package registry returned a 404 for the pinned Vite package and the public-registry retry was blocked by the container environment. This is an environment dependency-fetch issue; run `npm ci && npm run build` in CI or a normal internet-connected development environment before deployment.

## Intentionally deferred / next production iteration

These items from the broader master brief were not forced into this patch because they require a larger navigation/infrastructure migration or new product decisions:

- React Router migration and deep-link route guards (current permission-driven tab navigation is preserved).
- SQL-native pagination for the new jobs endpoint (the endpoint is scoped correctly but currently paginates after loading the authorised set).
- Support-ticket employee assignment workflow and internal-note model.
- Secure email-backed self-service password reset and invitation service.
- Google OAuth integration.
- Moving base64 support attachments to object/file storage for high-volume deployments.

These are documented rather than represented by fake UI.
