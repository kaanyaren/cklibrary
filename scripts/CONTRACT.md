# CKLibrary — Shared Contract (subagents MUST follow exactly)

Repo root: `/Users/kaanyaren/GitHub/CKLibrary`

## Firebase web config (public, safe to commit)

```js
export const firebaseConfig = {
  projectId: "cklibrary-cb9b1",
  appId: "1:466339259008:web:f2dc90b89fceb10b033c65",
  storageBucket: "cklibrary-cb9b1.firebasestorage.app",
  apiKey: "AIzaSyAQeUWxOJQbQDAsAn1U1NB23aHwSLPyjYQ",
  authDomain: "cklibrary-cb9b1.firebaseapp.com",
  messagingSenderId: "466339259008",
  projectNumber: "466339259008",
};
```

SDK: Firebase modular v11 via gstatic CDN (no npm, no build):
`https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js`,
`.../firebase-auth.js`, `.../firebase-firestore.js`.

## Roles (derived from signed-in email — NOT from UIDs)

| email | name | role |
|---|---|---|
| kaanyaren@gmail.com | kaan | editor |
| ceyda.d@gmail.com | ceyda | editor |
| lenayaren@gmail.com | lena | adder |

- `editor` = add + edit + delete + rate + note
- `adder` = add + rate + note (NO edit, NO delete)

Login screen: three name buttons (ceyda / kaan / lena) + password field. The button
picks the email; `signInWithEmailAndPassword` uses email + password.

## Firestore data model

`books/{bookId}` (bookId = CSV `id`, e.g. `he953qd19k`)
```
title: string
creators: string
publisher: string
publish_date: string
isbn13: string
isbn10: string
description: string
pages: int
item_type: string
added_at: string          // ISO date from CSV 'added'
created_at: string        // ISO timestamp
created_by: string        // name (kaan/ceyda/lena)
cover_url: string         // onaylı kapak; yoksa ISBN'den üretilir, o da yoksa harf-kapak
```

`books/{bookId}/ratings/{uid}`   // uid = signed-in user's uid
```
value: int 1..10
name: string        // kaan|ceyda|lena
updatedAt: string   // ISO
```

`books/{bookId}/notes/{autoId}`
```
text: string
uid: string
name: string
createdAt: string
```

`activity/{autoId}`
```
bookId: string
bookTitle: string
action: "add"|"edit"|"delete"|"rate"|"note"
detail: string
uid: string
name: string
at: string
```

## Cover images

`https://covers.openlibrary.org/b/isbn/{isbn13}-M.jpg`; on load error show a
letter-tile fallback (first letter of title, deterministic paper tone).

## House rules for the UI

- Turkish UI, Turkish-aware search (`str.toLocaleLowerCase("tr")`).
- No AI-slop: no purple/indigo gradients, no glassmorphism, no emoji headings,
  no generic "hero" cards. Paper card-catalog world; one accent color.
- Ratings shown as big numerals (`8/10`), not emoji stars.
- Mobile-first; tap targets comfortable.

## Hard constraints

- NEVER commit `cklibrary-cb9b1-firebase-adminsdk-*.json` (service account key).
- No bundler, no npm deps for the site itself.
- Only these site files: `index.html`, `styles.css`, `app.js`, `firebase-config.js`.
