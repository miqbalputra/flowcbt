# SLO FlowCBT (C-09)

| Indikator | Target | Cara ukur |
|---|---|---|
| Availability API & web | 99,5% / bulan | uptime probe `/livez` dari monitoring eksternal |
| Latensi p95 endpoint baca | < 300 ms | `http_request_duration_seconds` (Rencana: `/metrics`) |
| Latensi p95 `answers:sync` | < 500 ms | histogram route `/attempts/*/answers:sync` |
| Keberhasilan ACK jawaban | > 99,9% | `acked` sukses / total event |
| Update SSE laporan live | < 3 detik | E2E dua browser (guru + siswa) |
| RPO / RTO | ≤ 5 menit / ≤ 30 menit | lihat `BACKUP-RESTORE.md` + drill bulanan |

## Error budget

- 99,5% availability ≈ 3,6 jam downtime/bulan.
- Jika error budget terpakai > 50% dalam seminggu: **freeze fitur**, prioritas ke reliabilitas.
- Deploy saat ujian aktif diblokir oleh `scripts/check-deploy-freeze.sh` (C-08).

## Alert yang mengikat SLO

1. 5xx > 1% selama 5 menit.
2. `active_exams > 0` tetapi `sse_clients == 0`.
3. `email_outbox_pending` terus naik > 15 menit.
4. Worker heartbeat hilang > 2 menit.
5. RLS violation / percobaan lintas tenant.
6. Disk/storage > 80%.
