# CKLibrary — Aile Kütüphanesi Web Uygulaması Planı

Kişisel kütüphaneyi (429 kitap, `library_20261013_163504.csv`) ortak, çok kullanıcılı,
tarayıcıdan çalışan bir kataloğa dönüştürür. GitHub Pages'te yaşar, veri Firebase'de tutulur.

## 1. Özet kararlar

| Konu | Karar |
|---|---|
| Barındırma | GitHub Pages (saf statik, build adımı yok) |
| Veri + kimlik | Firebase (Auth + Firestore), Spark ücretsiz plan |
| Firebase proje | ad: `CKLibrary`, id: `cklibrary-cb9b1` |
| Ortak veri | Evet — 3 cihaz da aynı güncel listeyi görür |
| Puan modeli | **Kişi başına ayrı** (Kaan 8 · Ceyda 7 · Lena –), 1–10 tam sayı + ortalama |
| Not modeli | Yazarlı, sadece eklenir (düzenlenmez); kim yazdı görünür |
| Kapak | ISBN ile otomatik (Open Library), yoksa harf-kapak |
| Ekleyen/silen | Kaan + Ceyda ekler/siler/düzeltir; **Lena sadece ekler** + puan/not verir |

## 2. Kullanıcılar

| Kullanıcı adı | E-posta | Yetki |
|---|---|---|
| kaan | kaanyaren@gmail.com | ekle · sil · düzelt · puan · not |
| ceyda | ceyda.d@gmail.com | ekle · sil · düzelt · puan · not |
| lena | lenayaren@gmail.com | **ekle** · puan · not (sil/düzelt yok) |

- Açık kayıt **kapalı**; sadece bu 3 hesap Firebase Console'da elle yaratılır.
- Şifreler yalnızca Firebase Console'da yaşar; repoya asla yazılmaz — `app.js`'e `git remote` üzerinden değil, sadece Console'dan değer girilir.
- Giriş ekranı: 3 isim butonu (ceyda / kaan / lena) + şifre kutusu. Buton arkada ilgili e-postaya bağlanır. Görünen ad `displayName` (ceyda/kaan/lena).
- Şifre sıfırlama istenirse gerçek Gmail adresleri zaten tanımlı, sorun yok.

## 3. Mimari

```
GitHub Pages (statik)
  index.html · styles.css · app.js · firebase-config.js
        │  Firebase JS SDK (CDN)
        ▼
Firebase
  Auth (e-posta + şifre, 3 kullanıcı)
  Firestore
    books/{bookId}                     ← CSV id'si doküman ID'si
      ratings/{uid}  { value: 1..10, updatedAt }
      notes/{autoId} { text, uid, name, createdAt }
    activity/{autoId} { bookId, uid, name, action, detail, at }
```

- CSV'deki `id` değeri Firestore doküman ID'si olur → yükleme tekrarlansa da çift kayıt çıkmaz.
- Kapak URL'si çalışma anında üretilir (DB'ye yazılmaz): `https://covers.openlibrary.org/b/isbn/{ISBN}-M.jpg`; 404 ise baş harf kutusu.
- `firebase-config.js` içindeki `apiKey` herkese açıktır, bu normaldir; güvenlik **Security Rules**'tadır, anahtarda değil.

## 4. Firestore veri modeli

**`books/{bookId}`**
```
title, creators, publisher, publish_date,
isbn13, isbn10, description, pages,
added_by_uid, added_by_name, created_at,
updated_by_uid, updated_by_name, updated_at
```
(orijinal CSV alanlarından yalnızca işe yarayanlar taşınır.)

**`books/{bookId}/ratings/{uid}`**
```
value: 1..10 (int), updatedAt
```

**`books/{bookId}/notes/{autoId}`**
```
text, uid, name, createdAt
```

**`activity/{autoId}`**
```
bookId, book_title, uid, name,
action: "add" | "delete" | "update" | "rate" | "note",
detail (ör. "puan 7 → 8"), at
```

## 5. Yetki kuralları (Security Rules — sunucuda zorlanır)

Arayüz sadece gizler; asıl kısıt Firestore Rules'ta:

1. **Okuma:** giriş yapmış herkes.
2. **Kitap ekleme:** üçü de.
3. **Kitap düzeltme/silme:** yalnızca kaan + ceyda.
4. **Puan yazma:** herkes yalnızca kendi dokümanını (`ratings/{uid}`, uid eşleşmesi) ve 1–10 aralığında.
5. **Not ekleme:** herkes; not silme yazar + kaan/ceyda.
6. Yorum satırlarını silme kuralı: `activity` yalnızca eklenir, değiştirilemez/silinemez.

Referans Rules taslağı:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function name()     { return request.auth.token.name; } // displayName
    function canEdit()  { return signedIn() && (name() == 'kaan' || name() == 'ceyda'); }

    match /books/{bookId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update, delete: if canEdit();

      match /ratings/{uid} {
        allow read: if signedIn();
        allow write: if signedIn() && request.auth.uid == uid
                     && request.resource.data.value is int
                     && request.resource.data.value >= 1
                     && request.resource.data.value <= 10;
      }

      match /notes/{noteId} {
        allow read: if signedIn();
        allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
        allow delete: if canEdit() || resource.data.uid == request.auth.uid;
        allow update: if false;
      }
    }

    match /activity/{docId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update, delete: if false;
    }
  }
}
```
Not: `name()` displayName'i token'dan okur. Rules yayınlanmadan önce displayName claim'i
için custom claim kurulumu gerekirse Console → Authentication → Users'tan doğrulanır.

## 6. Arayüz yönü (impeccable · mod: **Operate**)

Amaç: günlük kullanılan bir araç. Taranabilirlik ve tutarlılık ifadeden önce gelir;
marka kimliği ince detaylarda yaşar.

1. **Dünya:** "ev kütüphanesi fiş kataloğu" — sıcak kâğıt zemin, mürekkep metin, tek vurgu
   rengi (bordo ya da koyu yeşil). Mor-mavi gradyan, cam efektli kart, emoji-başlık gibi
   AI-slop kalıpları **yasak**.
2. **Tipografi:** Başlıklarda Türkçe karakterli serif (ğ ş ı ç ö ü İ **şart**); arayüz
   etiketlerinde dar grotesk. Puanlar emoji yıldız değil, **büyük rakam** (8/10).
3. **Liste:** kapak + başlık + yazar + ortalama + kişi kırılımı tek satırda taranır.
   Arama Türkçe'ye duyarlı (`toLocaleLowerCase('tr')`).
   Filtreler: puanlayan / puanlanmamış / ekleyen.
4. **Detay:** kişi kırılımı, yazarlı not dizisi, "kim ne yaptı" damga-geçmişi (`activity`).
5. **Mobil öncelikli:** puan/not butonları başparmak mesafesinde; masaüstünde çok kolonlu.
6. **Doğrulama:** build tamamlandıktan sonra tek toplu tur (masaüstü + mobil ekran görüntüsü),
   bulunanlar tek seferde düzeltilir, en fazla bir teyit turu yapılır — açık uçlu cilalama yok.

## 7. Dosyalar (build çıktısı, 5 dosya)

1. `index.html` — giriş ekranı (3 isim butonu) + liste + detay modalı.
2. `styles.css` — mobil öncelikli, sade, kâğıt-fiş-katalog görsel dünyası.
3. `app.js` — tüm mantık: auth, arama/filtre, puan, not, activity log.
4. `firebase-config.js` — Firebase web config (5 alan) — **sen doldurursun**.
5. `books_seed.json` — CSV'den üretilmiş yedek + `import.mjs` (tek seferlik Admin SDK yükleyici).

## 8. Kurulum adımları (~70 dk)

1. **Firebase (~20 dk):** `cklibrary-cb9b1` projesinde Web uygulaması ekle → config'i al.
   Authentication → Email/Password aç. 3 kullanıcıyı yarat, `displayName` ata.
2. **Firestore (~20 dk):** Koleksiyonları oluştur, §5 Rules'u yapıştır.
   Servis hesabı anahtarıyla `node import.mjs` → 429 kitap içe aktarılır.
3. **GitHub (~20 dk):** Repo → GitHub. Pages'i `main` / root olarak aç.
   `firebase-config.js`'e config'i gir, 3 hesapla giriş yapıp test et.
4. **Doğrulama (~10 dk):** kapak çekimi, TR karakter arama, Lena'nın sil butonunun yokluğu
   ve Rules reddi, puan kırılımının 3 cihazda eşitlenmesi.

## 9. Test kontrol listesi

- [ ] 3 hesapla giriş; yanlış şifre reddi
- [ ] Lena'da sil/düzelt butonu yok **ve** Rules elle denemede reddediyor
- [ ] Aynı kitaba Kaan 8, Ceyda 7 → liste `8 · 7 · ort 7.5` gösteriyor
- [ ] Türkçe arama: "şeker" ↔ "seker" eşleşmesi
- [ ] Kapak: ISBN'li kitapta resim, ISBN'siz kitapta harf-kapak
- [ ] Not ekle → yazan adı ve tarih görünür; başka kullanıcı silemez (Kaan/Ceyda hariç)
- [ ] İki cihazda puan değişince diğerinde güncelleniyor

## 10. Kapsam dışı (şimdilik)

- Kitap ödünç verme / kim aldı takibi
- Çoklu dil (arayüz sadece Türkçe)
- Kapak görsellerinin depolanması (sadece dış URL)
- Sesli kitap / DVD (`item_type` şimdilik yalnız `book`)

---
Sonraki adım: Firebase Console'da 3 kullanıcıyı yarat (displayName: ceyda/kaan/lena),
sonra uygulamayı ve Rules'u üret — dosyalar bu plana göre yazılacak.
