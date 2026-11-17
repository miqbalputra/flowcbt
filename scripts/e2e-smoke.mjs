import { req } from './http.mjs';

// C-11: kumpulkan kegagalan dan akhiri dengan exit code non-nol.
// Sebelumnya helper ini hanya console.log, sehingga `set -e` di smoke.sh tidak pernah
// menangkap kegagalan dan CI menganggap smoke selalu hijau.
let failures = 0;
let total = 0;
const ok = (name, cond, extra='') => {
  total++;
  if (!cond) failures++;
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
};

// 1. guru baru + tenant trial
const email = 'guru' + Date.now() + '@s.sch.id';
let r = await req('POST', '/api/v1/auth/register', {name:'Guru Uji', email, password:'password123', tenant_name:'SMP Uji ' + Date.now(), level:'smp_mts'});
ok('register', r.status === 201);
r = await req('POST', '/api/v1/auth/login', {email, password:'password123'});
const T = r.body.data.tokens.access_token;
const tenant = r.body.data.user.tenant_id;
ok('login guru', r.status === 200);

// 2. kelas + siswa (akun)
r = await req('POST', '/api/v1/classes', {name:'IX A', academic_year:'2026/2027'}, T);
const classId = r.body.data.id;
r = await req('POST', '/api/v1/students', {name:'Ahmad Fauzi', gender:'L', class_id: classId, nis:'1001'}, T);
const student = r.body.data;
ok('siswa dibuat dgn kredensial', r.status === 201, student.username);

// 3. paket soal 5 tipe + publish
r = await req('POST', '/api/v1/question-sets', {subject_name:'MTK', title:'UH Bab 2', exam_code:'UJI' + Math.floor(Math.random()*999)}, T);
const qsId = r.body.data.id;
const qs = [
 {type:'mcq', body_html:'<p>2+2?</p>', options_json:[{id:'A',html:'4'},{id:'B',html:'5'}], answer_key_json:{correct:'A'}, points:10},
 {type:'mcq_complex', body_html:'<p>Prima?</p>', options_json:[{id:'A',html:'2'},{id:'B',html:'4'},{id:'C',html:'3'}], answer_key_json:{correct:['A','C']}, points:10, scoring_mode:'partial'},
 {type:'matching', body_html:'<p>Pasangkan</p>', options_json:{left:[{id:'L1',html:'A'},{id:'L2',html:'B'}],right:[{id:'R1',html:'X'},{id:'R2',html:'Y'}]}, answer_key_json:{pairs:{L1:'R1',L2:'R2'}}, points:10, scoring_mode:'partial'},
 {type:'short_answer', body_html:'<p>5*3?</p>', answer_key_json:{accepted:['15']}, points:10},
 {type:'essay', body_html:'<p>Jelaskan!</p>', rubric_json:{max_points:10}, points:10},
];
const qids = [];
for (const q of qs) {
  r = await req('POST', `/api/v1/question-sets/${qsId}/questions`, q, T);
  if (r.status !== 201) console.log('  add q fail', q.type, JSON.stringify(r.body));
  qids.push(r.body.data?.id);
}
r = await req('GET', `/api/v1/question-sets/${qsId}/questions`, null, T);
ok('5 soal tersimpan', r.body.data?.length === 5, 'count=' + r.body.data?.length);
// pastikan tidak ada kunci di respons? (guru memang boleh lihat kunci; yg penting tidak ke siswa)
r = await req('POST', `/api/v1/question-sets/${qsId}/publish`, {}, T);
ok('publish paket soal', r.status === 200, JSON.stringify(r.body.data));

// 4. buat ujian + penugasan kelas + publish (trial 1x) — AC-7
r = await req('POST', '/api/v1/exams', {question_set_id: qsId, name:'UH MTK IX A', open_at: new Date(Date.now()-60000).toISOString(), close_at: new Date(Date.now()+3600000).toISOString(), duration_minutes: 60, login_mode:'both', max_attempts: 1, passing_score: 60}, T);
ok('buat ujian', r.status === 201, JSON.stringify(r.body));
const examId = r.body.data.id;
r = await req('PUT', `/api/v1/exams/${examId}/assignments`, {class_ids:[classId], student_ids:[]}, T);
ok('penugasan kelas', r.status === 200);
r = await req('POST', `/api/v1/exams/${examId}/publish`, {}, T);
ok('publish ujian (trial kuota)', r.status === 200, JSON.stringify(r.body.data));
const token = r.body.data?.token;
ok('token ujian terbit', !!token, token);

// 5. login siswa (akun) — tenant code dari /me
r = await req('GET', '/api/v1/auth/me', null, T);
const tenantCode = r.body.data.tenant.code;
r = await req('POST', '/api/v1/student/auth/login', {tenant_code: tenantCode, username: student.username, password: student.password}, T);
ok('login siswa (akun)', r.status === 200, JSON.stringify(r.body).slice(0,120));
if (r.status !== 200) { console.log('STOP'); process.exit(1); }
const ST = r.body.data.tokens.access_token;

// 6. GET /me/exams
r = await req('GET', '/api/v1/me/exams', null, ST);
ok('siswa lihat daftar ujian', r.status === 200 && r.body.data?.length === 1, JSON.stringify(r.body.data?.[0]?.state));

// 7. start ujian (token) — paket tanpa kunci
r = await req('POST', `/api/v1/exams/${examId}/start`, {token}, ST);
ok('start ujian', r.status === 200, JSON.stringify(r.body.data?.exam?.name));
const attemptId = r.body.data?.attempt_id;
const packet = r.body.data;
ok('paket soal tanpa answer_key', packet.questions?.every(q => q.answer_key_json === undefined), 'q=' + packet.questions?.length);
ok('deadline dari server', !!packet.deadline_at);

// 8. sync jawaban (kirim 2x untuk tes idempotensi AC-3)
const ev = (qid, answer, seq) => ({client_event_id: crypto.randomUUID(), type:'answer', question_id: qid, payload: answer, seq, client_ts: new Date().toISOString(), elapsed_ms: seq*1000});
const q = packet.questions;
const byType = {}; for (const qq of q) byType[qq.type] = qq;
const answers = [
  ev(byType.mcq.id, {selected: 'A'}, 1),
  ev(byType.mcq_complex.id, {selected: ['A','C']}, 2),
  ev(byType.matching.id, {pairs: {L1:'R1', L2:'R2'}}, 3),
  ev(byType.short_answer.id, {text: '15'}, 4),
  ev(byType.essay.id, {text: 'Fotosintesis adalah proses tumbuhan mengubah cahaya menjadi energi.'}, 5),
];
r = await req('POST', `/api/v1/attempts/${attemptId}/answers:sync`, {events: answers}, ST);
ok('sync batch 1', r.status === 200 && r.body.data.acked.length === 5, JSON.stringify(r.body.data?.acked?.length));
const answersDup = answers.map((e) => ({...e})); // kirim ulang batch sama (idempoten via client_event_id)
r = await req('POST', `/api/v1/attempts/${attemptId}/answers:sync`, {events: answersDup}, ST);
ok('sync duplikat → ACK tanpa duplikasi (AC-3)', r.status === 200 && r.body.data.acked.every(a => a.duplicate === true), JSON.stringify(r.body.data?.acked?.map(a=>a.duplicate)));

// 9. submit
r = await req('POST', `/api/v1/attempts/${attemptId}/submit`, {client_event_id: crypto.randomUUID()}, ST);
ok('submit', r.status === 200, JSON.stringify(r.body));

// 10. hasil — ada essay → awaiting_manual_grading, nilai sementara
r = await req('GET', `/api/v1/attempts/${attemptId}/result`, null, ST);
console.log('  result:', JSON.stringify(r.body.data).slice(0,300));
ok('hasil: status awaiting_manual_grading (ada uraian)', r.body.data?.status === 'awaiting_manual_grading');
// nilai sementara: 4 soal objektif benar = 40/50 -> 80
ok('nilai sementara 80 (4 objektif benar)', Math.abs((r.body.data?.final_score ?? 0) - 80) < 0.01, 'final=' + r.body.data?.final_score);

// 11. guru koreksi uraian (skor 8/10) → nilai akhir (48/50*100=96)
r = await req('GET', `/api/v1/attempts/${attemptId}/grading`, null, T);
const essayRow = r.body.data?.find(x => x.type === 'essay');
ok('guru lihat grading', !!essayRow);
r = await req('PUT', `/api/v1/attempts/${attemptId}/answers/${essayRow.question_id}/score`, {score: 8, comment: 'Bagus, kurang detail', override_reason: 'koreksi manual'}, T);
ok('koreksi uraian', r.status === 200);
r = await req('GET', `/api/v1/attempts/${attemptId}/result`, null, ST);
ok('status graded & nilai akhir 96', r.body.data?.status === 'graded' && Math.abs(r.body.data.final_score - 96) < 0.01, 'final=' + r.body.data?.final_score + ' status=' + r.body.data?.status);

// 12. ujian kedua untuk tes penalti: buat exam baru? pakai reset attempt lalu mulai lagi dengan pelanggaran
//    (trial hanya 1x ujian — publish ujian ke-2 harus ditolak AC-7)
r = await req('POST', '/api/v1/exams', {question_set_id: qsId, name:'UH Kedua', open_at: new Date(Date.now()-60000).toISOString(), close_at: new Date(Date.now()+3600000).toISOString(), duration_minutes: 30}, T);
const exam2 = r.body.data.id;
await req('PUT', `/api/v1/exams/${exam2}/assignments`, {class_ids:[classId]}, T);
r = await req('POST', `/api/v1/exams/${exam2}/publish`, {}, T);
ok('publish ujian ke-2 tanpa kuota → ditolak AC-7 (402)', r.status === 402 && r.body.error?.code === 'QUOTA_EXCEEDED', JSON.stringify(r.body.error));

// 13. tes penalti: reset attempt lalu mulai lagi, kirim pelanggaran x4 (melebihi flag 3)
r = await req('POST', `/api/v1/exams/${examId}/participants/${student.id}/reset-attempt`, {}, T);
ok('reset attempt guru (404 wajar karena sudah graded)', r.status === 200 || r.status === 404, 'status='+r.status);
r = await req('POST', `/api/v1/exams/${examId}/start`, {token}, ST);
const att2 = r.body.data?.attempt_id;
ok('start ulang (percobaan 2 melebihi max 1?)', r.status === 200 || r.status === 409, 'status=' + r.status);
// max_attempts=1 & sudah 1 attempt → harus 409 (AC-6)
ok('batas percobaan AC-6 (409)', r.status === 409, JSON.stringify(r.body.error?.code));

// 14. laporan
r = await req('GET', '/api/v1/reports/history', null, T);
ok('laporan historis', r.status === 200 && Array.isArray(r.body.data));
r = await req('GET', `/api/v1/reports/exams/${examId}`, null, T);
ok('laporan detail ujian (avg)', r.status === 200 && r.body.data?.count >= 1, JSON.stringify(r.body.data).slice(0,150));
r = await req('GET', `/api/v1/reports/exams/${examId}/item-analysis`, null, T);
ok('analisis butir', r.status === 200 && r.body.data?.length === 5, 'count=' + r.body.data?.length);
r = await req('GET', `/api/v1/exams/${examId}/attempts`, null, T);
ok('rekap nilai per ujian', r.status === 200);
r = await req('GET', `/api/v1/students/${student.id}/track-record`, null, T);
ok('track record siswa', r.status === 200 && r.body.data?.attempts?.length >= 1);

// 15. billing: status trial, checkout mock paket per_exam, webhook mock → kredit, lalu publish ujian ke-2 bisa
r = await req('GET', '/api/v1/billing/subscription', null, T);
ok('status langganan trial', r.status === 200 && r.body.data?.trial_active === true, JSON.stringify(r.body.data));
r = await req('POST', '/api/v1/billing/checkout', {plan_code: 'per_exam_s', provider: 'mock'}, T, {'Idempotency-Key': 'idem-1'});
ok('checkout mock', r.status === 201, JSON.stringify(r.body.data?.order_id));
const orderId = r.body.data?.order_id;
r = await req('POST', '/api/v1/webhooks/payment/mock', {order_id: orderId, transaction_status: 'settlement'});
ok('webhook mock 1', r.status === 200);
r = await req('POST', '/api/v1/webhooks/payment/mock', {order_id: orderId, transaction_status: 'settlement'});
ok('webhook mock duplikat → tetap 200 tanpa ganda', r.status === 200);
r = await req('GET', '/api/v1/billing/subscription', null, T);
ok('kredit bertambah 3 (idempoten)', r.body.data?.credits_left === 3, 'credits_left=' + r.body.data?.credits_left);
r = await req('POST', `/api/v1/exams/${exam2}/publish`, {}, T);
ok('publish ujian ke-2 setelah beli kredit', r.status === 200, JSON.stringify(r.body.data));

// 16. login tamu (tanpa akun) — exam2 login_mode both
r = await req('POST', '/api/v1/exams/' + exam2 + '/start', {token: 'SALAH123'}, ST);
ok('token salah ditolak (TOKEN_INVALID)', r.status === 401 && r.body.error?.code === 'TOKEN_INVALID');
const exam2detail = await req('GET', `/api/v1/exams/${exam2}`, null, T);
const token2 = exam2detail.body.data.token;
const examCode = (await req('GET', `/api/v1/question-sets/${qsId}`, null, T)).body.data.exam_code;
r = await req('POST', '/api/v1/student/auth/guest', {exam_code: examCode, token: token2, name: 'Budi Tamu', gender: 'L', class_name: 'IX A', nis: ''});
ok('login tamu (tanpa akun)', r.status === 200, JSON.stringify(r.body.data?.student).slice(0,120));
const GT = r.body.data?.tokens?.access_token;
if (GT) {
  r = await req('GET', '/api/v1/me/exams', null, GT);
  ok('tamu melihat ujian', r.status === 200 && r.body.data?.length === 1);
}

// 17. RLS isolasi tenant (AC-9): resource tenant A tidak boleh terbaca dari tenant B.
const otherEmail = 'lain' + Date.now() + '@s.sch.id';
r = await req('POST', '/api/v1/auth/register', {name:'Guru Lain', email: otherEmail, password:'password123', tenant_name:'Sekolah Beda ' + Date.now(), level:'sd_mi'});
ok('register tenant B', r.status === 201, JSON.stringify(r.body.error || {}));
r = await req('POST', '/api/v1/auth/login', {email: otherEmail, password:'password123'});
const TB = r.body.data?.tokens?.access_token;
ok('login tenant B', r.status === 200 && !!TB);

// Kontrol: pemilik resource tetap bisa membacanya.
r = await req('GET', `/api/v1/question-sets/${qsId}`, null, T);
ok('tenant A bisa baca resource sendiri', r.status === 200 && r.body.data?.id === qsId);

// Uji utama: tenant B memakai ID tenant A harus ditolak (404/403), bukan mendapat datanya.
r = await req('GET', `/api/v1/question-sets/${qsId}`, null, TB);
ok('RLS: tenant B tidak bisa baca resource tenant A', r.status === 404 || r.status === 403, 'status=' + r.status);
r = await req('GET', `/api/v1/classes/${classId}`, null, TB);
ok('RLS: tenant B tidak bisa baca kelas tenant A', r.status === 404 || r.status === 403, 'status=' + r.status);

console.log(`--- DONE (${total - failures}/${total} lulus) ---`);
if (failures > 0) {
  console.error(`SMOKE GAGAL: ${failures} assertion tidak lulus`);
  process.exit(1);
}
