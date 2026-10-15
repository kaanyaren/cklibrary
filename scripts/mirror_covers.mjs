// Mevcut onaylı kapakları (cover_url) Firebase Storage'a taşır.
// Sunucu tarafı: CORS engeli yok, Amazon dahil her kaynak iner.
// Kullanım: node scripts/mirror_covers.mjs          → kuru çalıştırma (liste + boyut)
//          node scripts/mirror_covers.mjs --apply  → indir → yükle → cover_url güncelle
// Geri alma: mirror_covers.map.json (bookId → {old, new}).
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getAccessToken } from "./gauth.mjs";

const PROJECT = "cklibrary-cb9b1";
const BUCKET = "cklibrary-cb9b1.firebasestorage.app";
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const APPLY = process.argv.includes("--apply");
const MAX_BYTES = 5 * 1024 * 1024;
const WORKERS = 3;

const token = await getAccessToken();
const H = { Authorization: `Bearer ${token}` };

// ── 1. Kitapları listele ──
const books = [];
let pageToken = "";
do {
  const q = new URLSearchParams({ pageSize: "300", ...(pageToken ? { pageToken } : {}) });
  const res = await fetch(`https://firestore.googleapis.com/v1/${DOCS}/books?${q}`, { headers: H });
  if (!res.ok) throw new Error(`list books ${res.status}: ${await res.text()}`);
  const data = await res.json();
  for (const d of data.documents || []) {
    const f = d.fields || {};
    const url = f.cover_url?.stringValue || "";
    if (url && !url.includes("firebasestorage")) {
      books.push({ id: d.name.split("/").pop(), title: f.title?.stringValue || "", url });
    }
  }
  pageToken = data.nextPageToken || "";
} while (pageToken);

console.log(`${books.length} taşınacak kapak bulundu (Storage'dakiler atlandı).`);
if (!books.length) process.exit(0);
if (!APPLY) {
  let total = 0;
  for (const b of books) {
    try {
      const h = await fetch(b.url, { method: "HEAD", headers: { "User-Agent": "CKLibrary/1.0" } });
      total += Number(h.headers.get("content-length")) || 0;
    } catch { /* boyut bilinmiyor */ }
    console.log(`- ${b.id} “${b.title.slice(0, 40)}”`);
  }
  console.log(`tahmini toplam: ${(total / 1048576).toFixed(1)} MB (HEAD vermeyenler hariç)`);
  console.log(`uygulamak için: node scripts/mirror_covers.mjs --apply`);
  process.exit(0);
}

// ── 2. Taşı (3 işçi) ──
const map = {};
try { Object.assign(map, JSON.parse(readFileSync(new URL("./mirror_covers.map.json", import.meta.url), "utf8"))); }
catch { /* ilk çalıştırma */ }
let done = 0, ok = 0, fail = 0;

async function mirror(b) {
  if (map[b.id]?.new) return "skip"; // zaten taşınmış
  const dl = await fetch(b.url, { headers: { "User-Agent": "CKLibrary/1.0" } });
  if (!dl.ok) throw new Error(`indirilemedi (${dl.status})`);
  const ct = (dl.headers.get("content-type") || "").split(";")[0].trim() || "image/jpeg";
  if (!ct.startsWith("image/")) throw new Error(`resim değil (${ct})`);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`${(buf.length / 1048576).toFixed(1)} MB, 5 MB sınırını aşıyor`);
  const dlToken = randomUUID();
  const name = `covers/${b.id}/mirrored.jpg`;
  const up = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { ...H, "Content-Type": ct, "X-Upload-Content-Length": String(buf.length) }, body: buf });
  if (!up.ok) throw new Error(`yüklenemedi (${up.status}): ${(await up.text()).slice(0, 120)}`);
  await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}`,
    { method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { firebaseStorageDownloadTokens: dlToken } }) });
  const fbUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media&token=${dlToken}`;
  const wr = await fetch(`https://firestore.googleapis.com/v1/${DOCS}/books/${b.id}?updateMask.fieldPaths=cover_url`,
    { method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { cover_url: { stringValue: fbUrl } } }) });
  if (!wr.ok) throw new Error(`belge güncellenemedi (${wr.status})`);
  map[b.id] = { old: b.url, new: fbUrl };
  return "ok";
}

const queue = [...books];
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (queue.length) {
    const b = queue.pop();
    try { (await mirror(b)) === "ok" ? ok++ : done; }
    catch (e) { fail++; console.log(`HATA ${b.id} “${b.title.slice(0, 40)}”: ${e.message}`); }
    done++;
    if (done % 10 === 0 || done === books.length) console.log(`ilerleme: ${done}/${books.length} · ${ok} taşındı · ${fail} hata`);
  }
}));

writeFileSync(new URL("./mirror_covers.map.json", import.meta.url), JSON.stringify(map, null, 2));
console.log(`bitti: ${ok} taşındı, ${fail} hata. Eşleme: scripts/mirror_covers.map.json`);
