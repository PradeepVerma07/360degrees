Verification: Productivity Role integration

This file documents quick verification steps and expected outputs for the `responsibilityKey` (Role) support added to productivity jobs.

Prerequisites
- MySQL database accessible and migrated (see `database/migrations/20260813_add_responsibility_key.sql`).
- Server dev dependencies installed in `server/` (`npm install`).
- Server running (recommended `npm run dev` from `server/`).

Quick manual test (curl)

1) Fetch meta (requires authenticated internal user). If running locally with demo seed enabled, you may use the demo login flow. For an already-authenticated environment where cookies/tokens are set, run:

```bash
curl -s -X GET http://localhost:4000/api/productivity/meta | jq .
```

2) Post a sample job (no auth shown here; use the `scripts/test_productivity_role.ps1` PowerShell script or include appropriate `Authorization` header if required):

```bash
curl -s -X POST http://localhost:4000/api/productivity/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "clientId":"<clientId>",
    "startDate":"2026-08-13",
    "valueAmount":1000,
    "description":"Integration test job",
    "serviceIds":[<serviceId>],
    "assignments":[{"userId":"<userId>","revenuePercent":100,"hoursSpent":2,"responsibilityKey":"owner"}]
  }'
```

Expected successful response (HTTP 201): JSON object containing `job` with assignments. Each assignment should include `responsibilityKey` with the chosen role key, for example:

```json
{
  "job": {
    "id": "123",
    "clientId": "client1",
    "assignments": [
      {
        "id": "456",
        "userId": "ci360admin",
        "userName": "Demo Admin",
        "responsibilityKey": "owner",
        "revenuePercent": 100,
        "hoursSpent": 2
      }
    ]
  }
}
```

PowerShell quick test

Run the test script added at `scripts/test_productivity_role_post.ps1`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test_productivity_role_post.ps1
```

Notes and troubleshooting
- If the server responds with `Database is not ready`, wait until the server logs `CI360 database ready` or check DB credentials in environment variables.
- If validation fails with `One or more responsibility/role keys are invalid`, ensure the `productivity_responsibilities` table contains the expected keys (see `database/migrations/20260813_add_responsibility_key.sql`).
- For full end-to-end tests, run `npm run test:integration` from `server/` after `npm install`.

Contact me if you want this converted into an automated test (Mocha/Jest) that runs as part of CI.