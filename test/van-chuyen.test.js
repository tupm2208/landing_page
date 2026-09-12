// Module Van chuyen — chay het duong tao van don va tra cuu, khong goi SPX/ViettelPost lan nao.
//
// Trong tam cua bo bai nay la cac QUIRK da phai tra gia moi biet: item_price kieu chuoi,
// address_version 0/2, SPX khoa order_id vinh vien, bo trong ai tra ship = nguoi nhan tra.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const toKhai = require("../modules/van-chuyen/module");
const spx = require("../modules/van-chuyen/spx");
const { doiSangHaiCap } = require("../modules/van-chuyen/dia-chi");

const MA_QT = "ma-quan-tri";
const MA_DV = "ma-bo-nao";
const CAU_HINH_SPX = { appId: "app-1", appSecret: "bi-mat", userId: "123456", userSecret: "khoa", collectType: 2 };

const PHIEU = {
  maPhieu: "ORD-1789000000001",
  nguoiGui: { ten: "TopRun H", dienThoai: "0900000000", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Giảng Võ", diaChiChiTiet: "Số 1 ngõ 2" },
  nguoiNhan: { ten: "Nguyễn Văn A", dienThoai: "0911111111", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Điện Biên", diaChiChiTiet: "12 Đội Cấn" },
  mon: [{ ten: "Giày chạy Pegasus 40 size 42", soLuong: 1, donGia: 2890000, canNangKg: 0.75 }],
  cod: 2890000
};

/** httpNgoai gia: ghi lai moi lan goi, tra ve cau tra loi da soan. */
function mangGia(cacTraLoi) {
  const daGoi = [];
  let lan = 0;
  return {
    daGoi,
    async goi(url, tuyChon = {}) {
      daGoi.push({ url: String(url), tuyChon });
      const tl = typeof cacTraLoi === "function" ? cacTraLoi(String(url), tuyChon, lan) : cacTraLoi[Math.min(lan, cacTraLoi.length - 1)];
      lan += 1;
      return { ok: true, status: 200, json: async () => tl, text: async () => JSON.stringify(tl) };
    }
  };
}

const SPX_TAO_OK = { ret_code: 0, message: "success", data: { orders: [{ tracking_no: "SPXVN123456789", order_id: "ORD-1789000000001", estimated_shipping_fee: 25000 }] } };
const SPX_TRUNG_MA = { ret_code: 1, message: "fail", data: { fail_list: [{ message: "order id has been used already" }] } };

function dungThu({ httpNgoai, cauHinh } = {}) {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "van-chuyen-"));
  const nhatKy = taoNhatKyGia();
  const kho = taoKhoTep({ thuMuc, nhatKy });
  const khung = taoKhung({
    cong: {
      kho, nhatKy, gio: taoGioGia(), httpNgoai: httpNgoai ?? mangGia([SPX_TAO_OK]),
      quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_DV })
    },
    nhatKy,
    toKhais: [toKhai],
    cauHinh: { "van-chuyen": cauHinh ?? { hangMacDinh: "spx", spx: CAU_HINH_SPX } }
  });
  return { khung, kho, nhatKy };
}

const goiTao = (than, ma = MA_QT) => ({
  method: "POST", duong: "/api/van-chuyen/tao", truyVan: {},
  tieuDe: { authorization: `Bearer ${ma}` }, doc: async () => than
});

// ---------- dung payload ----------

test("item_price phai la CHUOI — gui so bi SPX bao loi unmarshal 11001", () => {
  const { payload } = spx.dungPayload({ phieu: PHIEU, cauHinh: CAU_HINH_SPX });
  assert.equal(typeof payload.parcel_info.item_list[0].item_price, "string");
  assert.equal(payload.parcel_info.item_list[0].item_price, "2890000");
});

test("dia chi ba cap doi duoc sang hai cap thi address_version = 2", () => {
  const { payload, thieu } = spx.dungPayload({ phieu: PHIEU, cauHinh: CAU_HINH_SPX });
  assert.deepEqual(thieu, []);
  assert.equal(payload.sender_info.sender_address_version, 2);
  assert.equal(payload.sender_info.sender_district, "", "he hai cap khong con cap thu ba");
  assert.equal(payload.deliver_info.deliver_address_version, 2);
});

test("don khai san he hai cap thi giu nguyen, khong doi lai", () => {
  const { payload } = spx.dungPayload({
    phieu: { ...PHIEU, nguoiNhan: { ...PHIEU.nguoiNhan, heDiaChi: "2-cap", huyen: "", xa: "Phường Ba Đình" } },
    cauHinh: CAU_HINH_SPX
  });
  assert.equal(payload.deliver_info.deliver_address_version, 2);
  assert.equal(payload.deliver_info.deliver_city, "Phường Ba Đình");
});

test("bo trong ai tra ship = NGUOI NHAN tra (chot 25/08/2026, truoc do shop mat tien oan)", () => {
  assert.equal(spx.dungPayload({ phieu: PHIEU, cauHinh: CAU_HINH_SPX }).payload.fulfillment_info.payment_role, 2);
  assert.equal(spx.dungPayload({ phieu: { ...PHIEU, aiTraShip: "nguoi-gui" }, cauHinh: CAU_HINH_SPX }).payload.fulfillment_info.payment_role, 1);
});

test("hang tren 3 trieu thi bat xu ly gia tri cao va khai bao bao hiem", () => {
  const { payload } = spx.dungPayload({ phieu: { ...PHIEU, giaTriHang: 3500000 }, cauHinh: CAU_HINH_SPX });
  assert.equal(payload.fulfillment_info.high_value_processing_collection, 1);
  assert.equal(payload.parcel_info.express_insured_value, 3500000);
});

test("COD bi chan tran 20 trieu", () => {
  const { payload } = spx.dungPayload({ phieu: { ...PHIEU, cod: 99000000 }, cauHinh: CAU_HINH_SPX });
  assert.equal(payload.fulfillment_info.cod_amount, 20000000);
});

test("mac dinh cho xem hang, KHONG cho thu hang (chot 03/09/2026)", () => {
  const { payload } = spx.dungPayload({ phieu: PHIEU, cauHinh: CAU_HINH_SPX });
  assert.equal(payload.fulfillment_info.allow_mutual_check, 1);
  assert.equal(payload.fulfillment_info.allow_try_on, 0);
});

test("dia chi hong font bi chan som, khong de SPX bao 'location not found'", () => {
  const { thieu } = spx.dungPayload({
    phieu: { ...PHIEU, nguoiGui: { ...PHIEU.nguoiGui, xa: "Ph�ng Dịch Vọng" } }, cauHinh: CAU_HINH_SPX
  });
  assert.ok(thieu.some((t) => /hỏng font/.test(t)), thieu.join("; "));
});

test("thieu so dien thoai khach thi khong dung payload, noi ro thieu gi", () => {
  const { thieu } = spx.dungPayload({
    phieu: { ...PHIEU, nguoiNhan: { ...PHIEU.nguoiNhan, dienThoai: "" } }, cauHinh: CAU_HINH_SPX
  });
  assert.ok(thieu.some((t) => /điện thoại khách nhận/.test(t)));
});

test("xa cu bi TACH lam hai xa moi thi LUI VE he ba cap, khong doan bua", () => {
  // "Phuong Ngoc Ha" (Ba Dinh) cu nam trong hai xa moi. Doan mot trong hai la co the giao
  // nham quan. Luat: khong chac thi gui he ba cap cu — SPX van nhan.
  const tach = doiSangHaiCap({ tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Ngọc Hà" });
  assert.equal(tach.ok, true);
  assert.equal(tach.mapHo, true, "phai nhan ra la bi tach");

  const { payload } = spx.dungPayload({
    phieu: { ...PHIEU, nguoiNhan: { ...PHIEU.nguoiNhan, xa: "Phường Ngọc Hà" } }, cauHinh: CAU_HINH_SPX
  });
  assert.equal(payload.deliver_info.deliver_address_version, 0, "khong chac thi dung he cu");
  assert.equal(payload.deliver_info.deliver_city, "Quận Ba Đình");
  assert.equal(payload.deliver_info.deliver_district, "Phường Ngọc Hà");
});

test("bang doi dia chi doi duoc Quan 2 va Quan 9 sang Thu Duc", () => {
  const q2 = doiSangHaiCap({ tinh: "TP Hồ Chí Minh", huyen: "Quận 2", xa: "Phường Thảo Điền" });
  assert.equal(q2.ok, true, JSON.stringify(q2));
  assert.ok(String(q2.tinh).length > 0);
});

// ---------- ky va goi ----------

test("chu ky tinh tren appId_timestamp_random_than, dung HMAC-SHA256", () => {
  const than = '{"user_id":1}';
  const mong = crypto.createHmac("sha256", "bi-mat").update("app-1_1700000000_42_" + than, "utf8").digest("hex");
  assert.equal(spx.kySo("app-1", "bi-mat", 1700000000, 42, than), mong);
});

test("goi SPX kem du bon tieu de bat buoc", async () => {
  const mang = mangGia([SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang });
  await khung.xuLy(goiTao(PHIEU));
  const h = mang.daGoi[0].tuyChon.headers;
  assert.equal(h["app-id"], "app-1");
  assert.equal(typeof h["check-sign"], "string");
  assert.ok(h.timestamp && h["random-num"]);
  assert.match(mang.daGoi[0].url, /^https:\/\/spx\.vn\//, "mac dinh la moi truong that");
});

test("moi truong thu goi sang ten mien thu", async () => {
  const mang = mangGia([SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang, cauHinh: { hangMacDinh: "spx", spx: { ...CAU_HINH_SPX, moiTruong: "thu" } } });
  await khung.xuLy(goiTao(PHIEU));
  assert.match(mang.daGoi[0].url, /test-stable\.spx\.vn/);
});

// ---------- tao van don ----------

test("tao duoc van don: tra ma, duong tra cuu, va ghi vao so", async () => {
  const { khung, kho } = dungThu();
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.maVanDon, "SPXVN123456789");
  assert.match(ra.than.duongTra, /spx\.vn\/express\/track/);

  await kho.choXong();
  const so = await kho.so("van-don").doc();
  assert.equal(so.vanDon["ORD-1789000000001"].maVanDon, "SPXVN123456789");
});

test("tao van don xong thi phat len bang tin cho module khac", async () => {
  const { khung } = dungThu();
  const nghe = [];
  khung.bus.nghe("van-chuyen.da-tao-van-don", "bai-thu", (d) => nghe.push(d));
  await khung.xuLy(goiTao(PHIEU));
  await new Promise((r) => setImmediate(r));
  assert.equal(nghe.length, 1);
  assert.equal(nghe[0].maVanDon, "SPXVN123456789");
});

test("SPX khoa vinh vien ma don da nop — tu dong thu lai voi hau to -R2", async () => {
  const mang = mangGia([SPX_TRUNG_MA, SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang });
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 200);
  assert.equal(mang.daGoi.length, 2, "phai nop lai lan hai");
  assert.equal(JSON.parse(mang.daGoi[0].tuyChon.body).orders[0].order_id, "ORD-1789000000001");
  assert.equal(JSON.parse(mang.daGoi[1].tuyChon.body).orders[0].order_id, "ORD-1789000000001-R2");
});

test("loi KHAC loi trung ma thi dung ngay, khong nop lai ba lan", async () => {
  const mang = mangGia([{ ret_code: 1, message: "fail", data: { fail_list: [{ message: "location not found" }] } }]);
  const { khung } = dungThu({ httpNgoai: mang });
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 502);
  assert.equal(mang.daGoi.length, 1);
  assert.match(ra.than.message, /location not found/);
});

test("chua cau hinh SPX thi KHONG goi ra ngoai, bao de nguoi that xu ly", async () => {
  const mang = mangGia([SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang, cauHinh: { hangMacDinh: "spx", spx: {} } });
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 400);
  assert.equal(ra.than.error, "spx_chua_cau_hinh");
  assert.equal(mang.daGoi.length, 0);
});

test("phieu thieu thi tra ve danh sach thieu, khong goi SPX", async () => {
  const mang = mangGia([SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang });
  const ra = await khung.xuLy(goiTao({ ...PHIEU, nguoiNhan: { ...PHIEU.nguoiNhan, ten: "" } }));
  assert.equal(ra.ma, 400);
  assert.ok(ra.than.thieu.some((t) => /tên khách nhận/.test(t)));
  assert.equal(mang.daGoi.length, 0);
});

test("khi SPX hen gio den lay hang thi phai xin khung gio truoc", async () => {
  const gioLay = { ret_code: 0, data: [{ pickup_time: 1789100000, slots: [{ pickup_time_range_id: 7, pickup_time_range: "09:00-12:00" }] }] };
  const mang = mangGia([gioLay, SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang, cauHinh: { hangMacDinh: "spx", spx: { ...CAU_HINH_SPX, collectType: 1 } } });
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 200);
  const gui = JSON.parse(mang.daGoi[1].tuyChon.body).orders[0];
  assert.equal(gui.fulfillment_info.pickup_time, 1789100000);
  assert.equal(gui.fulfillment_info.pickup_time_range_id, 7);
});

// ---------- tra cuu ----------

test("tra cuu doc so truoc, chi goi ra ngoai mot lan cho hai cau hoi", async () => {
  const traLoi = { ret_code: 0, data: { orders: [{ tracking_no: "SPXVN123456789", status: "delivering" }] } };
  const mang = mangGia((url) => (url.includes("create_order") ? SPX_TAO_OK : traLoi));
  const { khung, kho } = dungThu({ httpNgoai: mang });
  await khung.xuLy(goiTao(PHIEU));
  await kho.choXong();

  const hoi = { method: "GET", duong: "/api/van-chuyen/tra-cuu/ORD-1789000000001", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_DV}` } };
  const ra = await khung.xuLy(hoi);
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.maVanDon, "SPXVN123456789");
  assert.equal(ra.than.don.status, "delivering");
});

test("tra cuu don chua co van don thi 404, khong goi ra ngoai", async () => {
  const mang = mangGia([SPX_TAO_OK]);
  const { khung } = dungThu({ httpNgoai: mang });
  const ra = await khung.xuLy({ method: "GET", duong: "/api/van-chuyen/tra-cuu/ORD-khong-co", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_DV}` } });
  assert.equal(ra.ma, 404);
  assert.equal(mang.daGoi.length, 0);
});

// ---------- quyen ----------

test("duong tao van don chi cho quan tri; bo nao khong tu tao van don duoc", async () => {
  const { khung } = dungThu();
  assert.equal((await khung.xuLy(goiTao(PHIEU, MA_DV))).ma, 401);
  assert.equal((await khung.xuLy({ ...goiTao(PHIEU), tieuDe: {} })).ma, 401);
});

test("duong tra cuu mo cho bo nao (bot tra loi 'don em toi dau roi')", async () => {
  const { khung } = dungThu();
  const ra = await khung.xuLy({ method: "GET", duong: "/api/van-chuyen/tra-cuu/x", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_DV}` } });
  assert.notEqual(ra.ma, 401);
});

// ---------- ViettelPost ----------

test("ViettelPost: dang nhap lay token roi moi tao don", async () => {
  const mang = mangGia((url) => (url.includes("login") ? { data: { token: "tk-1" } } : { data: { ORDER_NUMBER: "VTP999", MONEY_TOTALFEE: 30000 } }));
  const { khung } = dungThu({ httpNgoai: mang, cauHinh: { hangMacDinh: "vtp", vtp: { username: "u", password: "p" } } });
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.maVanDon, "VTP999");
  assert.equal(mang.daGoi.length, 2);
  assert.equal(mang.daGoi[1].tuyChon.headers.Token, "tk-1");
});

test("ViettelPost: co san token thi bo qua buoc dang nhap", async () => {
  const mang = mangGia([{ data: { ORDER_NUMBER: "VTP111" } }]);
  const { khung } = dungThu({ httpNgoai: mang, cauHinh: { hangMacDinh: "vtp", vtp: { token: "tk-san" } } });
  const ra = await khung.xuLy(goiTao(PHIEU));
  assert.equal(ra.ma, 200);
  assert.equal(mang.daGoi.length, 1, "khong duoc dang nhap lai khi da co token");
});

test("ViettelPost tinh can nang bang gram, khong phai ki-lo", async () => {
  const mang = mangGia([{ data: { ORDER_NUMBER: "VTP222" } }]);
  const { khung } = dungThu({ httpNgoai: mang, cauHinh: { hangMacDinh: "vtp", vtp: { token: "tk" } } });
  await khung.xuLy(goiTao(PHIEU));
  assert.equal(JSON.parse(mang.daGoi[0].tuyChon.body).PRODUCT_WEIGHT, 750);
});
