// Audit aksesibilitas otomatis (FR-11.3) — axe-core via Playwright.
// Jalankan: pnpm tsx axe-audit.ts  (butuh API :8090, web teacher :5173, web student :5174)
// Scan halaman publik + halaman terautentikasi guru (refresh token di localStorage)
// dan login siswa via /login siswa. Output: pelanggaran critical/serious/moderate.
import { chromium, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const API = process.env.API_ORIGIN || 'http://127.0.0.1:8090/api/v1';
const TEACHER = process.env.TEACHER_ORIGIN || 'http://127.0.0.1:5173';
const STUDENT = process.env.STUDENT_ORIGIN || 'http://127.0.0.1:5174';

async function api(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

interface Finding { page: string; id: string; impact: string; nodes: string[]; help: string }

async function scan(page: Page, name: string, out: Finding[]) {
  // tunggu aplikasi siap (React render) & data query selesai
  await page.waitForTimeout(1200);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  for (const v of results.violations) {
    if (!v.impact || v.impact === 'minor') continue;
    out.push({
      page: name, id: v.id, impact: v.impact as string,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    });
  }
  console.log(`scanned ${name}: ${results.violations.length} violations`);
}

async function main() {
  const email = `axe${Date.now()}@s.sch.id`;
  let r = await api('POST', '/auth/register', {
    name: 'Guru A11y', email, password: 'password123', tenant_name: 'SMP A11y ' + Date.now(), level: 'smp_mts',
  });
  if (r.status !== 201) throw new Error('register gagal: ' + r.status + ' ' + JSON.stringify(r.body));
  r = await api('POST', '/auth/login', { email, password: 'password123' });
  const token = r.body.data.tokens.access_token as string;
  const refresh = r.body.data.tokens.refresh_token as string;
  const tenantCode = r.body.data.user?.tenant?.code ?? r.body.data.user?.tenant_code;
  // smoke pakai /auth/me untuk kode tenant
  const meResp = await api('GET', '/auth/me', undefined, token);
  const code = meResp.body?.data?.tenant?.code ?? tenantCode;
  if (!code) throw new Error('kode tenant tidak ditemukan: ' + JSON.stringify(meResp.body).slice(0, 300));

  // siapkan data: kelas + siswa (untuk halaman daftar tidak kosong)
  r = await api('POST', '/classes', { name: 'IX A11y', academic_year: '2026/2027' }, token);
  const classId = r.body?.data?.id;
  await api('POST', '/students', { name: 'Ahmad A11y', gender: 'L', class_id: classId, nis: '1101' }, token);

  const findings: Finding[] = [];
  const browser = await chromium.launch();

  // ---- Teacher app ----
  const tctx = await browser.newContext();
  await tctx.addInitScript((rt) => localStorage.setItem('flowcbt-refresh', rt), refresh);
  const page = await tctx.newPage();

  await page.goto(TEACHER + '/login', { waitUntil: 'networkidle' });
  await scan(page, 'teacher /login', findings);

  await page.goto(TEACHER + '/register', { waitUntil: 'networkidle' });
  await scan(page, 'teacher /register', findings);

  const teacherRoutes = [
    '/dashboard', '/students', '/classes', '/question-sets', '/exams', '/exams/new',
    '/reports/history', '/reports/live', '/billing', '/settings',
    '/admin/tenants', '/admin/plans', '/admin/payments', '/admin/metrics',
  ];
  for (const p of teacherRoutes) {
    await page.goto(TEACHER + p, { waitUntil: 'networkidle' });
    await scan(page, 'teacher ' + p, findings);
  }

  // A-09: audit dark mode (kontras tombol danger & badge sebelumnya belum teruji).
  // ThemeProvider memakai 'system' secara default → emulateMedia mengaktifkan .dark.
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const p of ['/dashboard', '/question-sets', '/exams', '/billing']) {
    await page.goto(TEACHER + p, { waitUntil: 'networkidle' });
    await scan(page, 'teacher(dark) ' + p, findings);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await tctx.close();

  // ---- Student app: halaman login via UI ----
  const sctx = await browser.newContext();
  const spage = await sctx.newPage();
  await spage.goto(STUDENT + '/login', { waitUntil: 'networkidle' });
  await scan(spage, 'student /login', findings);
  await spage.goto(STUDENT + '/guest', { waitUntil: 'networkidle' });
  await scan(spage, 'student /guest', findings);
  // login siswa via UI bila form tersedia, lalu scan dashboard/riwayat
  await spage.goto(STUDENT + '/login', { waitUntil: 'networkidle' });
  try {
    const fields = {
      tenant: spage.getByLabel(/sekolah|kode tenant|kode sekolah|tenant/i).first(),
      user: spage.getByLabel(/username|nis/i).first(),
      pass: spage.getByLabel(/password/i).first(),
    };
    const cresp = await api('POST', '/students', { name: 'Budi A11y', gender: 'P', class_id: classId, nis: '1102' }, token);
    const st = cresp.body?.data;
    if (!st?.id) throw new Error('siswa tidak dibuat: ' + JSON.stringify(cresp.body).slice(0, 200));
    // kredensial pasti lewat reset-password (FR-1.3: reset oleh guru)
    const rp = await api('POST', `/students/${st.id}/reset-password`, {}, token);
    const username = st.username || rp.body?.data?.username;
    const password = rp.body?.data?.password;
    if (!username || !password) throw new Error('kredensial siswa tidak tersedia: ' + JSON.stringify(rp.body).slice(0, 200));
    await fields.tenant.fill(code);
    await fields.user.fill(username);
    await fields.pass.fill(password);
    await spage.getByRole('button', { name: /masuk|login/i }).first().click();
    await spage.waitForTimeout(1500);
    await scan(spage, 'student /exams', findings);
    await spage.goto(STUDENT + '/history', { waitUntil: 'networkidle' });
    await scan(spage, 'student /history', findings);
  } catch (e: any) {
    console.log('student login scan dilewati:', e.message);
  }
  await sctx.close();
  await browser.close();

  // ---- Laporan ----
  const order = { critical: 0, serious: 1, moderate: 2 } as Record<string, number>;
  findings.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
  console.log('\n=== HASIL AUDIT AXE (critical/serious/moderate) ===');
  if (findings.length === 0) { console.log('Nihil — tidak ada pelanggaran.'); return; }
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const k = f.id + '|' + f.page + '|' + f.impact;
    if (!byKey.has(k)) byKey.set(k, f);
  }
  for (const f of byKey.values()) {
    console.log(`\n[${f.impact.toUpperCase()}] ${f.id} — ${f.help}\n  halaman: ${f.page}\n  contoh selector: ${f.nodes.join('; ')}`);
  }
  const crit = findings.filter((f) => f.impact === 'critical').length;
  const ser = findings.filter((f) => f.impact === 'serious').length;
  console.log(`\nTotal: ${findings.length} pelanggaran (critical: ${crit}, serious: ${ser})`);
  // C-11: jadikan audit ini gate yang bisa gagal, bukan sekadar laporan.
  if (crit + ser > 0) {
    console.error(`A11Y GAGAL: ${crit} critical, ${ser} serious`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
