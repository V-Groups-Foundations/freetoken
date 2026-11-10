# Database backups

The online database (Neon) is backed up every day at 03:30 Japan time by the **Database backup**
GitHub Actions workflow (`.github/workflows/db-backup.yml`). Each backup is a `pg_dump` (custom
format) encrypted with AES-256 and kept as a workflow artifact for 30 days. The repository is public,
so the dump is never stored unencrypted.

Secrets (repository → Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `BACKUP_DATABASE_URL` | Neon's **direct** (not `-pooler`) connection string |
| `BACKUP_PASSPHRASE` | the encryption passphrase — also in the owner's `.env.local` as `BACKUP_PASSPHRASE` |

Without the passphrase a backup can't be opened, so keep a copy somewhere safe besides `.env.local`.

## Run one now

```sh
gh workflow run "Database backup"
```

## Restore

```sh
gh run download <run-id> --name freetoken-db-<stamp>       # gh run list --workflow "Database backup"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in freetoken-<stamp>.dump.enc -out db.dump -pass env:BACKUP_PASSPHRASE
pg_restore --list db.dump | head                          # look before restoring
pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DATABASE_URL" db.dump
```

Restore into a new Neon branch first (Neon console → Branches → Create) and check it there before
pointing the app at it. Provider keys inside are encrypted with `VAULT_MASTER_KEY`; restoring them to
an install with a different master key leaves them unreadable.

The laptop also keeps copies of its old embedded database in `.data/backups/`.
