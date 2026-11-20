-- 0002: dukungan sesi siswa (modul internal/students).
--
-- refresh_tokens untuk typ='student' menyimpan ID SISWA (tabel students) pada
-- kolom user_id (sesuai kontrak claims siswa: UserID = SID = students.id),
-- sehingga FOREIGN KEY ke users tidak bisa dipertahankan. Integritas data
-- staff tetap dijaga di layer aplikasi (modul users selalu menulis user_id
-- dari tabel users).
ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_user_id_fkey;

-- Lookup login siswa by NIS.
CREATE INDEX IF NOT EXISTS idx_students_nis ON students (nis);
