// Scan Firestore books for Windows-1254 mojibake (Ý, Þ, ð, ý, þ, Ð) and fix them in place.
import { getAccessToken } from "./gauth.mjs";

const PROJECT = "cklibrary-cb9b1";
const DB = "(default)";
const DOCS = `projects/${PROJECT}/databases/${DB}/documents`;
const BASE = `https://firestore.googleapis.com/v1/${DOCS}`;

const MOJIBAKE_REGEX = /[ÝýÞþÐð]/;
const MOJIBAKE_MAP = {
  'Ý': 'İ', 'ý': 'ı',
  'Þ': 'Ş', 'þ': 'ş',
  'Ð': 'Ğ', 'ð': 'ğ',
};

function fixMojibake(s) {
  if (!s || typeof s !== "string") return s;
  return s.replace(/[ÝýÞþÐð]/g, (c) => MOJIBAKE_MAP[c] || c);
}

function fromValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  return null;
}

function toValue(v) {
  return typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) };
}

const token = await getAccessToken();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

console.log("Fetching books from Firestore...");
let pageToken = "";
const booksToFix = [];

do {
  const url = `${BASE}/books?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const docs = data.documents || [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    const updates = {};
    for (const key of ["title", "creators", "publisher", "description"]) {
      const val = fromValue(fields[key]);
      if (typeof val === "string" && MOJIBAKE_REGEX.test(val)) {
        updates[key] = fixMojibake(val);
      }
    }

    if (Object.keys(updates).length > 0) {
      booksToFix.push({
        name: doc.name,
        docId: doc.name.split("/").pop(),
        updates,
      });
    }
  }

  pageToken = data.nextPageToken || "";
} while (pageToken);

console.log(`Found ${booksToFix.length} books in Firestore with character encoding issues.`);

if (booksToFix.length === 0) {
  console.log("All clean! No books need fixing in Firestore.");
  process.exit(0);
}

for (const b of booksToFix) {
  console.log(`- Fixing ${b.docId}:`, Object.keys(b.updates).join(", "));
  const updateMask = Object.keys(b.updates).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const url = `${BASE}/${b.name.replace(`projects/${PROJECT}/databases/${DB}/documents/`, "")}?${updateMask}`;
  
  const fields = {};
  for (const [k, v] of Object.entries(b.updates)) {
    fields[k] = toValue(v);
  }

  const patchRes = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });

  if (!patchRes.ok) {
    console.error(`Failed to update ${b.docId}:`, patchRes.status, await patchRes.text());
  } else {
    console.log(`  ✓ Updated ${b.docId}`);
  }
}

console.log("Firestore cleanup complete!");
