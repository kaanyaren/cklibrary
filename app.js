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
import {
  getStorage, ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
  addedBy: "all",
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
const libraryStats = $("library-stats");
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
const formDup = $("form-dup");
const formDupMsg = $("form-dup-msg");
let formDupOk = false; // Kullanıcı "Yine de ekle" dedi mi

let selectedEmail = null;

// ── Yardımcılar ────────────────────────────────────────────────
const trLower = (s) => String(s ?? "").toLocaleLowerCase("tr");
// Veri küçük harf kalır; ekranda ilk harf büyük gösterilir.
const displayName = (s) => {
  const v = String(s ?? "");
  return v.charAt(0).toLocaleUpperCase("tr") + v.slice(1);
};
// Sayı + belirtme ("3'ünü okudun"): ek, sayının okunuşundaki son sözcüğe göre
// seçilir (1'ini, 2'sini, 6'sını, 9'unu, 10'unu, 20'sini, 40'ını, 100'ünü, 1000'ini).
function readPartitive(n) {
  const v = Math.floor(Math.abs(Number(n)));
  if (!Number.isFinite(v)) return `${n}'ini`;
  const ones = ["", "'ini", "'sini", "'ünü", "'ünü", "'ini", "'sını", "'sini", "'ini", "'unu"];
  const tensMap = ["", "'unu", "'sini", "'unu", "'ını", "'sini", "'ını", "'ini", "'ini", "'ını"];
  if (v % 10) return `${v}${ones[v % 10]}`;
  if (v % 100) return `${v}${tensMap[Math.floor(v / 10) % 10]}`;
  if (v === 0) return "0'ını";
  if (v % 1000) return `${v}'ünü`; // …yüz
  if (Math.floor(v / 1e3) % 1e3) return `${v}'ini`; // …bin
  if (Math.floor(v / 1e6) % 1e3) return `${v}'unu`; // …milyon
  if (Math.floor(v / 1e9) % 1e3) return `${v}'ını`; // …milyar
  return `${v}'unu`; // …trilyon ve üstü
}

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
function highResCoverUrl(src) {
  return String(src || "").replace(/-[SM]\.jpg(?=(\?|$))/, "-L.jpg");
}
function coverNode(book, size = "L") {
  const wrap = el("div", { class: "cover" });
  // ?default=false: olmayan kapakta 404 dönsün ki harf-kapak devreye girsin.
  // Liste ve detay kartları retina ekranda net görünmesi için yüksek çözünürlük (L) kullanır.
  const isbn10 = isbn13to10(book.isbn10 || book.isbn13);
  const amzUrl = isbn10 ? `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01._SCLZZZZZZZ_.jpg` : null;
  const olUrl = book.isbn13 ? `https://covers.openlibrary.org/b/isbn/${book.isbn13}-${size}.jpg?default=false` : null;
  const initialCover = highResCoverUrl(book.cover_url);
  let current = initialCover || olUrl || amzUrl;
  if (current) {
    const img = el("img", { src: current,
                            alt: book?.title ? `${book.title} kapağı` : "Kapak", loading: "lazy", decoding: "async",
                            fetchpriority: "auto" });
    // Onaylı kapak ölürse ISBN kaynaklarına düş, hepsi biterse harf-kapak.
    const nextSource = () => {
      if (current === initialCover && olUrl && olUrl !== current) return olUrl;
      if (amzUrl && current !== amzUrl) return amzUrl;
      return null;
    };
    const fallback = () => {
      const n = nextSource();
      if (n) {
        current = n;
        img.src = n;
        return;
      }
      img.remove();
      wrap.append(letterTile(book.title));
    };
    img.addEventListener("error", fallback);
    img.addEventListener("load", () => {
      if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
        fallback();
      }
    });
    wrap.append(img);
  } else {
    wrap.append(letterTile(book.title));
  }
  return wrap;
}

// Detay kapakları: tıklayınca büyük sürüm lightbox'ta açılır (harf-kapak hariç).
const lightboxDialog = $("cover-lightbox");
const lightboxImg = $("cover-lightbox-img");
const lightboxCap = $("cover-lightbox-cap");
function largeCoverUrl(src) {
  return highResCoverUrl(src);
}
function openLightbox(book, src) {
  if (!lightboxDialog || !lightboxImg || !src) return;
  lightboxImg.alt = book?.title ? `${book.title} kapağı büyütülmüş` : "Büyütülmüş kapak";
  lightboxCap.textContent = book?.title || "Kapak";
  const big = largeCoverUrl(src);
  lightboxImg.onerror = () => { lightboxImg.onerror = null; lightboxImg.src = src; };
  lightboxImg.src = big;
  if (!lightboxDialog.open) lightboxDialog.showModal();
}
document.querySelectorAll("[data-close-lightbox]").forEach((b) =>
  b.addEventListener("click", () => lightboxDialog?.close()));
lightboxDialog?.addEventListener("click", (e) => { if (e.target === lightboxDialog) lightboxDialog.close(); });
function zoomableCover(coverEl, book) {
  const img = coverEl.querySelector("img");
  if (!img) return coverEl; // harf-kapak büyütülmez
  coverEl.classList.add("is-zoomable");
  coverEl.setAttribute("role", "button");
  coverEl.setAttribute("tabindex", "0");
  coverEl.setAttribute("aria-label", "Kapağı büyüt");
  coverEl.title = "Büyütmek için dokun";
  const open = (e) => { e.stopPropagation(); openLightbox(book, img.currentSrc || img.src); };
  coverEl.addEventListener("click", open);
  coverEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); }
  });
  return coverEl;
}

// ── Türetilmiş veri ────────────────────────────────────────────
const getBook = (id) => state.books.find((b) => b.id === id);
const ratingsOf = (id) => state.ratings.get(id) || new Map();
const notesOf = (id) => state.notes.get(id) || [];
const readsOf = (id) => state.reads.get(id) || new Map();
// Eski boolean kayıtlar: true -> "read", yok/false -> "unread".
const myReadStatus = (id) => {
  const r = readsOf(id).get(state.user.uid);
  if (r?.status) return r.status;
  return r?.read === true ? "read" : "unread";
};
const myRead = (id) => myReadStatus(id) === "read";
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
function readStatusForName(id, name) {
  for (const r of readsOf(id).values()) {
    if (r.name === name) {
      if (r.status) return r.status;
      return r.read === true ? "read" : "unread";
    }
  }
  return "unread";
}

// ── Seri Algılama ve İlişkilendirme ────────────────────────────
function normalizeKey(s) {
  if (!s) return "";
  const tr = { "ı": "i", "İ": "i", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ş": "s", "Ş": "s", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };
  return String(s).toLowerCase().replace(/[ıİğĞüÜşŞöÖçÇ]/g, (c) => tr[c] || c).replace(/[^a-z0-9]/g, "");
}

function parseVolumeNumber(val) {
  if (!val) return null;
  val = String(val).trim();
  const n = parseInt(val, 10);
  if (!Number.isNaN(n)) return n;
  const roman = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const r = val.toLowerCase();
  let tot = 0, prev = 0;
  for (let i = r.length - 1; i >= 0; i--) {
    const curr = roman[r[i]];
    if (!curr) return null;
    if (curr < prev) tot -= curr;
    else tot += curr;
    prev = curr;
  }
  return tot || null;
}

// Bilinen Popüler Edebiyat Serileri Kataloğu
const KNOWN_SERIES = [
  {
    name: "Dune",
    authors: ["frank herbert"],
    items: [
      { match: "dune tanri imparatoru", vol: "4" },
      { match: "dune cocuklari", vol: "3" },
      { match: "dune mesihi", vol: "2" },
      { match: "dune sapkinlari", vol: "5" },
      { match: "dune rahibeler meclisi", vol: "6" },
      { match: "dune", vol: "1" },
    ]
  },
  {
    name: "Bayan Peregrine'in Tuhaf Çocukları",
    authors: ["ransom riggs"],
    items: [
      { match: "golge sehir", vol: "2" },
      { match: "ruhlar kutuphanesi", vol: "3" },
      { match: "gunler haritasi", vol: "4" },
      { match: "kuslar meclisi", vol: "5" },
      { match: "yoklar sehri", vol: "6" },
      { match: "tuhaf cocuklar", vol: "1" },
      { match: "bayan peregrine", vol: "1" },
    ]
  },
  {
    name: "The Expanse",
    authors: ["corey"],
    items: [
      { match: "leviathan uyaniyor", vol: "1" },
      { match: "caliban", vol: "2" },
      { match: "abaddon", vol: "3" },
      { match: "cibola", vol: "4" },
      { match: "intikam oyunlari", vol: "5" },
      { match: "kuller sehri", vol: "6" },
      { match: "persepolis", vol: "7" },
      { match: "tiamat", vol: "8" },
      { match: "leviathan dusuyor", vol: "9" },
    ]
  },
  {
    name: "Katilbot Günlükleri",
    authors: ["wells", "karamanci"],
    items: [
      { match: "tum sistemler coktu", vol: "1" },
      { match: "kacak protokol", vol: "2" },
      { match: "yapay durum", vol: "3" },
      { match: "cikis stratejisi", vol: "4" },
      { match: "sebeke etkisi", vol: "5" },
      { match: "kacak telemetri", vol: "6" },
      { match: "sistem cokusu", vol: "7" },
    ]
  },
  {
    name: "Buz ve Ateşin Şarkısı",
    authors: ["george r. r. martin", "martin"],
    items: [
      { match: "taht oyunlari", vol: "1" },
      { match: "krallarin carpismasi", vol: "2" },
      { match: "kiliclarin firtinasi", vol: "3" },
      { match: "kargalarin ziyafeti", vol: "4" },
      { match: "ejderhalarin dansi", vol: "5" },
    ]
  },
  {
    name: "Wool",
    authors: ["hugh howey", "howey"],
    items: [
      { match: "silo", vol: "1" },
      { match: "vardiya", vol: "2" },
      { match: "toz", vol: "3" },
    ]
  },
  {
    name: "Yerdeniz",
    authors: ["le guin"],
    items: [
      { match: "yerdeniz buyucusu", vol: "1" },
      { match: "atuan mezarlari", vol: "2" },
      { match: "en uzak sahil", vol: "3" },
      { match: "tehanu", vol: "4" },
      { match: "yerdeniz oykuleri", vol: "5" },
      { match: "oteki ruzgar", vol: "6" },
    ]
  },
  {
    name: "Vakıf",
    authors: ["asimov"],
    items: [
      { match: "vakif ve imparatorluk", vol: "2" },
      { match: "ikinci vakif", vol: "3" },
      { match: "vakifin siniri", vol: "4" },
      { match: "vakif ve dunya", vol: "5" },
      { match: "vakif kurulurken", vol: "6" },
      { match: "vakif ileri", vol: "7" },
      { match: "vakif", vol: "1" },
      { match: "foundation", vol: "1" },
    ]
  }
];

function detectBookSeries(b) {
  if (!b) return null;
  const title = (b.title || "").trim();
  if (!title) return null;

  if (b.series) {
    return {
      name: String(b.series).trim(),
      volume: b.volume || b.series_index || null,
      order: parseVolumeNumber(b.volume || b.series_index),
    };
  }

  const normTitle = normalizeKey(title);
  const normCreators = normalizeKey(b.creators || "");

  // 0. Bilinen Seriler Kataloğu (Dune, The Expanse, Bayan Peregrine, Katilbot vb.)
  for (const s of KNOWN_SERIES) {
    const authorOk = s.authors.length === 0 || s.authors.some((a) => normCreators.includes(normalizeKey(a)));
    if (authorOk) {
      for (const item of s.items) {
        if (normTitle.includes(normalizeKey(item.match))) {
          return {
            name: s.name,
            volume: item.vol,
            order: parseVolumeNumber(item.vol),
          };
        }
      }
    }
  }

  // 1. Parantez içi seri ifadeleri: (Hanımın Çiftliği, #1), (Vakıf Serisi 1), (Buz ve Ateşin Şarkısı, #2)
  const mParen = title.match(/\(([^)]*?(?:#\s*\d+|serisi(?:\s*\d+)?|cilt\s*(?:[0-9]+|[ivxlcdm]+)|vol\.?\s*[0-9]+|book\s*[0-9]+)[^)]*)\)/i);
  if (mParen) {
    const content = mParen[1].trim();
    const mHash = content.match(/^(.*?)[,\s]+#\s*(\d+)$/i);
    if (mHash) {
      const sName = mHash[1].replace(/\s*serisi$/i, "").trim();
      return { name: sName, volume: mHash[2], order: parseVolumeNumber(mHash[2]) };
    }
    const mSeri = content.match(/^(.*?)\s*serisi\s*(\d+)?$/i);
    if (mSeri) {
      const sName = mSeri[1].trim() || title.substring(0, title.indexOf("(")).replace(/[\s\-:,;]+$/, "");
      return { name: sName, volume: mSeri[2] || null, order: parseVolumeNumber(mSeri[2]) };
    }
    const mCilt = content.match(/\b(?:cilt|vol\.?|book)\s*([0-9]+|[ivxlcdm]+)\b/i);
    if (mCilt) {
      const sName = title.substring(0, title.indexOf("(")).replace(/[\s\-:,;]+$/, "");
      return { name: sName, volume: mCilt[1], order: parseVolumeNumber(mCilt[1]) };
    }
  }

  // 2. Cilt X örn. Tek Adam Cilt 1, Kavgam Cilt I
  const mCiltTitle = title.match(/^(.*?)\s+cilt\s+([0-9]+|[ivxlcdm]+)\b/i);
  if (mCiltTitle && mCiltTitle[1].length < 60) {
    return { name: mCiltTitle[1].replace(/[\s\-:,;]+$/, ""), volume: mCiltTitle[2], order: parseVolumeNumber(mCiltTitle[2]) };
  }

  // 3. X. Cilt örn. Akl-i Kemal 1. Cilt
  const mNumCilt = title.match(/^(.*?)\s+([0-9]+)\.\s*cilt\b/i);
  if (mNumCilt && mNumCilt[1].length < 60) {
    return { name: mNumCilt[1].replace(/[\s\-:,;]+$/, ""), volume: mNumCilt[2], order: parseVolumeNumber(mNumCilt[2]) };
  }

  // 4. Book X of Y örn. Persepolis Rising: Book 7 of the Expanse
  const mBookOf = title.match(/Book\s+([0-9]+)\s+of\s+(?:the\s+)?([^,(\n]+)/i);
  if (mBookOf) {
    return { name: mBookOf[2].trim(), volume: mBookOf[1], order: parseVolumeNumber(mBookOf[1]) };
  }

  // 5. Harry Potter
  const mHp = title.match(/Harry Potter(?:\s*([0-9]+))?/i);
  if (mHp) {
    const hpMap = {
      felsefetasi: "1", sorcerer: "1", philosopher: "1",
      sirlarodasi: "2", chamber: "2",
      azkaban: "3", prisoner: "3",
      ateskadehi: "4", goblet: "4",
      zumruduanka: "5", phoenix: "5",
      melezprens: "6", halfblood: "6", halbblut: "6",
      olumyadigarlari: "7", deathlyhallows: "7"
    };
    let vol = mHp[1] || null;
    if (!vol) {
      for (const [k, v] of Object.entries(hpMap)) {
        if (normTitle.includes(k)) { vol = v; break; }
      }
    }
    return { name: "Harry Potter", volume: vol, order: parseVolumeNumber(vol) };
  }

  // 6. Sherlock Holmes Vol. X
  const mSh = title.match(/Sherlock Holmes.*?\bvol(?:ume)?\.?\s*([0-9]+|[ivxlcdm]+)/i);
  if (mSh) {
    return { name: "Sherlock Holmes", volume: mSh[1], order: parseVolumeNumber(mSh[1]) };
  }

  return null;
}

function getSeriesBooks(seriesName, currentBookId) {
  if (!seriesName) return [];
  const targetKey = normalizeKey(seriesName);
  const found = [];
  for (const b of state.books) {
    const s = detectBookSeries(b);
    if (s && normalizeKey(s.name) === targetKey) {
      found.push({ book: b, seriesInfo: s, isCurrent: b.id === currentBookId });
    }
  }
  // Cilt numarasına veya başlığa göre sırala
  found.sort((a, b) => {
    const ordA = a.seriesInfo.order ?? 9999;
    const ordB = b.seriesInfo.order ?? 9999;
    if (ordA !== ordB) return ordA - ordB;
    return (a.book.title || "").localeCompare(b.book.title || "", "tr");
  });
  return found;
}

// ── Giriş ekranı ───────────────────────────────────────────────
function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.hidden = false;
}
function clearLoginError() { loginError.hidden = true; loginError.textContent = ""; }

function selectWho(btn) {
  if (!btn) return;
  selectedEmail = btn.dataset.email;
  whoButtons.forEach((b) => {
    const isSelected = b === btn;
    b.setAttribute("aria-pressed", String(isSelected));
    b.setAttribute("aria-checked", String(isSelected));
    b.tabIndex = isSelected ? 0 : -1;
  });
  clearLoginError();
  passwordInput.focus();
}

whoButtons.forEach((btn, idx) => {
  btn.addEventListener("click", () => selectWho(btn));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = whoButtons[(idx + 1) % whoButtons.length];
      selectWho(next);
      next.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = whoButtons[(idx - 1 + whoButtons.length) % whoButtons.length];
      selectWho(prev);
      prev.focus();
    }
  });
});

const togglePasswordBtn = $("toggle-password");
if (togglePasswordBtn && passwordInput) {
  togglePasswordBtn.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    togglePasswordBtn.setAttribute("aria-pressed", String(isPassword));
    const label = isPassword ? "Şifreyi gizle" : "Şifreyi göster";
    togglePasswordBtn.setAttribute("aria-label", label);
    togglePasswordBtn.title = label;
    const eye = togglePasswordBtn.querySelector(".icon-eye");
    const eyeOff = togglePasswordBtn.querySelector(".icon-eye-off");
    if (eye) eye.hidden = isPassword;
    if (eyeOff) eyeOff.hidden = !isPassword;
    passwordInput.focus();
  });
}

passwordInput?.addEventListener("input", clearLoginError);

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
  $("welcome").textContent = `Kütüphanene hoş geldin ${displayName(state.user.name)}.`;
  $("user-role").textContent = state.user.role === "editor" ? "düzenleyici" : "ekleyici";
  $("find-covers").hidden = state.user.role !== "editor";
  $("find-summaries").hidden = state.user.role !== "editor";
  searchInput.value = "";
  state.query = "";
  state.filter = "all";
  state.addedBy = "all";
  filterButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.filter === "all"));
  document.querySelectorAll(".addedby-select").forEach((s) => { s.value = "all"; });

  renderSkeleton();
  await loadAll();
});

// ── Veri yükleme (sınırlı okuma: kitap + collectionGroup + activity) ──
async function loadAll() {
  shelfError.hidden = true;
  const shelfRetry = $("shelf-retry");
  if (shelfRetry) shelfRetry.hidden = true;
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej({ code: "unavailable" }), 20000));
    const activityPromise = getDocs(collection(db, "activity"));
    const [booksSnap, ratingsSnap, notesSnap, readsSnap] = await Promise.race([
      Promise.all([
        getDocs(collection(db, "books")),
        getDocs(collectionGroup(db, "ratings")),
        getDocs(collectionGroup(db, "notes")),
        getDocs(collectionGroup(db, "reads")),
      ]),
      timeout,
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

    state.activity = [];

    renderShelf();

    try {
      const activitySnap = await activityPromise;
      state.activity = activitySnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    } catch { /* non-critical */ }
  } catch (err) {
    shelf.innerHTML = "";
    shelfError.hidden = false;
    shelfError.textContent = loadErrorMessage(err);
    const retry = $("shelf-retry");
    if (retry) {
      retry.hidden = false;
      retry.onclick = () => { renderSkeleton(); loadAll(); };
    }
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
  libraryStats.textContent = "Kitaplar yükleniyor…";
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
      if (state.addedBy !== "all" && b.created_by !== state.addedBy) return false;
      if (state.filter === "read" && myReadStatus(b.id) !== "read") return false;
      if (state.filter === "reading" && myReadStatus(b.id) !== "reading") return false;
      if (state.filter === "unread" && myReadStatus(b.id) !== "unread") return false;
      if (!q) return true;
      const hay = trLower([b.title, b.creators, b.publisher].filter(Boolean).join(" "));
      return hay.includes(q);
    })
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "tr"));
}

function renderShelf() {
  shelf.innerHTML = "";
  shelfError.hidden = true;
  const retry = $("shelf-retry");
  if (retry) retry.hidden = true;
  const list = visibleBooks();

  const readCount = state.books.filter((b) => myRead(b.id)).length;
  const totalPages = state.books.reduce((sum, b) => sum + (Number(b.pages) > 0 ? Number(b.pages) : 0), 0);
  libraryStats.textContent =
    `${state.books.length} kitap · ${readPartitive(readCount)} okudun · toplam ${totalPages.toLocaleString("tr-TR")} sayfa` +
    (state.query || state.filter !== "all" || state.addedBy !== "all" ? ` · ${list.length} sonuç` : "") +
    (state.addedBy !== "all" ? ` · ekleyen: ${displayName(state.addedBy)}` : "");

  if (!list.length) {
    shelf.append(el("div", { class: "shelf-empty" },
      el("h2", { text: state.books.length ? "Eşleşen kitap yok" : "Kütüphane boş" }),
      el("p", { text: state.books.length
        ? "Aramayı veya filtreleri gevşetmeyi dene."
        : "İlk kitabı eklemek için “Kitap ekle”ye dokun." })));
    return;
  }

  const frag = document.createDocumentFragment();
  for (const b of list) frag.append(bookCard(b));
  shelf.append(frag);
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

  const creators = b.creators || "";
  const publine = [b.publisher, b.publish_date].filter(Boolean).join(" · ");
  const addedBy = b.created_by ? displayName(b.created_by) : null;

  const readFlag = el("span", { class: "read-flag is-" + myReadStatus(b.id),
                 text: { read: "okudum", reading: "okuyorum", unread: "okumadım" }[myReadStatus(b.id)] });

  const seriesInfo = detectBookSeries(b);
  const seriesBadge = seriesInfo
    ? el("span", { class: "series-badge", title: `${seriesInfo.name}${seriesInfo.volume ? ` #${seriesInfo.volume}` : ""}` },
        el("span", { class: "series-badge-icon", "aria-hidden": "true", text: "◈" }),
        "Bir Serinin Parçası")
    : null;

  const card = el("article", { class: "book book-entry", role: "button", tabindex: "0",
                               "data-book-id": b.id, "aria-label": b.title },
    coverNode(b, "L"),
    el("div", { class: "book-main" },
      // Bayrak başlığın içinde float: yalnızca ilk satırı daraltır, sağ boşluk rezervi gerekmez.
      el("h3", { class: "book-title" }, readFlag, b.title || "(başlıksız)"),
      seriesBadge,
      creators ? el("p", { class: "book-creators", text: creators }) : null,
      publine ? el("p", { class: "book-pub", text: publine }) : null,
      addedBy ? el("p", { class: "book-added", text: `Ekleyen: ${addedBy}` }) : null,
      el("div", { class: "book-foot" },
        el("div", { class: "score" },
          avgNode,
          el("span", { class: "score-of", text: "/10" }),
          el("span", { class: "score-count", text: count ? `${count} oy` : "oy yok" })),
        breakdown)));

  return card;
}

// ── Detay (Long Document 02 — tek akışlı katalog fişi) ─────────
let currentDetailBookId = null;
let returnToDetailId = null;

function openDetail(bookId) {
  currentDetailBookId = bookId;
  renderDetail(bookId);
  if (!detailDialog.open) detailDialog.showModal();
  detailDialog.scrollTop = 0;
}

detailDialog.addEventListener("keydown", (e) => {
  if (!detailDialog.open || !currentDetailBookId) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || e.target?.isContentEditable) return;
  const n = e.key === "0" ? 10 : Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 10) return;
  e.preventDefault();
  submitRating(currentDetailBookId, n);
});

function captureDetailFocus() {
  const active = document.activeElement;
  if (!active || !detailBody.contains(active)) return null;
  if (active.dataset?.focusKey) return `[data-focus-key="${active.dataset.focusKey}"]`;
  if (active.id) return `#${CSS.escape(active.id)}`;
  return null;
}

function renderDetail(bookId) {
  const b = getBook(bookId);
  if (!b) return;
  currentDetailBookId = bookId;
  const { avg, count } = averageOf(bookId);
  const isEditor = state.user.role === "editor";
  const myRating = ratingsOf(bookId).get(state.user.uid)?.value ?? null;
  const readStatus = myReadStatus(bookId);
  const notes = notesOf(bookId);
  const acts = activityOf(bookId);

  const prevScroll = detailDialog.scrollTop;
  const focusSelector = captureDetailFocus();
  const wasActionsOpen = detailBody.querySelector(".detail-actions-disclosure")?.open;
  const wasCoverToolsOpen = detailBody.querySelector(".detail-cover-tools")?.open;
  const wasHistoryMoreOpen = detailBody.querySelector(".activity-more")?.open;
  detailBody.innerHTML = "";

  // ── 1. Yapışkan üst bar: görünür fiş numarası + başlık + güvenli eylemler ──
  const shortId = String(b.id || "").slice(0, 6).toUpperCase();
  const topActions = el("div", { class: "detail-top-actions" });
  if (isEditor) {
    topActions.append(
      el("button", {
        class: "btn btn-ghost btn-tiny",
        type: "button",
        text: "Düzenle",
        "data-focus-key": "top-edit",
        onclick: () => openFormFromDetail(bookId),
      }));
  }
  topActions.append(
    el("button", {
      class: "detail-close",
      type: "button",
      text: "Kapat",
      "data-focus-key": "top-close",
      onclick: () => detailDialog.close(),
    }));

  detailBody.append(
    el("div", { class: "detail-top is-sticky" },
      el("div", { class: "detail-top-left" },
        el("span", {
          class: "catalog-no",
          text: `Fiş № ${shortId}`,
          title: `Tam fiş kimliği: ${b.id}`,
        }),
        el("p", { class: "detail-top-title", text: b.title || "(başlıksız)" })),
      topActions));

  // ── 2. Kahraman: tipografik başlık + sağda kapak notu + 3 kişilik aile skoru ──
  const bylineParts = [
    b.publisher,
    b.publish_date,
    b.pages ? `${b.pages} s.` : null,
  ].filter(Boolean);

  const coverWrap = el("div", { class: "detail-cover-note" },
    zoomableCover(coverNode(b), b),
    b.cover_url ? el("span", { class: "cover-badge", text: "Onaylı kapak" }) : null);

  if (isEditor) {
    const covStatus = el("p", {
      class: "rate-help",
      role: "status",
      "aria-live": "polite",
      text: b.cover_url
        ? "Onaylı kapak kullanılıyor."
        : "Otomatik kapak (ISBN) veya harf-kapak gösteriliyor.",
    });
    const covOpts = el("div", { class: "cover-opts" });
    const searchBtn = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Kapak ara" });
    const fileInput = el("input", { type: "file", accept: "image/*", hidden: true });
    const camInput = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
    const fileBtn = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Dosyadan seç" });
    const camBtn = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Kamerayla çek" });
    fileBtn.addEventListener("click", () => fileInput.click());
    camBtn.addEventListener("click", () => camInput.click());
    const onCoverFile = (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) handleCoverFile(bookId, f, covStatus, [fileBtn, camBtn, searchBtn]);
    };
    fileInput.addEventListener("change", onCoverFile);
    camInput.addEventListener("change", onCoverFile);
    searchBtn.addEventListener("click", async () => {
      searchBtn.disabled = true;
      searchBtn.textContent = "Aranıyor…";
      covOpts.innerHTML = "";
      covStatus.textContent = "Hazırlanıyor…";
      const urls = await searchCovers(b, 6, (m) => { covStatus.textContent = m; });
      searchBtn.disabled = false;
      searchBtn.textContent = "Kapak ara";
      if (!urls.length) { covStatus.textContent = "Kapak bulunamadı."; return; }
      covStatus.textContent = "Birine dokun — hemen uygulanır.";
      for (const u of urls) {
        const pick = el("button", {
          class: "cover-opt",
          type: "button",
          "aria-label": "Bu kapağı uygula",
        }, el("img", { src: u, alt: "", loading: "lazy" }));
        pick.addEventListener("click", () => applyCover(bookId, u));
        covOpts.append(pick);
      }
    });
    const covBtns = el("div", { class: "cover-detail-btns" }, searchBtn, fileBtn, camBtn, fileInput, camInput);
    if (b.cover_url) {
      const clearBtn = el("button", {
        class: "btn btn-ghost btn-tiny",
        type: "button",
        text: "Otomatik kapağa dön",
        onclick: () => clearCover(bookId),
      });
      covBtns.append(clearBtn);
    }
    const coverTools = el("details", { class: "detail-cover-tools" },
      el("summary", { class: "detail-cover-summary", "data-focus-key": "cover-tools-toggle", text: "Kapağı değiştir" }),
      el("div", { class: "detail-cover-drawer" }, covBtns, covStatus, covOpts));
    if (wasCoverToolsOpen) coverTools.open = true;
    coverWrap.append(coverTools);
  }

  const readStatusLabels = { read: "Okudu", reading: "Okuyor", unread: "Okumadı" };
  const myStatusLabels = { read: "Okudum", reading: "Okuyorum", unread: "Okumadım" };

  const hero = el("div", { class: "detail-hero" },
    el("div", { class: "detail-titleblock" },
      el("h2", { id: "detail-title", text: b.title || "(başlıksız)" }),
      b.creators ? el("p", { class: "detail-creators", text: b.creators }) : null,
      bylineParts.length
        ? el("p", { class: "detail-byline", text: bylineParts.join(" · ") })
        : null),
    coverWrap,
    el("div", { class: "detail-scorecard detail-score-line" },
      el("div", { class: "score-hero" },
        avg === null
          ? el("span", { class: "score-avg is-none", text: "—" })
          : el("span", { class: "score-avg", text: avg.toFixed(1) }),
        el("span", { class: "score-of", text: "/10" }),
        el("span", { class: "score-count", text: count ? `${count} oy` : "oy yok" })),
      el("ul", { class: "mini-breakdown", "aria-label": "Aile puanları ve okuma durumları" },
        ...PEOPLE.map((name) => {
          const v = valueForName(bookId, name);
          const rStat = readStatusForName(bookId, name);
          const isMe = name === state.user.name;
          const rLabel = isMe ? myStatusLabels[rStat] : readStatusLabels[rStat];
          return el("li", { class: isMe ? "is-mine" : "" },
            el("div", { class: "member-top" },
              el("span", { class: "who", text: displayName(name) }),
              el("span", { class: "val" + (v === null ? " is-none" : ""), text: v === null ? "–" : String(v) })),
            el("span", {
              class: `member-read is-${rStat}`,
              text: rLabel,
            }));
        }))));

  // ── 3. Açıklama (Synopsis): ilk ekranda hemen okunabilir ──
  const docFlow = el("div", { class: "detail-doc" });

  const descPara = el("p", {
    class: "prose" + (b.description ? "" : " is-empty"),
    text: b.description || "Açıklama girilmemiş.",
  });
  const descSec = el("section", { class: "section detail-section-first" },
    el("h3", { class: "section-title", text: "Açıklama" }),
    descPara);

  if (isEditor) {
    const sumStatus = el("p", { class: "rate-help", role: "status", "aria-live": "polite", text: "" });
    const sumOpts = el("div", {});
    const sumBtn = el("button", { class: "btn btn-ghost btn-tiny detail-inline-cta", type: "button", text: "Özet bul" });
    sumBtn.addEventListener("click", async () => {
      sumBtn.disabled = true;
      sumBtn.textContent = "Aranıyor…";
      sumOpts.innerHTML = "";
      sumStatus.textContent = "Hazırlanıyor…";
      const found = await searchSummaries(b, 8, (m) => { sumStatus.textContent = m; });
      sumBtn.disabled = false;
      sumBtn.textContent = "Özet bul";
      if (!found.length) { sumStatus.textContent = "Özet bulunamadı."; return; }
      sumStatus.textContent = `${found.length} aday bulundu — tam metni okuyup birini seç, açıklamanın yerine geçer.`;
      for (const s of found) {
        const apply = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Uygula" });
        apply.addEventListener("click", () => applySummary(bookId, s.text));
        sumOpts.append(el("div", { class: "sum-row" },
          el("div", {},
            el("span", { class: "sum-src", text: `${s.source} · ${s.text.length} karakter` }),
            el("p", { class: "sum-text is-full", text: s.text })),
          apply));
      }
    });
    descSec.append(sumBtn, sumStatus, sumOpts);
  }
  docFlow.append(descSec);

  // ── 4. Puan & Okuma Durumu (Katlanabilir / Collapsible eylem şeridi) ──
  const rateRow = el("div", { class: "rate-row" });
  for (const [rangeLabel, from, to] of [["1–5", 1, 5], ["6–10", 6, 10]]) {
    const group = el("div", { class: "rate-group", role: "group", "aria-label": `${rangeLabel} arası puanlar` });
    group.append(el("span", { class: "rate-range", "aria-hidden": "true", text: rangeLabel }));
    for (let v = from; v <= to; v++) {
      group.append(el("button", {
        type: "button",
        class: "rate-btn" + (myRating === v ? " is-current" : ""),
        text: String(v),
        "data-focus-key": `rate-${v}`,
        "aria-label": myRating === v ? `${v} puan, şu anki puanın` : `${v} puan ver`,
        "aria-pressed": String(myRating === v),
        onclick: () => submitRating(bookId, v),
      }));
    }
    rateRow.append(group);
  }

  const rateHelp = el("p", {
    class: "rate-help",
    role: "status",
    "aria-live": "polite",
    text: myRating !== null
      ? `Şu anki puanın ${myRating}/10. Başka sayıya dokunursan değişir.`
      : "1–10 arası bir sayıya dokun; ortalamaya eklenir.",
  });
  const kbdHint = el("span", { class: "rate-kbd-hint", text: " (Klavye: 1–9, 10 için 0)" });
  rateHelp.append(kbdHint);

  const defaultActionsOpen = wasActionsOpen !== undefined
    ? wasActionsOpen
    : (myRating === null && readStatus === "unread");

  const summaryStatusText = [
    myRating !== null ? `Puanın: ${myRating}/10` : "Puan verilmedi",
    myStatusLabels[readStatus],
  ].join(" · ");

  const actionsDisclosure = el("details", { class: "section detail-actions-disclosure" },
    el("summary", { class: "detail-actions-summary", "data-focus-key": "actions-toggle" },
      el("span", { class: "section-title detail-summary-label", text: "Senin Kaydın" }),
      el("span", { class: "detail-summary-val", text: summaryStatusText }),
      el("span", { class: "detail-summary-cta", text: "Puanla / Değiştir" })),
    el("div", { class: "detail-actions" },
      el("div", { class: "action-card", role: "region", "aria-label": "Puan ver" },
        el("h4", { class: "action-subtitle", text: "Puan ver" }),
        rateRow,
        rateHelp,
        myRating !== null
          ? el("button", {
              class: "btn btn-ghost btn-tiny rate-clear",
              type: "button",
              text: "Puanı kaldır",
              "data-focus-key": "rate-clear",
              "aria-label": `Puanını kaldır (${myRating}/10)`,
              onclick: () => clearRating(bookId),
            })
          : null),
      el("div", { class: "action-card", role: "region", "aria-label": "Okuma durumu" },
        el("h4", { class: "action-subtitle", text: "Okuma durumu" }),
        el("div", { class: "rate-row", role: "group", "aria-label": "Okuma durumu seç" },
          ...[["read", "Okudum"], ["reading", "Okuyorum"], ["unread", "Okumadım"]].map(([v, label]) =>
            el("button", {
              class: "rate-btn read-toggle" + (readStatus === v ? " is-current" : ""),
              type: "button",
              text: label,
              "data-focus-key": `read-${v}`,
              "aria-pressed": String(readStatus === v),
              onclick: () => submitRead(bookId, v),
            }))))));
  if (defaultActionsOpen) actionsDisclosure.open = true;
  docFlow.append(actionsDisclosure);

  // ── 5. Seri Bilgisi (Varsa, Long Document akışında) ──
  const seriesInfo = detectBookSeries(b);
  if (seriesInfo) {
    const seriesBooks = getSeriesBooks(seriesInfo.name, bookId);
    const seriesSection = el("section", { class: "section detail-series-section" },
      el("h3", { class: "section-title", text: "Seri" }),
      el("div", { class: "detail-series-box" },
        el("div", { class: "detail-series-head" },
          el("div", { class: "detail-series-title-row" },
            el("span", { class: "series-badge" },
              el("span", { class: "series-badge-icon", "aria-hidden": "true", text: "◈" }),
              "Seri"),
            el("h4", { class: "detail-series-name", text: `${seriesInfo.name} Serisi` })),
          seriesInfo.volume ? el("span", { class: "detail-series-vol", text: `${seriesInfo.volume}. Kitap` }) : null),
        seriesBooks.length > 1
          ? el("div", { class: "detail-series-list-wrap" },
              el("p", { class: "detail-series-subhead", text: "Kütüphanedeki diğer kitapları:" }),
              el("div", { class: "detail-series-chips" },
                ...seriesBooks.map(({ book: sb, seriesInfo: sInfo, isCurrent }) => {
                  const volTag = sInfo.volume ? `#${sInfo.volume} ` : "";
                  if (isCurrent) {
                    return el("span", {
                      class: "series-chip is-current",
                      "aria-current": "true",
                      title: "Şu an görüntülenen kitap",
                      text: `${volTag}${sb.title || "(başlıksız)"}`,
                    });
                  }
                  return el("button", {
                    type: "button",
                    class: "series-chip",
                    title: `${sb.title} detayına git`,
                    text: `${volTag}${sb.title || "(başlıksız)"}`,
                    onclick: () => {
                      renderDetail(sb.id);
                      detailDialog.scrollTop = 0;
                    },
                  });
                })))
          : el("p", { class: "detail-series-alone", text: "Bu seriden kütüphanede kayıtlı başka kitap bulunmuyor." })));
    docFlow.append(seriesSection);
  }

  // ── 6. Aile Notları (Tek akışta doğrudan görünür) ──
  const noteBox = el("textarea", {
    rows: "2",
    placeholder: "Bu kitap hakkında bir aile notu bırak…",
    "aria-label": "Not",
    "data-focus-key": "note-input",
  });
  const noteBtn = el("button", {
    class: "btn btn-primary",
    type: "button",
    text: "Notu ekle",
    "data-focus-key": "note-submit",
  });
  noteBtn.addEventListener("click", () => submitNote(bookId, noteBox, noteBtn));

  const noteList = el("ul", { class: "note-list" });
  if (!notes.length) {
    noteList.append(el("li", { class: "prose is-empty", text: "Henüz not yok. İlk notu sen ekle." }));
  } else {
    for (const n of notes) {
      noteList.append(el("li", { class: "note-entry" },
        el("div", { class: "note-head" },
          el("span", { class: "note-author", text: displayName(n.name) || "?" }),
          el("span", { class: "note-date", text: fmtDate(n.createdAt, true) })),
        el("p", { class: "note-text", text: n.text })));
    }
  }
  docFlow.append(
    el("section", { class: "section" },
      el("h3", {
        class: "section-title",
        text: notes.length ? `Notlar · ${notes.length}` : "Notlar",
      }),
      noteList,
      el("div", { class: "note-form" }, noteBox, noteBtn)));

  // ── 7. Künye (Tekrarsız katalog kimlik verileri) ──
  const facts = [
    ["Fiş №", shortId],
    ["Ekleyen", b.created_by ? displayName(b.created_by) : null],
    ["Eklenme", b.added_at ? fmtDate(b.added_at, false) : null],
    ["ISBN-13", b.isbn13],
    ["ISBN-10", b.isbn10],
  ].filter(([, v]) => v);
  if (facts.length) {
    docFlow.append(
      el("section", { class: "section" },
        el("h3", { class: "section-title", text: "Künye" }),
        el("dl", { class: "fact-grid" },
          ...facts.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]))));
  }

  // ── 8. Hareket Geçmişi (Kompakt akış, >3 kayıt varsa katlanır) ──
  const renderActItem = (a) => el("li", { class: "activity-entry" },
    el("span", { class: "activity-name", text: displayName(a.name) || "?" }),
    el("span", { class: "activity-what" },
      document.createTextNode(`${actionLabel(a.action)}`),
      a.detail ? el("strong", { text: ` ${a.detail}` }) : null),
    el("span", { class: "activity-at", text: fmtDate(a.at, true) }));

  const actSec = el("section", { class: "section" },
    el("h3", {
      class: "section-title",
      text: acts.length ? `Hareket geçmişi · ${acts.length}` : "Hareket geçmişi",
    }));

  if (!acts.length) {
    actSec.append(el("p", { class: "prose is-empty", text: "Kayıtlı hareket yok." }));
  } else {
    const visibleActs = acts.slice(0, 3);
    const hiddenActs = acts.slice(3);
    actSec.append(el("ul", { class: "activity-list" }, ...visibleActs.map(renderActItem)));
    if (hiddenActs.length) {
      const moreDetails = el("details", { class: "activity-more" },
        el("summary", {
          class: "activity-more-summary",
          "data-focus-key": "activity-more-toggle",
          text: `Tüm hareketleri göster (+${hiddenActs.length})`,
        }),
        el("ul", { class: "activity-list activity-list-more" }, ...hiddenActs.map(renderActItem)));
      if (wasHistoryMoreOpen) moreDetails.open = true;
      actSec.append(moreDetails);
    }
  }
  docFlow.append(actSec);

  // ── 9. Yıkıcı işlem (Sil) yalnız fişin en altında, Kapat'tan uzakta ──
  if (isEditor) {
    docFlow.append(
      el("div", { class: "editor-bar" },
        el("button", {
          class: "btn btn-ghost",
          type: "button",
          text: "Fişi düzenle",
          "data-focus-key": "bottom-edit",
          onclick: () => openFormFromDetail(bookId),
        }),
        el("button", {
          class: "btn btn-danger",
          type: "button",
          text: "Kitabı sil",
          "data-focus-key": "bottom-delete",
          onclick: () => removeBook(bookId),
        })));
  }

  detailBody.append(hero, docFlow);
  detailDialog.scrollTop = prevScroll || 0;

  if (focusSelector) {
    const target = detailBody.querySelector(focusSelector);
    if (target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  }
}

function actionLabel(action) {
  return ({ add: "ekledi", edit: "düzenledi", delete: "sildi", rate: "puanladı", note: "not ekledi" })[action]
    || action;
}

// ── Yazma işlemleri ────────────────────────────────────────────
// Harden: çift-dokunma kilidi + satır-içi hata/onay + Geri al. Türkçe,
// sessiz durum dili, yeni bağımlılık yok.
const writeBusy = new Set();
const confirmPending = new Map();
const removeArmed = new Set();
const UNDO_MS = 8000;
let undoTimer = 0;

function writeErrorMessage(err) {
  switch (err?.code) {
    case "permission-denied": return "Yetkin yok. Bu işlemi yalnızca düzenleyiciler yapabilir.";
    case "unavailable":
    case "deadline-exceeded":
    case "cancelled": return "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.";
    case "unauthenticated": return "Oturumun kapandı. Yeniden giriş yapıp tekrar dene.";
    default: return "İşlem tamamlanamadı. Tekrar dene.";
  }
}

function rerenderDetailPreserving(bookId) {
  renderDetail(bookId);
  renderShelf();
}

function showDetailError(msg, onRetry) {
  detailBody.querySelector(".detail-write-error")?.remove();
  const row = el("div", { class: "detail-write-error", role: "alert" },
    el("span", { text: msg }));
  if (onRetry) {
    const retry = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Tekrar dene" });
    retry.addEventListener("click", () => { row.remove(); onRetry(); });
    row.append(retry);
    retry.focus({ preventScroll: true });
  }
  const anchor = detailBody.querySelector(".detail-top");
  if (anchor) anchor.after(row); else detailBody.prepend(row);
}

function showConfirmRow(msg, confirmLabel, onConfirm, onCancel) {
  detailBody.querySelector(".detail-write-error")?.remove();
  document.querySelectorAll(".undo-bar").forEach((n) => n.remove());
  const ok = el("button", { class: "btn btn-danger btn-tiny", type: "button", text: confirmLabel });
  const no = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Vazgeç" });
  const row = el("div", { class: "detail-write-error is-confirm", role: "alert" },
    el("span", { text: msg }), ok, no);
  const done = () => row.remove();
  ok.addEventListener("click", () => { done(); onConfirm(); });
  no.addEventListener("click", () => { done(); onCancel?.(); });
  const anchor = detailBody.querySelector(".detail-top");
  if (anchor) anchor.after(row); else detailBody.prepend(row);
  ok.focus({ preventScroll: true });
}

function showUndo(message, onUndo) {
  document.querySelectorAll(".undo-bar").forEach((n) => n.remove());
  detailBody.querySelector(".detail-write-error.is-confirm")?.remove();
  clearTimeout(undoTimer);
  const btn = el("button", { class: "btn btn-ghost btn-tiny", type: "button", text: "Geri al" });
  const bar = el("div", { class: "undo-bar", role: "status" },
    el("span", { text: message }), btn);
  if (detailDialog.open) {
    const anchor = detailBody.querySelector(".detail-top");
    if (anchor) anchor.after(bar); else detailBody.prepend(bar);
  } else {
    appView.prepend(bar);
  }
  const done = () => { clearTimeout(undoTimer); bar.remove(); };
  btn.addEventListener("click", async () => { done(); await onUndo(); });
  undoTimer = setTimeout(done, UNDO_MS);
}

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
  const key = `rate:${bookId}`;
  if (writeBusy.has(key)) return;
  const prevEntry = ratingsOf(bookId).get(state.user.uid) || null;
  const prev = prevEntry?.value ?? null;
  if (prev === value) return;
  writeBusy.add(key);
  const b = getBook(bookId);
  const updatedAt = new Date().toISOString();
  if (!state.ratings.has(bookId)) state.ratings.set(bookId, new Map());
  state.ratings.get(bookId).set(state.user.uid, { value, name: state.user.name, updatedAt });
  rerenderDetailPreserving(bookId);
  try {
    await setDoc(doc(db, "books", bookId, "ratings", state.user.uid),
      { value, name: state.user.name, updatedAt });
  } catch (err) {
    if (prevEntry) state.ratings.get(bookId).set(state.user.uid, prevEntry);
    else state.ratings.get(bookId).delete(state.user.uid);
    rerenderDetailPreserving(bookId);
    showDetailError(writeErrorMessage(err), () => submitRating(bookId, value));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
  await logActivity(b, "rate", prev ? `${prev} → ${value}` : `${value}`);
  if (detailDialog.open && currentDetailBookId === bookId) renderDetail(bookId);
}

async function clearRating(bookId) {
  const key = `rate:${bookId}`;
  if (writeBusy.has(key)) return;
  const prevEntry = ratingsOf(bookId).get(state.user.uid) || null;
  if (prevEntry === null) return;
  const prev = prevEntry.value;
  writeBusy.add(key);
  const b = getBook(bookId);
  state.ratings.get(bookId)?.delete(state.user.uid);
  rerenderDetailPreserving(bookId);
  try {
    await deleteDoc(doc(db, "books", bookId, "ratings", state.user.uid));
  } catch (err) {
    if (!state.ratings.has(bookId)) state.ratings.set(bookId, new Map());
    state.ratings.get(bookId).set(state.user.uid, prevEntry);
    rerenderDetailPreserving(bookId);
    showDetailError(writeErrorMessage(err), () => clearRating(bookId));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
  await logActivity(b, "rate", `${prev} → –`);
  if (detailDialog.open && currentDetailBookId === bookId) renderDetail(bookId);
}

async function submitRead(bookId, status) {
  const key = `read:${bookId}`;
  if (writeBusy.has(key)) return;
  if (!["read", "reading", "unread"].includes(status)) return;
  if (myReadStatus(bookId) === status) return;
  writeBusy.add(key);
  const prevEntry = readsOf(bookId).get(state.user.uid) || null;
  const updatedAt = new Date().toISOString();
  if (!state.reads.has(bookId)) state.reads.set(bookId, new Map());
  state.reads.get(bookId).set(state.user.uid, { status, read: status === "read", name: state.user.name, updatedAt });
  rerenderDetailPreserving(bookId);
  try {
    await setDoc(doc(db, "books", bookId, "reads", state.user.uid),
      { status, read: status === "read", name: state.user.name, updatedAt });
  } catch (err) {
    if (prevEntry) state.reads.get(bookId).set(state.user.uid, prevEntry);
    else state.reads.get(bookId).delete(state.user.uid);
    rerenderDetailPreserving(bookId);
    showDetailError(writeErrorMessage(err), () => submitRead(bookId, status));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
}

async function submitNote(bookId, box, btn) {
  const key = `note:${bookId}`;
  if (writeBusy.has(key)) return;
  const text = box.value.trim();
  if (!text) { box.focus(); return; }
  const b = getBook(bookId);
  const rec = { text, uid: state.user.uid, name: state.user.name, createdAt: new Date().toISOString() };
  writeBusy.add(key);
  btn.disabled = true;
  btn.textContent = "Kaydediliyor…";
  try {
    const ref = await addDoc(collection(db, "books", bookId, "notes"), rec);
    if (!state.notes.has(bookId)) state.notes.set(bookId, []);
    state.notes.get(bookId).unshift({ id: ref.id, ...rec });
  } catch (err) {
    btn.disabled = false; btn.textContent = "Notu ekle";
    showDetailError(writeErrorMessage(err), () => submitNote(bookId, box, btn));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
  await logActivity(b, "note", text.slice(0, 60));
  rerenderDetailPreserving(bookId);
}

// ── Kitap ekle / düzenle / sil ─────────────────────────────────
function openFormFromDetail(bookId) {
  returnToDetailId = bookId;
  detailDialog.close();
  openForm(bookId);
}

function openForm(bookId = null) {
  if (!bookId) returnToDetailId = null;
  state.editingId = bookId;
  const b = bookId ? getBook(bookId) : null;
  formTitle.textContent = b ? "Kitabı düzenle" : "Kitap ekle";
  formSubmit.textContent = b ? "Değişiklikleri kaydet" : "Kaydet";
  formError.hidden = true;
  formDup.hidden = true;
  formDupOk = false;
  $("lookup-isbn-input").value = "";
  clearFormNote();
  $("f-title").value = b?.title || "";
  $("f-creators").value = b?.creators || "";
  $("f-publisher").value = b?.publisher || "";
  $("f-date").value = b?.publish_date || "";
  $("f-pages").value = b?.pages ?? "";
  $("f-isbn13").value = b?.isbn13 || "";
  $("f-isbn10").value = b?.isbn10 || "";
  $("f-description").value = b?.description || "";
  setFormCover(b?.cover_url || "");
  formDialog.showModal();
  // Kısa ekranlarda (telefon + açık klavye) otomatik odak klavyeyi
  // dayayıp formu perdeliyor; odaklamayı uzun ekrana sakla.
  if (matchMedia("(min-height: 500px)").matches) {
    if (!b) $("lookup-isbn-input").focus();
    else $("f-title").focus();
  }
}

$("add-book").addEventListener("click", () => openForm(null));
document.querySelectorAll("[data-close-form]").forEach((b) =>
  b.addEventListener("click", () => formDialog.close()));

formDialog.addEventListener("close", () => {
  if (returnToDetailId && getBook(returnToDetailId)) {
    const reopenId = returnToDetailId;
    returnToDetailId = null;
    openDetail(reopenId);
  }
});

bookForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("f-title").value.trim();
  if (!title) { showFormError("Başlık zorunlu."); $("f-title").focus(); return; }

  const pagesRaw = $("f-pages").value.trim();
  const pages = pagesRaw ? parseInt(pagesRaw, 10) : null;

  const coverUrlVal = $("f-cover-url").value.trim();
  const fields = {
    title: fixTurkishMojibake(title),
    creators: fixTurkishMojibake($("f-creators").value.trim()),
    publisher: fixTurkishMojibake($("f-publisher").value.trim()),
    publish_date: $("f-date").value.trim(),
    isbn13: $("f-isbn13").value.trim().replace(/[^0-9Xx]/g, ""),
    isbn10: $("f-isbn10").value.trim().replace(/[^0-9Xx]/g, ""),
    description: fixTurkishMojibake($("f-description").value.trim()),
    pages: Number.isFinite(pages) ? pages : null,
    ...(coverUrlVal ? { cover_url: coverUrlVal } : {}),
  };

  if (!state.editingId && !formDupOk) {
    const dup = findDuplicateBook(fields.isbn13, fields.isbn10);
    if (dup) { showDupConfirm(dup); return; }
  }

  formSubmit.disabled = true;
  formSubmit.textContent = "Kaydediliyor…";
  try {
    const editedId = state.editingId;
    if (editedId) await saveEdit(editedId, fields);
    else await saveNew(fields);
    renderShelf();
    formDialog.close();
  } catch (err) {
    showFormError(err?.code === "permission-denied"
      ? "Yetkin yok. Bu işlemi yalnızca düzenleyiciler yapabilir."
      : "Kaydedilemedi. Tekrar dene.");
  } finally {
    formSubmit.disabled = false;
    formSubmit.textContent = state.editingId ? "Değişiklikleri kaydet" : "Kaydet";
  }
});

function setFormCover(url) {
  const input = $("f-cover-url");
  const preview = $("form-cover-preview");
  const img = $("form-cover-img");
  const clean = String(url || "").trim();
  input.value = clean;
  if (clean) {
    img.src = clean;
    preview.hidden = false;
  } else {
    img.removeAttribute("src");
    preview.hidden = true;
  }
}

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
  const key = `del:${bookId}`;
  if (writeBusy.has(key)) return;
  if (!removeArmed.has(bookId)) {
    removeArmed.add(bookId);
    showConfirmRow(`“${b.title || "Kitap"}” silinir; puanlar ve notlar listeden kalkar.`, "Sil",
      () => { removeArmed.delete(bookId); removeBook(bookId); },
      () => removeArmed.delete(bookId));
    setTimeout(() => removeArmed.delete(bookId), UNDO_MS);
    return;
  }
  removeArmed.delete(bookId);
  writeBusy.add(key);
  const snap = { ...b }; delete snap.id;
  const snapRatings = new Map(ratingsOf(bookId));
  const snapNotes = [...notesOf(bookId)];
  const snapReads = new Map(readsOf(bookId));
  try {
    await deleteDoc(doc(db, "books", bookId));
  } catch (err) {
    writeBusy.delete(key);
    removeArmed.add(bookId);
    showDetailError(writeErrorMessage(err), () => removeBook(bookId));
    return;
  }
  // NOT: deleteDoc alt koleksiyonları silmez; aynı id ile yeniden yazmak
  // onları görünür kılar, o yüzden Geri al yalnızca üst belgeyi yazar.
  state.books = state.books.filter((x) => x.id !== bookId);
  state.ratings.delete(bookId);
  state.notes.delete(bookId);
  state.reads.delete(bookId);
  detailDialog.close();
  await logActivity(b, "delete", "");
  renderShelf();
  writeBusy.delete(key);
  showUndo(`“${snap.title || "Kitap"}” silindi.`, async () => {
    try { await setDoc(doc(db, "books", bookId), snap); }
    catch (err) { shelfError.hidden = false; shelfError.textContent = writeErrorMessage(err); return; }
    state.books.push({ id: bookId, ...snap });
    state.ratings.set(bookId, snapRatings);
    if (snapNotes.length) state.notes.set(bookId, snapNotes);
    state.reads.set(bookId, snapReads);
    renderShelf();
  });
}

function alertWriteError(err) {
  const msg = writeErrorMessage(err);
  if (detailDialog.open) { showDetailError(msg, null); return; }
  shelfError.hidden = false;
  shelfError.textContent = msg;
}

// ── Barkod tarama (ISBN) ───────────────────────────────────────
// Önce tarayıcının yerleşik BarcodeDetector'ı, yoksa ZXing (CDN, tembel yüklenir).
// Okunan ISBN sırayla Open Library → Google Books → Kitapyurdu/D&R'de aranır, bulunan bilgi forma doldurulur.
const scanBtn = $("scan-btn");
const scanDialog = $("scan-dialog");
const scanVideo = $("scan-video");
const scanStatus = $("scan-status");
const scanFile = $("scan-file");
const scanPhotoBtn = $("scan-photo-btn");
const formNote = $("form-note");
let scanStream = null, scanTimer = 0, scanReader = null, scanDone = false;
let scanBatch = false, scanBusy = false, scanAdded = 0, scanSkipped = 0;
let scanSeen = new Set(), scanLast = { code: "", at: 0 };

function showFormNote(msg) { formNote.textContent = msg; formNote.hidden = false; }
function clearFormNote() { formNote.hidden = true; formNote.textContent = ""; }

// Kütüphanede aynı ISBN ile kayıtlı kitap var mı (toplu tarama + tekli kayıt aynı kuralı kullanır).
function findDuplicateBook(isbn13, isbn10) {
  const a = String(isbn13 || ""), b = String(isbn10 || "");
  if (!a && !b) return null;
  return state.books.find((x) =>
    (a && (x.isbn13 === a || x.isbn10 === a)) ||
    (b && (x.isbn13 === b || x.isbn10 === b))) || null;
}

function showDupConfirm(dup) {
  formDupMsg.textContent = `“${dup.title || "Bu kayıt"}” zaten kütüphanede. Yine de eklensin mi?`;
  formDup.hidden = false;
  // Uyarı uzun formda ekran altında kalabilir; odak kaydırarak görünür yapar.
  $("form-dup-ok").focus();
}

// Duvarına takılan uyarı, ISBN değişirse geçersiz kalır.
["f-isbn13", "f-isbn10"].forEach((id) =>
  $(id).addEventListener("input", () => { formDup.hidden = true; }));
$("form-dup-ok").addEventListener("click", () => {
  formDup.hidden = true;
  formDupOk = true; // onay verildi, form yeniden gönderilsin
  bookForm.requestSubmit();
});
$("form-dup-no").addEventListener("click", () => { formDup.hidden = true; });

scanBtn.addEventListener("click", () => { clearFormNote(); formError.hidden = true; openScanner(); });
$("lookup-isbn-btn")?.addEventListener("click", () => {
  const val = $("lookup-isbn-input").value;
  applyIsbnLookup(val);
});
$("lookup-isbn-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applyIsbnLookup(e.target.value);
  }
});
$("form-cover-remove")?.addEventListener("click", () => {
  setFormCover("");
});
scanPhotoBtn?.addEventListener("click", () => scanFile?.click());
scanFile?.addEventListener("change", handleScanFile);
$("batch-scan")?.addEventListener("click", openBatchScanner);
// Kart menü: seçince, dışarı dokununca, Esc ile kapanır.
const bulkMenu = $("bulk-menu");
bulkMenu?.querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => bulkMenu.removeAttribute("open")));
document.addEventListener("click", (e) => {
  if (bulkMenu?.open && !bulkMenu.contains(e.target)) bulkMenu.removeAttribute("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") bulkMenu?.removeAttribute("open");
});
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
scanDialog.addEventListener("close", () => { stopScanner(); scanBatch = false; scanBusy = false; });

async function openScanner() {
  scanBatch = false;
  $("scan-title").textContent = "Barkod tara";
  $("scan-count").hidden = true;
  $("scan-items").innerHTML = "";
  scanDone = false;
  scanStatus.textContent = "Kamera açılıyor…";
  if (scanFile) scanFile.value = "";
  if (!scanDialog.open) scanDialog.showModal();
  // iPad mini / eski iOS: mediaDevices hiç olmayabilir (eski Safari, WKWebView).
  if (!navigator.mediaDevices?.getUserMedia) {
    scanStatus.textContent = "Bu cihazda canlı kamera açılamıyor. Alttaki “Fotoğrafla tara”yı kullan veya ISBN'yi elle yaz.";
    return;
  }
  // iOS uyumu: düz string en geniş desteklenir; olmazsa genel kameraya düş.
  const tries = [
    { video: { facingMode: "environment" }, audio: false },
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: true, audio: false },
  ];
  let err0 = null;
  for (const c of tries) {
    try {
      scanStream = await Promise.race([
        navigator.mediaDevices.getUserMedia(c),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
      ]);
      err0 = null;
      break;
    } catch (e) { err0 = e; }
  }
  if (!scanStream) {
    scanStatus.textContent = cameraErrorMessage(err0);
    return;
  }
  scanVideo.setAttribute("playsinline", "true");
  scanVideo.setAttribute("webkit-playsinline", "true");
  scanVideo.muted = true;
  scanVideo.srcObject = scanStream;
  try { await scanVideo.play(); } catch { /* oynatılamazsa da devam */ }
  scanStatus.textContent = "Barkodu çerçevenin içine tut…";
  if ("BarcodeDetector" in window) startNativeScan();
  else {
    try { await startZxingScan(); }
    catch {
      scanStatus.textContent = "Canlı tarama açılamadı. “Fotoğrafla tara”yı kullan veya ISBN'yi elle yaz.";
    }
  }
}

function cameraErrorMessage(err) {
  const n = err?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError")
    return "Kamera izni verilmedi. Ayarlar → Safari → Kamera'dan izin verip tekrar dene; olmazsa “Fotoğrafla tara”yı kullan.";
  if (n === "NotFoundError" || n === "OverconstrainedError")
    return "Kamera bulunamadı. “Fotoğrafla tara”yı kullan veya ISBN'yi elle yaz.";
  if (n === "NotReadableError")
    return "Kamera başka uygulamada açık. Diğer sekmeyi/uygulamayı kapatıp tekrar dene; olmazsa “Fotoğrafla tara”yı kullan.";
  if (!window.isSecureContext)
    return "Kamera için HTTPS gerekli. Adresin https ile başladığından emin ol; olmazsa “Fotoğrafla tara”yı kullan.";
  return "Kameraya erişilemedi. “Fotoğrafla tara”yı kullan veya ISBN'yi elle yaz.";
}

// Fotoğraf yedeği: iOS'ta capture=environment kamera uygulamasını açar,
// gelen kare BarcodeDetector / ZXing ile çözülür. getUserMedia'sız cihazda çalışır.
async function handleScanFile() {
  const f = scanFile?.files?.[0];
  if (!f) return;
  scanStatus.textContent = "Fotoğraf okunuyor…";
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    let raw = null;
    if ("BarcodeDetector" in window) {
      try {
        const d = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        const codes = await d.detect(img);
        raw = codes[0]?.rawValue || null;
      } catch { raw = null; }
    }
    if (!raw) {
      const ZX = await import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm");
      // @zxing/browser DecodeHintType'ı export etmez (undefined → TypeError);
      // 1D okuyucu EAN-13/EAN-8/UPC-A'yı zaten kapsar (Safari'de BarcodeDetector yok).
      const reader = new ZX.BrowserMultiFormatOneDReader();
      try { raw = (await reader.decodeFromImageElement(img))?.getText() || null; }
      catch { raw = null; }
      finally { try { reader.reset(); } catch { /* yoksay */ } }
    }
    if (!raw) {
      scanStatus.textContent = "Barkod okunamadı. Daha net, yakın bir fotoğrafla tekrar dene veya ISBN'yi elle yaz.";
      return;
    }
    await handleBarcode(raw);
  } catch {
    scanStatus.textContent = "Fotoğraf okunamadı. Tekrar dene veya ISBN'yi elle yaz.";
  } finally {
    URL.revokeObjectURL(url);
    if (scanFile) scanFile.value = "";
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
  // ZXing'in kendi döngüsü 500 ms'de bir, tüm 1080p kareyi tarıyor (iPad'de yavaş).
  // Kendi döngümüz: açık akışı kullanır, ortadaki bölgeyi kırpıp 800px'e indirir,
  // saniyede ~10 kez dener (ölçüm: 10.6 ms → ~1.1 ms/deneme).
  scanReader = new ZX.BrowserMultiFormatOneDReader();
  const cv = document.createElement("canvas");
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const tick = () => {
    if (scanDone || !scanDialog.open) return;
    const vw = scanVideo.videoWidth, vh = scanVideo.videoHeight;
    if (vw && vh) {
      const sw = Math.round(vw * 0.8), sh = Math.round(vh * 0.8);
      const dw = Math.min(800, sw), dh = Math.round((dw * sh) / sw);
      if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; }
      cx.drawImage(scanVideo, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, dw, dh);
      try {
        const res = scanReader.decodeFromCanvas(cv);
        if (res) return handleBarcode(res.getText());
      } catch { /* barkod yok, sonraki kare */ }
    }
    scanTimer = setTimeout(tick, 100);
  };
  tick();
}

async function lookupIsbn(isbn) {
  // Sıra: Open Library → Google Books (isbn:) → Kitapyurdu + D&R (proxy, sessizce boş dönebilir).
  let res = null;
  try { const ol = await lookupIsbnOL(isbn); if (ol?.title) res = ol; } catch { /* sonraki kaynağa düş */ }
  if (!res) { try { const gb = await lookupIsbnGB(isbn); if (gb?.title) res = gb; } catch { /* sonraki kaynağa düş */ } }
  if (!res) { try { res = await lookupIsbnTR(isbn); } catch { res = null; } }
  if (!res) return null;
  return {
    ...res,
    title: fixTurkishMojibake(res.title),
    creators: fixTurkishMojibake(res.creators),
    publisher: fixTurkishMojibake(res.publisher),
  };
}

async function lookupIsbnOL(isbn) {
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

// Google Books: q=isbn:… (anahtarsız, CORS serbest; özet/kapak aramalarındaki fetchJson kullanılır).
async function lookupIsbnGB(isbn) {
  const data = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1` +
    `&fields=items(volumeInfo/title,volumeInfo/authors,volumeInfo/publisher,volumeInfo/publishedDate,volumeInfo/pageCount)`);
  const v = data?.items?.[0]?.volumeInfo;
  if (!v?.title) return null;
  return {
    title: v.title || "",
    creators: (v.authors || []).filter(Boolean).join(", "),
    publisher: v.publisher || "",
    publish_date: (String(v.publishedDate || "").match(/\d{4}/) || [""])[0],
    pages: Number.isInteger(v.pageCount) ? v.pageCount : null,
  };
}

// Kitapyurdu + D&R: ISBN ile arama → ilk ürün → JSON-LD Book künyesi.
// ponytail: arama sayfaları JS-render + proxy kırılgan; yanlış kitap engeli için isbn eşleşmesi şart, hata = null.
async function lookupIsbnTR(isbn) {
  const digits = String(isbn || "").replace(/\D/g, "");
  if (!digits) return null;
  for (const lookup of [kyIsbnBook, drIsbnBook]) {
    try {
      const b = await lookup(digits);
      if (b?.title) return b;
    } catch { /* sessizce sonrakine düş */ }
  }
  return null;
}

// Ürün HTML'indeki JSON-LD Book düğümünden künye (özet aramadaki parseProductDescription'ın künye karşılığı).
function bookNodeFromHtml(html) {
  const isBook = (t) => {
    const types = Array.isArray(t) ? t : [t];
    return types.some((x) => String(x || "").toLocaleLowerCase("tr").includes("book"));
  };
  for (const m of String(html || "").matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const blocks = JSON.parse(m[1]);
      for (const blk of (Array.isArray(blocks) ? blocks : [blocks])) {
        const graphs = Array.isArray(blk["@graph"]) ? blk["@graph"] : [blk];
        for (const node of graphs) {
          if (isBook(node?.["@type"])) return node;
        }
      }
    } catch { /* bozuk JSON-LD'yi atla */ }
  }
  return null;
}

function bookInfoFromNode(node) {
  if (!node) return null;
  const author = node.author;
  const creators = Array.isArray(author)
    ? author.map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).join(", ")
    : (author?.name || (typeof author === "string" ? author : ""));
  const publisher = node.publisher?.name || (typeof node.publisher === "string" ? node.publisher : "");
  const pages = Number.isInteger(node.numberOfPages) ? node.numberOfPages
    : (Number.isInteger(parseInt(node.numberOfPages, 10)) ? parseInt(node.numberOfPages, 10) : null);
  return {
    title: fixTurkishMojibake(node.name || ""),
    creators: fixTurkishMojibake(creators || ""),
    publisher: fixTurkishMojibake(publisher || ""),
    publish_date: (String(node.datePublished || "").match(/\d{4}/) || [""])[0],
    pages,
    isbn: String(node.isbn || "").replace(/\D/g, ""),
  };
}

async function kyIsbnBook(digits) {
  const searchHtml = await fetchTextViaProxy(
    `https://www.kitapyurdu.com/index.php?route=product/list&filter_name=${encodeURIComponent(digits)}`);
  const link = searchHtml?.match(/\/kitap\/[a-z0-9-]+\/\d+\.html/);
  if (!link) return null;
  const info = bookInfoFromNode(bookNodeFromHtml(await fetchTextViaProxy(`https://www.kitapyurdu.com${link[0]}`)));
  if (!info?.title || (info.isbn && info.isbn !== digits)) return null;
  return info;
}

async function drIsbnBook(digits) {
  const searchHtml = await fetchTextViaProxy(
    `https://www.dr.com.tr/search?q=${encodeURIComponent(digits)}`);
  const link = searchHtml?.match(/\/[^"\s]*?urunno=\d+/);
  if (!link) return null;
  const url = link[0].startsWith("http") ? link[0] : `https://www.dr.com.tr${link[0]}`;
  const info = bookInfoFromNode(bookNodeFromHtml(await fetchTextViaProxy(url)));
  if (!info?.title || (info.isbn && info.isbn !== digits)) return null;
  return info;
}

async function applyIsbnLookup(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 13) {
    showFormError("Lütfen geçerli bir 10 veya 13 haneli ISBN girin.");
    return;
  }
  formError.hidden = true;
  $("lookup-isbn-input").value = digits;
  if (digits.length === 13) {
    $("f-isbn13").value = digits;
    if (!$("f-isbn10").value) $("f-isbn10").value = isbn13to10(digits) || "";
  } else {
    $("f-isbn10").value = digits;
  }

  showFormNote(`${digits} aranıyor, kitap ve kapak bilgileri getiriliyor…`);
  const btn = $("lookup-isbn-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Aranıyor…"; }

  try {
    const info = await lookupIsbn(digits);
    if (!info || !info.title) {
      showFormNote("Bu ISBN kayıtlarda bulunamadı. Bilgileri elle doldurabilirsin.");
      return;
    }
    $("f-title").value = info.title;
    $("f-creators").value = info.creators;
    $("f-publisher").value = info.publisher;
    $("f-date").value = info.publish_date;
    $("f-pages").value = info.pages ?? "";

    // Kapak bulma: önce ISBN bazlı doğrudan CDN, sonra diğer kaynaklar
    showFormNote(`“${info.title}” bulundu. Kapak taranıyor…`);
    const tempBook = {
      title: info.title,
      creators: info.creators,
      isbn13: digits.length === 13 ? digits : "",
      isbn10: digits.length === 10 ? digits : (isbn13to10(digits) || "")
    };
    let foundCover = null;
    try {
      foundCover = await findCoverForBook(tempBook);
    } catch { foundCover = null; }

    if (foundCover) {
      setFormCover(foundCover);
      showFormNote(`“${info.title}” ve kapağı bulundu — kontrol edip Kaydet'e bas.`);
    } else {
      showFormNote(`“${info.title}” bulundu (kapak bulunamadı) — kontrol edip Kaydet'e bas.`);
    }
  } catch (err) {
    showFormError("Arama sırasında hata oluştu. Bilgileri elle yazabilirsin.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "ISBN ile Bul"; }
  }
}

async function findCoverForBook(b) {
  if (b.isbn13) {
    const olUrl = `https://covers.openlibrary.org/b/isbn/${b.isbn13}-L.jpg`;
    if (await imageLoads(olUrl)) return olUrl;
  }
  const isbn10 = isbn13to10(b.isbn10 || b.isbn13);
  if (isbn10) {
    const amzUrl = `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01._SCLZZZZZZZ_.jpg`;
    if (await imageLoads(amzUrl)) return amzUrl;
  }
  const ol = await olSearchCover(b);
  if (ol) return ol;
  const gb = (await gbSearchCovers(b, 1))[0];
  if (gb && await imageLoads(gb)) return gb;
  const ap = (await appleSearchCovers(b, 1))[0];
  if (ap && await imageLoads(ap)) return ap;
  return null;
}

async function handleBarcode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 10 && digits.length !== 13) {
    if (!scanBatch) {
      scanDone = true;
      stopScanner();
      scanDialog.close();
      showFormError("Barkod okunamadı. Tekrar dene veya bilgileri elle yaz.");
    } else {
      scanStatus.textContent = "Barkod okunamadı, sonrakini tut…";
      resumeBatchScan();
    }
    return;
  }
  if (scanBatch) return handleBatchBarcode(digits);
  if (scanDone) return;
  scanDone = true;
  stopScanner();
  scanDialog.close();
  await applyIsbnLookup(digits);
}

// ── Toplu barkod tarama: diyalog açık kalır, her barkod direkt kaydedilir ──
function openBatchScanner() {
  scanBatch = true;
  scanBusy = false;
  scanAdded = 0;
  scanSkipped = 0;
  scanSeen = new Set();
  scanLast = { code: "", at: 0 };
  $("scan-title").textContent = "Toplu barkod tara";
  $("scan-items").innerHTML = "";
  updateScanCount();
  $("scan-count").hidden = false;
  openScannerKeepBatch();
}

async function openScannerKeepBatch() {
  scanBatch = true;
  scanDone = false;
  scanStatus.textContent = "Kamera açılıyor…";
  if (scanFile) scanFile.value = "";
  if (!scanDialog.open) scanDialog.showModal();
  if (!navigator.mediaDevices?.getUserMedia) {
    scanStatus.textContent = "Bu cihazda canlı kamera açılamıyor. Alttaki “Fotoğrafla tara”yı kullan.";
    return;
  }
  if (scanStream) {
    scanStatus.textContent = "Barkodu çerçevenin içine tut, bitince Kapat'a bas…";
    if (!scanReader) startNativeScan();
    return;
  }
  await openScannerStreamOnly();
}

async function openScannerStreamOnly() {
  const tries = [
    { video: { facingMode: "environment" }, audio: false },
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: true, audio: false },
  ];
  let err0 = null;
  for (const c of tries) {
    try {
      scanStream = await Promise.race([
        navigator.mediaDevices.getUserMedia(c),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
      ]);
      err0 = null;
      break;
    } catch (e) { err0 = e; }
  }
  if (!scanStream) { scanStatus.textContent = cameraErrorMessage(err0); return; }
  scanVideo.setAttribute("playsinline", "true");
  scanVideo.setAttribute("webkit-playsinline", "true");
  scanVideo.muted = true;
  scanVideo.srcObject = scanStream;
  try { await scanVideo.play(); } catch { /* oynatılamazsa da devam */ }
  scanStatus.textContent = "Barkodu çerçevenin içine tut, bitince Kapat'a bas…";
  if ("BarcodeDetector" in window) startNativeScan();
  else {
    try { await startZxingScan(); }
    catch { scanStatus.textContent = "Canlı tarama açılamadı. “Fotoğrafla tara”yı kullan."; }
  }
}

function updateScanCount() {
  $("scan-count").textContent = `${scanAdded} eklendi · ${scanSkipped} atlandı — sonrakini tut, bitince Kapat'a bas`;
}

function addScanRow(text, cls) {
  const li = document.createElement("li");
  li.className = "note-entry" + (cls ? ` ${cls}` : "");
  li.textContent = text;
  $("scan-items").prepend(li);
}

function resumeBatchScan() {
  scanBusy = false;
  if (!scanBatch || !scanDialog.open) return;
  updateScanCount();
  // ZXing döngüsü kendi devam eder; native tick durduğu için yeniden başlat.
  if (!scanReader) startNativeScan();
  else scanStatus.textContent = "Sonrakini tut, bitince Kapat'a bas…";
}

async function handleBatchBarcode(digits) {
  // Aynı kare üst üste ateşlenir; 4 sn içinde aynı kodu yoksay.
  const now = Date.now();
  if (scanBusy || (scanLast.code === digits && now - scanLast.at < 4000)) return;
  scanBusy = true;
  scanLast = { code: digits, at: now };
  const dup = scanSeen.has(digits)
    || !!findDuplicateBook(digits.length === 13 ? digits : "", digits.length === 10 ? digits : "");
  if (dup) {
    scanSkipped++;
    addScanRow(`${digits} — zaten var, atlandı`);
    resumeBatchScan();
    return;
  }
  scanStatus.textContent = `${digits} bulunuyor…`;
  let info = null;
  try { info = await lookupIsbn(digits); } catch { info = null; }
  try {
    await saveNew({
      title: info?.title || "",
      creators: info?.creators || "",
      publisher: info?.publisher || "",
      publish_date: info?.publish_date || "",
      isbn13: digits.length === 13 ? digits : "",
      isbn10: digits.length === 10 ? digits : "",
      description: "",
      pages: info?.pages ?? null,
    });
    scanSeen.add(digits);
    scanAdded++;
    addScanRow(info?.title ? `“${info.title}” eklendi` : `${digits} eklendi (bilgi bulunamadı)`);
    renderShelf();
  } catch {
    scanSkipped++;
    addScanRow(`${digits} — kaydedilemedi`);
  }
  resumeBatchScan();
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
  // ile 404 alınır. Amazon vb. bulunamayan görseller için 1x1 GIF döner;
  // naturalWidth > 1 ile 1x1 boş görseller elenir.
  const probe = url + (url.includes("?") ? "&" : "?") + "default=false";
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth > 1 && im.naturalHeight > 1);
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
  return String(b.creators || "").split(",")[0].trim().replace(/\bGreda\b/gi, "Gerda");
}

// Aşama günlüğü: toplu diyaloglardaki yan liste + tekil durum satırı birlikte beslenir.
function stageLog(listEl, msg, keep = 40) {
  if (!listEl) return;
  const li = document.createElement("li");
  li.textContent = msg;
  listEl.prepend(li);
  while (listEl.children.length > keep) listEl.lastChild.remove();
}
const shortTitle = (b) => String(b?.title || "(başlıksız)").slice(0, 40);

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
  // ponytail: çeviri başlık EN kayda denk gelmez; yazar-son-çare (adaylar onaylı seçilir)
  if (author) {
    queries.push(new URLSearchParams({ author,
      limit: "6", fields: "key,title,author_name,cover_i" }));
  }
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(`https://openlibrary.org/search.json?${q}`);
    for (const d of (data?.docs || [])) {
      if (d.cover_i && !seen.has(d.cover_i)) {
        seen.add(d.cover_i);
        urls.push(`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`);
        if (urls.length >= n) return urls;
      }
    }
    if (urls.length) return urls.slice(0, n);
  }
  return urls.slice(0, n);
}

// Google Books (anahtarsız; proje anahtarının Books kotası 0, keyless IP kotası işler).
async function gbSearchCovers(b, n) {
  const queries = [];
  const author = firstAuthorOf(b);
  if (b.title && author) {
    queries.push(`intitle:${encodeURIComponent(b.title)}+inauthor:${encodeURIComponent(author)}`);
  }
  if (b.title) {
    queries.push(`intitle:${encodeURIComponent(b.title)}`);
  }
  // ponytail: çeviri başlıklar EN kayda denk gelmez; yazar-son-çare (adaylar onaylı seçilir)
  if (author) queries.push(`inauthor:${encodeURIComponent(author)}`);
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=10` +
      `&fields=items(volumeInfo/imageLinks)`);
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
  if (author) queries.push(`creator:(${author}) AND mediatype:texts`); // ponytail: çeviri başlık denk gelmez
  const seen = new Set();
  const urls = [];
  for (const q of queries) {
    const data = await fetchJson(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
      `&fl[]=identifier&rows=10&output=json`, 6000);
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
  if (author) queries.push(author); // ponytail: çeviri başlık EN kayda denk gelmez
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

function fixTurkishMojibake(s) {
  if (!s) return "";
  const map = {
    'Ý': 'İ', 'ý': 'ı',
    'Þ': 'Ş', 'þ': 'ş',
    'Ð': 'Ğ', 'ð': 'ğ'
  };
  return String(s).replace(/[ÝýÞþÐð]/g, (c) => map[c] || c);
}

function stripHtml(s) {
  return fixTurkishMojibake(String(s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;|&#xa0;/g, " ").trim());
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

async function olSearchSummaries(b, n = 2) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) {
    queries.push(new URLSearchParams({ title: b.title, author, limit: "5", fields: "key" }));
  }
  if (b.title) {
    queries.push(new URLSearchParams({ title: b.title, limit: "5", fields: "key" }));
  }
  // ponytail: çeviri başlık EN kayda denk gelmez; yazar-son-çare (adaylar onaylı seçilir)
  if (author) {
    queries.push(new URLSearchParams({ author, limit: "5", fields: "key" }));
  }
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const data = await fetchJson(`https://openlibrary.org/search.json?${q}`);
    for (const d of (data?.docs || [])) {
      const text = await olDescriptionForKey(d.key);
      const key = normSummary(text);
      if (text && text.length > 40 && !seen.has(key)) {
        seen.add(key);
        out.push({ text: text.trim(), source: "Open Library" });
        if (out.length >= n) return out;
      }
    }
    if (out.length) return out;
  }
  return out;
}

// Google Books: volumeInfo.description (servis cevap vermezse boş).
// Önce Türkçe sonuçlar (langRestrict=tr), sonra genel arama.
async function gbSearchSummaries(b, n = 2) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) {
    queries.push(`intitle:${encodeURIComponent(b.title)}+inauthor:${encodeURIComponent(author)}`);
  }
  if (b.title) {
    queries.push(`intitle:${encodeURIComponent(b.title)}`);
  }
  // ponytail: çeviri başlık EN kayda denk gelmez; yazar-son-çare (adaylar onaylı seçilir)
  if (author) queries.push(`inauthor:${encodeURIComponent(author)}`);
  const out = [];
  const seen = new Set();
  const run = async (lang) => {
    for (const q of queries) {
      const data = await fetchJson(
        `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=10` +
        `&fields=items(volumeInfo/description)` +
        (lang ? `&langRestrict=${lang}` : ""));
      for (const item of (data?.items || [])) {
        const text = stripHtml(item.volumeInfo?.description);
        const key = normSummary(text);
        if (text && text.length > 40 && !seen.has(key)) {
          seen.add(key);
          out.push({ text, source: lang === "tr" ? "Google Books (TR)" : "Google Books" });
          if (out.length >= n) return true;
        }
      }
      if (out.length) return true;
    }
    return false;
  };
  if (await run("tr")) return out;
  await run("");
  return out;
}

// Gutendex: summaries alanı doğrudan aramada gelir.
async function gutendexSearchSummaries(b, n = 2) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) queries.push(`${b.title} ${author}`);
  if (b.title) queries.push(b.title);
  if (author) queries.push(author); // ponytail: çeviri başlık EN kayda denk gelmez
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const data = await fetchJson(`https://gutendex.com/books?search=${encodeURIComponent(q)}`);
    for (const item of (data?.results || [])) {
      for (const raw of (item.summaries || [])) {
        const text = String(raw || "").trim();
        const key = normSummary(text);
        if (text && text.length > 40 && !seen.has(key)) {
          seen.add(key);
          out.push({ text, source: "Gutendex" });
          if (out.length >= n) return out;
        }
      }
    }
    if (out.length) return out;
  }
  return out;
}

// Apple Books: ham kayıtlar üzerinden (kapak aramasıyla aynı JSONP çağrısı).
async function appleSearchSummaries(b, n = 2) {
  const out = [];
  const seen = new Set();
  for (const item of await appleSearchItems(b)) {
    const text = stripHtml(item.description);
    const key = normSummary(text);
    if (text && text.length > 40 && !seen.has(key)) {
      seen.add(key);
      out.push({ text, source: "Apple Books" });
      if (out.length >= n) break;
    }
  }
  return out;
}

// Archive.org: tarama kaydının açıklaması.
async function archiveSearchSummaries(b, n = 2) {
  const author = firstAuthorOf(b);
  const queries = [];
  if (b.title && author) queries.push(`title:(${b.title}) AND creator:(${author}) AND mediatype:texts`);
  if (b.title) queries.push(`${b.title}${author ? " " + author : ""} AND mediatype:texts`);
  if (author) queries.push(`creator:(${author}) AND mediatype:texts`); // ponytail: çeviri başlık denk gelmez
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const data = await fetchJson(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
      `&fl[]=identifier&rows=10&output=json`, 6000);
    for (const d of (data?.response?.docs || [])) {
      if (!d.identifier) continue;
      const meta = await fetchJson(`https://archive.org/metadata/${d.identifier}`, 6000);
      const raw = meta?.metadata?.description;
      const text = stripHtml(Array.isArray(raw) ? raw[0] : raw);
      const key = normSummary(text);
      if (text && text.length > 40 && !seen.has(key)) {
        seen.add(key);
        out.push({ text, source: "Archive.org" });
        if (out.length >= n) return out;
      }
    }
    if (out.length) return out;
  }
  return out;
}

function normSummary(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 120).toLocaleLowerCase("tr");
}

// Özet adayları: 5 kaynak paralel, kaynak başına 2, toplam en çok 8.
// İlk 5'i boşsa son çare: Kitapyurdu + D&R (CORS proxy üzerinden, sessizce boş dönebilir).
async function searchSummaries(b, n = 8, onStage = null) {
  const say = (msg) => { try { onStage?.(msg); } catch { /* yoksay */ } };
  say("5 kaynakta paralel aranıyor: Google, Open Library, Apple, Gutendex, Archive…");
  const wrap = (label, p) => p.then((r) => {
    say(`${label}: ${r.length ? `${r.length} aday` : "yok"}`);
    return r;
  });
  const [gb, ol, ap, gx, ar] = await Promise.all([
    wrap("Google Books", gbSearchSummaries(b, 2)), wrap("Open Library", olSearchSummaries(b, 2)),
    wrap("Apple Books", appleSearchSummaries(b, 2)),
    wrap("Gutendex", gutendexSearchSummaries(b, 2)), wrap("Archive.org", archiveSearchSummaries(b, 2)),
  ]);
  const out = [];
  const seen = new Set();
  // ponytail: sabit öncelik (GB-TR → OL → GB → Apple → Gutendex → Archive → KY/DR), puana gerek yok
  for (const s of [...gb, ...ol, ...ap, ...gx, ...ar]) {
    const key = normSummary(s.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= n) return out;
  }
  if (out.length) return out;
  // ponytail: KY/D&R kırılgan (proxy + HTML parse); sadece ilk 5 boşsa, hata = boş liste
  say("Son çare: Kitapyurdu + D&R deneniyor…");
  for (const s of await trScrapeSummaries(b, 2)) {
    const key = normSummary(s.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

// Son çare özetler: Kitapyurdu + D&R ürün sayfasındaki JSON-LD Book.description,
// CORS proxy üzerinden çekilir (proxysiz tarayıcıdan erişilemez). Başarısızlık = [].
async function trScrapeSummaries(b, n = 2) {
  const out = [];
  const seen = new Set();
  for (const s of [...await kySearchSummaries(b), ...await drSearchSummaries(b)]) {
    const key = normSummary(s.text);
    if (s.text && s.text.length > 40 && !seen.has(key)) {
      seen.add(key);
      out.push(s);
      if (out.length >= n) break;
    }
  }
  return out;
}

async function fetchTextViaProxy(pageUrl, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`,
      { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// Ürün HTML'inden özet: önce JSON-LD Book.description, yoksa og:description.
function parseProductDescription(html) {
  for (const m of String(html || "").matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const blocks = JSON.parse(m[1]);
      for (const blk of (Array.isArray(blocks) ? blocks : [blocks])) {
        const graphs = Array.isArray(blk["@graph"]) ? blk["@graph"] : [blk];
        for (const node of graphs) {
          if (String(node?.["@type"] || "").toLocaleLowerCase("tr").includes("book")
            && node.description) {
            const text = stripHtml(node.description);
            if (text && text.length > 40) return text.trim();
          }
        }
      }
    } catch { /* bozuk JSON-LD'yi atla */ }
  }
  const og = String(html || "").match(
    /<meta property="og:description" content="([^"]{40,}?)"/);
  return og ? stripHtml(og[1]).trim() : null;
}

// Kitapyurdu: arama sayfasından ilk ürün linki → ürün sayfasından özet.
async function kySearchSummaries(b) {
  if (!b.title) return [];
  const q = `${b.title}${firstAuthorOf(b) ? " " + firstAuthorOf(b) : ""}`;
  const searchHtml = await fetchTextViaProxy(
    `https://www.kitapyurdu.com/index.php?route=product/list&filter_name=${encodeURIComponent(q)}`);
  const link = searchHtml?.match(/\/kitap\/[a-z0-9-]+\/\d+\.html/);
  if (!link) return [];
  const text = parseProductDescription(
    await fetchTextViaProxy(`https://www.kitapyurdu.com${link[0]}`));
  return text ? [{ text, source: "Kitapyurdu" }] : [];
}

// D&R: arama sayfasından ilk ürün linki → ürün sayfasından özet.
async function drSearchSummaries(b) {
  if (!b.title) return [];
  const q = `${b.title}${firstAuthorOf(b) ? " " + firstAuthorOf(b) : ""}`;
  const searchHtml = await fetchTextViaProxy(
    `https://www.dr.com.tr/search?q=${encodeURIComponent(q)}`);
  const link = searchHtml?.match(/\/[^"\s]*?urunno=\d+/);
  if (!link) return [];
  const url = link[0].startsWith("http") ? link[0] : `https://www.dr.com.tr${link[0]}`;
  const text = parseProductDescription(await fetchTextViaProxy(url));
  return text ? [{ text, source: "D&R" }] : [];
}

// Apple Books: anahtarsız ama CORS yok → JSONP (script etiketi).
// Ham kayıtları döner; kapak ve özet aramaları buradan beslenir.
function appleSearchItems(b) {
  const author = firstAuthorOf(b);
  // ponytail: çeviri başlık EN kayda denk gelmez; boşsa yazarla tekrar dene
  const terms = [];
  if (b.title) terms.push(`${b.title}${author ? " " + author : ""}`);
  if (author) terms.push(author);
  if (!terms.length) return Promise.resolve([]);
  const once = (term) => new Promise((res) => {
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
  return (async () => {
    for (const t of terms) {
      const items = await once(t);
      if (items.length) return items;
    }
    return [];
  })();
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

// Amazon: ISBN-10 (ASIN) üzerinden doğrudan CDN görseli (anahtarsız, CORS serbest).
// 1x1 GIF durumları imageLoads ile filtrelenir.
async function amazonSearchCovers(b, n) {
  const urls = [];
  const seen = new Set();
  const tryIsbn = (raw) => {
    const c10 = isbn13to10(raw);
    if (c10 && !seen.has(c10)) {
      seen.add(c10);
      urls.push(`https://images-na.ssl-images-amazon.com/images/P/${c10}.01._SCLZZZZZZZ_.jpg`);
    }
  };
  if (b.isbn10) tryIsbn(b.isbn10);
  if (b.isbn13) tryIsbn(b.isbn13);
  if (urls.length < n && b.title) {
    const author = firstAuthorOf(b);
    const q = new URLSearchParams({
      title: b.title,
      ...(author ? { author } : {}),
      limit: "5",
      fields: "isbn",
    });
    const data = await fetchJson(`https://openlibrary.org/search.json?${q}`);
    for (const doc of (data?.docs || [])) {
      for (const raw of (doc.isbn || [])) {
        tryIsbn(raw);
        if (urls.length >= n) break;
      }
      if (urls.length >= n) break;
    }
  }
  return urls.slice(0, n);
}

// Başlık+yazara göre kapak adayları: 6 kaynak paralel,
// yüklenebilenler, Open Library öncelikli, en çok n tane.
async function searchCovers(b, n = 6, onStage = null) {
  const say = (msg) => { try { onStage?.(msg); } catch { /* yoksay */ } };
  say("6 kaynakta paralel aranıyor: Open Library, Google, Archive, Gutendex, Apple, Amazon…");
  const wrap = (label, p) => p.then((r) => {
    say(`${label}: ${r.length ? `${r.length} aday` : "yok"}`);
    return r;
  });
  const [ol, gb, ar, gx, ap, am] = await Promise.all([
    wrap("Open Library", olSearchCovers(b, n)), wrap("Google Books", gbSearchCovers(b, n)),
    wrap("Archive.org", archiveSearchCovers(b, n)), wrap("Gutendex", gutendexSearchCovers(b, n)),
    wrap("Apple Books", appleSearchCovers(b, n)), wrap("Amazon", amazonSearchCovers(b, n)),
  ]);
  const merged = [];
  for (const u of [...ol, ...gb, ...ar, ...gx, ...ap, ...am]) {
    if (!merged.includes(u)) merged.push(u);
    if (merged.length >= 12) break;
  }
  if (!merged.length) { say("Hiç aday bulunamadı."); return []; }
  say(`${merged.length} aday yüklenebilir mi diye denetleniyor…`);
  const good = new Set();
  await Promise.all(merged.map(async (u) => { if (await imageLoads(u)) good.add(u); }));
  say(`${good.size} kapak yüklenebilir.`);
  return merged.filter((u) => good.has(u)).slice(0, n);
}

// Toplu tarama için kademeli (waterfall) kapak arama:
// 1. Kotasız doğrudan ISBN CDN'leri (Open Library + Amazon CDN)
// 2. Open Library arama (başlık+yazar)
// 3. Google Books (yalnızca öncekiler bulamazsa)
// 4. Apple Books
// 5. Archive.org
// 6. Gutendex
// İlk çalışan kapak bulunduğu an sonraki kaynaklara sorgu atılmaz.
async function findFirstCover(b, onStage = null) {
  const say = (msg) => { try { onStage?.(msg); } catch { /* yoksay */ } };
  if (b.isbn13) {
    say("ISBN kapağı deneniyor (Open Library)…");
    const olUrl = `https://covers.openlibrary.org/b/isbn/${b.isbn13}-L.jpg`;
    if (await imageLoads(olUrl)) { say("ISBN kapağı bulundu."); return olUrl; }
  }
  const isbn10 = isbn13to10(b.isbn10 || b.isbn13);
  if (isbn10) {
    say("ISBN kapağı deneniyor (Amazon)…");
    const amzUrl = `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01._SCLZZZZZZZ_.jpg`;
    if (await imageLoads(amzUrl)) { say("ISBN kapağı bulundu."); return amzUrl; }
  }
  say("Open Library aranıyor…");
  const ol = await olSearchCover(b);
  if (ol) { say("Open Library'de bulundu."); return ol; }

  say("Google Books aranıyor…");
  const gb = (await gbSearchCovers(b, 1))[0];
  if (gb && await imageLoads(gb)) { say("Google Books'ta bulundu."); return gb; }

  say("Apple Books aranıyor…");
  const ap = (await appleSearchCovers(b, 1))[0];
  if (ap && await imageLoads(ap)) { say("Apple Books'ta bulundu."); return ap; }

  say("Archive.org aranıyor…");
  const ar = (await archiveSearchCovers(b, 1))[0];
  if (ar && await imageLoads(ar)) { say("Archive.org'da bulundu."); return ar; }

  say("Gutendex aranıyor…");
  const gx = (await gutendexSearchCovers(b, 1))[0];
  if (gx && await imageLoads(gx)) { say("Gutendex'te bulundu."); return gx; }

  say("Hiçbir kaynakta bulunamadı.");
  return null;
}

// Kapaklı kitap atlanır (ISBN kapağı canonical sayılır); kapaklı ama özel
// cover_url'lu kitapta farklı kapak bulunursa değişiklik önerilir.
async function proposeCover(b, onStage = null) {
  const current = b.cover_url || null;
  const isbnUrl = b.isbn13 ? `https://covers.openlibrary.org/b/isbn/${b.isbn13}-L.jpg` : null;
  const isbnWorks = isbnUrl ? await imageLoads(isbnUrl) : false;
  if (isbnWorks && (!current || current === isbnUrl)) return null;
  const alt = await findFirstCover(b, onStage);
  if (!alt || alt === current) return null;
  return { id: b.id, title: b.title, creators: b.creators, url: alt, isNew: !current };
}

async function openCovers() {
  coverOffers = [];
  coversBody.innerHTML = "";
  const coversLog = $("covers-log");
  if (coversLog) coversLog.innerHTML = "";
  coversApply.disabled = true;
  coversSelectAll.disabled = true;
  coversStatus.textContent = "Hazırlanıyor…";
  coversDialog.showModal();
  const cands = state.books;
  if (!cands.length) { coversStatus.textContent = "Kütüphane boş."; return; }
  let done = 0, found = 0;
  const queue = [...cands];
  const paint = (current) => {
    coversStatus.textContent = `Taranıyor… ${done}/${cands.length} · ${found} öneri` +
      (current ? ` · şu an: “${shortTitle(current)}”` : "");
  };
  const worker = async () => {
    while (queue.length) {
      const book = queue.pop();
      paint(book);
      stageLog(coversLog, `“${shortTitle(book)}” → ISBN denetleniyor…`);
      const p = await proposeCover(book, (m) => {
        coversStatus.textContent = `Taranıyor… ${done}/${cands.length} · ${found} öneri · “${shortTitle(book)}”: ${m}`;
      });
      if (p) {
        coverOffers.push(p); found++;
        stageLog(coversLog, `“${shortTitle(book)}” → öneri bulundu (${p.isNew ? "yeni" : "değişiklik"})`);
      } else {
        stageLog(coversLog, `“${shortTitle(book)}” → atlandı (kapaklı ya da bulunamadı)`);
      }
      done++;
      paint(null);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
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
    const img = el("img", { src: o.url, alt: "", loading: "lazy",
                                class: "cover-offer-img" });
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
      const finalUrl = await mirrorCoverToStorage(o.id, o.url);
      await updateDoc(doc(db, "books", o.id), { cover_url: finalUrl });
      const b = getBook(o.id);
      if (b) b.cover_url = finalUrl;
      o._done = true;
      n++;
    } catch { /* tekil hata diğerlerini durdurmasın */ }
  }
  coverOffers = coverOffers.filter((o) => !o._done);
  renderOffers();
  coversStatus.textContent = `${n} kapak güncellendi.`;
  renderShelf();
});

// Cihazdan kapak yükleme: dosya seç veya kamerayla çek → küçült → Storage → cover_url.
// ponytail: eski Storage dosyası silinmez; applyCover'daki Geri al eski URL'ye döner.
function downscaleCover(file, maxDim = 1200) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85);
      } catch (e) { URL.revokeObjectURL(url); rej(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
    img.src = url;
  });
}

function storageErrorMessage(err) {
  const c = err?.code || "";
  if (c.includes("unauthorized") || c.includes("permission")) return "Yetkin yok. Bu işlemi yalnızca düzenleyiciler yapabilir.";
  if (c.includes("canceled") || c.includes("retry-limit") || c.includes("unavailable"))
    return "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.";
  return "Kapak yüklenemedi. Tekrar dene.";
}

async function handleCoverFile(bookId, file, statusEl, btns = []) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    statusEl.textContent = "Bir resim dosyası seç.";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    statusEl.textContent = "Dosya çok büyük (en çok 15 MB).";
    return;
  }
  const key = `cover-upload:${bookId}`;
  if (writeBusy.has(key)) return;
  writeBusy.add(key);
  btns.forEach((b) => { b.disabled = true; });
  statusEl.textContent = "Hazırlanıyor…";
  try {
    const blob = await downscaleCover(file);
    statusEl.textContent = "Yükleniyor…";
    const r = ref(storage, `covers/${bookId}/${Date.now()}.jpg`);
    await uploadBytes(r, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(r);
    statusEl.textContent = "Kaydediliyor…";
    await applyCover(bookId, url);
  } catch (err) {
    const msg = err?.message === "decode"
      ? "Bu fotoğraf biçimi okunamadı. JPG/PNG olarak kaydetmeyi dene."
      : storageErrorMessage(err);
    statusEl.textContent = msg;
    showDetailError(msg, null);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    writeBusy.delete(key);
  }
}

// Onaylanan dış kapağı Storage'a kopyala; olmazsa orijinal URL (sessiz geri dönüş).
// ponytail: Amazon CORS vermez → o kapaklar dış URL kalır, akış bozulmaz.
async function mirrorCoverToStorage(bookId, url) {
  if (!url || String(url).includes("firebasestorage")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    if (!blob.size || blob.size > 5 * 1024 * 1024) return url;
    const file = blob.type.startsWith("image/")
      ? blob : blob.slice(0, blob.size, "image/jpeg");
    const r = ref(storage, `covers/${bookId}/${Date.now()}.jpg`);
    await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
    return await getDownloadURL(r);
  } catch { return url; }
}

async function applyCover(bookId, url) {
  const key = `cover:${bookId}`;
  if (writeBusy.has(key)) return;
  const b = getBook(bookId);
  if (!b) return;
  const prev = b.cover_url || null;
  if (prev && prev !== url && confirmPending.get(key) !== url) {
    confirmPending.set(key, url);
    showConfirmRow(`“${b.title || "Kitap"}” için mevcut kapağın yerine geçer.`, "Üzerine yaz",
      () => applyCover(bookId, url), () => confirmPending.delete(key));
    setTimeout(() => confirmPending.delete(key), UNDO_MS);
    return;
  }
  confirmPending.delete(key);
  url = await mirrorCoverToStorage(bookId, url);
  writeBusy.add(key);
  b.cover_url = url;
  rerenderDetailPreserving(bookId);
  try {
    await updateDoc(doc(db, "books", bookId), { cover_url: url });
  } catch (err) {
    if (prev) b.cover_url = prev; else delete b.cover_url;
    confirmPending.set(key, url);
    rerenderDetailPreserving(bookId);
    showDetailError(writeErrorMessage(err), () => applyCover(bookId, url));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
  showUndo("Kapak değişti.", async () => {
    try {
      if (prev) { await updateDoc(doc(db, "books", bookId), { cover_url: prev }); getBook(bookId).cover_url = prev; }
      else { await updateDoc(doc(db, "books", bookId), { cover_url: deleteField() }); delete getBook(bookId).cover_url; }
    } catch (err) { showDetailError(writeErrorMessage(err), null); return; }
    rerenderDetailPreserving(bookId);
  });
}

// ── Toplu özet bulma (açıklamasız kitaplar taranır) ───────
// Kapak taramasının özet karşılığı: adayı olmayan kitap atlanır,
// ilk aday önerilir, tam metin kutuda onaylanır.
const findSummariesBtn = $("find-summaries");
const summariesDialog = $("summaries-dialog");
const summariesBody = $("summaries-body");
const summariesStatus = $("summaries-status");
const summariesApply = $("summaries-apply");
const summariesSelectAll = $("summaries-select-all");
let summaryOffers = []; // [{ id, title, creators, text, source, _check }]

findSummariesBtn.addEventListener("click", openSummaries);
document.querySelectorAll("[data-close-summaries]").forEach((b) =>
  b.addEventListener("click", () => summariesDialog.close()));
summariesDialog.addEventListener("click", (e) => { if (e.target === summariesDialog) summariesDialog.close(); });

async function proposeSummary(b, onStage = null) {
  if (String(b.description || "").trim()) return null;
  const found = await searchSummaries(b, 3, onStage);
  const first = found[0];
  if (!first) return null;
  return { id: b.id, title: b.title, creators: b.creators, text: first.text, source: first.source };
}

async function openSummaries() {
  summaryOffers = [];
  summariesBody.innerHTML = "";
  const summariesLog = $("summaries-log");
  if (summariesLog) summariesLog.innerHTML = "";
  summariesApply.disabled = true;
  summariesSelectAll.disabled = true;
  summariesStatus.textContent = "Hazırlanıyor…";
  summariesDialog.showModal();
  const cands = state.books.filter((b) => !String(b.description || "").trim());
  if (!cands.length) { summariesStatus.textContent = "Özeti eksik kitap yok."; return; }
  if (!state.books.length) { summariesStatus.textContent = "Kütüphane boş."; return; }
  let done = 0, found = 0;
  const queue = [...cands];
  const worker = async () => {
    while (queue.length) {
      const b = queue.pop();
      summariesStatus.textContent = `Taranıyor… ${done}/${cands.length} · ${found} öneri · şu an: “${shortTitle(b)}”`;
      stageLog(summariesLog, `“${shortTitle(b)}” → kaynaklar taranıyor…`);
      let p = null;
      try {
        p = await proposeSummary(b, (m) => {
          summariesStatus.textContent = `Taranıyor… ${done}/${cands.length} · ${found} öneri · “${shortTitle(b)}”: ${m}`;
        });
      } catch { p = null; }
      if (p) {
        summaryOffers.push(p); found++;
        stageLog(summariesLog, `“${shortTitle(b)}” → bulundu (${p.source}, ${p.text.length} karakter)`);
      } else {
        stageLog(summariesLog, `“${shortTitle(b)}” → bulunamadı`);
      }
      done++;
      summariesStatus.textContent = `Taranıyor… ${done}/${cands.length} · ${found} öneri`;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  summaryOffers.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "tr"));
  renderSummaryOffers();
  summariesStatus.textContent = summaryOffers.length
    ? `${cands.length} eksik tarandı · ${summaryOffers.length} öneri. Tam metni okuyup seçtiklerini uygula.`
    : `${cands.length} eksik tarandı · onay bekleyen öneri yok.`;
}

function renderSummaryOffers() {
  summariesBody.innerHTML = "";
  const on = summaryOffers.length > 0;
  summariesApply.disabled = !on;
  summariesSelectAll.disabled = !on;
  summariesSelectAll.checked = true;
  for (const o of summaryOffers) {
    const check = el("input", { type: "checkbox", checked: true,
                                "aria-label": `${o.title || "kitap"} özetini onayla` });
    o._check = check;
    summariesBody.append(el("div", { class: "sum-row is-bulk" },
      el("div", {},
        el("p", { class: "cover-title", text: o.title || "(başlıksız)" }),
        o.creators ? el("p", { class: "cover-creators", text: o.creators }) : null,
        el("span", { class: "sum-src", text: `${o.source} · ${o.text.length} karakter` }),
        el("p", { class: "sum-text is-full", text: o.text })),
      el("label", { class: "cover-check" }, check)));
  }
  updateSummariesApplyLabel();
}

function updateSummariesApplyLabel() {
  const n = summaryOffers.filter((o) => o._check?.checked).length;
  summariesApply.textContent = `Seçilenleri uygula (${n})`;
}

summariesSelectAll.addEventListener("change", () => {
  for (const o of summaryOffers) if (!o._check.disabled) o._check.checked = summariesSelectAll.checked;
  updateSummariesApplyLabel();
});
summariesBody.addEventListener("change", updateSummariesApplyLabel);

summariesApply.addEventListener("click", async () => {
  const sel = summaryOffers.filter((o) => o._check?.checked);
  if (!sel.length) return;
  summariesApply.disabled = true;
  summariesApply.textContent = "Uygulanıyor…";
  let n = 0;
  for (const o of sel) {
    try {
      await updateDoc(doc(db, "books", o.id), { description: o.text });
      const b = getBook(o.id);
      if (b) b.description = o.text;
      o._done = true;
      n++;
    } catch { /* tekil hata diğerlerini durdurmasın */ }
  }
  summaryOffers = summaryOffers.filter((o) => !o._done);
  renderSummaryOffers();
  summariesStatus.textContent = `${n} özet güncellendi.`;
});

async function applySummary(bookId, text) {
  text = fixTurkishMojibake(text);
  const key = `sum:${bookId}`;
  if (writeBusy.has(key)) return;
  const b = getBook(bookId);
  if (!b) return;
  const prev = b.description || "";
  if (prev.trim() && prev !== text && confirmPending.get(key) !== text) {
    confirmPending.set(key, text);
    showConfirmRow(`Mevcut açıklamanın yerine geçer (${prev.length} → ${text.length} karakter).`, "Üzerine yaz",
      () => applySummary(bookId, text), () => confirmPending.delete(key));
    setTimeout(() => confirmPending.delete(key), UNDO_MS);
    return;
  }
  confirmPending.delete(key);
  writeBusy.add(key);
  b.description = text;
  renderDetail(bookId);
  try {
    await updateDoc(doc(db, "books", bookId), { description: text });
  } catch (err) {
    b.description = prev;
    confirmPending.set(key, text);
    renderDetail(bookId);
    showDetailError(writeErrorMessage(err), () => applySummary(bookId, text));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
  showUndo("Açıklama değişti.", async () => {
    try { await updateDoc(doc(db, "books", bookId), { description: prev }); getBook(bookId).description = prev; }
    catch (err) { showDetailError(writeErrorMessage(err), null); return; }
    renderDetail(bookId);
  });
}

async function clearCover(bookId) {
  const key = `cover:${bookId}`;
  if (writeBusy.has(key)) return;
  const b = getBook(bookId);
  if (!b?.cover_url) return;
  const prev = b.cover_url;
  writeBusy.add(key);
  delete b.cover_url;
  rerenderDetailPreserving(bookId);
  try {
    await updateDoc(doc(db, "books", bookId), { cover_url: deleteField() });
  } catch (err) {
    b.cover_url = prev;
    rerenderDetailPreserving(bookId);
    showDetailError(writeErrorMessage(err), () => clearCover(bookId));
    writeBusy.delete(key); return;
  }
  writeBusy.delete(key);
  showUndo("Kapak kaldırıldı.", async () => {
    try { await updateDoc(doc(db, "books", bookId), { cover_url: prev }); getBook(bookId).cover_url = prev; }
    catch (err) { showDetailError(writeErrorMessage(err), null); return; }
    rerenderDetailPreserving(bookId);
  });
}

// ── Arama & filtre ─────────────────────────────────────────────
searchInput.addEventListener("input", () => {
  clearTimeout(searchInput._t);
  searchInput._t = setTimeout(() => {
    if (!state.user || state.query === searchInput.value) return;
    state.query = searchInput.value;
    renderShelf();
  }, 150);
});
// Tek dinleyici: her kart için ayrı click/keydown eklemek yerine (429+ dinleyici)
// event delegation — liste yeniden çizildiğinde listener yeniden bağlanmaz.
shelf.addEventListener("click", (e) => {
  const card = e.target.closest(".book-entry");
  if (!card || !shelf.contains(card)) return;
  const id = card.getAttribute("data-book-id");
  if (id) openDetail(id);
});
shelf.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".book-entry");
  if (!card || !shelf.contains(card)) return;
  e.preventDefault();
  const id = card.getAttribute("data-book-id");
  if (id) openDetail(id);
});

filterButtons.forEach((btn) => btn.addEventListener("click", () => {
  state.filter = btn.dataset.filter;
  filterButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
  renderShelf();
}));
document.querySelectorAll(".addedby-select").forEach((sel) => sel.addEventListener("change", () => {
  state.addedBy = sel.value;
  document.querySelectorAll(".addedby-select").forEach((s) => { if (s !== sel) s.value = sel.value; });
  renderShelf();
}));

// ── Tema (açık/koyu) ───────────────────────────────────────────
const themeButtons = [...document.querySelectorAll(".theme-toggle")];
function paintThemeBtn() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeButtons.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(dark));
    btn.setAttribute("aria-label", dark ? "Açık temaya geç" : "Koyu temaya geç");
  });
}
themeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ck-theme", next); } catch { /* yoksay */ }
    paintThemeBtn();
  });
});
paintThemeBtn();

// Arka plana dokununca kapat
detailDialog.addEventListener("click", (e) => { if (e.target === detailDialog) detailDialog.close(); });
formDialog.addEventListener("click", (e) => { if (e.target === formDialog) formDialog.close(); });
scanDialog.addEventListener("click", (e) => { if (e.target === scanDialog) scanDialog.close(); });
