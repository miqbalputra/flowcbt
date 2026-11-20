#!/usr/bin/env python3
# Smoke test E2E comprehensive FlowCBT (AC PRD 10.4)
import json, requests, random, string, sys, time

B = "http://127.0.0.1:8080/api/v1"
S = requests.Session()
OK = FAIL = 0

def check(name, cond, extra=""):
    global OK, FAIL
    if cond: OK += 1; print(f"  PASS {name}")
    else: FAIL += 1; print(f"  FAIL {name} {extra}")

def post(p, body=None, tok=None, **kw):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return S.post(B+p, json=body, headers=h, **kw)

def get(p, tok=None):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    return S.get(B+p, headers=h)

def put(p, body=None, tok=None):
    h = {"Content-Type": "application/json", "Authorization": f"Bearer {tok}"}
    return S.put(B+p, json=body, headers=h)

print("== 1. LOGIN GURU & DASHBOARD ==")
r = post("/auth/login", {"email":"guru@demo.cbt","password":"Guru#12345"}).json()
gt = r["access_token"]; check("guru login", bool(gt))
r = get("/dashboard", gt).json()["data"]
check("dashboard rollup", 28<=r["students_count"]<=100 and r["exams_running"]>=1, json.dumps(r)[:120])

print("== 2. SISWA LOGIN & START ==")
# --- reset run sebelumnya utk siswa2012 (Bunga Lestari) — fitur pengawas FR-5.7 ---
EX = "0b8889fe-b37d-4c42-8c57-7024f40fbdf0"
rows0 = (get(f"/exams/{EX}/attempts", gt).json().get("data") or [])
for x in rows0:
    if x.get("student_name") == "Bunga Lestari" and x.get("student_id"):
        rr = post(f"/exams/{EX}/participants/{x['student_id']}/reset-attempt", {}, gt)
        print("   reset:", rr.status_code)
cred_before = get("/billing/subscription", gt).json()["data"]["exam_credits_remaining"]

r = post("/student/auth/login", {"username":"siswa2012","password":"Siswa#123"}).json()
st = r["access_token"]; check("siswa login", bool(st), str(r)[:120])
exams = get("/student/me/exams", st).json()["data"]
exam = exams["open"][0] if exams["open"] else None
check("ujian terbuka di dashboard", exam is not None, json.dumps(exams)[:150])
eid = exam["id"]
r = post(f"/student/exams/{eid}/start", {"token":"AA3141"}, st).json()
d = r.get("data") or r
check("start → attempt+deadline", d.get("attempt_id") and d.get("deadline_at"), json.dumps(r)[:200])
aid = d["attempt_id"]
pkg = (d.get("package") or {})
qs = pkg.get("questions") or []
check("package pra-muat ada soal", len(qs)==7, f"n={len(qs)}")
check("tanpa kunci jawaban", "answer_key" not in json.dumps(pkg) and '"correct"' not in json.dumps(qs))
check("rules anti-cheat tampil", (pkg.get("rules") or {}).get("tolerance_seconds") is not None, json.dumps(pkg.get("rules",{}))[:100])

print("== 3. JAWAB 5 TIPE (payload question_id) ==")
def ansOf(o): return o
byid = {q["order_no"]: q for q in qs}
events = []
seq = 1
answers_map = {}
# q1 mcq A, q2 mcq_complex A,C,E partial, q3 matching pairs, q4 short 15, q5 essay, q6 mcq B, q7 short 7
answers_map[1] = "A"
answers_map[2] = ["A","C","E"]
answers_map[3] = {"Indonesia":"Jakarta","Jepang":"Tokyo","Mesir":"Kairo"}
answers_map[4] = "15"
answers_map[5] = "Fotosintesis... langkah: p=12,l=7"
answers_map[6] = "B"
answers_map[7] = "7"
for n, ans in answers_map.items():
    events.append({"client_event_id": f"ev-{n}-1", "type": "answer", "question_id": byid[n]["id"],
                   "payload": {"question_id": byid[n]["id"], "answer": ans},
                   "client_ts": int(time.time()*1000), "seq": seq}); seq += 1
flag = {"client_event_id": "ev-flag-1", "type": "flag", "question_id": byid[4]["id"],
        "payload": {"question_id": byid[4]["id"], "flag": True},
        "client_ts": int(time.time()*1000), "seq": seq}; seq += 1
events.append(flag)
r = post(f"/attempts/{aid}/answers:sync", {"events": events, "client_elapsed_ms": 60000}, st).json()
d = r.get("data") or r
check("sync ACK semua", len(d.get("acked", []))==len(events), json.dumps(r)[:200])
check("sync rejected kosong", not d.get("rejected"), json.dumps(d.get("rejected",[]))[:120])

# LWW: ubah jawaban q1 -> B (salah), seq lebih tinggi
ev2 = {"client_event_id":"ev-1-2","type":"answer","question_id":byid[1]["id"],
       "payload":{"question_id":byid[1]["id"],"answer":"B"},
       "client_ts":int(time.time()*1000),"seq":seq}; seq += 1
r = post(f"/attempts/{aid}/answers:sync", {"events":[ev2]}, st).json()
d = r.get("data") or r
check("LWW update q1 acked", d.get("acked")==["ev-1-2"], json.dumps(r)[:150])

print("== 4. IDEMPOTENSI (AC-3) ==")
r1 = post(f"/attempts/{aid}/answers:sync", {"events":[ev2]}, st).json()
d1 = r1.get("data") or r1
check("replay → acked tanpa duplikat", d1.get("acked")==["ev-1-2"], json.dumps(r1)[:120])

print("== 5. VIOLATION (AC-8) ==")
r = post(f"/attempts/{aid}/violations",
         {"client_event_id":"viol-1","type":"tab_hidden","started_at":"2026-11-20T05:00:00+07:00","duration_ms":5000}, st).json()
d = r.get("data") or r
check("violation tercatat", d.get("violations")==1, json.dumps(r)[:150])
check("penalti=5", d.get("total_penalty")==5, json.dumps(r)[:120])
check("status warned", d.get("cheating_status")=="warned", json.dumps(r)[:120])

print("== 6. SUBMIT & GRADING OTOMATIS ==")
r = post(f"/attempts/{aid}/submit", {"client_event_id":"submit-1","client_elapsed_ms":120000}, st).json()
d = r.get("data") or r
check("submitted", d.get("status") in ("submitted","graded"), json.dumps(r)[:200])
# idempoten submit
r2 = post(f"/attempts/{aid}/submit", {"client_event_id":"submit-1"}, st).json()
check("submit idempoten", not r2.get("error"), json.dumps(r2)[:160])
# hitung harapan: max=20; q1 salah (B) 0; q2 3; q3 4; q4 2; q5 0 pending; q6 2; q7 2 → auto=13; target final = 65-5=60
r = get(f"/attempts/{aid}/result", st).json()
d = r.get("data") or r
score = d.get("score"); final = d.get("final_score")
check("score otomatis 13", score==13, f"got {score} resp={json.dumps(r)[:180]}")
check("final 60 (13/20*100-5)", final==60, f"got {final}")
check("final_score_pending (uraian)", d.get("final_score_pending")==True, json.dumps(r)[:150])

print("== 7. GURU: KOREKSI URAIAN (FR-8.3) ==")
# temukan row attempt list
r = get(f"/exams/{eid}/attempts", gt).json()
rows = r.get("data") or []
row = [x for x in rows if x.get("student_name")=="Bunga Lestari"][0] if rows else None
# siswa2012 = baris ke-12! (namaP[5]='Fitri'? — cari via student_id)
r2 = get(f"/attempts/{aid}/grading", gt).json()
d = r2.get("data") or r2
check("grading view", bool(d.get("questions")), json.dumps(r2)[:150])
essay = [q for q in d["questions"] if q["type"]=="essay"][0]
qid = essay["question_id"]
check("jawaban uraian tampil", bool(essay.get("student_answer")), json.dumps(essay)[:160])
r = put(f"/attempts/{aid}/answers/{qid}/score", {"score":4, "reason":"rubrik cocok"}, gt).json()
d = r.get("data") or r
check("override skor uraian", d.get("score")==4, json.dumps(r)[:150])
r = post(f"/exams/{eid}/regrade", {}, gt).json()
check("regrade ok", r.get("code") is None or "err" not in str(r.get("code","")).lower(), json.dumps(r)[:150])
r = get(f"/attempts/{aid}/result", st).json()
d = r.get("data") or r
check("final setelah uraian = (17/20*100)-5 = 80", d.get("final_score")==80, f"got {d.get('final_score')}")
check("pending hilang", d.get("final_score_pending")==False, json.dumps(d)[:120])

print("== 8. LAPORAN ==")
r = get("/reports/live", gt).json(); rows = r.get("data") or []
mine = [x for x in rows if x.get("exam_id")==eid]
check("live list punya ujian", bool(mine), json.dumps(rows)[:160])
if mine: check("live counts", mine[0]["counts"]["done"]>=1, json.dumps(mine[0])[:150])
r = get(f"/reports/live/{eid}", gt).json(); d = r.get("data") or r
check("live detail ada ringkasan", "summary" in r.get("data",{}), json.dumps(d)[:120])
r = get("/reports/history", gt).json(); rows = r.get("data") or []
check("history >=1", len(rows)>=1, "%d baris"%len(rows))
r = get(f"/reports/exams/{eid}", gt).json(); d = r.get("data") or r
st2 = d.get("stats") or {}
check("statistik avg>0", (st2.get("avg") or 0)>0, json.dumps(st2)[:160])
r = get(f"/reports/exams/{eid}/item-analysis", gt).json(); rows = r.get("data") or []
check("item analysis baris=7", len(rows)==7, "%d"%len(rows))

print("== 9. EXPORT ==")
r = get("/students/export", gt)
check("export siswa xlsx", r.status_code==200 and "spreadsheet" in r.headers.get("Content-Type",""), r.headers.get("Content-Type",""))
r = get(f"/reports/exams/{eid}/export?format=csv", gt)
check("export rekap csv", r.status_code==200 and (";" in r.text or "," in r.text), r.text[:80])
r = get("/billing/export-all", gt)
check("export-all zip", r.status_code==200 and "zip" in r.headers.get("Content-Type",""), f"{r.status_code} {r.headers.get('Content-Type','')}")

print("== 10. ISOLASI TENANT (AC-9) ==")
r = post("/auth/register", {"full_name":"Guru Sekolah Lain","email":"lain@sekolah.sch.id","password":"Rahasia#77",
                            "school_name":"SMP Lain Sekali", "school_level":"SMP/MTs"}).json()
vt = (r.get("data") or {}).get("verify_token")
post("/auth/verify-email", {"token":vt})
r = post("/auth/login", {"email":"lain@sekolah.sch.id","password":"Rahasia#77"}).json()
gt2 = r.get("access_token")
r = get(f"/attempts/{aid}/grading", gt2)
check("attempt tenant lain → 404", r.status_code==404, f"got {r.status_code}")
try: code_at = r.json().get("code")
except Exception: code_at = None
check("attempt tenant lain → code NOT_FOUND (tanpa bocor data)", code_at=="NOT_FOUND", str(r.text)[:120])
r = get(f"/students/{aid}", gt2)
check("siswa id tenant lain → 404", r.status_code==404, f"got {r.status_code}")
try: code_st = r.json().get("code")
except Exception: code_st = None
check("siswa tenant lain → code NOT_FOUND (tanpa bocor data)", code_st=="NOT_FOUND", str(r.text)[:120])

print("== 11. GUEST LOGIN (FR-1.3) ==")
r = post("/student/auth/guest", {"exam_code":"DEMO01","token":"AA3141","name":"Tamu Satu","gender":"L","class_name":"X-1"}).json()
check("guest login", bool(r.get("access_token")), json.dumps(r)[:200])
gut = r.get("access_token")
r2 = post("/student/auth/guest", {"exam_code":"DEMO01","token":"SALAH","name":"Tamu Dua","gender":"P"})
check("guest token salah → 401", r2.status_code==401, f"got {r2.status_code}")

print("== 12. BILLING (FR-10) ==")
r = post("/billing/checkout", {"plan_code":"per_exam_small","provider":"midtrans"}, gt).json()
d = r.get("data") or r
check("checkout order dibuat", bool(d.get("order_id")), json.dumps(r)[:160])
oid = d.get("order_id")
r = post("/billing/simulate-pay", {"order_id":oid}, gt).json()
check("simulate pay (dev)", r.get("code") is None, json.dumps(r)[:130])
r = get("/billing/subscription", gt).json(); d = r.get("data") or r
check("kredit ujian tertambah", d.get("exam_credits_remaining")==cred_before+3, json.dumps(d)[:150])
r = get("/billing/invoices", gt).json(); rows = r.get("data") or []
check("invoice tercatat", len(rows)>=1, json.dumps(rows)[:120])


print("== 13. SSE REAL-TIME (FR-9.3) ==")
try:
    import requests as _rq
    with _rq.get(B+"/reports/live/stream", params={"token": gt, "exam_id": EX}, stream=True, timeout=8) as rr:
        check("SSE status 200 + content-type", rr.status_code==200 and "text/event-stream" in rr.headers.get("Content-Type",""), f"{rr.status_code} {rr.headers.get('Content-Type','')}")
        buf = b""
        n_snap = 0
        for chunk in rr.iter_content(chunk_size=1024):
            buf += chunk
            n_snap = buf.count(b"event: snapshot")
            # tunggu snapshot LENGKAP (blok data diakhiri baris kosong)
            if n_snap >= 1 and buf.rstrip().endswith(b"}") and b"\n\n" in buf.split(b"event: snapshot", 1)[1]:
                break
        check("SSE snapshot diterima", n_snap >= 1, f"buf={buf[:80]!r}")
        ok_json = False
        for line in buf.decode(errors="replace").splitlines():
            if line.startswith("data: [") or line.startswith("data: {"):
                try:
                    json.loads(line[6:]); ok_json = True
                except Exception: pass
        check("SSE payload JSON valid", ok_json)
except Exception as e:
    check("SSE stream", False, repr(e))
r2 = S.get(B+"/reports/live/stream", timeout=5)
check("SSE tanpa token -> 401", r2.status_code == 401, f"got {r2.status_code}")

print("== 14. EXPORT PDF (FR-9.11, FR-3.7) ==")
r = get(f"/reports/exams/{EX}/export?format=pdf", gt)
check("rekap PDF 200 + application/pdf", r.status_code==200 and "application/pdf" in r.headers.get("Content-Type",""), f"{r.status_code} {r.headers.get('Content-Type','')}")
check("rekap PDF magic %PDF", r.content[:5]==b"%PDF-", str(r.content[:10]))
rows_pdf = len([x for x in r.content.split(b"%%EOF") if x])
check("rekap PDF berisi EOF terminator", b"%%EOF" in r.content)

# track record siswa (ambil id siswa dari daftar attempt)
row0 = (rows0 or [{}])[0]
sid = row0.get("student_id", "")
r = get(f"/students/{sid}/track-record?format=pdf", gt)
check("track record PDF 200", r.status_code==200 and r.content[:5]==b"%PDF-", f"{r.status_code} {r.content[:8]}")


print(f"\n==== HASIL: {OK} PASS / {FAIL} FAIL ====")
sys.exit(1 if FAIL else 0)
