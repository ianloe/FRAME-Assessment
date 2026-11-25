# Deployment, TLS, and Backup Guide

## Reverse Proxy & TLS (Caddy Example)

Place Caddy or Nginx in front of the `web` service on port `8080`. Ensure `APP_BASE_URL`, `CORS_ORIGIN`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_ID` in `.env` match your public HTTPS domain.

Example `Caddyfile`:
```caddyfile
frame.example.com {
    encode gzip zstd
    reverse_proxy localhost:8080
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

## Backup and Restore

Use `scripts/backup.sh` to create a timestamped PostgreSQL dump and uploads archive:
```bash
./scripts/backup.sh ./backups
```

To restore from a backup:
```bash
./scripts/restore.sh ./backups/frame-db-YYYYMMDD-HHMMSS.sql.gz ./backups/frame-uploads-YYYYMMDD-HHMMSS.tar.gz
```
