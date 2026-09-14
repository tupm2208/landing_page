# Server khách (landing) — máy chủ riêng của từng nhà bán hàng

Chạy 24/7 trên hosting của shop: giữ dữ liệu (MySQL), phục vụ mặt web, mở API cho OMI và cho
bộ não trên Xeon, nhận tin Fanpage. **Một landing = một shop, một hosting, một cơ sở dữ liệu.**

Từ 14/09/2026 toàn bộ mã viết bằng **TypeScript, hướng đối tượng, tên tiếng Anh** — cùng chuẩn
với bộ não (`../bo-nao/DESIGN.md`); phần riêng của landing và **bảng đổi tên** từ bản JS cũ ở
`DESIGN.md`. Giao thức bên ngoài (đường HTTP, tên trường JSON, mã lỗi, tên bảng/cột, tên sổ,
cookie, biến môi trường) **giữ nguyên** nên OMI, Sales Desk, Image Tool và bộ não không đổi gì.

## Chạy

```bash
cd D:\projects\toprunvn_modules\server-khach
npm install
npm test            # dịch rồi chạy 206 bài không cần MySQL
npm run test:mysql  # 118 bài trên MySQL 3307 (TOPRUN_MYSQL_URL=mysql://...@127.0.0.1:3307/toprun_modules_test)
npm run check       # kiểm kiểu mã lẫn test, không dịch

npm run install-wizard   # bộ cài: hỏi vài câu, viết .env, đăng ký với Xeon
npm start                # = node dist/main.js (phải build trước; npm test đã build sẵn)
```

Biến môi trường đọc từ `.env` cạnh gói (bộ cài viết ra); biến đặt sẵn trong môi trường đè lên.
Bảng biến đầy đủ ở `../HUONG-DAN-CHAY.md`. **Chế độ thử bật mặc định**: không gửi tin cho
khách, không tạo vận đơn thật, không báo Telegram — chỉ `CHE_DO_THAT=1` mới cho gọi thật.
Cổng MySQL 3306 là dữ liệu thật của landing đang chạy: mọi công cụ ở đây tự ném nếu trỏ vào đó.

## Cấu trúc

| Tầng | Vai trò | Thư mục |
|---|---|---|
| Giao kèo | Cổng (`DataStore`, `AuthPort`, `HttpClient`…), request/reply, tờ khai module + bộ kiểm (`ManifestValidator`), mã lỗi, tên sự kiện | `src/contract` |
| Khung | `Kernel` (nạp module, phát cổng, chuỗi canh cửa: khớp đường → chặn gọi dồn → quyền → mảnh → hạn thân), `Router`, `EventBus`, HTTP adapter, luật kiến trúc, adapter cổng thật + giả | `src/kernel` |
| Dùng chung | Bọc kiểu lên `../chung/ve-may.js` và `../chung/order-money-kit.js`; giờ MySQL; cookie phiên | `src/shared` |
| Module | 10 module, mỗi cái một thư mục với `module.ts` là tờ khai; `index.ts` là sổ đăng ký | `src/modules` |
| Composition root | `app.ts` đọc env, cắm adapter, dựng kernel, chạy lược đồ, đăng ký Xeon; `main.ts` nghe cổng | `src` |
| Công cụ | Bộ cài, nạp danh mục / đơn / cộng tác viên thật (chỉ đọc máy cũ, chỉ ghi 3307) | `src/tools` |
| Mặt web cũ | Tệp trình duyệt/PHP chép nguyên từ bản đang chạy, module Gian hàng trả qua cổng tệp tĩnh | `modules/<id>/goc` |

Module chỉ nói chuyện qua **bảng tin sự kiện** (một chiều) và **dịch vụ theo tên**
(`provides` / `requires`, khung nối hộ). Bộ quét `architecture-rules.ts` làm gãy build khi một
module import giá trị từ module khác, import khung, hay tự mở `fs`/`http`/`mysql`.

| Module | Mảnh | Việc |
|---|---|---|
| `hang-kho` | hang-kho | Danh mục ba nguồn hàng, tồn theo kho, giữ chỗ có khoá dòng |
| `don-khach` | don-khach | Đặt đơn (giữ chỗ trước, giá lấy từ kho), tra đơn, đổi trạng thái, báo cáo |
| `tien-doi-soat` | tien | Bốn cách trả, tiền qua order-money-kit, báo Telegram cho người bán |
| `van-chuyen` | van-chuyen | Vận đơn SPX / Viettel Post (Strategy), sổ vận đơn, địa chỉ |
| `mua-ho` | mua-ho | Cổng đối tác phiên cookie, phiếu mua, báo hết theo mã dòng |
| `hop-thu` | hop-thu | Webhook Meta (kiểm chữ ký), hàng chờ gửi cho OMI, đẩy tin sang Xeon |
| `cong-bo-nao` | chatbot-cskh | Cửa công cụ cho bộ não (`/api/bo-nao/cong-cu`), trí nhớ hội thoại, mã kho mù |
| `gian-hang` | gian-hang | Mặt web (`goc/`), thẻ OG, link chia sẻ |
| `ctv` | gian-hang | Cộng tác viên: mật khẩu PBKDF2 (giữ nguyên định dạng cũ), thiết bị duyệt, tải ảnh |
| `khung-nen-tang` | — | Nội dung trang, phiên bản đang chạy, đăng ký Xeon, màn "landing này là shop nào" |

## Test

`test/*.test.mts` (không cần MySQL) và `test-mysql/*.test.mts` (cần 3307), TypeScript chạy
thẳng trên Node 24, import từ `dist/`. Mỗi luật kiến trúc có một bài "phá thì gãy"; danh sách
cửa công khai được ghim ở `test/route-table.test.mts` — mở thêm một cửa là bài đó đỏ, cố ý.

## Còn nợ

- `hang-kho.search` tìm bằng `LIKE %cả câu%` nên bộ não gửi nguyên câu khách thì không ra món
  (đã ghi `TODO` tại chỗ).
- Module `lien-ket` mới có `goc/`, chưa có tờ khai.
