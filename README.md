# CKLibrary — Aile Kütüphanesi

Ailenin ortak kitap kataloğu. Evdeki kişisel kütüphane (429 kitap) tek bir yerde
toplanır; üç kişi aynı tarayıcı uygulamasından listeyi görür, kitap ekler, puanlar
ve not düşer. Ortak veri Firebase'de tutulur, uygulama GitHub Pages'te yaşar.

## Teknoloji

- **Firebase Auth** — e-posta + şifre ile giriş (3 hesap, açık kayıt kapalı).
- **Cloud Firestore** — kitaplar, puanlar, notlar ve etkinlik akışı.
- **Vanilla JavaScript** — Firebase modular SDK v11, gstatic CDN üzerinden.
  Build adımı yok, npm bağımlılığı yok.
- **GitHub Pages** — saf statik barındırma (`main` / root).
- **Barkod tarama** — mobil kamerayla ISBN okuma (önce tarayıcının yerleşik
  BarcodeDetector'ı, yoksa ZXing); kitap bilgisi Open Library'den doldurulur.
- **Kapak bulma** — tek tuşla tüm kitaplar taranır; kapaksızlara yeni kapak,
  kapaklılara farklı baskı bulunursa değişiklik önerilir. Eski/yeni yan yana
  gösterilir, onaylananlar kaydedilir (yalnızca düzenleyiciler). Kitap detayından
  da tekil kapak araması yapılır (Open Library + Google Books + Archive.org +
  Gutendex + Apple Books).
- **Okuma durumu** — her kullanıcı kitapları okundu/okunmadı işaretler;
  liste "Okuduklarım / Okumadıklarım" filtreleriyle süzülür.

## Roller

Yetki, giriş yapılan e-postaya göre belirlenir (UID'ye göre değil):

| İsim  | E-posta             | Rol    | Yetkiler |
|-------|---------------------|--------|----------|
| kaan  | kaanyaren@gmail.com | editor | ekle · düzenle · sil · puan · not |
| ceyda | ceyda.d@gmail.com   | editor | ekle · düzenle · sil · puan · not |
| lena  | lenayaren@gmail.com | adder  | ekle · puan · not (düzenle/sil **yok**) |

Giriş ekranında üç isim butonu (ceyda / kaan / lena) ve bir şifre alanı bulunur.
Buton ilgili e-postayı seçer, giriş o e-posta + şifre ile yapılır.

## Yerelde çalıştırma

Statik site olduğu için herhangi bir HTTP sunucusu yeterli. Repo kökünde:

```sh
python3 -m http.server 8000
```

Sonra tarayıcıdan `http://localhost:8000` adresini aç.

> Not: Dosyayı doğrudan `file://` ile açmak yerine HTTP sunucusu kullan; Firebase
> Auth bazı tarayıcılarda `file://` üzerinden çalışmaz.

## Tek seferlik Firebase Console adımı

Proje `cklibrary-cb9b1` Firebase Console'da hazır olmalı. İlk kurulumda:

1. Firebase Console → **Authentication** → **Get started**.
2. **Sign-in method** sekmesinde **Email/Password** sağlayıcısını etkinleştir.
3. **Users** sekmesinden üç hesabı elle oluştur ve her birine `displayName`
   ata (`kaan` / `ceyda` / `lena`). Açık kayıt kapalıdır.
4. Firestore koleksiyonlarını oluşturup Security Rules'u yayınla.

Şifreler yalnızca Firebase Console'da yaşar; repoya **asla** yazılmaz.

`firebase-config.js` içindeki web config (apiKey dahil) herkese açıktır, bu
normaldir — güvenlik Security Rules'ta sağlanır, anahtarda değil.

## Güvenlik

- Servis hesabı anahtarı (`cklibrary-cb9b1-firebase-adminsdk-*.json`) ve
  `scripts/users.json` **commit edilmez** (bkz. `.gitignore`).
- Kitapları toplu içe aktarmak için kullanılan Admin SDK anahtarı yerelde tutulur.
