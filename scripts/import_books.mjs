// Import books_seed.json into Firestore over REST via documents:batchWrite.
import { readFileSync } from "node:fs";
import { getAccessToken } from "./gauth.mjs";

const PROJECT = "cklibrary-cb9b1";
const DB = "(default)";
const DOCS = `projects/${PROJECT}/databases/${DB}/documents`;
const BASE = `https://firestore.googleapis.com/v1/${DOCS}`;
const CHUNK = 400; // batchWrite hard limit is 500

const books = JSON.parse(readFileSync(new URL("../books_seed.json", import.meta.url), "utf8"));

// ponytail: only string/int fields exist in the seed; extend if new types appear.
function toValue(v) {
  return typeof v === "number" ? { integerValue: String(v) } : { stringValue: v };
}

function toFields(book) {
  const fields = {};
  for (const [k, v] of Object.entries(book)) {
    if (k === "docId") continue;
    fields[k] = toValue(v);
  }
  return fields;
}

const token = await getAccessToken();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

let imported = 0;
for (let i = 0; i < books.length; i += CHUNK) {
  const chunk = books.slice(i, i + CHUNK);
  const body = {
    writes: chunk.map((b) => ({
      update: { name: `${DOCS}/books/${b.docId}`, fields: toFields(b) },
    })),
  };
  const res = await fetch(`${BASE}:batchWrite`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`batchWrite ${res.status}: ${await res.text()}`);
  imported += chunk.length;
  console.log(`imported ${imported}/${books.length}`);
}

console.log(`documents imported: ${imported}`);
