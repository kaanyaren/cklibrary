# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Aile kitaplığı kataloğunun 3 onaylı kullanıcısı: kaan ve ceyda (editor — ekle/düzenle/sil/puan/not), lena (adder — ekle/puan/not, düzenle/sil yok). Evde ve mobilde, tek elle, başparmak mesafesinde kullanım. Birincil iş: kitap fişini hızla incelemek — kapak, başlık/yazar/yayın, açıklama ve puan durumu 10 sn içinde taranmalı. İkincil işler: puan ver, okundu işaretle, not ekle.

## Product Purpose

429 kitaplık ev koleksiyonunu ortak, güncel, taranabilir bir fiş kataloğunda toplar. Başarı: 3 cihazda aynı listeyi görmek, bir kitaba kimin kaç verdiğini ve notları anında anlamak, yeni kitabı (barkodla dahil) dakikada eklemek.

## Positioning

Aile-içi ortak katalog: kişi başına ayrı 1–10 puan + ortalama, yazarlı not dizisi ve "kim ne yaptı" geçmişi tek fişte. Genel kitap uygulamalarından farkı: Lena dahil 3 kişiye özel roller ve ortalama/kırılımın her yerde büyük rakamla gösterilmesi.

## Operating Context

GitHub Pages'te saf statik site (build yok, npm yok), Firebase Auth + Firestore arka ucu. Giriş: 3 isim butonu + şifre. Liste: arama (Türkçe `toLocaleLowerCase('tr')`), filtreler (puanlı/puanlanmamış/eklediklerim/okuduklarım/okumadıklarım). Detay bugün `dialog#detail-dialog` içinde `renderDetail()` ile üretiliyor; form, barkod tarama ve kapak önerileri ayrı dialoglar. Arayüz dili Türkçe.

## Capabilities and Constraints

Confirmed: vanilla JS + Firebase modular v11 CDN; `dialog` sheet kalabilir ama layout yeniden düşünülebilir; Firebase mantığı, roller, Türkçe UI, mobile-first korunur. Detay içeriği korunur: kapak (onaylı cover_url → ISBN Open Library → harf-kapak), künye, açıklama (+ editor özet bul), kişi puanları (kaan/ceyda/lena + ortalama), puan ver (1–10), okuma durumu, not ekle/listele, hareket geçmişi, editor kapak/düzenle/sil. Dark theme opsiyonu istendi; mevcut açık paper dünyayla birlikte sunulur. Kararsız: dark varsayılanı (sistem tercihi vs. elle seçim) — sistem tercihi + elle override varsayıldı.

## Brand Commitments

Sıcak kâğıt zemin (`--paper #ece3d0`, raise/recess), mürekkep metin, tek vurgu bordo oxblood (`--accent #7c2d2c`), serif başlık Caudex + sans Public Sans, büyük rakam puan (emoji yıldız yok). Mor-mavi gradyan, cam kart, emoji-başlık yasak. Mevcut dünya korunur; dark theme aynı dilin koyu karşılığı olur, yeni kimlik değil.

## Evidence on Hand

- `index.html`: `#detail-dialog > #detail-body`, `.sheet` stilleri
- `app.js`: `renderDetail()` (~384–594), `coverNode()`, `averageOf()`, puan/not/okuma/kapak/özet yazma işlemleri
- `styles.css`: paper/ink/accent token'ları, `.detail-head/.detail-grid/.rate-row/.note-list/.activity-list`
- `PLAN.md` §6 arayüz yönü (Operate), `README.md` roller
- Kullanıcı kararı (2026-10-14): detayda #1 iş = bilgiyi inceleme; dünyayı koru + dark ekle; layout'u yeniden düşünmek serbest

## Product Principles

1. Önce fiş, sonra işlem: bilgi 10 sn'de taranır, puan/not tek dokunuşta erişilir.
2. Taranabilirlik ifadeden önce: tutarlı hiyerarşi, sessiz zemin, tek vurgu.
3. Başparmak öncelikli: birincil eylemler mobilde üstte ve 44px+ hedefte.
4. Doğruluk iddiadan önce: kapak/özet adayları kaynaklı, onaylı kapak rozetli, geçmiş damgalı.
5. Sessiz güç: statik hosting ve mevcut Firebase akışını bozmayan, geriye uyumlu değişim.

## Accessibility & Inclusion

TR karakter desteği (ğ ş ı ç ö ü İ), klavye ile dialog (Enter/Space ile açma, `showModal` odağı), 44px dokunma hedefleri, `aria-live` durum metinleri, `prefers-reduced-motion` indirgemesi korunur. Dark theme WCAG AA kontrastı hedefler.
