-- Seed paket & harga per PRD §3.1 dan Keputusan #1 (§17.1)
INSERT INTO plans (code, name, kind, price_idr, min_students, max_students, exam_quota, duration_days, description, sort_order) VALUES
('free_trial',      'Gratis / Trial',        'trial',    0,      1,  10,  1,  14, 'Trial 14 hari untuk 1–10 siswa, 1x ujian, fitur lengkap', 1),
('per_exam_small',  'Per Ujian — Kecil',     'per_exam', 10000,  11, 40,  3,  NULL, '11–40 siswa · 3x ujian · tidak kedaluwarsa', 2),
('per_exam_medium', 'Per Ujian — Menengah',  'per_exam', 20000,  41, 70,  7,  NULL, '41–70 siswa · 7x ujian · tidak kedaluwarsa', 3),
('per_exam_large',  'Per Ujian — Besar',     'per_exam', 30000,  71, 100, 12, NULL, '71–100 siswa · 12x ujian · tidak kedaluwarsa', 4),
('monthly_medium',  'Bulanan — Menengah',    'monthly',  50000,  1,  50,  NULL, 30, '1–50 siswa · ujian tanpa batas · per bulan', 5),
('monthly_large',   'Bulanan — Besar',       'monthly',  70000,  51, 100, NULL, 30, '51–100 siswa · ujian tanpa batas · per bulan', 6)
ON CONFLICT (code) DO NOTHING;
