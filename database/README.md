# Database files

The app creates its MySQL tables automatically on first startup.

- `mysql-schema.sql`: optional manual schema import through phpMyAdmin.
- `mysql-import-existing-data.sql`: data exported from the SQLite database that was included in the original project.

For a clean production database, import only `mysql-schema.sql` or simply start the app with `SEED_DEMO_DATA=false`.
To preserve the original included records, import the schema first, then import `mysql-import-existing-data.sql`.
