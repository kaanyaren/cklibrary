// Tüm kitapların kapaklarını (mevcut harici URL, Open Library veya Amazon)
// Firebase Storage'a taşır ve Firestore'daki cover_url alanını günceller.
// Kullanım: node scripts/mirror_covers.mjs          → kuru çalıştırma (tahmin/liste)
//          node scripts/mirror_covers.mjs --apply  → indir → Storage'a yükle → Firestore'u güncelle
// Geri alma / durum: mirror_covers.map.json (bookId → {old, new}).

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getAccessToken } from "./gauth.mjs";

const PROJECT = "cklibrary-cb9b1";
const BUCKET = "cklibrary-cb9b1.firebasestorage.app";
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const APPLY = process.argv.includes("--apply");
const MAX_BYTES = 5 * 1024 * 1024;
const WORKERS = 4;

const token = await getAccessToken();
const H = { Authorization: `Bearer ${token}` };

function isbn13to10(isbn) {
  const clean = String(isbn || "").replace(/[^0-9X]/gi, "");
  if (clean.length === 10) return clean;
  if (clean.length !== 13 || !clean.startsWith("978")) return null;
  const core = clean.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(core[i], 10) * (10 - i);
  const rem = (11 - (sum % 11)) % 11;
  const check = rem === 10 ? "X" : String(rem);
  return core + check;
}

async function fetchImageBuffer(url, timeoutMs = 7000) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CKLibrary/1.0" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // 500 bayttan küçükse boş gif / geçersiz görseldir
    if (buf.length < 500) return null;
    return { buf, ct: ct || "image/jpeg" };
  } catch {
    return null;
  }
}

async function findCover(b) {
  // 1. Mevcut harici cover_url varsa önce onu dene (yüksek çözünürlük -L yap)
  if (b.existingUrl) {
    const highUrl = b.existingUrl.replace(/-[SM]\.jpg(?=(\?|$))/, "-L.jpg");
    const img = await fetchImageBuffer(highUrl);
    if (img) return { url: highUrl, img };
    const orig = await fetchImageBuffer(b.existingUrl);
    if (orig) return { url: b.existingUrl, img: orig };
  }

  // 2. Open Library ISBN13 (-L.jpg)
  if (b.isbn13) {
    const olUrl = `https://covers.openlibrary.org/b/isbn/${b.isbn13}-L.jpg?default=false`;
    const img = await fetchImageBuffer(olUrl);
    if (img) return { url: olUrl, img };
  }

  // 3. Amazon ISBN10 (_SCLZZZZZZZ_.jpg)
  const i10 = isbn13to10(b.isbn10 || b.isbn13);
  if (i10) {
    const amzUrl = `https://images-na.ssl-images-amazon.com/images/P/${i10}.01._SCLZZZZZZZ_.jpg`;
    const img = await fetchImageBuffer(amzUrl);
    if (img) return { url: amzUrl, img };
  }

  // 4. Open Library Search (Başlık)
  if (b.title) {
    try {
      const q = new URLSearchParams({ title: b.title, limit: "2", fields: "cover_i" });
      const sres = await fetch(`https://openlibrary.org/search.json?${q}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (sres.ok) {
        const sdata = await sres.json();
        for (const doc of (sdata.docs || [])) {
          if (doc.cover_i) {
            const searchUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
            const img = await fetchImageBuffer(searchUrl);
            if (img) return { url: searchUrl, img };
          }
        }
      }
    } catch { /* yoksay */ }
  }

  return null;
}

// ── 1. Kitapları listele ──
const books = [];
let pageToken = "";
let totalCount = 0;
let alreadyStorage = 0;

do {
  const q = new URLSearchParams({ pageSize: "300", ...(pageToken ? { pageToken } : {}) });
  const res = await fetch(`https://firestore.googleapis.com/v1/${DOCS}/books?${q}`, { headers: H });
  if (!res.ok) throw new Error(`list books ${res.status}: ${await res.text()}`);
  const data = await res.json();
  for (const d of data.documents || []) {
    totalCount++;
    const f = d.fields || {};
    const url = f.cover_url?.stringValue || "";
    if (url.includes("firebasestorage")) {
      alreadyStorage++;
    } else {
      books.push({
        id: d.name.split("/").pop(),
        title: f.title?.stringValue || "",
        isbn13: f.isbn13?.stringValue || "",
        isbn10: f.isbn10?.stringValue || "",
        existingUrl: url
      });
    }
  }
  pageToken = data.nextPageToken || "";
} while (pageToken);

console.log(`Toplam kitap: ${totalCount}`);
console.log(`Zaten Firebase Storage'da olan: ${alreadyStorage}`);
console.log(`İşlenecek kitap: ${books.length}`);

if (!books.length) {
  console.log("Taşınacak kapak yok, tümü zaten Storage'da.");
  process.exit(0);
}

// ── 2. Taşı veya listele ──
const mapPath = new URL("./mirror_covers.map.json", import.meta.url);
const map = {};
try { Object.assign(map, JSON.parse(readFileSync(mapPath, "utf8"))); }
catch { /* ilk çalıştırma */ }

let done = 0, ok = 0, noCover = 0, fail = 0;

async function processBook(b) {
  if (map[b.id]?.new?.includes("firebasestorage")) {
    return "skip";
  }

  const found = await findCover(b);
  if (!found) {
    noCover++;
    return "no_cover";
  }

  const { url, img } = found;
  if (img.buf.length > MAX_BYTES) {
    throw new Error(`${(img.buf.length / 1048576).toFixed(1)} MB, 5 MB sınırını aşıyor`);
  }

  if (!APPLY) {
    ok++;
    return "dry_run";
  }

  const dlToken = randomUUID();
  const name = `covers/${b.id}/mirrored.jpg`;
  const up = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { ...H, "Content-Type": img.ct, "X-Upload-Content-Length": String(img.buf.length) },
      body: img.buf
    }
  );
  if (!up.ok) throw new Error(`yüklenemedi (${up.status}): ${(await up.text()).slice(0, 100)}`);

  await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ metadata: { firebaseStorageDownloadTokens: dlToken } })
  });

  const fbUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media&token=${dlToken}`;

  const wr = await fetch(`https://firestore.googleapis.com/v1/${DOCS}/books/${b.id}?updateMask.fieldPaths=cover_url`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { cover_url: { stringValue: fbUrl } } })
  });
  if (!wr.ok) throw new Error(`firestore güncellenemedi (${wr.status})`);

  map[b.id] = { old: url, new: fbUrl };
  ok++;
  return "ok";
}

const queue = [...books];
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (queue.length) {
    const b = queue.pop();
    try {
      await processBook(b);
    } catch (e) {
      fail++;
      console.log(`HATA ${b.id} “${b.title.slice(0, 30)}”: ${e.message}`);
    }
    done++;
    if (done % 15 === 0 || done === books.length) {
      if (APPLY) writeFileSync(mapPath, JSON.stringify(map, null, 2));
      console.log(`ilerleme: ${done}/${books.length} · ${ok} yüklendi · ${noCover} kapaksız · ${fail} hata`);
    }
  }
}));

if (APPLY) {
  writeFileSync(mapPath, JSON.stringify(map, null, 2));
  console.log(`\nTamamlandı: ${ok} kapak Firebase Storage'a aktarıldı, ${noCover} kitapta dış kaynakta kapak bulunamadı (harf-kapak kalacak), ${fail} hata.`);
} else {
  console.log(`\nKuru çalıştırma sonucu: ${ok} kitap için kapak bulundu, ${noCover} kapaksız.`);
  console.log("Uygulamak için: node scripts/mirror_covers.mjs --apply");
}
