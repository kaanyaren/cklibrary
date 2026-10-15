// findDuplicateBook'u app.js'ten çıkarıp izole test eder (app.js DOM'a bağlı, import edilemez).
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const m = src.match(/function findDuplicateBook[\s\S]*?\n}/);
if (!m) throw new Error("findDuplicateBook bulunamadı");

const state = { books: [
  { id: "1", title: "A", isbn13: "9789750718216", isbn10: "" },
  { id: "2", title: "B", isbn13: "", isbn10: "0141439513" },
] };
const findDuplicateBook = new Function("state", `${m[0]}\nreturn findDuplicateBook;`)(state);

const cases = [
  ["9789750718216", "", "1", "isbn13 tam eşleşme"],
  ["9789750718216", "0141439513", "1", "alanlar çapraz da aranır"],
  ["", "0141439513", "2", "isbn10 kaydı"],
  ["9780000000000", "", null, "kütüphanede yok"],
  ["", "", null, "ISBN yoksa kontrol edilmez"],
];
for (const [i13, i10, want, name] of cases) {
  const got = findDuplicateBook(i13, i10)?.id ?? null;
  if (got !== want) throw new Error(`FAIL ${name}: ${got} !== ${want}`);
}
console.log(`OK — ${cases.length} durum`);
