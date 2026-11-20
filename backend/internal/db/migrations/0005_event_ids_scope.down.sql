-- Down 0005 — kembalikan unik global client_event_id.
--
-- Aman: UP sudah melakukan dedupe (hanya id terkecil yang tersisa), sehingga
-- client_event_id global-nya unik dan constraint di bawah ini dapat dibuat
-- ulang tanpa konflik. Jadwal partisi/performa index global kembali seperti
-- semula (dengan konsekuensi bug tabrakan lintas attempt kembali aktif —
-- JANGAN dipakai di produksi setelah UP diterapkan).

DROP INDEX IF EXISTS idx_events_attempt_client_id;
DROP INDEX IF EXISTS idx_viol_attempt_client_id;

CREATE UNIQUE INDEX idx_events_client_id ON attempt_events (client_event_id);
ALTER TABLE attempt_violations
  ADD CONSTRAINT attempt_violations_client_event_id_key UNIQUE (client_event_id);
