# database

SQL database client for Muxy — SQLite, MySQL, MariaDB, and PostgreSQL.

## Features

- Connection manager with groups, colors, test connection, and URL import
- Schema browser: databases, schemas, tables, views, columns, indexes, foreign keys, triggers, routines
- Data grid with pagination, sorting, filtering, and inline editing (pending changes reviewed as SQL before applying)
- SQL editor with syntax highlighting, schema-aware autocomplete, multiple query tabs, history, saved queries, and EXPLAIN
- Structure view with DDL, create/drop table and index, truncate
- Export to CSV/JSON/SQL, CSV import, and full database dumps
- SSH tunneling for remote databases

## Requirements

Databases are reached through their command-line clients via `muxy.exec`:

- SQLite: `sqlite3` (ships with macOS)
- PostgreSQL: `psql` and `pg_dump` (`brew install libpq && brew link --force libpq`)
- MySQL: `mysql` and `mysqldump` (`brew install mysql-client`)
- MariaDB: `mariadb` and `mariadb-dump` (`brew install mariadb`)

## Security

- Passwords are stored in the macOS Keychain (service `muxy-database`), never in extension storage.
- Every database command runs as a plain argument vector (no shell). At connect time the password is written to a private `0600` credential file in a temporary directory (a `passfile` for PostgreSQL, a `--defaults-extra-file` for MySQL/MariaDB), which the CLI reads directly — so the password never appears in a command line or the process list. The file is deleted when you disconnect or close the tab.
- Because commands are argument vectors, Muxy's "Allow & remember" applies per client binary (`psql`, `mysql`, `sqlite3`, …), so you approve each tool once instead of being prompted per query.
- When the Keychain is unavailable (remote workspaces), passwords are prompted per session and kept only in memory for the credential file.
- SSH tunnels authenticate with your ssh-agent or a key file only; password prompts are disabled (`BatchMode=yes`).

## Remote workspaces

Commands run on the remote host, so the database CLIs must be installed there, file paths are remote paths, and passwords are prompted per session instead of using the Keychain.

## Building

```bash
npm install
npm run build
```

Then use Load Unpacked in Muxy's Extensions modal and Reload after each rebuild.
