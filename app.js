// CK Kütüphanesi — aile kitaplığı kataloğu
// Firebase modular v11 (CDN), build adımı yok.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, getDocs,
  doc, setDoc, addDoc, updateDoc, deleteDoc, deleteField,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// CONTRACT: roller e-postadan türetilir (UID'den değil).
const ROLES = {
  "kaanyaren@gmail.com": { name: "kaan", role: "editor" },
  "ceyda.d@gmail.com":   { name: "ceyda", role: "editor" },
  "lenayaren@gmail.com": { name: "lena", role: "adder" },
};
const PEOPLE = ["kaan", "ceyda", "lena"];

const state = {
  user: null,          // { uid, email, name, role }
  books: [],           // [{ id, ...data }]
  ratings: new Map(),  // bookId -> Map(uid -> { value, name, updatedAt })
  notes: new Map(),    // bookId -> [{ id, text, uid, name, createdAt }]
  reads: new Map(),    // bookId -> Map(uid -> { read, name, updatedAt })
  activity: [],        // [{ id, ... }] en yeni önce
  query: "",
  filter: "all",
  editingId: null,     // form dialog: null = ekle, id = düzenle
};

// ── DOM ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const loginView = $("login-view");
const appView = $("app-view");
const loginForm = $("login-form");
const passwordInput = $("password");
const loginError = $("login-error");
const loginSubmit = $("login-submit");
const whoButtons = [...document.querySelectorAll(".who-btn")];
const shelf = $("shelf");
const shelfStatus = $("shelf-status");
const shelfError = $("shelf-error");
const searchInput = $("search");
const filterButtons = [...document.querySelectorAll(".chip")];
const detailDialog = $("detail-dialog");
const detailBody = $("detail-body");
const formDialog = $("form-dialog");
const bookForm = $("book-form");
const formTitle = $("form-title");
const formError = $("form-error");
const formSubmit = $("form-submit");

let selectedEmail = null;

// ── Yardımcılar ────────────────────────────────────────────────
const trLower = (s) => String(s ?? "").toLocaleLowerCase("tr");
// Veri küçük harf kalır; ekranda ilk harf büyük gösterilir.
const displayName = (s) => {
  const v = String(s ?? "");
  return v.charAt(0).toLocaleUpperCase("tr") + v.slice(1);
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;         // yalnızca sabit şablonlar için
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null) node.append(c);
  return node;
}

function fmtDate(iso, withTime = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts = { day: "numeric", month: "long", year: "numeric" };
  if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
  return d.toLocaleDateString("tr-TR", opts);
}

// Kapak: önce onaylı cover_url, yoksa ISBN'den Open Library; yüklenemezse harf-kapak.
const TONES = ["#d8c8a6", "#cdb894", "#c8b79c", "#d3bfa1", "#bfa886", "#d9cdb2"];
function toneFor(str) {
  let n = 0;
  for (const ch of String(str)) n = (n + ch.codePointAt(0)) % 9973;
  return TONES[n % TONES.length];
}
function letterTile(title) {
  const ch = Array.from(String(title || "?").trim())[0] || "?";
  return el("div", { class: "cover-tile", text: ch.toLocaleUpperCase("tr"),
                     style: `background:${toneFor(title)}` });
}
function coverNode(book) {
  const wrap = el("div", { class: "cover" });
  // ?default=false: olmayan kapakta 404 dönsün ki harf-kapak devreye girsin.
  const src = book.cover_url ||
    (book.isbn13 ? `https://covers.openlibrary.org/b/isbn/${book.isbn13}-M.jpg?default=false` : null);
  if (src) {
    const img = el("img", { src,
                            alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => { img.remove(); wrap.append(letterTile(book.title)); });
    wrap.append(img);
  } else {
    wrap.append(letterTile(book.title));
  }
  return wrap;
}

// ── Türetilmiş veri ────────────────────────────────────────────
const getBook = (id) => state.books.find((b) => b.id === id);
const ratingsOf = (id) => state.ratings.get(id) || new Map();
const notesOf = (id) => state.notes.get(id) || [];
const readsOf = (id) => state.reads.get(id) || new Map();
const myRead = (id) => readsOf(id).get(state.user.uid)?.read === true;
const activityOf = (id) => state.activity.filter((a) => a.bookId === id);

function averageOf(id) {
  const values = [...ratingsOf(id).values()].map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
  if (!values.length) return { avg: null, count: 0 };
  return { avg: values.reduce((a, b) => a + b, 0) / values.length, count: values.length };
}
function valueForName(id, name) {
  for (const r of ratingsOf(id).values()) if (r.name === name) return Number(r.value);
  return null;
}

// ── Giriş ekranı ───────────────────────────────────────────────
function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.hidden = false;
}
function clearLoginError() { loginError.hidden = true; loginError.textContent = ""; }

whoButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedEmail = btn.dataset.email;
    whoButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    clearLoginError();
    passwordInput.focus();
  });
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearLoginError();
  if (!selectedEmail) { showLoginError("Önce bir isim seç."); return; }
  const password = passwordInput.value;
  if (!password) { showLoginError("Şifre gerekli."); return; }

  loginSubmit.disabled = true;
  loginSubmit.textContent = "Giriş yapılıyor…";
  try {
    await signInWithEmailAndPassword(auth, selectedEmail, password);
  } catch (err) {
    showLoginError(loginErrorMessage(err));
    passwordInput.select();
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Giriş yap";
  }
});

function loginErrorMessage(err) {
  switch (err?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/invalid-login-credentials":
      return "Şifre yanlış. Tekrar dene.";
    case "auth/user-not-found":
      return "Bu hesap bulunamadı.";
    case "auth/too-many-requests":
      return "Çok fazla deneme. Biraz bekleyip tekrar dene.";
    case "auth/network-request-failed":
      return "Bağlantı kurulamadı. İnternetini kontrol et.";
    case "auth/unauthorized-domain":
      return "Bu adres girişe yetkili değil. Kaan'a bildir.";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid":
      return "Firebase yapılandırması geçersiz.";
    default:
      return "Giriş yapılamadı. Tekrar dene.";
  }
}

$("logout").addEventListener("click", () => signOut(auth));

// ── Kimlik akışı ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.user = null;
    state.books = [];
    state.ratings = new Map();
    state.notes = new Map();
    state.reads = new Map();
    state.activity = [];
    if (detailDialog.open) detailDialog.close();
    if (formDialog.open) formDialog.close();
    appView.hidden = true;
    loginView.hidden = false;
    passwordInput.value = "";
    return;
  }

  const info = ROLES[user.email];
  if (!info) {
    showLoginError("Bu hesap kütüphaneye tanımlı değil.");
    await signOut(auth);
    return;
  }

  state.user = { uid: user.uid, email: user.email, ...info };
  loginView.hidden = true;
  appView.hidden = false;
  $("welcome").textContent = `kütüphanene hoş geldin ${state.user.name}.`;
  $("user-role").textContent = state.user.role === "editor" ? "düzenleyici" : "ekleyici";
  $("find-covers").hidden = state.user.role !== "editor";
  searchInput.value = "";
  state.query = "";
  state.filter = "all";
  filterButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.filter === "all"));

  renderSkeleton();
  await loadAll();
});

// ── Veri yükleme (sınırlı okuma: kitap + collectionGroup + activity) ──
async function loadAll() {
  shelfError.hidden = true;
  try {
    const [booksSnap, ratingsSnap, notesSnap, readsSnap, activitySnap] = await Promise.all([
      getDocs(collection(db, "books")),
      getDocs(collectionGroup(db, "ratings")),
      getDocs(collectionGroup(db, "notes")),
      getDocs(collectionGroup(db, "reads")),
      getDocs(collection(db, "activity")),
    ]);

    state.books = booksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    state.ratings = new Map();
    for (const d of ratingsSnap.docs) {
      const bookId = d.ref.parent.parent.id;
      if (!state.ratings.has(bookId)) state.ratings.set(bookId, new Map());
      state.ratings.get(bookId).set(d.id, d.data());
    }

    state.notes = new Map();
    for (const d of notesSnap.docs) {
      const bookId = d.ref.parent.parent.id;
      if (!state.notes.has(bookId)) state.notes.set(bookId, []);
      state.notes.get(bookId).push({ id: d.id, ...d.data() });
    }
    for (const arr of state.notes.values()) {
      arr.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }

    state.reads = new Map();
    for (const d of readsSnap.docs) {
      const bookId = d.ref.parent.parent.id;
      if (!state.reads.has(bookId)) state.reads.set(bookId, new Map());
      state.reads.get(bookId).set(d.id, d.data());
    }

    state.activity = activitySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

    renderShelf();
  } catch (err) {
    shelf.innerHTML = "";
    shelfError.hidden = false;
    shelfError.textContent = loadErrorMessage(err);
    shelfStatus.textContent = "";
  }
}

function loadErrorMessage(err) {
  if (err?.code === "permission-denied") {
    return "Kitaplara erişilemedi. Firestore güvenlik kurallarını denetle.";
  }
  if (err?.code === "unavailable") return "Sunucuya ulaşılamadı. İnternetini kontrol et.";
  return "Kitaplar yüklenemedi. Sayfayı yenilemeyi dene.";
}

// ── Liste ──────────────────────────────────────────────────────
function renderSkeleton() {
  shelf.innerHTML = "";
  shelfStatus.textContent = "Kitaplar yükleniyor…";
  for (let i = 0; i < 6; i++) shelf.append(el("div", { class: "skeleton" }));
}

function visibleBooks() {
  const q = trLower(state.query.trim());
  return state.books
    .filter((b) => {
      const r = ratingsOf(b.id).size;
      if (state.filter === "rated" && r === 0) return false;
      if (state.filter === "unrated" && r > 0) return false;
      if (state.filter === "mine" && b.created_by !== state.user.name) return false;
      if (state.filter === "read" && !myRead(b.id)) return false;
      if (state.filter === "unread" && myRead(b.id)) return false;
      if (!q) return true;
      const hay = trLower([b.title, b.creators, b.publisher].filter(Boolean).join(" "));
      return hay.includes(q);
    })
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "tr"));
}

function renderShelf() {
  shelf.innerHTML = "";
  shelfError.hidden = true;
  const list = visibleBooks();

  const ratedCount = state.books.filter((b) => ratingsOf(b.id).size > 0).length;
  shelfStatus.textContent = `${state.books.length} kitap · ${ratedCount} puanlanmış` +
    (state.query || state.filter !== "all" ? ` · ${list.length} sonuç` : "");

  if (!list.length) {
    shelf.append(el("div", { class: "shelf-empty" },
      el("h2", { text: state.books.length ? "Eşleşen kitap yok" : "Kütüphane boş" }),
      el("p", { text: state.books.length
        ? "Aramayı veya filtreleri gevşetmeyi dene."
        : "İlk kitabı eklemek için “Kitap ekle”ye dokun." })));
    return;
  }

  for (const b of list) shelf.append(bookCard(b));
}

function bookCard(b) {
  const { avg, count } = averageOf(b.id);
  const avgNode = avg === null
    ? el("span", { class: "score-avg is-none", text: "—" })
    : el("span", { class: "score-avg", text: avg.toFixed(1) });

  const breakdown = el("ul", { class: "breakdown" },
    ...PEOPLE.map((name) => {
      const v = valueForName(b.id, name);
      return el("li", { class: name === state.user.name ? "is-mine" : "" },
        el("span", { class: "who", text: displayName(name) }),
        el("span", { class: "val" + (v === null ? " is-none" : ""), text: v === null ? "–" : String(v) }));
    }));

  const meta = [b.creators, [b.publisher, b.publish_date].filter(Boolean).join(" · ")]
    .filter(Boolean).join(" — ");

  const card = el("article", { class: "book", role: "button", tabindex: "0", "aria-label": b.title },
    coverNode(b),
    el("div", { class: "book-main" },
      el("h3", { class: "book-title", text: b.title || "(başlıksız)" }),
      meta ? el("p", { class: "book-creators", text: meta }) : null,
      el("div", { class: "book-foot" },
        el("div", { class: "score" },
          avgNode,
          el("span", { class: "score-of", text: "/10" }),
          el("span", { class: "score-count", text: count ? `${count} oy` : "oy yok" }),
          myRead(b.id) ? el("span", { class: "read-stamp", text: "okundu" }) : null),
        breakdown)));

  const open = () => openDetail(b.id);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });
  return card;
}

// ── Detay ──────────────────────────────────────────────────────
function openDetail(bookId) {
  renderDetail(bookId);
  detailDialog.showModal();
}

function renderDetail(bookId) {
  const b = getBook(bookId);
  if (!b) return;
  const { avg, count } = averageOf(bookId);
  const isEditor = state.user.role === "editor";
  const myRating = ratingsOf(bookId).get(state.user.uid)?.value ?? null;

  detailBody.innerHTML = "";

  detailBody.append(
    el("div", { class: "detail-top" },
      el("span", { class: "catalog-no", text: `Fiş № ${String(b.id).toUpperCase()}` }),
      el("button", { class: "detail-close", type: "button", text: "Kapat",
                     onclick: () => detailDialog.close() })));

  detailBody.append(
    el("div", { class: "detail-head" },
      coverNode(b),
      el("div", {},
        el("h2", { id: "detail-title", text: b.title || "(başlıksız)" }),
        b.creators ? el("p", { class: "detail-creators", text: b.creators }) : null,
        el("p", { class: "detail-meta" },
          ...[b.publisher, b.publish_date, b.pages ? `${b.pages} s.` : null,
           b.isbn13 ? `ISBN ${b.isbn13}` : null]
            .filter(Boolean)
            .map((t) => el("span", { text: t })))),
      el("div", { class: "detail-score" },
        avg === null
          ? el("span", { class: "score-avg is-none", text: "—" })
          : el("span", { class: "score-avg", text: avg.toFixed(1) }),
        el("span", { class: "score-of", text: "/10" }),
        el("span", { class: "score-count", text: count ? `${count} oy` : "oy yok" }))));

  // ── İşlemler (hepsi üstte) ──
  const opsGrid = el("div", { class: "detail-grid" });
  // Puan ver
  const rateRow = el("div", { class: "rate-row" });
  for (let v = 1; v <= 10; v++) {
    rateRow.append(el("button", {
      type: "button",
      class: "rate-btn" + (myRating === v ? " is-current" : ""),
      text: String(v),
      "aria-label": `${v} puan`,
      "aria-pressed": String(myRating === v),
      onclick: () => submitRating(bookId, v),
    }));
  }
  opsGrid.append(
    el("section", { class: "section" },
      el("h3", { class: "section-title", text: "Puan ver" }),
      rateRow,
      el("p", { class: "rate-help", text: myRating
        ? `Şu anki puanın: ${myRating}/10 · değiştirmek için başka bir sayıya dokun.`
        : "1–10 arası bir sayıya dokun." })));

  // Okuma durumu
  const iRead = readsOf(bookId).get(state.user.uid)?.read === true;
  opsGrid.append(
    el("section", { class: "section" },
      el("h3", { class: "section-title", text: "Okuma durumu" }),
      el("p", { class: "rate-help", text: iRead ? "Bu kitabı okudun." : "Bu kitabı henüz okumadın." }),
      el("button", { class: "btn btn-ghost", type: "button",
                     text: iRead ? "Okumadı olarak işaretle" : "Okudum olarak işaretle",
                     onclick: () => submitRead(bookId, !iRead) })));

  // Not ekle (form üstte; liste aşağıda "Notlar"da)
  const noteBox = el("textarea", { rows: "3", placeholder: "Bu kitap hakkında bir not yaz…",
                                   "aria-label": "Not" });
  const noteBtn = el("button", { class: "btn btn-primary", type: "button", text: "Notu ekle" });
  noteBtn.addEventListener("click", () => submitNote(bookId, noteBox, noteBtn));
  opsGrid.append(
    el("section", { class: "section" },
      el("h3", { class: "section-title", text: "Not ekle" }),
      el("div", { class: "note-form" }, noteBox, noteBtn)));

  // Kapak — YALNIZCA editor (tekil arama + kaldırma)
  if (isEditor) {
    const covStatus = el("p", { class: "rate-help", text: b.cover_url
      ? "Onaylı kapak kullanılıyor."
      : "Otomatik kapak (ISBN) veya harf-kapak gösteriliyor." });
    const covOpts = el("div", { class: "cover-opts" });
    const searchBtn = el("button", { class: "btn btn-ghost", type: "button", text: "Kapak ara" });
    searchBtn.addEventListener("click", async () => {
      searchBtn.disabled = true;
      searchBtn.textContent = "Aranıyor…";
      covOpts.innerHTML = "";
      const urls = await searchCovers(b, 6);
      searchBtn.disabled = false;
      searchBtn.textContent = "Kapak ara";
      if (!urls.length) { covStatus.textContent = "Kapak bulunamadı."; return; }
      covStatus.textContent = "Birine dokun — hemen uygulanır.";
      for (const u of urls) {
        const pick = el("button", { class: "cover-opt", type: "button",
                                    "aria-label": "Bu kapağı uygula" },
          el("img", { src: u, alt: "", loading: "lazy" }));
        pick.addEventListener("click", () => applyCover(bookId, u));
        covOpts.append(pick);
      }
    });
    const covBtns = el("div", { class: "cover-detail-btns" }, searchBtn);
    if (b.cover_url) {
      const clearBtn = el("button", { class: "btn btn-ghost", type: "button", text: "Otomatik kapağa dön" });
      clearBtn.addEventListener("click", () => clearCover(bookId));
      covBtns.append(clearBtn);
    }
    opsGrid.append(
      el("section", { class: "section" },
        el("h3", { class: "section-title", text: "Kapak" }),
        el("div", { class: "cover-detail-row" }, coverNode(b), covBtns),
        covStatus,
        covOpts));
  }

  detailBody.append(opsGrid);

  // Düzenleyici işlemleri — YALNIZCA editor (üstte, işlemlerle birlikte)
  if (isEditor) {
    detailBody.append(
      el("div", { class: "editor-actions" },
        el("button", { class: "btn btn-ghost", type: "button", text: "Düzenle",
                       onclick: () => { detailDialog.close(); openForm(bookId); } }),
        el("button", { class: "btn btn-danger", type: "button", text: "Sil",
                       onclick: () => removeBook(bookId) })));
  }

  // Açıklama (+ YALNIZCA editor: özet bul)
  const descPara = el("p", { class: "prose" + (b.description ? "" : " is-empty"),
                             text: b.description || "Açıklama girilmemiş." });
  const descSec = el("section", { class: "section" },
    el("h3", { class: "section-title", text: "Açıklama" }),
    descPara);
  if (isEditor) {
    const sumStatus = el("p", { class: "rate-help", text: "" });
    const sumOpts = el("div", {});
    const sumBtn = el("button", { class: "btn btn-ghost", type: "button", text: "Özet bul" });
    sumBtn.addEventListener("click", async () => {
      sumBtn.disabled = true;
      sumBtn.textContent = "Aranıyor…";
      sumOpts.innerHTML = "";
      sumStatus.textContent = "";
      const found = await searchSummaries(b);
      sumBtn.disabled = false;
      sumBtn.textContent = "Özet bul";
      if (!found.length) { sumStatus.textContent = "Özet bulunamadı."; return; }
      sumStatus.textContent = "Birini seç — açıklamanın yerine geçer.";
      for (const s of found) {
        const preview = s.text.length > 300 ? s.text.slice(0, 300) + "…" : s.text;
        const apply = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Uygula" });
        apply.addEventListener("click", () => applySummary(bookId, s.text));
        sumOpts.append(el("div", { class: "sum-row" },
          el("div", {},
            el("span", { class: "sum-src", text: s.source }),
            el("p", { class: "sum-text", text: preview })),
          apply));
      }
    });
    descSec.append(sumBtn, sumStatus, sumOpts);
  }
  detailBody.append(descSec);

  // Kişi puanları
  detailBody.append(
    el("section", { class: "section" },
      el("h3", { class: "section-title", text: "Kim kaç verdi" }),
      el("ul", { class: "breakdown breakdown-lg" },
        ...PEOPLE.map((name) => {
          const v = valueForName(bookId, name);
          return el("li", { class: name === state.user.name ? "is-mine" : "" },
            el("span", { class: "who", text: displayName(name) }),
            el("span", { class: "val" + (v === null ? " is-none" : ""), text: v === null ? "–" : String(v) }));
        }))));

  // Notlar (liste; form yukarıda "Not ekle"de)
  const notes = notesOf(bookId);
  const noteList = el("ul", { class: "note-list" });
  if (!notes.length) {
    noteList.append(el("li", { class: "prose is-empty", text: "Henüz not yok." }));
  } else {
    for (const n of notes) {
      noteList.append(el("li", { class: "note-entry" },
        el("div", { class: "note-head" },
          el("span", { class: "note-author", text: displayName(n.name) || "?" }),
          el("span", { class: "note-date", text: fmtDate(n.createdAt, true) })),
        el("p", { class: "note-text", text: n.text })));
    }
  }
  detailBody.append(
    el("section", { class: "section" },
      el("h3", { class: "section-title", text: "Notlar" }),
      noteList));

  // Geçmiş
  const acts = activityOf(bookId);
  const actList = el("ul", { class: "activity-list" });
  if (!acts.length) {
    actList.append(el("li", { class: "prose is-empty", text: "Kayıtlı hareket yok." }));
  } else {
    for (const a of acts) {
      actList.append(el("li", { class: "activity-entry" },
        el("span", { class: "activity-name", text: displayName(a.name) || "?" }),
        el("span", { class: "activity-what" },
          document.createTextNode(`${actionLabel(a.action)}`),
          a.detail ? el("strong", { text: ` ${a.detail}` }) : null),
        el("span", { class: "activity-at", text: fmtDate(a.at, true) })));
    }
  }
  detailBody.append(
    el("section", { class: "section" },
      el("h3", { class: "section-title", text: "Hareket geçmişi" }),
      actList));
}

function actionLabel(action) {
  return ({ add: "ekledi", edit: "düzenledi", delete: "sildi", rate: "puanladı", note: "not ekledi" })[action]
    || action;
}

// ── Yazma işlemleri ────────────────────────────────────────────
async function logActivity(book, action, detail) {
  const rec = {
    bookId: book.id, bookTitle: book.title || "", action, detail: detail || "",
    uid: state.user.uid, name: state.user.name, at: new Date().toISOString(),
  };
  try {
    const ref = await addDoc(collection(db, "activity"), rec);
    state.activity.unshift({ id: ref.id, ...rec });
  } catch { /* geçmiş yazılamazsa asıl işlem bozulmasın */ }
}

async function submitRating(bookId, value) {
  const b = getBook(bookId);
  const prev = ratingsOf(bookId).get(state.user.uid)?.value ?? null;
  const updatedAt = new Date().toISOString();
  try {
    await setDoc(doc(db, "books", bookId, "ratings", state.user.uid),
      { value, name: state.user.name, updatedAt });
  } catch (err) {
    alertWriteError(err); return;
  }
  if (!state.ratings.has(bookId)) state.ratings.set(bookId, new Map());
  state.ratings.get(bookId).set(state.user.uid, { value, name: state.user.name, updatedAt });
  await logActivity(b, "rate", prev ? `${prev} → ${value}` : `${value}`);
  renderDetail(bookId);
  renderShelf();
}

async function submitRead(bookId, read) {
  const updatedAt = new Date().toISOString();
  try {
    await setDoc(doc(db, "books", bookId, "reads", state.user.uid),
      { read, name: state.user.name, updatedAt });
  } catch (err) {
    alertWriteError(err); return;
  }
  if (!state.reads.has(bookId)) state.reads.set(bookId, new Map());
  state.reads.get(bookId).set(state.user.uid, { read, name: state.user.name, updatedAt });
  renderDetail(bookId);
  renderShelf();
}

async function submitNote(bookId, box, btn) {
  const text = box.value.trim();
  if (!text) { box.focus(); return; }
  const b = getBook(bookId);
  const rec = { text, uid: state.user.uid, name: state.user.name, createdAt: new Date().toISOString() };
  btn.disabled = true;
  btn.textContent = "Kaydediliyor…";
  try {
    const ref = await addDoc(collection(db, "books", bookId, "notes"), rec);
    if (!state.notes.has(bookId)) state.notes.set(bookId, []);
    state.notes.get(bookId).unshift({ id: ref.id, ...rec });
  } catch (err) {
    btn.disabled = false; btn.textContent = "Notu ekle"; alertWriteError(err); return;
  }
  await logActivity(b, "note", text.slice(0, 60));
  renderDetail(bookId);
}

// ── Kitap ekle / düzenle / sil ─────────────────────────────────
function openForm(bookId = null) {
  state.editingId = bookId;
  const b = bookId ? getBook(bookId) : null;
  formTitle.textContent = b ? "Kitabı düzenle" : "Kitap ekle";
  formSubmit.textContent = b ? "Değişiklikleri kaydet" : "Kaydet";
  formError.hidden = true;
  $("f-title").value = b?.title || "";
  $("f-creators").value = b?.creators || "";
  $("f-publisher").value = b?.publisher || "";
  $("f-date").value = b?.publish_date || "";
  $("f-pages").value = b?.pages ?? "";
  $("f-isbn13").value = b?.isbn13 || "";
  $("f-isbn10").value = b?.isbn10 || "";
  $("f-description").value = b?.description || "";
  formDialog.showModal();
  $("f-title").focus();
}

$("add-book").addEventListener("click", () => openForm(null));
document.querySelectorAll("[data-close-form]").forEach((b) =>
  b.addEventListener("click", () => formDialog.close()));

bookForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("f-title").value.trim();
  if (!title) { showFormError("Başlık zorunlu."); $("f-title").focus(); return; }

  const pagesRaw = $("f-pages").value.trim();
  const pages = pagesRaw ? parseInt(pagesRaw, 10) : null;

  const fields = {
    title,
    creators: $("f-creators").value.trim(),
    publisher: $("f-publisher").value.trim(),
    publish_date: $("f-date").value.trim(),
    isbn13: $("f-isbn13").value.trim().replace(/[^0-9Xx]/g, ""),
    isbn10: $("f-isbn10").value.trim().replace(/[^0-9Xx]/g, ""),
    description: $("f-description").value.trim(),
    pages: Number.isFinite(pages) ? pages : null,
  };

  formSubmit.disabled = true;
  formSubmit.textContent = "Kaydediliyor…";
  try {
    if (state.editingId) await saveEdit(state.editingId, fields);
    else await saveNew(fields);
    formDialog.close();
    renderShelf();
    if (detailDialog.open && state.editingId) renderDetail(state.editingId);
  } catch (err) {
    showFormError(err?.code === "permission-denied"
      ? "Yetkin yok. Bu işlemi yalnızca düzenleyiciler yapabilir."
      : "Kaydedilemedi. Tekrar dene.");
  } finally {
    formSubmit.disabled = false;
    formSubmit.textContent = state.editingId ? "Değişiklikleri kaydet" : "Kaydet";
  }
});

function showFormError(msg) { formError.textContent = msg; formError.hidden = false; }

async function saveNew(fields) {
  const now = new Date().toISOString();
  const data = { ...fields, item_type: "book", added_at: now.slice(0, 10),
                 created_at: now, created_by: state.user.name };
  const ref = await addDoc(collection(db, "books"), data);
  const book = { id: ref.id, ...data };
  state.books.push(book);
  await logActivity(book, "add", "");
  state.editingId = null;
}

async function saveEdit(bookId, fields) {
  const b = getBook(bookId);
  await updateDoc(doc(db, "books", bookId), fields);
  Object.assign(b, fields);
  await logActivity(b, "edit", "");
}

async function removeBook(bookId) {
  const b = getBook(bookId);
  if (!b) return;
  if (!confirm(`“${b.title}” silinsin mi? Bu işlem geri alınamaz.`)) return;
  try {
    await deleteDoc(doc(db, "books", bookId));
  } catch (err) { alertWriteError(err); return; }
  state.books = state.books.filter((x) => x.id !== bookId);
  state.ratings.delete(bookId);
  state.notes.delete(bookId);
  detailDialog.close();
  await logActivity(b, "delete", "");
  renderShelf();
}

function alertWriteError(err) {
  const msg = err?.code === "permission-denied"
    ? "Yetkin yok. Bu işlemi yalnızca düzenleyiciler yapabilir."
    : "İşlem tamamlanamadı. Tekrar dene.";
  shelfError.hidden = false;
  shelfError.textContent = msg;
}

// ── Barkod tarama (ISBN) ───────────────────────────────────────
// Önce tarayıcının yerleşik BarcodeDetector'ı, yoksa ZXing (CDN, tembel yüklenir).
// Okunan ISBN Open Library'de aranır, bulunan bilgi forma doldurulur.
const scanBtn = $("scan-btn");
const scanDialog = $("scan-dialog");
const scanVideo = $("scan-video");
const scanStatus = $("scan-status");
const formNote = $("form-note");
let scanStream = null, scanTimer = 0, scanReader = null, scanDone = false;

function showFormNote(msg) { formNote.textContent = msg; formNote.hidden = false; }
function clearFormNote() { formNote.hidden = true; formNote.textContent = ""; }

scanBtn.addEventListener("click", () => { clearFormNote(); formError.hidden = true; openScanner(); });
document.querySelectorAll("[data-close-scan]").forEach((b) =>
  b.addEventListener("click", () => scanDialog.close()));

function stopStream() {
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  if (scanVideo.srcObject) scanVideo.srcObject = null;
}
function stopScanner() {
  scanDone = true;
  clearTimeout(scanTimer);
  try { scanReader?.reset(); } catch { /* yoksay */ }
  scanReader = null;
  stopStream();
}
scanDialog.addEventListener("close", stopScanner);

async function openScanner() {
  scanDone = false;
  scanStatus.textContent = "Kamera açılıyor…";
  scanDialog.showModal();
  try {
    scanStream = await Promise.race([
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
    ]);
  } catch {
    scanStatus.textContent = "Kameraya erişilemedi. İzni verdiğinden ve HTTPS üzerinden girdiğinden emin ol.";
    return;
  }
  scanVideo.srcObject = scanStream;
  try { await scanVideo.play(); } catch { /* oynatılamazsa da devam */ }
  scanStatus.textContent = "Barkodu çerçevenin içine tut…";
  if ("BarcodeDetector" in window) startNativeScan();
  else {
    try { await startZxingScan(); }
    catch {
      scanStatus.textContent = "Bu tarayıcıda otomatik tarama yok. ISBN'yi elle yazabilirsin.";
    }
  }
}

async function startNativeScan() {
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  } catch {
    return startZxingScan();
  }
  const tick = async () => {
    if (scanDone || !scanDialog.open) return;
    try {
      const codes = await detector.detect(scanVideo);
      if (codes.length) return handleBarcode(codes[0].rawValue);
    } catch { /* bir kareyi atla */ }
    scanTimer = setTimeout(tick, 300);
  };
  tick();
}

async function startZxingScan() {
  const ZX = await import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm");
  stopStream(); // ZXing kendi akışını açar
  scanReader = new ZX.BrowserMultiFormatReader(new Map([
    [ZX.DecodeHintType.POSSIBLE_FORMATS,
     [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A]],
  ]));
  scanStatus.textContent = "Barkodu çerçevenin içine tut…";
  await scanReader.decodeFromConstraints(
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    scanVideo,
    (result) => {
      if (scanDone || !scanDialog.open || !result) return;
      handleBarcode(result.getText());
    });
}

async function lookupIsbn(isbn) {
  const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!res.ok) return null;
  const rec = (await res.json())[`ISBN:${isbn}`];
  if (!rec) return null;
  return {
    title: rec.title || "",
    creators: (rec.authors || []).map((a) => a.name).filter(Boolean).join(", "),
    publisher: rec.publishers?.[0]?.name || "",
    publish_date: (String(rec.publish_date || "").match(/\d{4}/) || [""])[0],
    pages: Number.isInteger(rec.number_of_pages) ? rec.number_of_pages : null,
  };
}

async function handleBarcode(raw) {
  if (scanDone) return;
  scanDone = true;
  stopScanner();
  scanDialog.close();
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 13) {
    showFormError("Barkod okunamadı. Tekrar dene veya bilgileri elle yaz.");
    return;
  }
  if (digits.length === 13) $("f-isbn13").value = digits;
  else $("f-isbn10").value = digits;

  showFormNote("Kitap bilgileri getiriliyor…");
  let info = null;
  try { info = await lookupIsbn(digits); } catch { info = null; }
  if (!info || !info.title) {
    formError.hidden = true;
    showFormNote("Bu ISBN kayıtlarda bulunamadı. Bilgileri elle yazabilirsin.");
    return;
  }
  $("f-title").value = info.title;
  $("f-creators").value = info.creators;
  $("f-publisher").value = info.publisher;
  $("f-date").value = info.publish_date;
  $("f-pages").value = info.pages ?? "";
  showFormNote(`“${info.title}” bulundu — kontrol edip Kaydet'e bas.`);
}

// ── Kapak bulma (eksik kapaklar Open Library'de aranır) ──────
// Aday = cover_url'suz kitaplar. ISBN kapağı çalışıyorsa zaten kapaklıdır
// (listeye girmez); başlık+yazar aramasıyla bulunanlar onayına sunulur.
const findCoversBtn = $("find-covers");
const coversDialog = $("covers-dialog");
const coversBody = $("covers-body");
const coversStatus = $("covers-status");
const coversApply = $("covers-apply");
const coversSelectAll = $("covers-select-all");
let coverOffers = []; // [{ id, title, creators, url, _check }]

findCoversBtn.addEventListener("click", openCovers);
document.querySelectorAll("[data-close-covers]").forEach((b) =>
  b.addEventListener("click", () => coversDialog.close()));
coversDialog.addEventListener("click", (e) => { if (e.target === coversDialog) coversDialog.close(); });

function imageLoads(url, ms = 12000) {
  // NOT: Open Library olmayan kapaklara 200 + boş GIF döner; ?default=false
  // ile 404 alınır, yoksa yoklama da harf-kapak geri dönüşü de çalışmaz.
  const probe = url + (url.includes("?") ? "&" : "?") + "default=false";
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(true);
    im.onerror = () => res(false);
    setTimeout(() => res(false), ms);
    im.src = probe;
  });
}

async function olSearchCover(b) {
  const found = await olSearchCovers(b, 1);
  return found[0] || null;
}

async function fetchJson(url, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function firstAuthorOf(b) {
  return String(b.creators || "").split(",")[0].trim();
}

// Open Library: önce başlık+yazar, boşsa başlıkla dene.
async function olSearchCovers(b, n) {
  const queries = [];
  const author = firstAuthorOf(b);
  if (b.title && author) {
    queries.push(new URLSearchParams({ title: b.title, author,
      limit: "6", fields: "key,title,author_name,cover_i" }));
  }
  if (b.title) {
    queries.push(new URLSearchParams({ title: b.title,
      limit: "6", fields: "key,title,author_name,cover_i" }));
  }
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(`https://openlibrary.org/search.json?${q}`);
    for (const d of (data?.docs || [])) {
      if (d.cover_i && !seen.has(d.cover_i)) {
        seen.add(d.cover_i);
        urls.push(`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`);
        if (urls.length >= n) return urls;
      }
    }
    if (urls.length) return urls.slice(0, n);
  }
  return urls.slice(0, n);
}

// Google Books (aynı web anahtarıyla; servis cevap vermezse sessizce atlanır).
async function gbSearchCovers(b, n) {
  const queries = [];
  const author = firstAuthorOf(b);
  if (b.title && author) {
    queries.push(`intitle:${encodeURIComponent(b.title)}+inauthor:${encodeURIComponent(author)}`);
  }
  if (b.title) {
    queries.push(`intitle:${encodeURIComponent(b.title)}`);
  }
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=10` +
      `&fields=items(volumeInfo/imageLinks)&key=${firebaseConfig.apiKey}`);
    for (const item of (data?.items || [])) {
      const t = item.volumeInfo?.imageLinks?.thumbnail;
      if (t) {
        const u = t.replace(/^http:\/\//, "https://");
        if (!seen.has(u)) {
          seen.add(u);
          urls.push(u);
          if (urls.length >= n) return urls;
        }
      }
    }
    if (urls.length) return urls.slice(0, n);
  }
  return urls.slice(0, n);
}

// Archive.org: tam metin taramalar; kapak, taramanın kapağıdır.
async function archiveSearchCovers(b, n) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) queries.push(`title:(${b.title}) AND creator:(${author}) AND mediatype:texts`);
  if (b.title) queries.push(`${b.title}${author ? " " + author : ""} AND mediatype:texts`);
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
      `&fl[]=identifier&rows=10&output=json`);
    for (const d of (data?.response?.docs || [])) {
      if (d.identifier && !seen.has(d.identifier)) {
        seen.add(d.identifier);
        urls.push(`https://archive.org/services/img/${d.identifier}`);
        if (urls.length >= n) return urls;
      }
    }
    if (urls.length) return urls.slice(0, n);
  }
  return urls.slice(0, n);
}

// Gutendex (Project Gutenberg): kamu malı klasikler.
async function gutendexSearchCovers(b, n) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) queries.push(`${b.title} ${author}`);
  if (b.title) queries.push(b.title);
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(`https://gutendex.com/books?search=${encodeURIComponent(q)}`);
    for (const item of (data?.results || [])) {
      const img = item.formats?.["image/jpeg"];
      if (img && !seen.has(img)) {
        seen.add(img);
        urls.push(img);
        if (urls.length >= n) return urls;
      }
    }
    if (urls.length) return urls.slice(0, n);
  }
  return urls.slice(0, n);
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|&#xa0;/g, " ").trim();
}

// Open Library: search → edition/work kaydından açıklama.
async function olDescriptionForKey(key) {
  const pick = (v) => {
    const s = typeof v === "string" ? v : v?.value;
    return s && s.trim() ? s.trim() : null;
  };
  if (!key) return null;
  if (key.startsWith("/works/")) {
    return pick((await fetchJson(`https://openlibrary.org${key}.json`))?.description);
  }
  if (key.startsWith("/books/")) {
    const ed = await fetchJson(`https://openlibrary.org${key}.json`);
    return pick(ed?.description)
      || (ed?.works?.[0]?.key
        ? pick((await fetchJson(`https://openlibrary.org${ed.works[0].key}.json`))?.description)
        : null);
  }
  return null;
}

async function olSearchSummaries(b) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) {
    queries.push(new URLSearchParams({ title: b.title, author, limit: "3", fields: "key" }));
  }
  if (b.title) {
    queries.push(new URLSearchParams({ title: b.title, limit: "3", fields: "key" }));
  }
  for (const q of queries) {
    const data = await fetchJson(`https://openlibrary.org/search.json?${q}`);
    for (const d of (data?.docs || [])) {
      const text = await olDescriptionForKey(d.key);
      if (text) return [{ text, source: "Open Library" }];
    }
  }
  return [];
}

// Google Books: volumeInfo.description (servis cevap vermezse boş).
async function gbSearchSummaries(b) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) {
    queries.push(`intitle:${encodeURIComponent(b.title)}+inauthor:${encodeURIComponent(author)}`);
  }
  if (b.title) {
    queries.push(`intitle:${encodeURIComponent(b.title)}`);
  }
  for (const q of queries) {
    const data = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5` +
      `&fields=items(volumeInfo/description)&key=${firebaseConfig.apiKey}`);
    for (const item of (data?.items || [])) {
      const text = stripHtml(item.volumeInfo?.description);
      if (text) return [{ text, source: "Google Books" }];
    }
  }
  return [];
}

// Gutendex: summaries alanı doğrudan aramada gelir.
async function gutendexSearchSummaries(b) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) queries.push(`${b.title} ${author}`);
  if (b.title) queries.push(b.title);
  for (const q of queries) {
    const data = await fetchJson(`https://gutendex.com/books?search=${encodeURIComponent(q)}`);
    for (const item of (data?.results || [])) {
      const text = (item.summaries || []).find((s) => s && s.trim());
      if (text) return [{ text: text.trim(), source: "Gutendex" }];
    }
  }
  return [];
}

// Apple Books: ham kayıtlar üzerinden (kapak aramasıyla aynı JSONP çağrısı).
async function appleSearchSummaries(b) {
  for (const item of await appleSearchItems(b)) {
    const text = stripHtml(item.description);
    if (text) return [{ text, source: "Apple Books" }];
  }
  return [];
}

// Özet adayları: 4 kaynak paralel, en çok 4 tane.
async function searchSummaries(b) {
  const [ol, gb, gx, ap] = await Promise.all([
    olSearchSummaries(b), gbSearchSummaries(b),
    gutendexSearchSummaries(b), appleSearchSummaries(b),
  ]);
  return [...ol, ...gb, ...gx, ...ap].slice(0, 4);
}

// Apple Books: anahtarsız ama CORS yok → JSONP (script etiketi).
// Ham kayıtları döner; kapak ve özet aramaları buradan beslenir.
function appleSearchItems(b) {
  const author = firstAuthorOf(b);
  const term = b.title ? `${b.title}${author ? " " + author : ""}` : "";
  if (!term) return Promise.resolve([]);
  return new Promise((res) => {
    const script = document.createElement("script");
    const cb = `ckAppleCb${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
    const cleanup = () => { clearTimeout(timer); delete window[cb]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); res([]); }, 15000);
    window[cb] = (data) => { cleanup(); res(data?.results || []); };
    script.onerror = () => { cleanup(); res([]); };
    script.src = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
      `&media=ebook&limit=10&callback=${cb}`;
    document.head.appendChild(script);
  });
}

async function appleSearchCovers(b, n) {
  const urls = [];
  for (const item of await appleSearchItems(b)) {
    const art = item.artworkUrl100 || item.artworkUrl60;
    if (art) {
      const u = art.replace(/\d+x\d+bb\.jpg/, "300x300bb.jpg");
      if (!urls.includes(u)) urls.push(u);
      if (urls.length >= n) break;
    }
  }
  return urls;
}

// Başlık+yazara göre kapak adayları: 5 kaynak paralel,
// yüklenebilenler, Open Library öncelikli, en çok n tane.
async function searchCovers(b, n = 6) {
  const [ol, gb, ar, gx, ap] = await Promise.all([
    olSearchCovers(b, n), gbSearchCovers(b, n), archiveSearchCovers(b, n),
    gutendexSearchCovers(b, n), appleSearchCovers(b, n),
  ]);
  const merged = [];
  for (const u of [...ol, ...gb, ...ar, ...gx, ...ap]) {
    if (!merged.includes(u)) merged.push(u);
    if (merged.length >= 10) break;
  }
  const good = new Set();
  await Promise.all(merged.map(async (u) => { if (await imageLoads(u)) good.add(u); }));
  return merged.filter((u) => good.has(u)).slice(0, n);
}

// Kapaklı kitap atlanır (ISBN kapağı canonical sayılır); kapaklı ama özel
// cover_url'lu kitapta farklı kapak bulunursa değişiklik önerilir.
async function proposeCover(b) {
  const isbnUrl = b.isbn13 ? `https://covers.openlibrary.org/b/isbn/${b.isbn13}-M.jpg` : null;
  const isbnWorks = isbnUrl ? await imageLoads(isbnUrl) : false;
  if (isbnWorks && (!b.cover_url || b.cover_url === isbnUrl)) return null;
  const alt = await olSearchCover(b);
  const current = b.cover_url || null;
  if (!alt || alt === current) return null;
  return { id: b.id, title: b.title, creators: b.creators, url: alt, isNew: !current };
}

async function openCovers() {
  coverOffers = [];
  coversBody.innerHTML = "";
  coversApply.disabled = true;
  coversSelectAll.disabled = true;
  coversStatus.textContent = "Hazırlanıyor…";
  coversDialog.showModal();
  const cands = state.books;
  if (!cands.length) { coversStatus.textContent = "Kütüphane boş."; return; }
  let done = 0, found = 0;
  const queue = [...cands];
  const worker = async () => {
    while (queue.length) {
      const p = await proposeCover(queue.pop());
      if (p) { coverOffers.push(p); found++; }
      done++;
      coversStatus.textContent = `Taranıyor… ${done}/${cands.length} · ${found} öneri`;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  coverOffers.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "tr"));
  renderOffers();
  const fresh = coverOffers.filter((o) => o.isNew).length;
  coversStatus.textContent = coverOffers.length
    ? `${cands.length} kitap tarandı · ${coverOffers.length} öneri (${fresh} yeni, ${coverOffers.length - fresh} değişiklik).`
    : `${cands.length} kitap tarandı · onay bekleyen öneri yok.`;
}

function renderOffers() {
  coversBody.innerHTML = "";
  const on = coverOffers.length > 0;
  coversApply.disabled = !on;
  coversSelectAll.disabled = !on;
  coversSelectAll.checked = true;
  for (const o of coverOffers) {
    const check = el("input", { type: "checkbox", checked: true,
                                "aria-label": `${o.title || "kitap"} önerisini onayla` });
    o._check = check;
    const img = el("img", { src: o.url, alt: "", loading: "lazy" });
    img.addEventListener("error", () => { check.checked = false; check.disabled = true; });
    coversBody.append(el("div", { class: "cover-row" },
      coverNode(getBook(o.id) || { title: o.title }),
      el("div", { class: "cover" }, img),
      el("div", { class: "cover-info" },
        el("p", { class: "cover-title", text: o.title || "(başlıksız)" }),
        o.creators ? el("p", { class: "cover-creators", text: o.creators }) : null),
      el("label", { class: "cover-check" }, check)));
  }
  updateApplyLabel();
}

function updateApplyLabel() {
  const n = coverOffers.filter((o) => o._check?.checked).length;
  coversApply.textContent = `Seçilenleri uygula (${n})`;
}

coversSelectAll.addEventListener("change", () => {
  for (const o of coverOffers) if (!o._check.disabled) o._check.checked = coversSelectAll.checked;
  updateApplyLabel();
});
coversBody.addEventListener("change", updateApplyLabel);

coversApply.addEventListener("click", async () => {
  const sel = coverOffers.filter((o) => o._check?.checked);
  if (!sel.length) return;
  coversApply.disabled = true;
  coversApply.textContent = "Uygulanıyor…";
  let n = 0;
  for (const o of sel) {
    try {
      await updateDoc(doc(db, "books", o.id), { cover_url: o.url });
      const b = getBook(o.id);
      if (b) b.cover_url = o.url;
      o._done = true;
      n++;
    } catch { /* tekil hata diğerlerini durdurmasın */ }
  }
  coverOffers = coverOffers.filter((o) => !o._done);
  renderOffers();
  coversStatus.textContent = `${n} kapak güncellendi.`;
  renderShelf();
});

async function applyCover(bookId, url) {
  try {
    await updateDoc(doc(db, "books", bookId), { cover_url: url });
  } catch (err) {
    alertWriteError(err); return;
  }
  getBook(bookId).cover_url = url;
  renderDetail(bookId);
  renderShelf();
}

async function applySummary(bookId, text) {
  try {
    await updateDoc(doc(db, "books", bookId), { description: text });
  } catch (err) {
    alertWriteError(err); return;
  }
  getBook(bookId).description = text;
  renderDetail(bookId);
}

async function clearCover(bookId) {
  try {
    await updateDoc(doc(db, "books", bookId), { cover_url: deleteField() });
  } catch (err) {
    alertWriteError(err); return;
  }
  delete getBook(bookId).cover_url;
  renderDetail(bookId);
  renderShelf();
}

// ── Arama & filtre ─────────────────────────────────────────────
searchInput.addEventListener("input", () => { state.query = searchInput.value; renderShelf(); });
filterButtons.forEach((btn) => btn.addEventListener("click", () => {
  state.filter = btn.dataset.filter;
  filterButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
  renderShelf();
}));

// Arka plana dokununca kapat
detailDialog.addEventListener("click", (e) => { if (e.target === detailDialog) detailDialog.close(); });
formDialog.addEventListener("click", (e) => { if (e.target === formDialog) formDialog.close(); });
scanDialog.addEventListener("click", (e) => { if (e.target === scanDialog) scanDialog.close(); });
