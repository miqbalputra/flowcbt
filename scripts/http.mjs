const base = process.env.BASE || 'http://127.0.0.1:8080';
export async function req(method, path, body, token, extra={}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, method, path, body] = process.argv;
  const r = await req(method, path, body ? JSON.parse(body) : undefined);
  console.log(r.status, JSON.stringify(r.body).slice(0, 600));
}
