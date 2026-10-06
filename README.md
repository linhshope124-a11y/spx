📄 README.md (FULL) — v50.11.7

📋 Copy paste nguyên file, ghi đè README.md:

```markdown
# 🚚 SPX Tracker

> PWA theo dõi sản lượng giao/lấy/hoàn & tính điểm phúc lợi SPX Express

---

## 🌐 Truy cập nhanh

👉 **https://linhshope124-a11y.github.io/spx/**

Cài như app:
- **Android (Chrome):** ⋮ → Thêm vào màn hình chính
- **iPhone (Safari):** Chia sẻ → Thêm vào màn hình chính

---

## ✨ Tính năng

- 📊 **Theo dõi sản lượng** — 8 dải khối lượng Giao / Lấy / Hoàn
- 🎯 **Tính điểm phúc lợi** — theo chính sách SPX Express
- 📷 **Quét ảnh OCR** — tự nhận diện tab (Giao/Lấy/Hoàn) chính xác ~99%
- 📤 **Chia sẻ ảnh** — share từ Gallery → OCR tự chạy (Android Chrome)
- 💰 **Thu nhập theo tháng** — lưu riêng từng tháng
- ⚡ **Rule Tài xế** — chỉ cộng khi đơn Giao ≥ 1.500/tháng
- 🏆 **Hạng thưởng** — Đồng / Bạc / Vàng / B.Kim / K.Cương
- 🎯 **Cơ hội tăng điểm** — sort theo độ gần đạt mốc
- 🔍 **Lọc nâng cao Nhật ký** — ngày / loại / SL đơn / trạng thái điểm
- ☁️ **Backup Cloud** — GitHub Gist
- 📱 **Chạy offline** — sau lần đầu tải
- 🌙 **Dark mode**
- ↩️ **Undo** — hoàn tác 10 bước gần nhất

---

## 🛠️ Tech Stack

- Vanilla JS (ES Modules, không framework)
- CSS thuần với design tokens (light/dark)
- PWA — Service Worker + Manifest + Share Target
- Tesseract.js v5 — OCR tiếng Việt
- GitHub Gist API — Cloud backup
- localStorage — Lưu dữ liệu local (sanitize-safe)

**Không cần build step** — code chạy trực tiếp trên trình duyệt.

---

## 📂 Cấu trúc

```

spx/
├── index.html              # Entry point — main app
├── guide.html              # Trang hướng dẫn sử dụng
├── manifest.json           # PWA manifest + share_target
├── sw.js                   # Service Worker
├── version.json            # Version check (auto-update)
├── README.md
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── css/
│   └── style.css
└── js/
├── main.js
├── config.js
├── state.js
├── utils.js
├── calc.js
├── render.js
├── ui.js
├── entry.js
├── ocr.js              # OCR Engine v2.6
├── backup.js
├── cloud.js
├── theme.js
├── undo.js
└── dialog.js

```

---

## 📐 Công thức nghiệp vụ

### Quy đổi đơn → công
```

Đơn tính công = Giao + (Lấy / 6) + Hoàn

```

### Ngưỡng công

| Khu vực | 1 công | 0.5 công |
|---|---|---|
| Miền Trung | ≥ 60 | ≥ 30 |
| TP.HCM & Hà Nội | ≥ 80 | ≥ 40 |

### Số ngày tối đa
- Tháng 2 → **24**
- Các tháng khác → **26**

### Thu nhập
```

Lương 1 công = (LCB + Bưu cục + Tài xế) / số ngày tối đa
Tích lũy      = Lương 1 công × số công đã làm

⚡ Tài xế chỉ được cộng khi đơn Giao ≥ 1.500/tháng

```

### Tổng điểm
```

Tổng = Gốc + (Gốc × %hạng) + Thu nhập

```

---

## 🚀 Cài đặt cho developer

### Chạy local

```bash
git clone https://github.com/linhshope124-a11y/spx.git
cd spx
python -m http.server 8000
```

Mở http://localhost:8000

Deploy

Repo tự động deploy qua GitHub Pages khi push lên main.

```bash
git add .
git commit -m "v50.11.7: mô tả thay đổi"
git push
```

⚠️ Nhớ bump CACHE trong sw.js mỗi lần deploy (để SW force fetch file mới).

---

🔄 Version History

Version Thay đổi chính
v50.11.7 Bỏ card Phân bổ · Đổi "Miền" → "MIỀN TRUNG"
v50.11.6 Cơ hội tăng điểm — bỏ "Tất cả", sort theo độ gần đạt mốc
v50.11.5 Batch 1 fixes: sanitize weights · dialog block · token warning · SHA-256 · MAX_UNDO 10
v50.11.4 Cập nhật guide.html + version.json
v50.11.2 OCR Engine v2.5 — fix tab detection (zone-fallback + tab-cluster)
v50.11.1 Fix PWA install (icon PNG 192/512)
v50.11.0 Share Target + Lọc nâng cao Nhật ký + Business Rule Tài xế
v50.10.0 OCR Engine v2.0 → v2.4 (12+ bug fixes)
v50.9.0 Reminder banner — nhắc quét ngày thiếu
v50.8.0 Hạng thưởng lưu riêng theo tháng
v50.4 Thu nhập lưu theo từng tháng
v49 Hero + Tiles gộp, clamp font

---

📖 Hướng dẫn sử dụng

Xem tại guide.html hoặc Menu ☰ → Hướng dẫn sử dụng.

---

🤝 Đóng góp

1. Fork repo
2. Tạo branch: git checkout -b feature/ten-tinh-nang
3. Commit: git commit -m "Thêm tính năng X"
4. Push: git push origin feature/ten-tinh-nang
5. Mở Pull Request

Quy tắc code

· ✅ Vanilla JS — không thêm framework
· ✅ Tiếng Việt cho UI + comment
· ✅ Bump CACHE trong sw.js mỗi lần sửa
· ✅ Bump version.json để trigger update banner
· ❌ Không dùng coachmark / tooltip overlay
· ✅ Test trên Chrome mobile trước khi push

---

🐛 Báo lỗi

Mở Issues kèm:

· Ảnh chụp màn hình
· Mô tả ngắn hành động gây lỗi
· Phiên bản app (xem ở Menu ☰ → Kiểm tra cập nhật)

---

☕ Ủng hộ tác giả

· Viettinbank: 106879606835
· Chủ TK: LINH

Cảm ơn bạn! ❤️

---

📜 Giấy phép

MIT License — tự do sử dụng, chỉnh sửa, phân phối.

---

Made with ❤️ for SPX drivers

```