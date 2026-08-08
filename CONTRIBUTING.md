# Contributing

## Local Setup

1. Install Node.js 20 or newer.
2. Run `npm install` from the project root.
3. Copy `server/.env.example` to `server/.env`.
4. Update the MySQL values in `server/.env`.
5. Run `npm run dev`.

## Branch Workflow

- Keep `main` deployable.
- Create feature branches from `main`.
- Use branch names like `feature/support-ticket-filter`, `fix/login-error-state`, or `chore/update-hostinger-docs`.
- Open a pull request back into `main`.
- Request review from the app owner or GitHub team listed in `.github/CODEOWNERS`.

## Before Opening a Pull Request

- Run `npm run build`.
- Test the affected React page, API route, or deployment flow.
- Include screenshots for UI changes.
- Note any MySQL schema or environment variable changes in the pull request.
- Confirm no secrets, `.env` files, database exports, or credentials are committed.

## Release Notes

When a pull request affects Hostinger deployment, add:

- Build command changes
- Start command changes
- Environment variable changes
- Database import or migration notes
- Verification URL or health check notes
