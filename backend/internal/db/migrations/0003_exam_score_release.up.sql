-- Migration 0003: penanda rilis nilai pada ujian + paket soal yang
-- dikunci per attempt (urutan soal/opsi stabil sepanjang pengerjaan).

ALTER TABLE exams ADD COLUMN IF NOT EXISTS score_released BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS package_json JSONB NOT NULL DEFAULT '{}'::jsonb;
