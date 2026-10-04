# 🚚 SPX Tracker

> PWA theo dõi sản lượng giao/lấy/hoàn & tính điểm phúc lợi SPX Express

---

## 🌐 Truy cập nhanh

👉 **https://linhshope124-a11y.github.io/Linh/**

Cài như app:
- **Android (Chrome):** ⋮ → Thêm vào màn hình chính
- **iPhone (Safari):** Chia sẻ → Thêm vào màn hình chính

---

## ✨ Tính năng

- 📊 **Theo dõi sản lượng** — 8 dải khối lượng Giao / Lấy / Hoàn
- 🎯 **Tính điểm phúc lợi** — theo chính sách SPX Express
- 📷 **Quét ảnh OCR** — chụp màn hình SPX → tự nhập liệu
- 💰 **Thu nhập theo tháng** — lưu riêng từng tháng
- 🏆 **Hạng thưởng** — Đồng / Bạc / Vàng / B.Kim / K.Cương
- ☁️ **Backup Cloud** — GitHub Gist
- 📱 **Chạy offline** — sau lần đầu tải
- 🌙 **Dark mode**
- ↩️ **Undo** — hoàn tác 5s

---

## 🛠️ Tech Stack

- Vanilla JS (ES Modules, không framework)
- CSS thuần với design tokens (light/dark)
- PWA — Service Worker + Manifest
- Tesseract.js v5 — OCR tiếng Việt
- GitHub Gist API — Cloud backup
- localStorage — Lưu dữ liệu local

**Không cần build step** — code chạy trực tiếp trên trình duyệt.

---

## 📂 Cấu trúc

```

Linh/
├── index.html              # Entry point — main app
├── guide.html              # Trang hướng dẫn sử dụng
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
├── README.md               # File này
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
├── ocr.js
├── backup.js
├── cloud.js
├── theme.js
└── undo.js

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
| Miền Bắc/Trung/Nam | ≥ 60 | ≥ 30 |
| TP.HCM & Hà Nội | ≥ 80 | ≥ 40 |

### Số ngày tối đa
- Tháng 2 → **24**
- Các tháng khác → **26**

### Thu nhập
```

Lương 1 công = (LCB + Bưu cục + Tài xế) / số ngày tối đa
Tích lũy      = Lương 1 công × số công đã làm

```

### Tổng điểm
```

Tổng = Gốc + (Gốc × %hạng) + Thu nhập

```

---

## 🚀 Cài đặt cho developer

### Chạy local

```bash
git clone https://github.com/linhshope124-a11y/Linh.git
cd Linh
python -m http.server 8000
```

Mở http://localhost:8000

Deploy

Repo tự động deploy qua GitHub Pages khi push lên main.

```bash
git add .
git commit -m "v50.5: mô tả thay đổi"
git push
```

⚠️ Nhớ bump CACHE trong sw.js mỗi lần deploy.

---

🔄 Version History

Version Thay đổi chính
v50.5 Tách HDSD ra guide.html riêng
v50.4.1 Đơn vị "điểm" cột ĐƯỢC
v50.4 Thu nhập lưu theo từng tháng
v50.3 Header cluster 3 nhóm visual
v50.1 Label tháng có năm
v50 Bỏ toggle Ngày, header 1 hàng
v49 Hero + Tiles gộp, clamp font
v48 Hero collapsible
v47 Floating header card
v46 Toggle Tháng/Ngày
v45 OCR auto-save
v44 Chốt OCR fix
v43 Redesign chuyên nghiệp
v42 Month picker

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
· ❌ Không dùng coachmark / tooltip overlay
· ✅ Test trên Chrome mobile trước khi push

---

🐛 Báo lỗi

Mở Issues kèm:

· Ảnh chụp màn hình
· Mô tả ngắn hành động gây lỗi
· Phiên bản app

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

---