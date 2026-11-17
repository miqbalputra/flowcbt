# Backup & Restore FlowCBT (C-06)

## Kebijakan

| Item | Nilai |
|---|---|
| Backup penuh | harian (`pg_dump -Fc`) |
| Retensi lokal | 14 hari |
| Retensi object storage | 14 hari |
| Target RPO | ≤ 5 menit (**butuh WAL archiving / managed backup** — `pg_dump` harian saja tidak cukup) |
| Target RTO | ≤ 30 menit |
| Restore drill | bulanan ke database ephemeral |

## Menjalankan backup

```bash
BACKUP_DIR=/var/backups/flowcbt \
DATABASE_URL='postgres://postgres:***@127.0.0.1:5432/flowcbt?sslmode=disable' \
BACKUP_S3_URI='s3://bucket-flowcbt/backup' \
  bash scripts/backup.sh
```

> **WAL archiving (wajib untuk RPO ≤ 5 menit):** aktifkan `archive_mode=on` dan
> `archive_command` ke WAL-G/WAL-E, atau gunakan managed backup Coolify. Verifikasi
> arsip WAL bisa dipulihkan — jangan hanya mengandalkan dump harian.

## Restore drill (bulanan)

```bash
# 1. Buat DB ephemeral
createdb -h 127.0.0.1 flowcbt_restore

# 2. Restore
DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/flowcbt_restore?sslmode=disable' \
  bash scripts/restore.sh /var/backups/flowcbt/flowcbt-YYYYmmddTHHMMSSZ.dump

# 3. Regresi
cd backend
DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/flowcbt_restore?sslmode=disable' \
  go test ./test/integration/... -count=1

# 4. Catat hasil di tabel drill di bawah
```

## Catatan drill

| Tanggal | Dump | Durasi | Hasil | Operator |
|---|---|---|---|---|
| — | — | — | belum dijalankan | — |

> Backup tanpa restore test bukan backup. Jika drill gagal, perbaiki prosedur ini
> sebelum menganggap backup siap produksi.
