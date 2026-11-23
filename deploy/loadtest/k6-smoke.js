// Uji beban k6 — FlowCBT smoke load test (audit P2 #5).
// Jalankan dari VPS (target internal):
//   k6 run deploy/loadtest/k6-smoke.js
//   # atau eksplisit: k6 run -e BASE=http://127.0.0.1:8080 deploy/loadtest/k6-smoke.js
//   # BASE tanpa /api/v1 otomatis dilengkapi.
//
// Pemodelan beban sekolah nyata:
//  - guru/monitor: satu login (setup) → token dibagi VU → loop GET ujian,
//    dashboard live, riwayat (pemantauan = pola dominan lalu lintas).
//  - siswa: sampel kecil /student/auth/card-lookup (endpoint publik dengan
//    rate-limit ketat — sengaja VU rendah agar RL tidak mendominasi hasil).
// Threshold: p95 < 1.5s, error rate < 1% (baseline alat uji 2 vCPU).

import http from 'k6/http';
import { check, sleep } from 'k6';

let BASE = __ENV.BASE || 'http://127.0.0.1:8080/api/v1';
if (!BASE.endsWith('/api/v1')) BASE = BASE.replace(/\/$/, '') + '/api/v1';
const TEACHER = __ENV.TEACHER_EMAIL || 'guru@demo.cbt';
const TEACHER_PASS = __ENV.TEACHER_PASS || 'Guru#12345';

export const options = {
  scenarios: {
    guru_monitor: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 30 },
        { duration: '10s', target: 0 },
      ],
      exec: 'guru',
    },
    siswa_masuk: {
      executor: 'constant-vus',
      vus: 1,
      duration: '50s',
      exec: 'siswa',
    },
  },
  thresholds: {
    'http_req_duration{scenario:guru_monitor}': ['p(95)<1500'],
    'http_req_duration{scenario:siswa_masuk}': ['p(95)<1500'],
    'http_req_failed{scenario:guru_monitor}': ['rate<0.01'],
  },
};

// Login sekali saja: access token berlaku 15 menit; login sendiri di-rate-limit
// per-IP dan per-akun, jadi menghujani /auth/login bukan model beban nyata
// (di sekolah tiap guru punya akun sendiri & login jarang).
export function setup() {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({
    email: TEACHER,
    password: TEACHER_PASS,
  }), { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) {
    console.error(`setup login status=${res.status} body=${res.body}`);
  }
  check(res, { 'setup login 200': (r) => r.status === 200 });
  const tok = res.json('access_token');
  if (!tok) {
    throw new Error('setup: login guru gagal — periksa TEACHER_EMAIL/TEACHER_PASS');
  }
  return { token: tok };
}

export function guru(data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };

  const exams = http.get(`${BASE}/exams`, auth);
  check(exams, { 'daftar ujian 200': (r) => r.status === 200 });

  const live = http.get(`${BASE}/reports/live`, auth);
  check(live, { 'dashboard live 200': (r) => r.status === 200 });

  const history = http.get(`${BASE}/reports/history`, auth);
  check(history, { 'riwayat 200': (r) => r.status === 200 });
  sleep(1);
}

// card-lookup: 401 wajar bila ujian demo sudah tutup / kartu bukan milik
// ujian aktif; 429 wajar di akhir burst (RL 30/menit/IP). Metrik gagal
// dihitung hanya untuk 5xx.
export function siswa() {
  // 401/429 = perilaku yang diharapkan → jangan ditandai gagal k6.
  http.setResponseCallback(http.expectedStatuses(200, 401, 429, 400));
  const res = http.post(`${BASE}/student/auth/card-lookup`, JSON.stringify({
    exam_code: __ENV.EXAM_CODE || 'DEMO01',
    token: __ENV.EXAM_TOKEN || 'L4EJXB',
    card_number: __ENV.CARD_NUMBER || 'TS26-NWY0-G',
  }), { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'kartu masuk 200/401/429': (r) => [200, 401, 429, 400].includes(r.status) });
  sleep(2);
}
