# Chuẩn thiết kế mã — server khách (landing), áp dụng từ 14/09/2026

Cùng chuẩn với bộ não (`../bo-nao/DESIGN.md`): **TypeScript, hướng đối tượng, tên tiếng Anh**,
giao thức bên ngoài giữ nguyên. Tài liệu này nói phần riêng của landing: bố cục gói, giao kèo
module, và **bảng đổi tên** từ bản JS cũ sang bản TS để mọi module được viết cùng một kiểu.

## 1. Bố cục: một gói, bốn tầng

```
server-khach/
  src/contract/     giao kèo: cổng (ports.ts), request/reply (http.ts), tờ khai module (manifest.ts),
                    mã lỗi (errors.ts), tên sự kiện (events.ts). KHÔNG import ai.
  src/kernel/       khung: Kernel, Router, EventBus, HTTP adapter, luật kiến trúc, và các adapter cổng
                    (ports/: basics, json-file-store, mysql-store, auth, rate-limiter, trial-mode, static-files)
  src/shared/       bọc kiểu lên kit dùng chung ở ../chung (vé máy, tiền đơn) + tiện ích nhỏ (giờ MySQL, cookie phiên)
  src/modules/<id>/ mỗi module một thư mục: module.ts (tờ khai) + các tệp nghiệp vụ; index.ts là sổ đăng ký
  src/app.ts        composition root: đọc env, cắm adapter, dựng Kernel, chạy lược đồ, đăng ký Xeon
  src/main.ts       điểm khởi động: node dist/main.js
  src/tools/        công cụ dòng lệnh (bộ cài, nạp dữ liệu thật)
  modules/<id>/goc/ tệp trình duyệt chép nguyên từ bản cũ (HTML/JS/CSS/PHP) — KHÔNG phải mã máy chủ, để nguyên
  test/*.test.mts   bài không cần MySQL;  test-mysql/*.test.mts  bài cần MySQL 3307
```

Chiều phụ thuộc: `contract` ← `shared` ← `modules` ← `app`; `kernel` chỉ đọc `contract`/`shared`.
**Module không bao giờ import `kernel`** và không import giá trị từ module khác (bài
`architecture-rules` làm gãy). Được phép `import type` từ module khác để lấy chữ ký dịch vụ —
kiểu bị xoá lúc dịch nên không tạo phụ thuộc chạy.

## 2. Các mẫu thiết kế

| Mẫu | Ở đâu | Vì sao |
|---|---|---|
| Ports & Adapters | `contract/ports.ts` là cổng; `kernel/ports/*` là adapter thật + giả | Module không mở tệp/mạng/CSDL; test chạy bằng cửa giả |
| Chain of Responsibility | `Kernel.handle()`: khớp đường → chặn gọi dồn → kiểm quyền → kiểm mảnh → hạn thân → handler | Một chỗ duy nhất, không module nào quên được |
| Composition root | `app.ts` (`buildLandingApp`) | Chỗ DUY NHẤT đọc env và `new` adapter |
| Registry | `modules/index.ts` (`BUILTIN_MODULES`) | Danh sách tĩnh, TypeScript kiểm từng tờ khai |
| Strategy | hãng vận chuyển (`van-chuyen/spx.ts`, `vtp.ts`), kênh hộp thư, nguồn hàng | Thêm một hãng = thêm một lớp |
| Repository | lớp `*Repository` / `*Store` trong module bọc `ctx.ports.store.table(...)` | Che SQL khỏi luật nghiệp vụ; tên bảng/cột giữ tiếng Việt (trên đĩa) |
| Value helper | `shared/mysql-time.ts`, `shared/session-cookie.ts`, chuẩn hoá món | Hàm thuần, có tài liệu |

Lớp chỉ khi có trạng thái hoặc nhiều cài đặt thay nhau; còn lại là hàm thuần có TSDoc.

## 3. Tờ khai module (manifest) — đổi tên

```ts
import { defineModule, ACCESS, EVENTS, reply, type ModuleContext } from "../../contract";

interface Config { ... }                       // ctx.config — hình dạng do app.ts dựng (xem moduleConfigFromEnv)
interface Services { "hang-kho": Pick<InventoryServices, "reserve" | "release">; "tien-doi-soat"?: ... }

export const manifest = defineModule<Config, Services>({
  id, name, tier, runsOn: "server-khach", version, feature,
  ports: ["store", "logger", "clock", "http", "bus", "auth", "config", "staticFiles"],
  routes: [{ method, path, access: ACCESS.public, whyPublic, rateLimit: { calls, windowMs }, bodyLimit, feature, handle }],
  events: { emits: [EVENTS.stockOut], listens: { [EVENTS.orderCreated]: (ctx, payload) => ... } },
  provides: { "hang-kho.reserve": (ctx, input) => ... },
  requires: ["don-khach.read"], requiresOptional: ["tien-doi-soat.orderMoney"],
  inheritedTables: ["orders"], schema: [{ name, tables, sql }],
  botTools: [{ ten, hieuUng, ... }]            // gửi cho bộ não nguyên xi -> giữ tên trường tiếng Việt
});
```

| Cũ (JS) | Mới (TS) |
|---|---|
| `ten` / `mang` / `chay` / `phienBan` / `manh` | `name` / `tier` / `runsOn` / `version` / `feature` |
| `canCong: ["kho","nhatKy","gio","httpNgoai","bus","quyen","cauHinh","tepTinh"]` | `ports: ["store","logger","clock","http","bus","auth","config","staticFiles"]` |
| `duong[{ method, path, quyen, viSaoCongKhai, hanGoi:{soLan,trongMs}, hanThan, manh, tay }]` | `routes[{ method, path, access, whyPublic, rateLimit:{calls,windowMs}, bodyLimit, feature, handle }]` |
| `quyen: "cong-khai" \| "dich-vu" \| "quan-tri"` | `access: ACCESS.public \| ACCESS.service \| ACCESS.admin` (giá trị chuỗi giữ nguyên) |
| `suKien: { phat, nghe }` | `events: { emits, listens }`; tên sự kiện qua `EVENTS.*` (giá trị giữ nguyên) |
| `capDichVu` / `canDichVu` / `canDichVuNeuCo` | `provides` / `requires` / `requiresOptional` |
| `bangKeThua` / `luocDo[{ ten, bang, sql }]` | `inheritedTables` / `schema[{ name, tables, sql }]` |
| `congCuBot` | `botTools` (trường bên trong giữ `ten`, `hieuUng`: đó là giao thức với bộ não) |
| `LOI.khong_thay` ... | `ERROR_CODES.notFound` ... (giá trị giữ nguyên) |

**Tên dịch vụ** (`<id module>.<tên>`; id module giữ tiếng Việt vì là id mảnh/tiền tố bảng, phần tên tiếng Anh):

| Cũ | Mới |
|---|---|
| `hang-kho.tim / tonKho / giuCho / traCho / dem / ghi / doc` | `hang-kho.search / stock / reserve / release / count / write / read` |
| `don-khach.doc / tim / datDon / doiTrangThai / docTheoMaTra / ghiTien` | `don-khach.read / search / place / changeStatus / readByLookupToken / recordPayment` |
| `hop-thu.guiTin` | `hop-thu.send` |
| `khung-nen-tang.noiDung / soCuaTien / xeon` | `khung-nen-tang.content / moneySettings / xeon` |
| `mua-ho.canMua / daBaoHet` | `mua-ho.needsPurchase / reportedOutOfStock` |
| `tien-doi-soat.tienTrenDon / chonCachTra / ghiNhanDaTra` | `tien-doi-soat.orderMoney / choosePaymentMethod / recordPaid` |
| `van-chuyen.taoVanDon / traCuu / kiemPhieu` | `van-chuyen.createShipment / track / checkSlip` |

Gọi: `ctx.services["hang-kho"].reserve(input)` (kernel đã buộc sẵn ctx của bên cấp). Dịch vụ tuỳ chọn
có thể vắng: `ctx.services["tien-doi-soat"]?.orderMoney(...)`.

## 4. Request / reply / ctx — đổi tên

| Cũ | Mới |
|---|---|
| `yc.duong / tham / truyVan / tieuDe / ip / doc() / tho()` | `request.path / params / query / headers / ip / json() / raw()` |
| `tham.duoi` (đường `*`) | `params.rest` |
| `{ ma, than, tieuDe }` / `{ ma, tep:{duLieu,kieu} }` / `{ chuyenHuong, ma }` | `{ status, body, headers }` / `{ status, file:{data,type} }` / `{ redirect, status }` — hoặc `reply.json(body, status)`, `reply.file(data, type)`, `reply.redirect(url)` |
| `ctx.cong.kho / nhatKy / gio / httpNgoai / quyen / tepTinh` | `ctx.ports.store / logger / clock / http / auth / staticFiles` |
| `ctx.bus.phat(ten, duLieu)` | `ctx.bus.emit(name, payload)` |
| `ctx.dichVu["x"].y(...)` | `ctx.services["x"].y(...)` |
| `ctx.cauHinh` | `ctx.config` (tên trường bên trong đã đổi sang tiếng Anh trong `app.ts`) |

Cổng:

| Cũ | Mới |
|---|---|
| `nhatKy.tin / canhBao` | `logger.info / warn` |
| `gio.bayGio()` | `clock.now()` |
| `httpNgoai.goi(url, { method, headers, body, hanMs })` | `http.fetch(url, { method, headers, body, timeoutMs })` |
| `kho.bang(t).tim({ dieuKien, sapXep, gioiHan, bo, cot }) / mot / dem / them / themHoacThay / themNhieu / thay / xoa / xoaSach` | `store.table(t).find({ where, orderBy, limit, offset, columns }) / one / count / insert / upsert / insertMany / update / delete / truncate` |
| `kho.so(ten).doc / ghi / capNhat` | `store.document<T>(name).read / write / update` |
| `const [dong] = await kho.cauLenh(sql, ts)` (SELECT) | `const rows = await store.rows(sql, params)` |
| `kho.cauLenh(sql)` (DELETE/UPDATE) | `store.execute(sql, params)` → `{ affectedRows, insertId }` |
| `kho.giaoDich(async (trong) => ...)` | `store.transaction(async (tx) => ...)` |
| `kho.chayLuocDo(id, luocDo, { bangKeThua })` | `store.runSchema(id, schema, { inheritedTables })` |
| `quyen.ai(yc)` → `{ vai, ten, bang, shop, maMay, manh, truc, hetLuc }` | `auth.identify(request)` → `{ role, name, via, shop, machineId, features, onDuty, expiresAt }` (đổi lại tên tiếng Việt ở biên nếu trả ra HTTP) |
| `quyen.duoc / thieuManh / laQuanTri / datXeon / daDangKyXeon / tenCacKhoa` | `auth.allows / lacksFeature / isAdmin / setXeon / hasXeon / keyNames` |
| `tepTinh.mo(khu).doc(duong)` → `{ duLieu, kieu, nhoDem }` | `staticFiles.open(zone).read(path)` → `{ data, type, cacheControl, path }`; `.exists(path)` |

Kit chung: `shared/mysql-time.ts` (`toMysqlDateTime`, `fromMysqlDateTime`, `isoFromMysql`),
`shared/session-cookie.ts` (`SessionCookie`, `readCookie`), `shared/order-money.ts`,
`shared/ticket-kit.ts` (`signTicket`, `verifyTicket`, `generateSigningKey`, `isTicket`).

## 5. Cái gì GIỮ tiếng Việt

- Đường HTTP, tên trường JSON trả cho OMI/Desk/Image Tool/web/bộ não, mã lỗi (`khong_thay`...),
  tên sự kiện, id module, id mảnh, tên bảng và cột, tên sổ (`hop-thu-den`...), tên cookie, biến
  môi trường, giá trị `vai`/`bang`/`via`.
- Chuỗi hiện cho người: log vận hành, `message` trong lỗi, chữ trên trang, tin gửi khách.
- Câu khách trong test là dữ liệu — giữ nguyên.

Mọi thứ khác (biến, hàm, lớp, kiểu, tên tệp, chú thích, tiêu đề bài test) tiếng Anh.

## 6. Test

- `test/*.test.mts` và `test-mysql/*.test.mts`, chạy thẳng bằng `node --test` trên Node 24;
  import từ `../dist/index.js` (đã `npm run build`). Kiểm kiểu: `npm run check`.
- Dựng kernel trong test:
  ```ts
  import { Kernel, JsonFileStore, MemoryLogger, ManualClock, FakeHttpClient, TokenAuth, FixedWindowRateLimiter, ROLE, type IncomingRequest } from "../dist/index.js";
  const clock = new ManualClock(); const logger = new MemoryLogger();
  const kernel = new Kernel({
    ports: { store: new JsonFileStore(tmpDir), logger, clock, http: new FakeHttpClient(), auth: new TokenAuth({ keys: [{ token: "ma-quan-tri", name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [manifest], config: { "hang-kho": {} }
  });
  const r = await kernel.handle({ method: "GET", path: "/api/products", headers: { authorization: "Bearer ma-quan-tri" }, ip: "1.1.1.1", json: async () => body });
  r.status; r.body;
  ```
- MySQL: `openMysqlStore({ url, logger })`, `TOPRUN_MYSQL_URL` trỏ 3307 (`toprun_modules_test`); **3306 là cấm** (bài tự ném).
- Mỗi luật có một bài "phá thì gãy", không chỉ bài "đúng thì xanh".

## 7. Thêm một thứ mới

| Muốn thêm | Làm |
|---|---|
| Module mới | `src/modules/<id>/module.ts` với `defineModule`, một dòng trong `modules/index.ts`, cấu hình trong `app.ts` nếu cần |
| Đường mới | Một phần tử `routes`; công khai thì bắt buộc `whyPublic` + `rateLimit` |
| Dịch vụ cho module khác | Khai trong `provides` (tên `<id>.<name>`), export `interface XxxServices` để bên gọi `import type` |
| Cổng mới | Interface ở `contract/ports.ts`, adapter thật + giả ở `kernel/ports/`, một dòng trong `Kernel.portsFor` |
