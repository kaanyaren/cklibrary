#!/usr/bin/env python3
"""Convert the library CSV export into books_seed.json (see scripts/CONTRACT.md)."""
import csv
import json
import os
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "library_20261013_163504.csv")
OUT_PATH = os.path.join(REPO, "books_seed.json")


MOJIBAKE_MAP = str.maketrans({
    "Ý": "İ", "ý": "ı",
    "Þ": "Ş", "þ": "ş",
    "Ð": "Ğ", "ð": "ğ",
})


def clean(v):
    return (v or "").translate(MOJIBAKE_MAP).strip()


def build(rows):
    created_at = datetime.now(timezone.utc).isoformat()
    books = []
    for r in rows:
        if not clean(r.get("id")):
            continue
        b = {
            "docId": clean(r["id"]),
            "title": clean(r["title"]),
            "creators": clean(r["creators"]),
            "publisher": clean(r["publisher"]),
            "publish_date": clean(r["publish_date"]),
            "description": clean(r["description"]),
            "item_type": clean(r["item_type"]),
            "isbn13": clean(r["ean_isbn13"]),
            "isbn10": clean(r["upc_isbn10"]),
            "added_at": clean(r["added"]),
            "created_at": created_at,
            "created_by": "",
        }
        length = clean(r["length"])
        if length.isdigit():
            b["pages"] = int(length)
        books.append({k: v for k, v in b.items() if k == "docId" or v != ""})
    return books


def main():
    # utf-8-sig strips a leading BOM from the header row.
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    books = build(rows)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, indent=2)
    print(f"csv rows parsed: {len(rows)}")
    print(f"books written:   {len(books)} -> {OUT_PATH}")


if __name__ == "__main__":
    main()
