-- 0005 — scope unik client_event_id per attempt (bukan lagi global).
--
-- BUG: idx_events_client_id (attempt_events.client_event_id unik GLOBAL,
-- 0001:343) dan attempt_violations.client_event_id UNIQUE (0001:356)
-- membuat client_event_id unik lintas attempt. Tab/browser berbeda yang
-- menghasilkan client_event_id sama (klien tanpa UUID acak, atau counter
-- per-tab yang terulang) berbenturan dengan attempt LAIN: insert gagal lewat
-- ON CONFLICT DO NOTHING padahal event itu BELUM pernah tiba untuk attempt
-- tersebut — event dianggap "ter-ACK" lalu hilang (antrean offline macet).
--
-- Langkah idempoten & aman terhadap data eksisting:
--   1. Dedupe: hapus duplikat lintas attempt, simpan id TERKECIL
--      (entri tertua dipertahankan).
--   2. Buang index unik global attempt_events & constraint unik kolom
--      attempt_violations.
--   3. Buat unik baru berscope per attempt: (attempt_id, client_event_id).
-- Konsumen harus menyesuaikan ON CONFLICT → (attempt_id, client_event_id).

DELETE FROM attempt_events a USING attempt_events b
  WHERE a.client_event_id = b.client_event_id AND a.id > b.id;

DELETE FROM attempt_violations a USING attempt_violations b
  WHERE a.client_event_id = b.client_event_id AND a.id > b.id;

DROP INDEX IF EXISTS idx_events_client_id;
ALTER TABLE attempt_violations
  DROP CONSTRAINT IF EXISTS attempt_violations_client_event_id_key;

CREATE UNIQUE INDEX idx_events_attempt_client_id
  ON attempt_events (attempt_id, client_event_id);
CREATE UNIQUE INDEX idx_viol_attempt_client_id
  ON attempt_violations (attempt_id, client_event_id);
