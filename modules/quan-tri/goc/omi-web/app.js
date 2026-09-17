// Web OMI: omi-ui/src + web-omi/cau-noi-web.ts, built by scripts/build-omi-web.mjs. Do not edit by hand.
"use strict";
(() => {
  // ../omi/packages/omi/src/landing/cong-landing.ts
  var HAN_MAC_DINH = 15e3;
  function cauLoiTheoMa(ma, than) {
    const chu2 = than ?? {};
    const cuaServer = typeof chu2.message === "string" && chu2.message.trim() !== "" ? chu2.message.trim() : "";
    if (ma === 401) return `Máy chủ không nhận vé của máy này (vé hết hạn, hoặc landing chưa đăng ký với Xeon). Bấm Kiểm lại license.${cuaServer ? ` (${cuaServer})` : ""}`;
    if (ma === 403) {
      if (chu2.error === "chua_mua_manh") return `Shop chưa mua mảnh "${String(chu2.manh ?? "?")}". Liên hệ nơi cấp key để mở thêm.`;
      return cuaServer || "Máy chủ từ chối việc này.";
    }
    if (ma === 404) return cuaServer || "Không tìm thấy thứ cần tìm trên máy chủ.";
    if (ma === 409) return cuaServer || "Việc này không làm được ở trạng thái hiện tại.";
    if (ma === 413) return "Gửi lên quá lớn — máy chủ từ chối nhận.";
    if (ma === 429) return "Máy chủ đang nhận quá nhiều yêu cầu. Chờ ít phút rồi thử lại.";
    if (ma >= 500) return cuaServer || "Máy chủ đang gặp lỗi. Xem nhật ký của máy chủ.";
    return cuaServer || `Máy chủ trả mã ${ma}.`;
  }
  function taoCongLanding(t) {
    const hanMs = Number(t.hanMs ?? HAN_MAC_DINH);
    const goi = t.goi ?? ((url, tuyChon) => fetch(url, tuyChon));
    const goc = () => String(t.duong() ?? "").trim().replace(/\/+$/, "");
    async function di(cach, duong, than) {
      const g = goc();
      if (g === "") return { ok: false, ma: 0, than: null, viSao: "Chưa biết địa chỉ landing của shop — bấm Kiểm lại license." };
      const ma = t.ma();
      const dung = new AbortController();
      const hen = setTimeout(() => dung.abort(), hanMs);
      try {
        const tl = await goi(`${g}${duong}`, {
          method: cach,
          // Ve nam O DAY va chi o day.
          headers: {
            ...ma === "" ? {} : { Authorization: `Bearer ${ma}` },
            ...than === void 0 ? {} : { "Content-Type": "application/json" }
          },
          ...than === void 0 ? {} : { body: JSON.stringify(than) },
          signal: dung.signal
        });
        const chu2 = await tl.text();
        let doc = null;
        try {
          doc = chu2 === "" ? null : JSON.parse(chu2);
        } catch {
          doc = null;
        }
        if (!tl.ok) return { ok: false, ma: tl.status, than: null, viSao: cauLoiTheoMa(tl.status, doc) };
        return { ok: true, ma: tl.status, than: doc, viSao: "" };
      } catch (e) {
        const loi = e;
        if (loi?.name === "AbortError") {
          return { ok: false, ma: 0, than: null, viSao: `Máy chủ không trả lời trong ${Math.round(hanMs / 1e3)} giây.` };
        }
        return { ok: false, ma: 0, than: null, viSao: `Không nối được tới máy chủ ${g}: ${String(loi?.message ?? e)}` };
      } finally {
        clearTimeout(hen);
      }
    }
    const q = (o) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(o)) {
        if (v === void 0 || v === null || v === "") continue;
        p.set(k, String(v));
      }
      const chu2 = p.toString();
      return chu2 === "" ? "" : `?${chu2}`;
    };
    const maAnToan = (x) => encodeURIComponent(String(x ?? "").trim());
    return {
      duong: goc,
      phienBan: () => di("GET", "/api/runtime-version"),
      xeon: () => di("GET", "/api/admin/xeon"),
      danhSachDon: (tham = {}) => di("GET", `/api/orders${q({
        status: tham.trangThai,
        phone: tham.dienThoai,
        since: tham.tuNgay,
        limit: tham.gioiHan,
        daXoa: tham.daXoa,
        nhom: tham.nhom,
        q: tham.tuKhoa
      })}`),
      demDonTheoNhom: () => di("GET", "/api/admin/orders/dem-quy-trinh"),
      moDon: (maDon) => di("GET", `/api/orders/${maAnToan(maDon)}`),
      doiTrangThaiDon: (maDon, trangThai, ghiChu = "") => di("PATCH", `/api/orders/${maAnToan(maDon)}`, { status: trangThai, note: ghiChu }),
      ghiNhanDaTra: (maDon, soTien, ghiChu = "") => di("POST", "/api/tien/da-tra", { maDon, soTien, ghiChu, boi: "omi" }),
      tienCuaDon: (maDon) => di("GET", `/api/tien/don/${maAnToan(maDon)}`),
      hoanTien: (than) => di("POST", "/api/tien/hoan", { ...than, boi: "omi" }),
      giaVonConThieu: (gioiHan) => di("GET", `/api/tien/gia-von/thieu${q({ gioiHan })}`),
      ghiGiaVon: (dong) => di("POST", "/api/tien/gia-von", { dong }),
      buGiaVonTuPhieu: (maDon) => di("POST", "/api/tien/gia-von/bu-tu-phieu", maDon === "" ? {} : { maDon }),
      taoDonThuCong: (than) => di("POST", "/api/orders/thu-cong", than),
      suaDon: (maDon, than) => di("PUT", `/api/orders/${maAnToan(maDon)}`, than),
      xoaDon: (maDon) => di("DELETE", `/api/orders/${maAnToan(maDon)}`),
      khoiPhucDon: (maDon) => di("POST", `/api/orders/${maAnToan(maDon)}/khoi-phuc`, {}),
      ghiDongDon: (maDon, maDong, than) => di("PATCH", `/api/orders/${maAnToan(maDon)}/dong/${maAnToan(maDong)}`, than),
      doiMauDong: (maDon, maDong, than) => di("POST", `/api/orders/${maAnToan(maDon)}/dong/${maAnToan(maDong)}/doi-mau`, than),
      lamViecDon: (maDon, viec, ghiChu = "") => di("POST", `/api/orders/${maAnToan(maDon)}/viec`, { viec, ghiChu }),
      ketThucDon: (maDon, cach, lyDo, giuCoc = "") => di("POST", `/api/orders/${maAnToan(maDon)}/ket-thuc`, { cach, lyDo, ...giuCoc === "" ? {} : { giuCoc } }),
      goiYKho: (maDon) => di("GET", `/api/orders/${maAnToan(maDon)}/goi-y-kho`),
      xoaHanDon: (maDon) => di("DELETE", `/api/orders/${maAnToan(maDon)}/vinh-vien`),
      danhSachKhach: (tuKhoa = "", gioiHan = 200) => di("GET", `/api/admin/khach${q({ q: tuKhoa, limit: gioiHan })}`),
      timHang: (tuKhoa = "", gioiHan = 30, loc = {}) => di("GET", `/api/admin/products${q({ q: tuKhoa, limit: gioiHan, size: loc.size ?? "", nguon: loc.nguon ?? "" })}`),
      boGiaTay: (ma) => di("POST", `/api/hang-kho/mon/${maAnToan(ma)}/bo-gia-tay`, {}),
      ghiNoiDungWeb: (ma, than) => di("PUT", `/api/hang-kho/mon/${maAnToan(ma)}/noi-dung-web`, than),
      xemHoanTacHang: () => di("GET", "/api/hang-kho/hoan-tac"),
      hoanTacHang: () => di("POST", "/api/hang-kho/hoan-tac", {}),
      taiAnhHang: (ma, than) => di("POST", `/api/hang-kho/mon/${maAnToan(ma)}/anh`, than),
      taiAnhVe: (than) => di("POST", "/api/hang-kho/tai-anh-ve", than),
      nhapBangHang: (than) => di("POST", "/api/hang-kho/nhap-bang", than),
      doiGiaBienThe: (than) => di("POST", "/api/hang-kho/doi-gia", than),
      chinhSachHangSan: () => di("GET", "/api/hang-kho/chinh-sach-hang-san"),
      ghiChinhSachHangSan: (than) => di("POST", "/api/hang-kho/chinh-sach-hang-san", than),
      tonCuaMa: (ma, size2 = "") => di("GET", `/api/hang-kho/ton/${maAnToan(ma)}${q({ size: size2 })}`),
      ghiHang: (ma, mon) => di("PUT", `/api/hang-kho/mon/${maAnToan(ma)}`, mon),
      xoaHang: (ma) => di("DELETE", `/api/hang-kho/mon/${maAnToan(ma)}`),
      napThemHang: (mon) => di("POST", "/api/hang-kho/nap-them", mon),
      suaNhanhHang: (mon) => di("POST", "/api/hang-kho/sua-nhanh", { mon }),
      hangTheoNguon: (nguon, gioiHan) => di("GET", `/api/hang-kho/theo-nguon/${maAnToan(nguon)}${q({ limit: gioiHan })}`),
      lichSuNapHang: () => di("GET", "/api/hang-kho/lich-su-nap"),
      danhSachDoiTac: () => di("GET", "/api/admin/partners"),
      ghiDoiTac: (doiTac) => di("POST", "/api/admin/partners", doiTac),
      muaHo: (doiTac, gioiHan) => di("GET", `/api/admin/mua-ho${q({ doiTac, limit: gioiHan })}`),
      docCauHinhShop: () => di("GET", "/api/admin/cau-hinh"),
      ghiCauHinhShop: (giaTri) => di("POST", "/api/admin/cau-hinh", { giaTri }),
      khuonNoiDung: () => di("GET", "/api/noi-dung/khuon"),
      danhSachLo: () => di("GET", "/api/noi-dung/lo"),
      taoLo: (than) => di("POST", "/api/noi-dung/lo", than),
      moLo: (ma) => di("GET", `/api/noi-dung/lo/${maAnToan(ma)}`),
      suaBaiLo: (ma, bai, than) => di("PUT", `/api/noi-dung/lo/${maAnToan(ma)}/bai/${maAnToan(bai)}`, than),
      chamLo: (ma) => di("POST", `/api/noi-dung/lo/${maAnToan(ma)}/cham`, {}),
      doiBuocLo: (ma, huong) => di("POST", `/api/noi-dung/lo/${maAnToan(ma)}/buoc`, { huong }),
      lenLichLo: (ma) => di("POST", `/api/noi-dung/lo/${maAnToan(ma)}/len-lich`, {}),
      xinBoNaoViet: (ma, bai) => di("POST", `/api/noi-dung/lo/${maAnToan(ma)}/bai/${maAnToan(bai)}/viet`, {}),
      docNoiDung: () => di("GET", "/api/content"),
      ghiNoiDung: (doi) => di("POST", "/api/content", doi),
      timDiaChi: (tham) => di("GET", `/api/dia-chi/tim${q({ he: tham.he, cap: tham.cap, q: tham.q, tinh: tham.tinh, huyen: tham.huyen })}`),
      doiDiaChiHaiCap: (tham) => di("GET", `/api/dia-chi/doi-hai-cap${q({ tinh: tham.tinh, huyen: tham.huyen, xa: tham.xa })}`),
      traVanDon: (maPhieu) => di("GET", `/api/van-chuyen/tra-cuu/${maAnToan(maPhieu)}`),
      taoVanDonTuDon: (than) => di("POST", "/api/van-chuyen/tao-tu-don", than),
      hopThu: (tuyChon = {}) => di("GET", `/api/facebook/webhook-inbox${q({ since: tuyChon.tu, limit: tuyChon.gioiHan })}`),
      danhSachHoiThoai: (tuyChon) => di("GET", `/api/hop-thu/hoi-thoai${q({ kenh: tuyChon.kenh, loc: tuyChon.loc, q: tuyChon.q, trang: tuyChon.trang, limit: tuyChon.gioiHan })}`),
      moHoiThoai: (ma) => di("GET", `/api/hop-thu/hoi-thoai/${maAnToan(ma)}`),
      danhDauDaDoc: (ma) => di("POST", `/api/hop-thu/hoi-thoai/${maAnToan(ma)}/da-doc`, {}),
      guiTin: (than) => di("POST", "/api/hop-thu/gui", than),
      tinVao: (tin) => di("POST", "/api/hop-thu/tin-vao", { tin }),
      choGui: () => di("GET", "/api/hop-thu/cho-gui"),
      choGuiNhan: (than) => di("POST", "/api/hop-thu/cho-gui/nhan", than),
      choGuiXong: (than) => di("POST", "/api/hop-thu/cho-gui/xong", than),
      canNguoi: () => di("GET", "/api/hop-thu/can-nguoi"),
      canNguoiXong: (maHoiThoai) => di("POST", "/api/hop-thu/can-nguoi/xong", { maHoiThoai }),
      cauHinhHopThu: () => di("GET", "/api/hop-thu/cau-hinh"),
      ghiCauHinhHopThu: (than) => di("POST", "/api/hop-thu/cau-hinh", than),
      baoCao: (soNgay = 14) => di("GET", `/api/bao-cao/tong-quan${q({ ngay: soNgay })}`),
      danhSachCtv: () => di("GET", "/api/admin/ctv"),
      ghiCtv: (than) => di("POST", "/api/admin/ctv", than),
      thietBiCtv: (than) => di("POST", "/api/admin/ctv/thiet-bi", than),
      nhatKyCtv: (maCtv = "") => di("GET", `/api/admin/ctv/nhat-ky${q({ ctv: maCtv, limit: 200 })}`),
      khoHang: () => di("GET", "/api/hang-kho/kho"),
      phieuNhap: (than) => di("POST", "/api/hang-kho/phieu-nhap", than),
      danhSachPhieuNhap: (gioiHan) => di("GET", `/api/hang-kho/phieu-nhap${q({ limit: gioiHan })}`),
      dieuChinhTon: (dong) => di("POST", "/api/hang-kho/dieu-chinh-ton", { dong }),
      chuyenKho: (than) => di("POST", "/api/hang-kho/chuyen-kho", than),
      bienDongKho: (ma, gioiHan) => di("GET", `/api/hang-kho/bien-dong${q({ ma, limit: gioiHan })}`),
      congDoiTac: (maDoiTac) => di("GET", `/api/admin/mua-ho/portal${q({ doiTac: maDoiTac })}`),
      ghiTienDoiTac: (than) => di("POST", "/api/admin/mua-ho/tien", than),
      hoaHongCtv: () => di("GET", "/api/admin/ctv/hoa-hong"),
      thanhToanCtv: (than) => di("POST", "/api/admin/ctv/thanh-toan", than),
      xoaCtv: (ma) => di("POST", "/api/admin/ctv/xoa", { ma }),
      thongKeWeb: (tham) => di("GET", `/api/admin/analytics${q({ days: tham.soNgay, productFrom: tham.tuNgay, productTo: tham.denNgay })}`),
      trangFanpage: () => di("GET", "/api/hop-thu/trang"),
      lienHeHoiThoai: (ma, than) => di("POST", `/api/hop-thu/hoi-thoai/${maAnToan(ma)}/lien-he`, than),
      taiAnhGuiKhach: (duLieuAnh) => di("POST", "/api/admin/fanpage/media", { imageData: duLieuAnh }),
      danhSachHoSoKhach: (tuKhoa, gioiHan) => di("GET", `/api/admin/ho-so-khach${q({ q: tuKhoa, limit: gioiHan })}`),
      hoSoKhach: (ma) => di("GET", `/api/admin/ho-so-khach/${maAnToan(ma)}`),
      hoSoKhachTheoSo: (dienThoai) => di("GET", `/api/admin/ho-so-khach-theo-so${q({ dienThoai })}`),
      ghiHoSoKhach: (than) => di("POST", "/api/admin/ho-so-khach", than),
      ghiDiaChiKhach: (maKhach, than) => di("POST", `/api/admin/ho-so-khach/${maAnToan(maKhach)}/dia-chi`, than),
      xoaDiaChiKhach: (maKhach, maDiaChi) => di("DELETE", `/api/admin/ho-so-khach/${maAnToan(maKhach)}/dia-chi/${maAnToan(maDiaChi)}`),
      duyetKhachDon: (maDon, than) => di("POST", `/api/orders/${maAnToan(maDon)}/duyet-khach`, than),
      capLaiMaTraCuu: (maDon) => di("POST", `/api/orders/${maAnToan(maDon)}/ma-tra-cuu`, {}),
      taoVanDonHangLoat: (than) => di("POST", "/api/van-chuyen/tao-hang-loat", than),
      huyVanDon: (maPhieu) => di("POST", "/api/van-chuyen/huy", { maPhieu }),
      nhanVanDon: (maPhieu) => di("GET", `/api/van-chuyen/nhan/${maAnToan(maPhieu)}`),
      thuKetNoiHang: (hang) => di("POST", "/api/van-chuyen/thu-ket-noi", { hang }),
      dongBoHanhTrinh: (maPhieu) => di("POST", "/api/van-chuyen/dong-bo", maPhieu.length ? { maPhieu } : {}),
      baoCaoVanChuyen: () => di("GET", "/api/van-chuyen/bao-cao"),
      thuTelegram: () => di("POST", "/api/tien/thu-telegram", {}),
      thuFacebook: () => di("POST", "/api/hop-thu/thu-facebook", {}),
      taiChinh: (tham) => di("GET", `/api/tien/tai-chinh${q({ tuNgay: tham.tuNgay, denNgay: tham.denNgay })}`),
      ghiThuChi: (than) => di("POST", "/api/tien/thu-chi", than),
      huyThuChi: (than) => di("POST", "/api/tien/thu-chi/huy", than),
      traTienHangDoiTac: (than) => di("POST", "/api/tien/tra-doi-tac", than),
      soCongNoDoiTac: (tham) => di("GET", `/api/admin/mua-ho/so-cong-no${q({ doiTac: tham.doiTac, tuNgay: tham.tuNgay, denNgay: tham.denNgay })}`),
      suaTienDoiTac: (than) => di("POST", "/api/admin/mua-ho/tien/sua", than),
      huyTienDoiTac: (than) => di("POST", "/api/admin/mua-ho/tien/huy", than),
      muaThayDoiTac: (than) => di("POST", "/api/admin/mua-ho/mua-thay", than),
      bamThayDoiTac: (than) => di("POST", "/api/admin/mua-ho/thay-doi-tac", than),
      nguonChuyenHang: (maDon, maDong) => di("GET", `/api/admin/mua-ho/nguon-chuyen${q({ maDon, maDong })}`),
      chuyenPhieuMua: (than) => di("POST", "/api/admin/mua-ho/chuyen-phieu", than),
      guiDoiTac: (maDon) => di("POST", "/api/admin/mua-ho/gui-doi-tac", { maDon }),
      chinhSachDoiTac: () => di("GET", "/api/admin/mua-ho/chinh-sach"),
      ghiChinhSachDoiTac: (than) => di("POST", "/api/admin/mua-ho/chinh-sach", than),
      suaThanhToanCtv: (than) => di("POST", "/api/admin/ctv/thanh-toan/sua", than),
      huyThanhToanCtv: (than) => di("POST", "/api/admin/ctv/thanh-toan/huy", than),
      cauHinhCtv: () => di("GET", "/api/admin/ctv/cau-hinh"),
      ghiCauHinhCtv: (than) => di("POST", "/api/admin/ctv/cau-hinh", than),
      themChienDichCtv: (than) => di("POST", "/api/admin/ctv/chien-dich", than),
      themQuyTacCtv: (than) => di("POST", "/api/admin/ctv/quy-tac", than)
    };
  }

  // ../omi/packages/omi/src/landing/tham-so.ts
  var TRAN_CHU = 200;
  var TRAN_GHI_CHU = 2e3;
  var TRAN_TIEN = 5e9;
  function chu(o, ten, { batBuoc = false, tran = TRAN_CHU } = {}) {
    const g = o[ten];
    if (g === void 0 || g === null || g === "") {
      if (batBuoc) throw new Error(`Thiếu "${ten}".`);
      return "";
    }
    if (typeof g !== "string") throw new Error(`"${ten}" phải là một chuỗi.`);
    const sach = g.trim();
    if (sach.length > tran) throw new Error(`"${ten}" quá dài (${sach.length} ký tự, trần ${tran}).`);
    return sach;
  }
  function so(o, ten, { macDinh = 0, tran = 1e9 } = {}) {
    const g = o[ten];
    if (g === void 0 || g === null || g === "") return macDinh;
    const n = Number(g);
    if (!Number.isFinite(n) || n < 0) throw new Error(`"${ten}" phải là một số không âm.`);
    if (n > tran) throw new Error(`"${ten}" quá lớn.`);
    return Math.round(n);
  }
  function soCoDau(o, ten, { tran = 1e6 } = {}) {
    const g = o[ten];
    const n = Number(g);
    if (g === void 0 || g === null || g === "" || !Number.isFinite(n)) throw new Error(`"${ten}" phải là một số.`);
    if (Math.abs(n) > tran) throw new Error(`"${ten}" quá lớn.`);
    return Math.round(n);
  }
  function mot(o, ten, cho, macDinh = "") {
    const g = chu(o, ten, { tran: 64 }) || macDinh;
    if (g !== "" && !cho.includes(g)) throw new Error(`"${ten}" = "${g}" không có. Đang mở: ${cho.join(", ")}.`);
    return g;
  }
  function danhSach(o, ten, { tran = 200, cauThieu = "" } = {}) {
    const g = o[ten];
    if (!Array.isArray(g) || g.length === 0) throw new Error(cauThieu || `"${ten}" cần ít nhất một dòng.`);
    if (g.length > tran) throw new Error(`"${ten}" quá nhiều dòng (${g.length}, trần ${tran}).`);
    return g.map((x) => x !== null && typeof x === "object" && !Array.isArray(x) ? x : {});
  }
  function lay(k) {
    return { ok: k.ok, than: k.than, viSao: k.viSao };
  }

  // ../omi/packages/omi/src/landing/viec/ctv-thong-ke-hop-thu.ts
  var NGAY = /^\d{4}-\d{2}-\d{2}$/;
  var TRAN_ANH_DATA_URL = 12 * 1024 * 1024;
  function ngay(t, ten) {
    const g = chu(t, ten, { tran: 10 });
    if (g !== "" && !NGAY.test(g)) throw new Error(`"${ten}" phải dạng 2026-09-17.`);
    return g;
  }
  function viecCtvThongKeHopThu(cong2) {
    return {
      "ctv.hoa-hong": async () => lay(await cong2.hoaHongCtv()),
      "ctv.thanh-toan": async (t) => {
        const soTien = so(t, "soTien", { tran: TRAN_TIEN });
        if (soTien <= 0) throw new Error("Số tiền phải lớn hơn 0.");
        return lay(await cong2.thanhToanCtv({ maCtv: chu(t, "maCtv", { batBuoc: true, tran: 64 }), soTien, ghiChu: chu(t, "ghiChu", { tran: TRAN_GHI_CHU }) }));
      },
      "ctv.xoa": async (t) => lay(await cong2.xoaCtv(chu(t, "ma", { batBuoc: true, tran: 64 }))),
      // Thong ke web: so ngay cua bang theo ngay; khoang ngay chi cho bang san pham (dung nhu Desk).
      "thong-ke.bao-cao": async (t) => {
        const tuNgay = ngay(t, "tuNgay");
        const denNgay = ngay(t, "denNgay");
        return lay(await cong2.thongKeWeb({
          soNgay: so(t, "soNgay", { macDinh: 14, tran: 366 }) || 14,
          ...tuNgay === "" ? {} : { tuNgay },
          ...denNgay === "" ? {} : { denNgay }
        }));
      },
      "hop-thu.trang": async () => lay(await cong2.trangFanpage()),
      "hop-thu.lien-he": async (t) => {
        const dienThoai = chu(t, "dienThoai", { tran: 32 });
        const diaChi2 = chu(t, "diaChi", { tran: 500 });
        if (dienThoai === "" && diaChi2 === "") throw new Error("Nhập số điện thoại hoặc địa chỉ.");
        return lay(await cong2.lienHeHoiThoai(chu(t, "ma", { batBuoc: true, tran: 200 }), { dienThoai, diaChi: diaChi2 }));
      },
      // Anh gui khach (hoa don, QR, anh san pham): chi nhan ANH, dang data URL — may chu tu dat ten tep.
      "hop-thu.anh.tai-len": async (t) => {
        const anh = chu(t, "anh", { batBuoc: true, tran: TRAN_ANH_DATA_URL });
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(anh)) throw new Error("Chỉ gửi được ảnh (png, jpg, webp, gif).");
        return lay(await cong2.taiAnhGuiKhach(anh));
      }
    };
  }

  // ../omi/packages/omi/src/landing/viec/doi-tac-tien.ts
  var LOAI_TIEN_DOI_TAC = ["tra", "phat_sinh"];
  function viecDoiTacTien(cong2) {
    return {
      // Cong nguyen van nhu doi tac thay. Man cua CHU SHOP, nen giu gia von; landing da bo gia ban cho khach.
      "mua-ho.cong": async (t) => lay(await cong2.congDoiTac(chu(t, "doiTac", { batBuoc: true, tran: 64 }))),
      // Tien la thu mat nhat: so tien > 0 chan tai cho; "tra" = da chuyen cho doi tac, "phat_sinh" =
      // chi phi them da thoa thuan (ship ho, phi gui...). Ghi chu bat buoc voi phat sinh.
      "mua-ho.tien": async (t) => {
        const soTien = so(t, "soTien", { tran: TRAN_TIEN });
        if (soTien <= 0) throw new Error("Số tiền phải lớn hơn 0.");
        const loai = mot(t, "loai", LOAI_TIEN_DOI_TAC, "tra");
        const ghiChu = chu(t, "ghiChu", { tran: TRAN_GHI_CHU });
        if (loai === "phat_sinh" && ghiChu === "") throw new Error("Chi phí phát sinh phải ghi là khoản gì.");
        return lay(await cong2.ghiTienDoiTac({ doiTac: chu(t, "doiTac", { batBuoc: true, tran: 64 }), soTien, loai, ghiChu }));
      }
    };
  }

  // ../omi/packages/omi/src/landing/viec/khach-ho-so.ts
  var HE_DIA_CHI = ["ba-cap", "hai-cap"];
  function diaChi(o) {
    return {
      ...chu(o, "ma", { tran: 64 }) === "" ? {} : { ma: chu(o, "ma", { tran: 64 }) },
      nguoiNhan: chu(o, "nguoiNhan", { tran: 190 }),
      dienThoai: chu(o, "dienThoai", { tran: 32 }),
      he: mot(o, "he", HE_DIA_CHI, "ba-cap"),
      tinh: chu(o, "tinh", { tran: 190 }),
      huyen: chu(o, "huyen", { tran: 190 }),
      xa: chu(o, "xa", { tran: 190 }),
      chiTiet: chu(o, "chiTiet", { tran: 255 }),
      ...o.macDinh === true ? { macDinh: true } : {}
    };
  }
  function viecKhachHoSo(cong2) {
    return {
      "khach.ho-so.danh-sach": async (t) => lay(await cong2.danhSachHoSoKhach(chu(t, "tuKhoa", { tran: 120 }), so(t, "gioiHan", { macDinh: 300, tran: 2e3 }) || 300)),
      "khach.ho-so.doc": async (t) => lay(await cong2.hoSoKhach(chu(t, "ma", { batBuoc: true, tran: 64 }))),
      "khach.ho-so.theo-so": async (t) => lay(await cong2.hoSoKhachTheoSo(chu(t, "dienThoai", { batBuoc: true, tran: 32 }))),
      // Chi truong CO MAT moi gui: sua ten khong xoa trang size quen go tuan truoc.
      "khach.ho-so.ghi": async (t) => {
        const than = { ten: chu(t, "ten", { batBuoc: true, tran: 190 }) };
        for (const [k, tran] of [["ma", 64], ["dienThoai", 32], ["email", 190], ["ghiChu", 500], ["sizeQuen", 64], ["formChan", 190], ["monChoi", 190], ["hangThich", 500], ["tomTat", 5e3], ["nguon", 64]]) {
          if (t[k] !== void 0) than[k] = chu(t, k, { tran });
        }
        if (t.diaChiMoi !== void 0 && t.diaChiMoi !== null) {
          if (typeof t.diaChiMoi !== "object" || Array.isArray(t.diaChiMoi)) throw new Error('"diaChiMoi" phải là một địa chỉ.');
          than.diaChiMoi = diaChi(t.diaChiMoi);
        }
        return lay(await cong2.ghiHoSoKhach(than));
      },
      "khach.ho-so.dia-chi.ghi": async (t) => {
        const d = diaChi(t);
        if (d.tinh === "" && d.xa === "" && d.chiTiet === "") throw new Error("Địa chỉ cần ít nhất số nhà hoặc tỉnh/xã.");
        return lay(await cong2.ghiDiaChiKhach(chu(t, "maKhach", { batBuoc: true, tran: 64 }), d));
      },
      "khach.ho-so.dia-chi.xoa": async (t) => lay(await cong2.xoaDiaChiKhach(chu(t, "maKhach", { batBuoc: true, tran: 64 }), chu(t, "ma", { batBuoc: true, tran: 64 }))),
      // Duyet khach: CHON mot ho so, hoac TAO moi tu don — khong co lua chon thu ba.
      "don.duyet-khach": async (t) => {
        const maKhach = chu(t, "maKhach", { tran: 64 });
        if (maKhach === "" && t.moi !== true) throw new Error("Chọn một hồ sơ khách hoặc tạo hồ sơ mới.");
        return lay(await cong2.duyetKhachDon(chu(t, "maDon", { batBuoc: true, tran: 64 }), maKhach === "" ? { moi: true } : { maKhach }));
      },
      "don.ma-tra-cuu": async (t) => lay(await cong2.capLaiMaTraCuu(chu(t, "maDon", { batBuoc: true, tran: 64 })))
    };
  }

  // ../omi/packages/omi/src/landing/viec/hang-hoa.ts
  var MA_HANG = { batBuoc: true, tran: 128 };
  var TRAN_ANH_BASE64 = 12 * 1024 * 1024;
  var TRAN_CSV = 4 * 1024 * 1024;
  var TRAN_NOI_DUNG = 200 * 1024;
  function dsChu(g, ten, tran = 60) {
    if (g === void 0 || g === null) return [];
    if (!Array.isArray(g)) throw new Error(`"${ten}" phải là một danh sách.`);
    const ds = g.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (ds.length > tran) throw new Error(`"${ten}" quá nhiều ý (${ds.length}, trần ${tran}).`);
    return ds.map((x) => x.slice(0, 2e3));
  }
  function viecHangHoa(cong2) {
    return {
      // "Dung lai gia nguon" (Desk reset-landing-manual-price).
      "hang.ve-gia-nguon": async (t) => lay(await cong2.boGiaTay(chu(t, "ma", MA_HANG))),
      // "Luu noi dung web" (Desk save-product-web-fields): SEO + noi dung trang san pham. Khong gia, khong ton.
      "hang.noi-dung-web": async (t) => {
        const ma = chu(t, "ma", MA_HANG);
        const n = t.noiDung ?? {};
        if (typeof n !== "object" || Array.isArray(n)) throw new Error('"noiDung" phải là một đối tượng.');
        const rieng = n.rieng ?? {};
        const noiDung = {
          dongSanPham: chu(n, "dongSanPham", { tran: 190 }),
          tuKhoaDong: dsChu(n.tuKhoaDong, "tuKhoaDong"),
          gioiThieu: chu(n, "gioiThieu", { tran: 2e4 }),
          tinhNang: dsChu(n.tinhNang, "tinhNang"),
          congNghe: dsChu(n.congNghe, "congNghe"),
          phuHopVoi: dsChu(n.phuHopVoi, "phuHopVoi"),
          khongNenNeu: dsChu(n.khongNenNeu, "khongNenNeu"),
          huongDanFit: chu(n, "huongDanFit", { tran: 5e3 }),
          ghiChuSize: chu(n, "ghiChuSize", { tran: 5e3 }),
          rieng: {
            cheDo: mot(rieng, "cheDo", ["append", "replace"], "append"),
            gioiThieu: chu(rieng, "gioiThieu", { tran: 2e4 }),
            tinhNang: dsChu(rieng.tinhNang, "rieng.tinhNang"),
            ghiChu: dsChu(rieng.ghiChu, "rieng.ghiChu"),
            ghiChuSize: chu(rieng, "ghiChuSize", { tran: 5e3 })
          },
          ...n.baiSeo !== void 0 && n.baiSeo !== null ? { baiSeo: n.baiSeo } : {}
        };
        if (JSON.stringify(noiDung).length > TRAN_NOI_DUNG) throw new Error("Nội dung web quá dài (trần 200 KB).");
        return lay(await cong2.ghiNoiDungWeb(ma, {
          seoTitle: chu(t, "seoTitle", { tran: 255 }),
          seoDescription: chu(t, "seoDescription", { tran: 500 }),
          seoKeywords: chu(t, "seoKeywords", { tran: 500 }),
          noiDung
        }));
      },
      "hang.hoan-tac.xem": async () => lay(await cong2.xemHoanTacHang()),
      "hang.hoan-tac": async () => lay(await cong2.hoanTacHang()),
      // Anh tu may shop: data URL anh (png/jpeg/webp/gif). Landing tu dat ten, tu kiem la anh that.
      "hang.tai-anh": async (t) => {
        const ma = chu(t, "ma", MA_HANG);
        const anh = chu(t, "anh", { batBuoc: true, tran: TRAN_ANH_BASE64 });
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(anh)) throw new Error("Ảnh phải là tệp .jpg, .png, .webp hoặc .gif.");
        return lay(await cong2.taiAnhHang(ma, { anh, chinh: t.chinh === true }));
      },
      // "Tai gallery anh" (Desk cache-product-images): mot mon, hoac ca danh muc (landing gioi han moi lan).
      "hang.tai-anh-ve": async (t) => {
        const ma = chu(t, "ma", { tran: 128 });
        if (ma === "" && t.tatCa !== true) throw new Error("Chọn một sản phẩm, hoặc bấm tải gallery toàn bộ.");
        return lay(await cong2.taiAnhVe(ma === "" ? {} : { ma }));
      },
      // DONG BO KHO bang bang: CSV dan tay HOAC link Google Sheet public; he size; hang shop / doi tac.
      "hang.nhap-bang": async (t) => {
        const csv = chu(t, "csv", { tran: TRAN_CSV });
        const sheetUrl = chu(t, "sheetUrl", { tran: 2e3 });
        if (csv === "" && sheetUrl === "") throw new Error("Dán CSV hoặc link Google Sheet trước.");
        if (sheetUrl !== "" && !/^https?:\/\//i.test(sheetUrl)) throw new Error("Link Google Sheet phải bắt đầu bằng http(s).");
        const nguon = mot(t, "nguon", ["own", "partner"], "own");
        const tenNguon = chu(t, "tenNguon", { tran: 100 });
        if (nguon === "partner" && tenNguon === "") throw new Error("Nhập tên đối tác cho hàng của đối tác.");
        return lay(await cong2.nhapBangHang({
          ...sheetUrl === "" ? { csv } : { sheetUrl },
          heSize: mot(t, "heSize", ["EU", "US_MEN", "UK"], "EU"),
          nguon,
          tenNguon,
          xemTruoc: t.xemTruoc === true
        }));
      },
      // Kho hang san "Doi gia" (Desk rs-price): mot size, mot kho, mot nguon.
      "hang.doi-gia": async (t) => {
        const gia = so(t, "gia", { tran: TRAN_TIEN });
        if (gia <= 0) throw new Error("Giá bán mới phải lớn hơn 0.");
        return lay(await cong2.doiGiaBienThe({
          ma: chu(t, "ma", MA_HANG),
          size: chu(t, "size", { batBuoc: true, tran: 32 }),
          maKho: chu(t, "maKho", { batBuoc: true, tran: 128 }),
          nguon: mot(t, "nguon", ["own", "ready", "campaign"], "ready"),
          gia
        }));
      },
      "hang.chinh-sach-hang-san": async () => lay(await cong2.chinhSachHangSan()),
      "hang.ghi-chinh-sach-hang-san": async (t) => lay(await cong2.ghiChinhSachHangSan({
        tomTat: chu(t, "tomTat", { tran: 2e3 }),
        choCod: t.choCod !== false,
        phanTramCoc: so(t, "phanTramCoc", { tran: 100 })
      })),
      // Desk toggle-product-web-status: dua len web chi khi con size co hang.
      "hang.bat-tat-web": async (t) => {
        const ma = chu(t, "ma", MA_HANG);
        const hien = t.hien === true;
        if (hien) {
          const k = await cong2.timHang(ma, 20);
          if (!k.ok) return lay(k);
          const mon = (Array.isArray(k.than) ? k.than : []).find((m) => String(m.code ?? "").toLowerCase() === ma.toLowerCase());
          if (mon === void 0) throw new Error(`Không có sản phẩm mã "${ma}".`);
          const conHang = (Array.isArray(mon.sizes) ? mon.sizes : []).some((s) => Number(s.qty ?? 0) > 0);
          if (!conHang) throw new Error("Sản phẩm chưa có size còn hàng. Hãy mở sản phẩm, nhập tồn size rồi mới đẩy lên web.");
        }
        return lay(await cong2.suaNhanhHang([{ ma, trangThai: hien ? "orderable" : "hidden" }]));
      }
    };
  }

  // ../omi/packages/omi/src/landing/viec/kho.ts
  var NGUON_TON = ["own", "ready", "campaign"];
  var maHang = (o) => chu(o, "ma", { batBuoc: true, tran: 128 });
  var size = (o) => chu(o, "size", { batBuoc: true, tran: 32 });
  var maKho = (o, ten = "maKho") => chu(o, ten, { batBuoc: true, tran: 128 });
  function viecKho(cong2) {
    return {
      "hang.kho": async () => lay(await cong2.khoHang()),
      // PHIEU NHAP: nhieu dong, moi dong mot ma + size + kho + so doi + gia von. May chu cong ton va
      // ghi so trong MOT luot — phieu hong mot dong la hong ca phieu.
      "hang.phieu-nhap": async (t) => {
        const dong = danhSach(t, "dong", { tran: 500, cauThieu: "Phiếu nhập cần ít nhất một dòng (mã, size, kho, số lượng)." }).map((o, i) => {
          const soLuong = so(o, "soLuong", { tran: 1e5 });
          if (soLuong < 1) throw new Error(`Dòng ${i + 1}: số lượng phải từ 1.`);
          const nguon = mot(o, "nguon", NGUON_TON);
          return {
            ma: maHang(o),
            size: size(o),
            maKho: maKho(o),
            soLuong,
            giaVon: so(o, "giaVon", { tran: TRAN_TIEN }),
            ghiChu: chu(o, "ghiChu", { tran: 300 }),
            ...nguon === "" ? {} : { nguon }
          };
        });
        return lay(await cong2.phieuNhap({ nhaCungCap: chu(t, "nhaCungCap", { tran: 190 }), ghiChu: chu(t, "ghiChu", { tran: TRAN_GHI_CHU }), dong }));
      },
      "hang.ds-phieu-nhap": async (t) => lay(await cong2.danhSachPhieuNhap(so(t, "gioiHan", { macDinh: 50, tran: 500 }) || 50)),
      // ±SL: so co dau. 0 la vo nghia, chan tai cho. Ly do bat buoc — sau nay doc so kho, "vi sao
      // hut 2 doi" chi con dong nay tra loi.
      "hang.dieu-chinh": async (t) => {
        const dong = danhSach(t, "dong", { tran: 1e3, cauThieu: "Chưa có dòng nào để điều chỉnh." }).map((o, i) => {
          const soLuong = soCoDau(o, "soLuong");
          if (soLuong === 0) throw new Error(`Dòng ${i + 1}: số lượng điều chỉnh phải khác 0.`);
          const ghiChu = chu(o, "ghiChu", { batBuoc: true, tran: 300 });
          const nguon = mot(o, "nguon", NGUON_TON);
          return { ma: maHang(o), size: size(o), maKho: maKho(o), soLuong, ghiChu, ...nguon === "" ? {} : { nguon } };
        });
        return lay(await cong2.dieuChinhTon(dong));
      },
      "hang.chuyen-kho": async (t) => {
        const tuKho = maKho(t, "tuKho");
        const denKho = maKho(t, "denKho");
        if (tuKho === denKho) throw new Error("Kho đi và kho đến phải khác nhau.");
        const soLuong = so(t, "soLuong", { tran: 1e5 });
        if (soLuong < 1) throw new Error("Số lượng chuyển phải từ 1.");
        const tuNguon = mot(t, "tuNguon", NGUON_TON);
        const denNguon = mot(t, "denNguon", NGUON_TON);
        return lay(await cong2.chuyenKho({
          ma: maHang(t),
          size: size(t),
          tuKho,
          denKho,
          soLuong,
          ghiChu: chu(t, "ghiChu", { tran: 300 }),
          ...tuNguon === "" ? {} : { tuNguon },
          ...denNguon === "" ? {} : { denNguon }
        }));
      },
      "hang.bien-dong": async (t) => lay(await cong2.bienDongKho(chu(t, "ma", { tran: 128 }), so(t, "gioiHan", { macDinh: 50, tran: 2e3 }) || 50))
    };
  }

  // ../omi/packages/omi/src/landing/viec/van-don.ts
  var HANG = ["spx", "vtp"];
  var MA_PHIEU = { batBuoc: true, tran: 80 };
  function viecVanDon(cong2) {
    return {
      // Hang loat: toi da 50 phieu, moi phieu la mot DON hoac mot KIEN cua don.
      "van-don.tao-hang-loat": async (t) => {
        const phieu = danhSach(t, "phieu", { tran: 50, cauThieu: "Chưa chọn đơn nào để tạo vận đơn." }).map((o) => {
          const maKien = chu(o, "maKien", { tran: 80 });
          return { maDon: chu(o, "maDon", { batBuoc: true, tran: 64 }), ...maKien === "" ? {} : { maKien } };
        });
        const hang = mot(t, "hang", HANG);
        return lay(await cong2.taoVanDonHangLoat({ phieu, ...hang === "" ? {} : { hang } }));
      },
      "van-don.huy": async (t) => lay(await cong2.huyVanDon(chu(t, "maPhieu", MA_PHIEU))),
      "van-don.nhan": async (t) => lay(await cong2.nhanVanDon(chu(t, "maPhieu", MA_PHIEU))),
      "van-don.thu-ket-noi": async (t) => lay(await cong2.thuKetNoiHang(mot(t, "hang", HANG, "spx"))),
      "van-don.dong-bo": async (t) => {
        const list = Array.isArray(t.maPhieu) ? t.maPhieu.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
        if (list.length > 200) throw new Error("Tối đa 200 vận đơn một lần đồng bộ.");
        return lay(await cong2.dongBoHanhTrinh(list));
      },
      "van-don.bao-cao": async () => lay(await cong2.baoCaoVanChuyen()),
      "tien.thu-telegram": async () => lay(await cong2.thuTelegram()),
      "hop-thu.thu-facebook": async () => lay(await cong2.thuFacebook())
    };
  }

  // ../omi/packages/omi/src/landing/viec/tai-chinh-doi-tac.ts
  var NHOM_THU_CHI = ["shipping", "packaging", "advertising", "software", "salary", "refund", "other_income", "other_expense"];
  var MA = { batBuoc: true, tran: 64 };
  function ngay2(t, ten) {
    const g = chu(t, ten, { tran: 10 });
    if (g !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(g)) throw new Error(`"${ten}" phải có dạng YYYY-MM-DD.`);
    return g;
  }
  function tienDuong(t, ten = "soTien") {
    const n = so(t, ten, { tran: TRAN_TIEN });
    if (n <= 0) throw new Error("Số tiền phải lớn hơn 0.");
    return n;
  }
  function viecTaiChinhDoiTac(cong2) {
    return {
      // ----- tai chinh -----
      "tai-chinh.bao-cao": async (t) => lay(await cong2.taiChinh({ tuNgay: ngay2(t, "tuNgay"), denNgay: ngay2(t, "denNgay") })),
      "tai-chinh.thu-chi": async (t) => lay(await cong2.ghiThuChi({
        loai: mot(t, "loai", ["thu", "chi"], "chi"),
        nhom: mot(t, "nhom", NHOM_THU_CHI, "other_expense"),
        soTien: tienDuong(t),
        maDon: chu(t, "maDon", { tran: 64 }),
        ghiChu: chu(t, "ghiChu", { tran: 500 })
      })),
      "tai-chinh.huy-thu-chi": async (t) => lay(await cong2.huyThuChi({ ma: chu(t, "ma", MA), lyDo: chu(t, "lyDo", { tran: 255 }) })),
      // Tien HANG tra doi tac: ghi vao so, gan doi tac — landing KHONG tinh la chi phi (da nam trong gia von).
      "tai-chinh.tra-doi-tac": async (t) => lay(await cong2.traTienHangDoiTac({
        doiTac: chu(t, "doiTac", MA),
        soTien: tienDuong(t),
        ghiChu: chu(t, "ghiChu", { tran: 500 })
      })),
      // ----- doi tac -----
      "mua-ho.so-cong-no": async (t) => lay(await cong2.soCongNoDoiTac({ doiTac: chu(t, "doiTac", { tran: 64 }), tuNgay: ngay2(t, "tuNgay"), denNgay: ngay2(t, "denNgay") })),
      "mua-ho.sua-tien": async (t) => lay(await cong2.suaTienDoiTac({ ma: chu(t, "ma", MA), soTien: tienDuong(t), ghiChu: chu(t, "ghiChu", { tran: 255 }) })),
      "mua-ho.huy-tien": async (t) => lay(await cong2.huyTienDoiTac({ ma: chu(t, "ma", MA), lyDo: chu(t, "lyDo", { tran: 255 }) })),
      "mua-ho.mua-thay": async (t) => {
        const soLuong = so(t, "soLuong", { tran: 1e3 });
        if (soLuong <= 0) throw new Error("Số lượng mua được phải lớn hơn 0.");
        return lay(await cong2.muaThayDoiTac({
          doiTac: chu(t, "doiTac", MA),
          maMon: chu(t, "maMon", { batBuoc: true, tran: 128 }),
          size: chu(t, "size", { tran: 64 }),
          soLuong,
          giaVon: tienDuong(t, "giaVon"),
          ghiChu: chu(t, "ghiChu", { tran: 255 })
        }));
      },
      "mua-ho.thay-doi-tac": async (t) => {
        const viec = mot(t, "viec", ["xac-nhan", "het-hang"]);
        if (viec === "") throw new Error('Thiếu "viec".');
        return lay(await cong2.bamThayDoiTac({ maDon: chu(t, "maDon", MA), viec, lyDo: chu(t, "lyDo", { tran: 255 }) }));
      },
      "mua-ho.nguon-chuyen": async (t) => lay(await cong2.nguonChuyenHang(chu(t, "maDon", MA), chu(t, "maDong", { batBuoc: true, tran: 128 }))),
      "mua-ho.chuyen-phieu": async (t) => {
        const maPhieu = chu(t, "maPhieu", { tran: 80 });
        if (maPhieu !== "") return lay(await cong2.chuyenPhieuMua({ maPhieu, doiTacMoi: chu(t, "doiTacMoi", MA) }));
        return lay(await cong2.chuyenPhieuMua({
          maDonDich: chu(t, "maDonDich", MA),
          maDongDich: chu(t, "maDongDich", { batBuoc: true, tran: 128 }),
          maDonNguon: chu(t, "maDonNguon", MA),
          soLuong: so(t, "soLuong", { tran: 1e3 }) || 1
        }));
      },
      "mua-ho.gui-doi-tac": async (t) => lay(await cong2.guiDoiTac(chu(t, "maDon", MA))),
      "mua-ho.chinh-sach": async () => lay(await cong2.chinhSachDoiTac()),
      "mua-ho.ghi-chinh-sach": async (t) => lay(await cong2.ghiChinhSachDoiTac({
        ma: chu(t, "ma", { tran: 128 }),
        ten: chu(t, "ten", { batBuoc: true, tran: 120 }),
        noiDung: chu(t, "noiDung", { tran: 4e3 }),
        ghiChu: chu(t, "ghiChu", { tran: TRAN_GHI_CHU })
      })),
      // ----- CTV -----
      "ctv.sua-thanh-toan": async (t) => lay(await cong2.suaThanhToanCtv({ ma: chu(t, "ma", MA), soTien: tienDuong(t), ghiChu: chu(t, "ghiChu", { tran: 255 }) })),
      "ctv.huy-thanh-toan": async (t) => lay(await cong2.huyThanhToanCtv({ ma: chu(t, "ma", MA), lyDo: chu(t, "lyDo", { tran: 255 }) })),
      "ctv.cau-hinh": async () => lay(await cong2.cauHinhCtv()),
      "ctv.ghi-cau-hinh": async (t) => {
        const list = (ten) => {
          const g = t[ten];
          if (g === void 0) return void 0;
          if (!Array.isArray(g) || g.length > 500) throw new Error(`"${ten}" phải là danh sách (tối đa 500).`);
          return g.filter((x) => x !== null && typeof x === "object");
        };
        const campaigns = list("campaigns");
        const rules = list("rules");
        return lay(await cong2.ghiCauHinhCtv({ ...campaigns ? { campaigns } : {}, ...rules ? { rules } : {} }));
      },
      "ctv.them-chien-dich": async (t) => lay(await cong2.themChienDichCtv({
        ten: chu(t, "ten", { batBuoc: true, tran: 190 }),
        ma: chu(t, "ma", { batBuoc: true, tran: 60 }),
        phamVi: chu(t, "phamVi", { tran: 190 }),
        ghiChu: chu(t, "ghiChu", { tran: 1e3 })
      })),
      "ctv.them-quy-tac": async (t) => lay(await cong2.themQuyTacCtv({
        maSanPham: chu(t, "maSanPham", { batBuoc: true, tran: 128 }),
        giaTri: tienDuong(t, "giaTri"),
        loai: mot(t, "loai", ["fixed", "percent"], "fixed")
      }))
    };
  }

  // ../omi/packages/omi/src/landing/ban-dieu-hanh.ts
  var TEN_MANH = {
    "hang-kho": "Hàng hoá & kho",
    "don-khach": "Đơn hàng & khách",
    "lien-ket": "Liên kết tài khoản",
    "van-chuyen": "Vận chuyển",
    "tien": "Tiền & đối soát",
    "mua-ho": "Mua hộ",
    "gian-hang": "Gian hàng & CTV",
    "xuong-noi-dung": "Xưởng nội dung",
    "xuong-video": "Xưởng video",
    "goi-noi-dung": "Gói nội dung",
    "hop-thu": "Hộp thư đa kênh",
    "chatbot-cskh": "Chatbot chăm sóc khách",
    "nhu-cau-cho": "Nhu cầu chờ & báo cáo"
  };
  var LOAI_SAN_PHAM = ["shoe", "apparel", "accessory", "bag", "hat", "sock", "other"];
  var VIEC_NHANH = ["xac-nhan", "san-sang-giao", "cho-ship-bat-buoc", "hoan-tat", "hoan-tac"];
  var NHOM_QUY_TRINH = [
    "workflow_new",
    "workflow_stock",
    "workflow_payment",
    "workflow_purchase",
    "workflow_delivery",
    "workflow_completed",
    "workflow_attention",
    "cancelled",
    // Đ2: hai loc cua o trang thai Desk (`landingOrderStatusOptions`) khong phai tab.
    "chua-gan-kho",
    "o-doi-tac"
  ];
  function donGon(don) {
    const mon = Array.isArray(don.items) ? don.items : [];
    return {
      id: String(don.id ?? ""),
      khach: String(don.customerName ?? ""),
      dienThoai: String(don.phone ?? ""),
      tinh: String(don.province ?? ""),
      tong: Number(don.total ?? 0),
      daTra: Number(don.paidAmount ?? 0),
      conPhaiTra: Number(don.remainingAmount ?? 0),
      trangThai: String(don.status ?? ""),
      trangThaiTien: String(don.paymentStatus ?? ""),
      trangThaiGiao: String(don.fulfillmentStatus ?? ""),
      maVanDon: String(don.trackingCode ?? ""),
      soMon: mon.length,
      // Tu 16/09/2026: don xoa roi van doc duoc — man hinh ve no o tab "Da xoa", mo hon, co nut
      // Khoi phuc. Man hinh phai biet don nao dang o thung rac de khong ve nut xoa lan nua.
      daXoa: don.daXoa === true,
      // Tab nao dang chua don nay — MAY CHU tinh, man hinh khong tu suy. Mot don co the o HAI tab
      // (dang mua ma khach chua CK), nen day la mot DANH SACH.
      trangThaiQuyTrinh: Array.isArray(don.trangThaiQuyTrinh) ? don.trangThaiQuyTrinh.map(String) : [],
      // Kien: don co hang o hai kho di lam hai kien, hai van don, hai lan thu COD. Rong = mot kien
      // nhu thuong. Khong co nut "tach kien" — kien tu theo viec moi dong thuoc kho nao.
      kien: Array.isArray(don.kien) ? don.kien.map((k) => ({
        maKien: String(k.maKien ?? ""),
        thuTu: Number(k.thuTu ?? 0),
        tenKho: String(k.tenKho ?? ""),
        soMon: Array.isArray(k.mon) ? k.mon.length : 0,
        giaTriHang: Number(k.giaTriHang ?? 0),
        cod: Number(k.cod ?? 0)
      })) : [],
      // Nut nao hien tren dong nay — MAY CHU quyet dinh, va chinh luat do gac cua ghi. Man hinh an
      // mot nut trong khi may chu van cho goi la hai su that; o day chi co mot.
      viecLamDuoc: Array.isArray(don.viecLamDuoc) ? don.viecLamDuoc.map(String) : [],
      epChoShip: don.epChoShip === true,
      // Ho so khach trong so cua chu shop. Rong = don web "cho duyet khach" (Đ2).
      maKhach: String(don.customerProfileId ?? ""),
      // MON NGAY TRONG DONG DON. Man Danh sach don cua Desk ve cum mua ho (chon kho, day mua) ngay
      // tren tung dong hang cua tung don — khong phai mo don ra moi thay. Ban nay du de ve cum do
      // va KHONG mang gia von: bang danh sach la thu de nhin nhat, cang it thu quy cang tot.
      mon: mon.map((m) => ({
        maDong: String(m.maDong ?? ""),
        ma: String(m.productCode ?? ""),
        ten: String(m.productName ?? ""),
        size: String(m.size ?? ""),
        soLuong: Number(m.qty ?? m.quantity ?? 1),
        kho: String(m.warehouseName ?? m.warehouse ?? ""),
        maKho: String(m.warehouseId ?? ""),
        maDoiTac: String(m.partnerId ?? ""),
        trangThaiMua: String(m.procurementStatus ?? ""),
        dayMua: m.purchaseAuthorized === true,
        daMua: Number(m.daMua ?? 0),
        canMua: Number(m.canMua ?? 0),
        daMuaDu: m.daMuaDu === true,
        khoaKho: m.khoaKho === true,
        loaiSanPham: String(m.productKind ?? "")
      })),
      taoLuc: String(don.createdAt ?? "")
    };
  }
  function donGiao(don) {
    const mon = Array.isArray(don.items) ? don.items : [];
    return {
      ...donGon(don),
      huyen: String(don.district ?? ""),
      xa: String(don.ward ?? ""),
      diaChi: String(don.addressDetail ?? don.address ?? ""),
      ghiChu: String(don.note ?? ""),
      hangVanChuyen: String(don.shippingProvider ?? ""),
      trangThaiGiao: String(don.fulfillmentStatus ?? ""),
      // Đ3: nguoi tra ship + cach giao (trinh soan don Đ2) va van don cua tung kien.
      nguoiTraShip: String(don.shippingPayer ?? ""),
      cachGiao: String(don.deliveryMethod ?? ""),
      vanDonKien: Array.isArray(don.vanDonKien) ? don.vanDonKien.map((k) => ({
        maKien: String(k.maKien ?? ""),
        maVanDon: String(k.maVanDon ?? ""),
        hang: String(k.hang ?? ""),
        trangThaiGiao: String(k.trangThaiGiao ?? "")
      })) : [],
      // COD = con phai tra, KHONG bao gio la tong: don da coc 20% ma thu ca tong la thu hai lan.
      cod: Number(don.remainingAmount ?? 0),
      tenMon: mon.map((m) => {
        const ten = String(m.productName ?? m.productCode ?? "").trim();
        return ten === "" ? "" : `${ten}${m.size ? ` size ${String(m.size)}` : ""} x${Number(m.qty ?? m.quantity ?? 1)}`;
      }).filter((x) => x !== "").join("; ")
    };
  }
  function donDayDu(don) {
    const mon = Array.isArray(don.items) ? don.items : [];
    const nhatKy = Array.isArray(don.statusLogs) ? don.statusLogs : [];
    return {
      ...donGon(don),
      email: String(don.email ?? ""),
      diaChi: String(don.address ?? ""),
      // Ba cap + so nha rieng: form sua don dien lai dung o goi y dia chi (Đ1, 17/09).
      huyen: String(don.district ?? ""),
      xa: String(don.ward ?? ""),
      diaChiChiTiet: String(don.addressDetail ?? ""),
      // Đ2: trinh soan don ve lai dung khung Thanh toan + Giao hang.
      tongTienHang: Number(don.subtotal ?? 0),
      loaiChietKhau: String(don.discountType ?? "money"),
      chietKhau: Number(don.discountValue ?? 0),
      phiShip: Number(don.shippingFee ?? 0),
      nguoiTraShip: String(don.shippingPayer ?? ""),
      cachGiao: String(don.deliveryMethod ?? ""),
      nhan: String(don.tags ?? ""),
      ghiChuGiao: String(don.shippingNote ?? ""),
      ghiChu: String(don.note ?? ""),
      maChuyenKhoan: String(don.paymentReference ?? ""),
      phuongThucTra: String(don.paymentMethod ?? ""),
      soTienTra: Number(don.paymentAmount ?? 0),
      hangVanChuyen: String(don.shippingProvider ?? ""),
      mon: mon.map((m) => ({
        // MA DONG: khoa on dinh cua dong don (`<ma don>#<bien the|so thu tu>`). Moi thao tac mua ho
        // (chon kho, day mua) gui len bang ma nay, khong bao gio bang VI TRI trong danh sach.
        maDong: String(m.maDong ?? ""),
        ma: String(m.productCode ?? ""),
        ten: String(m.productName ?? ""),
        size: String(m.size ?? ""),
        soLuong: Number(m.qty ?? m.quantity ?? 1),
        donGia: Number(m.price ?? 0),
        // Ten kho CO o day: day la man cua CHU SHOP, khong phai cau gui khach.
        kho: String(m.warehouseName ?? m.warehouse ?? ""),
        maKho: String(m.warehouseId ?? ""),
        // Cum mua ho: man hinh ve nut theo nhung so nay, khong tu tinh lay.
        maDoiTac: String(m.partnerId ?? ""),
        trangThaiMua: String(m.procurementStatus ?? ""),
        dayMua: m.purchaseAuthorized === true,
        daMua: Number(m.daMua ?? 0),
        canMua: Number(m.canMua ?? 0),
        daMuaDu: m.daMuaDu === true,
        khoaKho: m.khoaKho === true,
        loaiSanPham: String(m.productKind ?? ""),
        // GIA VON: chi man cua chu shop thay. Khong bao gio ra cau gui khach, khong ra ban cong khai.
        giaVon: Number(m.costPrice ?? 0),
        loaiChietKhau: String(m.discountType ?? "money"),
        chietKhau: Number(m.discountValue ?? 0)
      })),
      nhatKy: nhatKy.map((n) => ({
        trangThai: String(n.status ?? ""),
        boi: String(n.actorType ?? ""),
        ghiChu: String(n.note ?? ""),
        luc: String(n.createdAt ?? "")
      }))
    };
  }
  function hangGon(mon) {
    const size2 = Array.isArray(mon.sizes) ? mon.sizes : [];
    return {
      ma: String(mon.code ?? ""),
      ten: String(mon.name ?? ""),
      hang: String(mon.brand ?? ""),
      nguon: String(mon.sourceName ?? ""),
      gia: Number(mon.price ?? mon.suggestedPrice ?? 0),
      giaNiemYet: Number(mon.listPrice ?? 0),
      giamGia: Number(mon.discountPercent ?? 0),
      trangThai: String(mon.status ?? ""),
      // Đ5: du de ve the "Sua nhanh web" nhu Desk — loai, mon, gioi tinh, anh, gia tay / gia nguon.
      loai: String(mon.productKind ?? ""),
      nhom: String(mon.category ?? ""),
      gioiTinh: String(mon.gender ?? ""),
      anh: [mon.thumbnailImage, mon.highImage, ...Array.isArray(mon.galleryImages) ? mon.galleryImages : []].map((x) => String(x ?? "")).find((x) => x !== "") ?? "",
      soAnh: new Set([mon.thumbnailImage, mon.highImage, ...Array.isArray(mon.galleryImages) ? mon.galleryImages : []].map((x) => String(x ?? "")).filter((x) => x !== "")).size,
      giaTay: Number(mon.manualPrice ?? 0),
      giaNguon: Number(mon.sourcePrice ?? 0),
      cheDoGia: String(mon.priceMode ?? "source"),
      canhBaoGia: String(mon.priceWarning ?? ""),
      tonTong: size2.reduce((t, d) => t + Number(d.qty ?? 0), 0),
      size: size2.map((d) => ({
        size: String(d.size ?? ""),
        ton: Number(d.qty ?? 0),
        gia: Number(d.price ?? 0),
        kho: String(d.warehouseName ?? d.warehouse ?? d.warehouseId ?? ""),
        // Ma kho (khong phai ten): phieu nhap / dieu chinh ton ghi theo ma nay.
        maKho: String(d.warehouseId ?? ""),
        nguon: String(d.nguon ?? d.source ?? "")
      }))
    };
  }
  function hangDayDu(mon) {
    const size2 = Array.isArray(mon.sizes) ? mon.sizes : [];
    return {
      code: String(mon.code ?? ""),
      name: String(mon.name ?? ""),
      brand: String(mon.brand ?? ""),
      gender: String(mon.gender ?? ""),
      category: String(mon.category ?? ""),
      productKind: String(mon.productKind ?? ""),
      listPrice: Number(mon.listPrice ?? 0),
      discountPercent: Number(mon.discountPercent ?? 0),
      status: String(mon.status ?? ""),
      thumbnailImage: String(mon.thumbnailImage ?? ""),
      highImage: String(mon.highImage ?? ""),
      galleryImages: Array.isArray(mon.galleryImages) ? mon.galleryImages.map(String) : [],
      shortDescription: String(mon.shortDescription ?? ""),
      description: String(mon.description ?? ""),
      sourceName: String(mon.sourceName ?? ""),
      division: String(mon.division ?? ""),
      slug: String(mon.slug ?? ""),
      seoTitle: String(mon.seoTitle ?? ""),
      seoDescription: String(mon.seoDescription ?? ""),
      seoKeywords: String(mon.seoKeywords ?? ""),
      policy: String(mon.policy ?? ""),
      webContent: mon.webContent !== null && typeof mon.webContent === "object" && !Array.isArray(mon.webContent) ? mon.webContent : {},
      manualPrice: Number(mon.manualPrice ?? 0),
      sourcePrice: Number(mon.sourcePrice ?? 0),
      priceMode: String(mon.priceMode ?? "source"),
      priceWarning: String(mon.priceWarning ?? ""),
      price: Number(mon.price ?? 0),
      sizes: size2.map((d) => ({
        size: String(d.size ?? ""),
        qty: Number(d.qty ?? 0),
        price: Number(d.price ?? 0),
        listPrice: Number(d.listPrice ?? 0),
        warehouseId: String(d.warehouseId ?? ""),
        nguon: String(d.nguon ?? ""),
        sku: String(d.sku ?? ""),
        costPrice: Number(d.costPrice ?? 0),
        sourcePrice: Number(d.sourcePrice ?? d.price ?? 0)
      }))
    };
  }
  function laAnhHopLe(u) {
    return /^https?:\/\//i.test(u) || /^\/api\/hang-kho\/anh\/[A-Za-z0-9._-]+$/.test(u);
  }
  var TRAN_SIZE = 200;
  var TRAN_SUA_NHANH = 1e3;
  var TRAN_ANH = 2e3;
  function monTuThamSo(t) {
    const code = chu(t, "code", { batBuoc: true, tran: 128 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(code)) throw new Error(`Mã hàng "${code}" chỉ được chữ, số, chấm, gạch.`);
    const name = chu(t, "name", { batBuoc: true, tran: 300 });
    const sizesTho = t["sizes"];
    if (!Array.isArray(sizesTho) || sizesTho.length === 0) throw new Error("Món phải có ít nhất một size (size + tồn + giá).");
    if (sizesTho.length > TRAN_SIZE) throw new Error(`Quá nhiều size (${sizesTho.length}, trần ${TRAN_SIZE}).`);
    const listPrice = so(t, "listPrice", { tran: TRAN_TIEN });
    const sizes = sizesTho.map((d, i) => {
      const o = d ?? {};
      const size2 = chu(o, "size", { batBuoc: true, tran: 32 });
      const qty = so(o, "qty", { tran: 1e6 });
      const price = so(o, "price", { tran: TRAN_TIEN });
      const gnyRieng = so(o, "listPrice", { tran: TRAN_TIEN });
      if (price <= 0) throw new Error(`Size "${size2}" (dòng ${i + 1}) chưa có giá bán.`);
      const sku = chu(o, "sku", { tran: 128 });
      const costPrice = so(o, "costPrice", { tran: TRAN_TIEN });
      return {
        size: size2,
        qty,
        price,
        listPrice: gnyRieng > 0 ? gnyRieng : listPrice,
        ...chu(o, "warehouseId", { tran: 64 }) ? { warehouseId: chu(o, "warehouseId", { tran: 64 }) } : {},
        ...sku === "" ? {} : { sku },
        ...costPrice > 0 ? { costPrice } : {}
      };
    });
    const anh = (k) => {
      const u = chu(t, k, { tran: TRAN_ANH });
      if (u && !laAnhHopLe(u)) throw new Error(`"${k}" phải là một địa chỉ http(s) hoặc ảnh đã tải lên.`);
      return u;
    };
    const gallery = Array.isArray(t["galleryImages"]) ? t["galleryImages"].map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 20) : [];
    for (const g of gallery) if (!laAnhHopLe(g)) throw new Error("Ảnh khác phải là địa chỉ http(s) hoặc ảnh đã tải lên.");
    const status2 = chu(t, "status", { tran: 32 });
    if (status2 && !["orderable", "hidden", "sold_out"].includes(status2)) throw new Error(`Trạng thái "${status2}" không có. Đang mở: orderable, hidden, sold_out.`);
    const productKind = chu(t, "productKind", { tran: 100 });
    const slug = chu(t, "slug", { tran: 190 });
    if (slug !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Slug "${slug}" chỉ được chữ thường không dấu, số và gạch nối.`);
    return {
      code,
      name,
      brand: chu(t, "brand", { tran: 100 }),
      gender: chu(t, "gender", { tran: 40 }),
      category: chu(t, "category", { tran: 100 }),
      productKind,
      division: chu(t, "division", { tran: 100 }),
      ...slug === "" ? {} : { slug },
      listPrice,
      discountPercent: Math.min(100, so(t, "discountPercent", { tran: 100 })),
      ...status2 ? { status: status2 } : {},
      thumbnailImage: anh("thumbnailImage"),
      highImage: anh("highImage"),
      galleryImages: gallery,
      shortDescription: chu(t, "shortDescription", { tran: 1e3 }),
      description: chu(t, "description", { tran: 2e4 }),
      seoTitle: chu(t, "seoTitle", { tran: 255 }),
      seoDescription: chu(t, "seoDescription", { tran: 500 }),
      seoKeywords: chu(t, "seoKeywords", { tran: 500 }),
      policy: chu(t, "policy", { tran: 5e3 }),
      sourceName: chu(t, "sourceName", { tran: 100 }) || "OMI",
      // Gia tay (Đ5): co mat = man soan quyet (0 = ban theo gia nguon). Vang mat = giu nguyen.
      ...t["giaTay"] === void 0 ? {} : { giaTay: so(t, "giaTay", { tran: TRAN_TIEN }) },
      sizes
    };
  }
  var TRAN_DONG_MON = 200;
  function donTuThamSo(t, { taoMoi }) {
    const ra = {};
    const co = (k) => t[k] !== void 0 && t[k] !== null;
    const chuNeuCo = (tenTham, tenLanding, tran = TRAN_CHU) => {
      if (co(tenTham)) ra[tenLanding] = chu(t, tenTham, { tran });
    };
    if (taoMoi || co("khach")) ra["customerName"] = chu(t, "khach", { batBuoc: taoMoi });
    if (taoMoi || co("dienThoai")) ra["phone"] = chu(t, "dienThoai", { batBuoc: taoMoi, tran: 32 });
    chuNeuCo("email", "email");
    chuNeuCo("diaChi", "address", 500);
    chuNeuCo("tinh", "province");
    chuNeuCo("huyen", "district");
    chuNeuCo("xa", "ward");
    chuNeuCo("diaChiChiTiet", "addressDetail", 255);
    chuNeuCo("ghiChu", "note", TRAN_GHI_CHU);
    chuNeuCo("cachTra", "paymentMethod", 64);
    chuNeuCo("trangThaiTien", "paymentStatus", 48);
    chuNeuCo("maChuyenKhoan", "paymentReference", 128);
    chuNeuCo("hangVanChuyen", "shippingProvider", 100);
    chuNeuCo("maVanDon", "trackingCode", 100);
    if (taoMoi) chuNeuCo("trangThai", "status", 48);
    if (co("daTra")) ra["paidAmount"] = so(t, "daTra", { tran: TRAN_TIEN });
    if (co("loaiChietKhau")) ra["discountType"] = chu(t, "loaiChietKhau", { tran: 16 }) === "percent" ? "percent" : "money";
    if (co("chietKhau")) ra["discountValue"] = so(t, "chietKhau", { tran: TRAN_TIEN });
    if (co("phiShip")) ra["shippingFee"] = so(t, "phiShip", { tran: 1e8 });
    if (co("nguoiTraShip")) {
      const v = chu(t, "nguoiTraShip", { tran: 16 });
      if (!["", "sender", "receiver"].includes(v)) throw new Error('"nguoiTraShip" chỉ nhận sender, receiver hoặc để trống.');
      ra["shippingPayer"] = v;
    }
    if (co("cachGiao")) {
      const v = chu(t, "cachGiao", { tran: 16 });
      if (!["", "carrier", "external", "pickup", "later"].includes(v)) throw new Error('"cachGiao" chỉ nhận carrier, external, pickup, later.');
      ra["deliveryMethod"] = v;
    }
    chuNeuCo("nhan", "tags", 500);
    chuNeuCo("ghiChuGiao", "shippingNote", 500);
    chuNeuCo("trangThaiGiao", "fulfillmentStatus", 48);
    chuNeuCo("maKhach", "customerProfileId", 64);
    if (!taoMoi && co("trangThai")) chuNeuCo("trangThai", "status", 48);
    if (co("mon")) {
      const mon = t["mon"];
      if (!Array.isArray(mon) || mon.length === 0) throw new Error("Đơn cần ít nhất một món (mã, size, số lượng, đơn giá).");
      if (mon.length > TRAN_DONG_MON) throw new Error(`Quá nhiều dòng món (${mon.length}, trần ${TRAN_DONG_MON}).`);
      ra["items"] = mon.map((d, i) => {
        const o = d ?? {};
        const ma = chu(o, "ma", { batBuoc: true, tran: 128 });
        const soLuong = so(o, "soLuong", { macDinh: 1, tran: 1e3 });
        if (soLuong < 1) throw new Error(`Dòng ${i + 1} (${ma}): số lượng phải từ 1.`);
        return {
          productCode: ma,
          productName: chu(o, "ten", { tran: 300 }),
          size: chu(o, "size", { tran: 32 }),
          qty: soLuong,
          price: so(o, "donGia", { tran: TRAN_TIEN }),
          ...o["loaiChietKhau"] === void 0 ? {} : { discountType: chu(o, "loaiChietKhau", { tran: 16 }) === "percent" ? "percent" : "money" },
          ...o["chietKhau"] === void 0 ? {} : { discountValue: so(o, "chietKhau", { tran: TRAN_TIEN }) }
        };
      });
    } else if (taoMoi) {
      throw new Error("Đơn cần ít nhất một món (mã, size, số lượng, đơn giá).");
    }
    return ra;
  }
  function taoBanDieuHanh(cong2, phu = {}) {
    const VIEC = {
      "phien-ban": async () => lay(await cong2.phienBan()),
      "giay-phep": async () => {
        const gp = phu.license ? phu.license() : null;
        return { ok: true, than: gp === null ? null : { ...gp, tenManh: gp.manh.map((m) => TEN_MANH[m] ?? m) }, viSao: "" };
      },
      "xeon.trang-thai": async () => lay(await cong2.xeon()),
      "don.danh-sach": async (t) => {
        const daXoa = chu(t, "daXoa", { tran: 8 });
        if (daXoa !== "" && daXoa !== "chi" && daXoa !== "tat-ca") throw new Error('"daXoa" chỉ nhận "chi" hoặc "tat-ca".');
        const nhom = chu(t, "nhom", { tran: 32 });
        if (nhom !== "" && !NHOM_QUY_TRINH.includes(nhom)) throw new Error(`Nhóm "${nhom}" không có. Đang mở: ${NHOM_QUY_TRINH.join(", ")}.`);
        const k = await cong2.danhSachDon({
          trangThai: chu(t, "trangThai"),
          dienThoai: chu(t, "dienThoai", { tran: 32 }),
          gioiHan: so(t, "gioiHan", { macDinh: 50, tran: 500 }) || 50,
          ...daXoa === "" ? {} : { daXoa },
          ...nhom === "" ? {} : { nhom },
          ...chu(t, "tuKhoa", { tran: 120 }) === "" ? {} : { tuKhoa: chu(t, "tuKhoa", { tran: 120 }) }
        });
        if (!k.ok) return lay(k);
        const ds = Array.isArray(k.than) ? k.than : [];
        return { ok: true, than: ds.map(donGon), viSao: "" };
      },
      "don.mo": async (t) => {
        const k = await cong2.moDon(chu(t, "maDon", { batBuoc: true, tran: 64 }));
        if (!k.ok) return lay(k);
        return { ok: true, than: donDayDu(k.than ?? {}), viSao: "" };
      },
      "don.doi-trang-thai": async (t) => lay(await cong2.doiTrangThaiDon(
        chu(t, "maDon", { batBuoc: true, tran: 64 }),
        chu(t, "trangThai", { batBuoc: true, tran: 48 }),
        chu(t, "ghiChu", { tran: TRAN_GHI_CHU })
      )),
      "don.ghi-tien": async (t) => {
        const soTien = so(t, "soTien", { tran: 5e9 });
        if (soTien <= 0) throw new Error("Số tiền phải lớn hơn 0.");
        return lay(await cong2.ghiNhanDaTra(
          chu(t, "maDon", { batBuoc: true, tran: 64 }),
          soTien,
          chu(t, "ghiChu", { tran: TRAN_GHI_CHU })
        ));
      },
      "don.tien": async (t) => lay(await cong2.tienCuaDon(chu(t, "maDon", { batBuoc: true, tran: 64 }))),
      // HOAN TIEN: bat buoc co ly do va so tien > 0. May chu con chan them "khong hoan qua so da tra".
      "tien.hoan": async (t) => {
        const soTien = so(t, "soTien", { tran: 5e9 });
        if (soTien <= 0) throw new Error('"soTien" phải lớn hơn 0.');
        return lay(await cong2.hoanTien({
          maDon: chu(t, "maDon", { batBuoc: true, tran: 64 }),
          soTien,
          lyDo: chu(t, "lyDo", { batBuoc: true, tran: TRAN_GHI_CHU })
        }));
      },
      // GIA VON (16/09): bao cao tai chinh va cong no doi tac doc gia von tung dong. Dong nao trong
      // thi ca hai ra so SAI — va sai theo huong nguy hiem nhat: lai trong co ve cao hon that.
      "gia-von.con-thieu": async (t) => lay(await cong2.giaVonConThieu(so(t, "gioiHan", { macDinh: 200, tran: 500 }) || 200)),
      "gia-von.ghi": async (t) => {
        const dongTho = t.dong;
        if (!Array.isArray(dongTho) || dongTho.length === 0) throw new Error("Chưa nhập giá vốn cho dòng nào.");
        if (dongTho.length > 200) throw new Error(`Một lần lưu tối đa 200 dòng (đang gửi ${dongTho.length}).`);
        return lay(await cong2.ghiGiaVon(dongTho.map((x) => {
          const o = x ?? {};
          return {
            maDon: chu(o, "maDon", { batBuoc: true, tran: 64 }),
            maDong: chu(o, "maDong", { batBuoc: true, tran: 160 }),
            giaVon: so(o, "giaVon", { tran: TRAN_TIEN })
          };
        })));
      },
      "gia-von.bu-tu-phieu": async (t) => lay(await cong2.buGiaVonTuPhieu(chu(t, "maDon", { tran: 64 }))),
      // ----- Dot O1 (14/09/2026): chu shop tao don thu cong, sua, xoa; danh sach khach -----
      "don.tao-thu-cong": async (t) => {
        const than = donTuThamSo(t, { taoMoi: true });
        const k = await cong2.taoDonThuCong(than);
        if (!k.ok) return lay(k);
        const b = k.than ?? {};
        const kho = b.stock ?? {};
        return {
          ok: true,
          viSao: "",
          than: { maDon: String(b.orderId ?? ""), maBiMat: String(b.lookupSecret ?? ""), duongTraCuu: String(b.lookupUrl ?? ""), thieu: Array.isArray(kho.thieu) ? kho.thieu : [] }
        };
      },
      "don.sua": async (t) => {
        const maDon = chu(t, "maDon", { batBuoc: true, tran: 64 });
        const than = donTuThamSo(t, { taoMoi: false });
        if (Object.keys(than).length === 0) throw new Error("Không có gì để sửa.");
        const k = await cong2.suaDon(maDon, than);
        if (!k.ok) return lay(k);
        const b = k.than ?? {};
        const kho = b.stock ?? {};
        return { ok: true, viSao: "", than: { don: donDayDu(b.order ?? {}), thieu: Array.isArray(kho.thieu) ? kho.thieu : [] } };
      },
      // XOA = vao thung rac, ton tra lai kho. Don van khoi phuc duoc — nut Xoa khong con la mot
      // hanh dong khong the lay lai (16/09/2026).
      "don.xoa": async (t) => lay(await cong2.xoaDon(chu(t, "maDon", { batBuoc: true, tran: 64 }))),
      "don.khoi-phuc": async (t) => lay(await cong2.khoiPhucDon(chu(t, "maDon", { batBuoc: true, tran: 64 }))),
      // So tren tung tab. Cua RIENG voi danh sach: so nay dem HET don dang hoat dong, khong doi theo
      // o tim kiem — nhet chung vao cua danh sach la so nhay theo cai nguoi ta vua go.
      "don.dem-nhom": async () => lay(await cong2.demDonTheoNhom()),
      // DOI MAU mot dong: doi tac bao het hang, nguoi ban doi cho khach sang doi khac. GIA khong gui
      // len — kho quyet gia, man hinh khong duoc dat gia cho mot mon hang.
      "don.dong.doi-mau": async (t) => lay(await cong2.doiMauDong(
        chu(t, "maDon", { batBuoc: true, tran: 64 }),
        chu(t, "maDong", { batBuoc: true, tran: 160 }),
        { ma: chu(t, "ma", { batBuoc: true, tran: 128 }), size: chu(t, "size", { tran: 32 }), lyDo: chu(t, "lyDo", { tran: TRAN_GHI_CHU }) }
      )),
      // Goi y gom kho: hoi khi MO mot don, khong hoi cho ca bang — moi don la N lan hoi ton, va may
      // chu cua khach nam tren hosting chung.
      "don.goi-y-kho": async (t) => lay(await cong2.goiYKho(chu(t, "maDon", { batBuoc: true, tran: 64 }))),
      // KET THUC don: "huy" = lat lai luot ban (hang ve kho nhu chua tung ban), "hang-hoan" = luot
      // ban DA xay ra, khach tra hang ve. Hang hoan bat buoc co ly do — chan tai cho.
      "don.ket-thuc": async (t) => {
        const cach = chu(t, "cach", { batBuoc: true, tran: 16 });
        if (cach !== "huy" && cach !== "hang-hoan") throw new Error('"cach" chỉ nhận "huy" hoặc "hang-hoan".');
        const lyDo = chu(t, "lyDo", { tran: TRAN_GHI_CHU });
        if (cach === "hang-hoan" && lyDo === "") throw new Error("Hàng hoàn phải ghi lý do — khách trả vì sao.");
        const giuCoc = chu(t, "giuCoc", { tran: 8 });
        if (!["", "giu", "hoan"].includes(giuCoc)) throw new Error('"giuCoc" chỉ nhận "giu" hoặc "hoan".');
        return lay(await cong2.ketThucDon(chu(t, "maDon", { batBuoc: true, tran: 64 }), cach, lyDo, giuCoc));
      },
      // CUM NUT TRANG THAI tren tung dong (Buoc 4): mot cua, ten viec di trong than — dung hinh dang
      // cua Desk. Sau cua gan giong nhau thi truoc sau gi cung lech.
      "don.viec": async (t) => {
        const viec = chu(t, "viec", { batBuoc: true, tran: 32 });
        if (!VIEC_NHANH.includes(viec)) throw new Error(`Việc "${viec}" không có. Đang mở: ${VIEC_NHANH.join(", ")}.`);
        return lay(await cong2.lamViecDon(chu(t, "maDon", { batBuoc: true, tran: 64 }), viec, chu(t, "ghiChu", { tran: TRAN_GHI_CHU })));
      },
      // CUM MUA HO TREN MOT DONG (dot O1 phan hai, 16/09/2026): chon kho / day mua / loai hang.
      // Chi nhung truong CO MAT moi duoc gui — gui thieu truong la giu nguyen, khong xoa trang.
      "don.dong.ghi": async (t) => {
        const than = {};
        if (t.maDoiTac !== void 0) than.maDoiTac = chu(t, "maDoiTac", { tran: 64 });
        if (t.maKho !== void 0) than.maKho = chu(t, "maKho", { tran: 128 });
        if (t.tenKho !== void 0) than.tenKho = chu(t, "tenKho", { tran: 190 });
        if (t.dayMua !== void 0) than.dayMua = t.dayMua === true;
        if (t.loaiSanPham !== void 0) {
          const loai = chu(t, "loaiSanPham", { tran: 32 });
          if (loai !== "" && !LOAI_SAN_PHAM.includes(loai)) throw new Error(`Loại "${loai}" không có. Đang mở: ${LOAI_SAN_PHAM.join(", ")}.`);
          than.loaiSanPham = loai;
        }
        if (Object.keys(than).length === 0) throw new Error("Không có gì để sửa trên dòng này.");
        return lay(await cong2.ghiDongDon(
          chu(t, "maDon", { batBuoc: true, tran: 64 }),
          chu(t, "maDong", { batBuoc: true, tran: 160 }),
          than
        ));
      },
      "don.xoa-vinh-vien": async (t) => lay(await cong2.xoaHanDon(chu(t, "maDon", { batBuoc: true, tran: 64 }))),
      "khach.danh-sach": async (t) => lay(await cong2.danhSachKhach(chu(t, "tuKhoa"), so(t, "gioiHan", { macDinh: 200, tran: 500 }) || 200)),
      "hang.tim": async (t) => {
        const nguon = chu(t, "nguon", { tran: 16 });
        if (nguon !== "" && !["own", "ready", "campaign"].includes(nguon)) throw new Error(`Nguồn "${nguon}" không có. Đang mở: own, ready, campaign.`);
        const k = await cong2.timHang(chu(t, "tuKhoa"), so(t, "gioiHan", { macDinh: 30, tran: TRAN_SUA_NHANH }) || 30, { size: chu(t, "size", { tran: 32 }), nguon });
        if (!k.ok) return lay(k);
        const ds = Array.isArray(k.than) ? k.than : [];
        return { ok: true, than: ds.map(hangGon), viSao: "" };
      },
      "hang.ton": async (t) => lay(await cong2.tonCuaMa(
        chu(t, "ma", { batBuoc: true, tran: 128 }),
        chu(t, "size", { tran: 64 })
      )),
      // ----- Hang hoa: them / sua / xoa / nhap Excel (dot L8 — Image Tool vao OMI) -----
      "hang.doc": async (t) => {
        const ma = chu(t, "ma", { batBuoc: true, tran: 128 });
        const k = await cong2.timHang(ma, 20);
        if (!k.ok) return lay(k);
        const ds = Array.isArray(k.than) ? k.than : [];
        const mon = ds.find((m) => String(m.code ?? "").toLowerCase() === ma.toLowerCase()) ?? null;
        return { ok: true, than: mon === null ? null : hangDayDu(mon), viSao: mon === null ? `Không có món mã "${ma}".` : "" };
      },
      "hang.ghi": async (t) => {
        const mon = monTuThamSo(t);
        return lay(await cong2.ghiHang(mon.code, mon));
      },
      "hang.xoa": async (t) => lay(await cong2.xoaHang(chu(t, "ma", { batBuoc: true, tran: 128 }))),
      // KHO HANG SAN / KHO DOI TAC: hang cua MOT nguon. Ten nguon la gia tri dong (landing tu choi
      // ten la), nen o day chi chan som cho cau loi de hieu.
      "hang.theo-nguon": async (t) => {
        const nguon = chu(t, "nguon", { batBuoc: true, tran: 32 });
        if (!["own", "ready", "campaign"].includes(nguon)) throw new Error(`Nguồn "${nguon}" không có. Đang mở: own, ready, campaign.`);
        return lay(await cong2.hangTheoNguon(nguon, so(t, "gioiHan", { macDinh: 500, tran: 2e3 }) || 500));
      },
      "hang.lich-su-nap": async () => lay(await cong2.lichSuNapHang()),
      // SUA NHANH: nhieu mon, ba truong (gia niem yet, giam gia, an/hien). Khong dong vao ton, size,
      // ten hay anh — man nhanh la man de sai nhat nen duoc voi tay ngan nhat.
      "hang.sua-nhanh": async (t) => {
        const monTho = t.mon;
        if (!Array.isArray(monTho) || monTho.length === 0) throw new Error("Chưa chọn món nào để sửa.");
        if (monTho.length > TRAN_SUA_NHANH) throw new Error(`Quá nhiều món (${monTho.length}, trần ${TRAN_SUA_NHANH}).`);
        const mon = monTho.map((x, i) => {
          const o = x ?? {};
          const ma = chu(o, "ma", { batBuoc: true, tran: 128 });
          const doi = { ma };
          if (o.giaNiemYet !== void 0) doi.giaNiemYet = so(o, "giaNiemYet", { tran: TRAN_TIEN });
          if (o.giamGia !== void 0) {
            const phanTram = so(o, "giamGia", { tran: 99 });
            doi.giamGia = phanTram;
          }
          if (o.ten !== void 0) doi.ten = chu(o, "ten", { batBuoc: true, tran: 255 });
          for (const k of ["hang", "nhom", "gioiTinh"]) if (o[k] !== void 0) doi[k] = chu(o, k, { tran: 190 });
          if (o.loai !== void 0) {
            const loai = chu(o, "loai", { tran: 32 });
            if (loai !== "" && !LOAI_SAN_PHAM.includes(loai)) throw new Error(`Dòng ${i + 1}: loại "${loai}" không có. Đang mở: ${LOAI_SAN_PHAM.join(", ")}.`);
            doi.loai = loai;
          }
          if (o.giaBan !== void 0) {
            const gia = so(o, "giaBan", { tran: TRAN_TIEN });
            if (gia <= 0) throw new Error(`Dòng ${i + 1} (${ma}): giá bán phải lớn hơn 0.`);
            doi.giaBan = gia;
          }
          if (o.trangThai !== void 0) {
            const tt = chu(o, "trangThai", { tran: 32 });
            if (tt !== "hidden" && tt !== "orderable") throw new Error(`Dòng ${i + 1}: trạng thái phải là "hidden" hoặc "orderable".`);
            doi.trangThai = tt;
          }
          if (Object.keys(doi).length === 1) throw new Error(`Dòng ${i + 1} (${ma}): không có gì để đổi.`);
          return doi;
        });
        return lay(await cong2.suaNhanhHang(mon));
      },
      "hang.nap-them": async (t) => {
        const ds = t["mon"];
        if (!Array.isArray(ds) || ds.length === 0) throw new Error("Cần một danh sách 1–20000 món.");
        if (ds.length > 2e4) throw new Error(`Quá nhiều món (${ds.length}, trần 20000).`);
        const sach = ds.map((m) => monTuThamSo(m ?? {}));
        const k = await cong2.napThemHang(sach);
        return lay(k);
      },
      "doi-tac.danh-sach": async () => {
        const k = await cong2.danhSachDoiTac();
        if (!k.ok) return lay(k);
        const ds = Array.isArray(k.than) ? k.than : [];
        return {
          ok: true,
          than: ds.map((d) => ({
            ma: String(d.ma ?? ""),
            ten: String(d.ten ?? ""),
            maCong: String(d.ma_cong ?? ""),
            // Landing khong bao gio tra ve bam mat khau (cot duoc liet ke tung cai, khong SELECT *),
            // nen o day chi co TEN dang nhap — du de man hinh hien "da co tai khoan hay chua".
            dangNhap: String(d.dang_nhap ?? ""),
            trangThai: String(d.trang_thai ?? ""),
            dienThoai: String(d.dien_thoai ?? ""),
            congMoiMon: Number(d.cong_moi_mon ?? 0),
            congMoiDon: Number(d.cong_moi_don ?? 0),
            cachTinh: String(d.cach_tinh ?? "ca-hai"),
            noi: [d.xa, d.huyen, d.tinh].map((x) => String(x ?? "")).filter((x) => x !== "").join(", "),
            tinh: String(d.tinh ?? ""),
            huyen: String(d.huyen ?? ""),
            xa: String(d.xa ?? ""),
            diaChiChiTiet: String(d.dia_chi_chi_tiet ?? ""),
            telegramChatId: String(d.telegram_chat_id ?? ""),
            email: String(d.email ?? ""),
            suaLuc: String(d.sua_luc ?? "")
          })),
          viSao: ""
        };
      },
      // MAT KHAU DOI TAC di qua day mot chieu: goi len landing roi thoi. Khong ghi vao nhat ky,
      // khong tra nguoc ve man hinh. O trong = "giu nguyen mat khau cu", nen sua so dien thoai
      // khong lam dang xuat doi tac.
      "doi-tac.ghi": async (t) => lay(await cong2.ghiDoiTac({
        ma: chu(t, "ma", { batBuoc: true, tran: 64 }),
        ten: chu(t, "ten", { batBuoc: true }),
        maCong: chu(t, "maCong", { batBuoc: true, tran: 128 }),
        trangThai: t.bat === false ? "paused" : chu(t, "trangThai") || "active",
        dienThoai: chu(t, "dienThoai", { tran: 32 }),
        dangNhap: chu(t, "dangNhap", { tran: 190 }),
        matKhau: chu(t, "matKhau", { tran: 128 }),
        congMoiMon: so(t, "congMoiMon"),
        congMoiDon: so(t, "congMoiDon"),
        cachTinh: chu(t, "cachTinh", { tran: 16 }) || "ca-hai",
        tinh: chu(t, "tinh"),
        huyen: chu(t, "huyen"),
        xa: chu(t, "xa"),
        diaChiChiTiet: chu(t, "diaChiChiTiet", { tran: 255 }),
        // Khong gui = landing giu nguyen (man cu khong biet hai o nay thi khong xoa mat).
        ...t.telegramChatId === void 0 ? {} : { telegramChatId: chu(t, "telegramChatId", { tran: 64 }) },
        ...t.email === void 0 ? {} : { email: chu(t, "email", { tran: 190 }) }
      })),
      // CAU HINH SHOP — thay cho tep .env cua Sales Desk. Bi mat da bi landing che truoc khi tra ve
      // (chi con "da dat" + bon ky tu cuoi), nen o day khong phai cat gi them.
      "cau-hinh.doc": async () => lay(await cong2.docCauHinhShop()),
      "cau-hinh.ghi": async (t) => {
        const giaTri = t.giaTri;
        if (giaTri === null || typeof giaTri !== "object" || Array.isArray(giaTri)) throw new Error('"giaTri" phải là một đối tượng.');
        const sach = {};
        for (const [k, v] of Object.entries(giaTri)) {
          if (!/^[a-z][a-z0-9_]{0,60}$/.test(k)) throw new Error(`Tên cấu hình không hợp lệ: ${k}`);
          const gt = String(v ?? "").trim();
          if (gt.length > 1e3) throw new Error(`Giá trị của "${k}" quá dài.`);
          sach[k] = gt;
        }
        if (Object.keys(sach).length === 0) throw new Error("Không có mục nào để lưu.");
        return lay(await cong2.ghiCauHinhShop(sach));
      },
      // SAN PHAM CAN MUA: viec con phai mua, phieu da mua (co gia von — day la man cua CHU SHOP),
      // va nhung dong doi tac bao het hang.
      "mua-ho.bang": async (t) => lay(await cong2.muaHo(chu(t, "doiTac", { tran: 64 }), so(t, "gioiHan", { macDinh: 200, tran: 1e3 }) || 200)),
      // XUONG NOI DUNG (dot O6) — nam buoc soan bai. May chu giu BUOC, khong phai trang giu.
      "noi-dung.khuon": async () => lay(await cong2.khuonNoiDung()),
      "noi-dung.lo": async () => lay(await cong2.danhSachLo()),
      "noi-dung.lo.tao": async (t) => {
        const ngay3 = chu(t, "ngay", { batBuoc: true, tran: 10 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay3)) throw new Error('"ngay" phải dạng 2026-09-20.');
        const trangTho = t.trang;
        if (!Array.isArray(trangTho) || trangTho.length === 0) throw new Error("Chưa chọn fanpage nào.");
        if (trangTho.length > 10) throw new Error("Tối đa 10 fanpage một lô.");
        const khungTho = Array.isArray(t.khungGio) ? t.khungGio : [];
        const khungGio = khungTho.map((x) => String(x ?? "").trim()).filter((x) => /^\d{2}:\d{2}$/.test(x));
        return lay(await cong2.taoLo({ ngay: ngay3, trang: trangTho.map((x) => String(x ?? "").trim()).filter(Boolean), khungGio }));
      },
      "noi-dung.lo.mo": async (t) => lay(await cong2.moLo(chu(t, "ma", { batBuoc: true, tran: 64 }))),
      "noi-dung.lo.sua-bai": async (t) => {
        const doi = {};
        if (t.caption !== void 0) doi.caption = chu(t, "caption", { tran: 8e3 });
        if (t.chuAnh !== void 0) doi.chuAnh = chu(t, "chuAnh", { tran: 300 });
        if (t.comment !== void 0) doi.comment = chu(t, "comment", { tran: 2e3 });
        if (t.chuDe !== void 0) doi.chuDe = chu(t, "chuDe", { tran: 500 });
        if (t.gio !== void 0) doi.gio = chu(t, "gio", { tran: 5 });
        if (t.dangBai !== void 0) doi.dangBai = chu(t, "dangBai", { tran: 32 });
        if (t.boQua !== void 0) doi.boQua = chu(t, "boQua", { tran: 300 });
        if (Array.isArray(t.ma)) doi.ma = t.ma.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 20);
        if (Object.keys(doi).length === 0) throw new Error("Không có gì để sửa.");
        return lay(await cong2.suaBaiLo(chu(t, "maLo", { batBuoc: true, tran: 64 }), chu(t, "maBai", { batBuoc: true, tran: 64 }), doi));
      },
      "noi-dung.lo.cham": async (t) => lay(await cong2.chamLo(chu(t, "ma", { batBuoc: true, tran: 64 }))),
      "noi-dung.lo.buoc": async (t) => {
        const huong = chu(t, "huong", { tran: 8 }) || "toi";
        if (huong !== "toi" && huong !== "lui") throw new Error('"huong" chỉ nhận "toi" hoặc "lui".');
        return lay(await cong2.doiBuocLo(chu(t, "ma", { batBuoc: true, tran: 64 }), huong));
      },
      "noi-dung.lo.len-lich": async (t) => lay(await cong2.lenLichLo(chu(t, "ma", { batBuoc: true, tran: 64 }))),
      "noi-dung.lo.xin-viet": async (t) => lay(await cong2.xinBoNaoViet(chu(t, "maLo", { batBuoc: true, tran: 64 }), chu(t, "maBai", { batBuoc: true, tran: 64 }))),
      "noi-dung.doc": async () => lay(await cong2.docNoiDung()),
      "noi-dung.ghi": async (t) => {
        const doi = t.doi;
        if (doi === null || typeof doi !== "object" || Array.isArray(doi)) throw new Error('"doi" phải là một đối tượng.');
        const sach = {};
        for (const [k, v] of Object.entries(doi)) {
          if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k)) throw new Error(`Tên trường không hợp lệ: ${k}`);
          const gt = String(v ?? "");
          if (gt.length > 2e4) throw new Error(`Trường "${k}" quá dài.`);
          sach[k] = gt;
        }
        if (Object.keys(sach).length === 0) throw new Error("Không có trường nào để sửa.");
        return lay(await cong2.ghiNoiDung(sach));
      },
      // Danh sach cho man Van don: cung duong /api/orders, nhung giu dia chi + COD de xuat tep hang.
      "van-don.danh-sach": async (t) => {
        const k = await cong2.danhSachDon({
          trangThai: chu(t, "trangThai"),
          gioiHan: so(t, "gioiHan", { macDinh: 200, tran: 500 }) || 200
        });
        if (!k.ok) return lay(k);
        const ds = Array.isArray(k.than) ? k.than : [];
        const chuaCoVanDon = t.chuaCoVanDon === true;
        const dong = ds.map(donGiao).filter((d) => !chuaCoVanDon || String(d.maVanDon ?? "") === "");
        return { ok: true, than: dong, viSao: "" };
      },
      // DIA CHI: go vai chu roi bam chon. Hang van chuyen TU CHOI don co ten tinh/xa khong khop danh
      // muc cua ho, va moi lan tu choi la mot lan nguoi ban mo lai don sua tay.
      "dia-chi.tim": async (t) => {
        const he = chu(t, "he", { tran: 16 }) || "ba-cap";
        if (he !== "ba-cap" && he !== "hai-cap") throw new Error('"he" chỉ nhận "ba-cap" hoặc "hai-cap".');
        const cap = chu(t, "cap", { batBuoc: true, tran: 8 });
        if (!["tinh", "huyen", "xa"].includes(cap)) throw new Error('"cap" chỉ nhận "tinh", "huyen" hoặc "xa".');
        return lay(await cong2.timDiaChi({
          he,
          cap,
          q: chu(t, "q", { tran: 120 }),
          tinh: chu(t, "tinh", { tran: 190 }),
          huyen: chu(t, "huyen", { tran: 190 })
        }));
      },
      "dia-chi.doi-hai-cap": async (t) => lay(await cong2.doiDiaChiHaiCap({
        tinh: chu(t, "tinh", { batBuoc: true, tran: 190 }),
        huyen: chu(t, "huyen", { tran: 190 }),
        xa: chu(t, "xa", { batBuoc: true, tran: 190 })
      })),
      "van-don.tra": async (t) => lay(await cong2.traVanDon(chu(t, "maPhieu", { batBuoc: true, tran: 64 }))),
      "van-don.tao-tu-don": async (t) => lay(await cong2.taoVanDonTuDon({
        maDon: chu(t, "maDon", { batBuoc: true, tran: 64 }),
        // Đ3: mot KIEN cua don tach kho — dong cua kien do, COD cua kien do.
        ...chu(t, "maKien", { tran: 80 }) === "" ? {} : { maKien: chu(t, "maKien", { tran: 80 }) },
        hang: chu(t, "hang", { tran: 32 }),
        canNangKg: so(t, "canNangKg", { tran: 200 }) || void 0,
        danDo: chu(t, "danDo", { tran: 500 })
      })),
      "hop-thu.xem": async (t) => {
        const k = await cong2.hopThu({ tu: chu(t, "tu", { tran: 128 }), gioiHan: so(t, "gioiHan", { macDinh: 50, tran: 300 }) || 50 });
        if (!k.ok) return lay(k);
        const than = k.than ?? {};
        const tin = Array.isArray(than.tin) ? than.tin : [];
        return {
          ok: true,
          than: {
            moc: String(than.cursor ?? ""),
            soGoi: Array.isArray(than.events) ? than.events.length : 0,
            tin: tin.map((e) => ({
              maSuKien: String(e.maSuKien ?? ""),
              kenh: String(e.kenh ?? "facebook"),
              nguoi: String(e.nguoi ?? ""),
              tenNguoi: String(e.tenNguoi ?? ""),
              chu: String(e.chu ?? ""),
              soAnh: Number(e.soAnh ?? 0),
              daXacMinh: e.daXacMinh === true,
              luc: String(e.luc ?? e.nhanLuc ?? "")
            }))
          },
          viSao: ""
        };
      },
      // KHO HOI THOAI (dot O5) — khung chat that: mot cuoc mang ca tin den va tin di.
      "hop-thu.hoi-thoai": async (t) => {
        const loc = chu(t, "loc", { tran: 16 });
        if (loc !== "" && loc !== "tat-ca" && loc !== "chua-doc") throw new Error('"loc" chỉ nhận "tat-ca" hoặc "chua-doc".');
        return lay(await cong2.danhSachHoiThoai({
          kenh: chu(t, "kenh", { tran: 32 }),
          loc,
          q: chu(t, "q", { tran: 120 }),
          trang: chu(t, "trang", { tran: 1e3 }),
          gioiHan: so(t, "gioiHan", { macDinh: 100, tran: 300 }) || 100
        }));
      },
      "hop-thu.hoi-thoai.mo": async (t) => lay(await cong2.moHoiThoai(chu(t, "ma", { batBuoc: true, tran: 200 }))),
      "hop-thu.hoi-thoai.da-doc": async (t) => lay(await cong2.danhDauDaDoc(chu(t, "ma", { batBuoc: true, tran: 200 }))),
      "hop-thu.tra-loi": async (t) => {
        const kenh = chu(t, "kenh", { tran: 32 }) || "facebook";
        const traLoiTin = chu(t, "traLoiTin", { tran: 160 });
        if (kenh === "facebook-binh-luan" && traLoiTin === "") throw new Error("Trả lời bình luận phải kèm mã bình luận.");
        const anhUrl = chu(t, "anhUrl", { tran: 2e3 });
        if (anhUrl !== "" && !/^(https?:\/\/|\/api\/fanpage-media\/)/i.test(anhUrl)) throw new Error("Ảnh gửi khách phải là ảnh đã tải lên landing.");
        return lay(await cong2.guiTin({
          nguoi: chu(t, "nguoi", { batBuoc: true, tran: 128 }),
          chu: chu(t, "chu", { batBuoc: anhUrl === "", tran: 4e3 }),
          kenh,
          ...anhUrl === "" ? {} : { anhUrl },
          ...traLoiTin === "" ? {} : { traLoiTin }
        }));
      },
      // Luong 2 (Zalo, FB ca nhan): may truc day tin boc duoc, keo hang cho, bao xong.
      "hop-thu.tin-vao": async (t) => {
        const tin = Array.isArray(t.tin) ? t.tin : [];
        if (tin.length === 0 || tin.length > 200) throw new Error("Cần 1–200 tin.");
        return lay(await cong2.tinVao(tin.map((x) => ({
          kenh: chu(x, "kenh", { batBuoc: true, tran: 32 }),
          nguoi: chu(x, "nguoi", { batBuoc: true, tran: 120 }),
          tenNguoi: chu(x, "tenNguoi", { tran: 120 }),
          chu: chu(x, "chu", { tran: 4e3 }),
          maTin: chu(x, "maTin", { batBuoc: true, tran: 160 }),
          luc: chu(x, "luc", { tran: 40 }),
          soAnh: so(x, "soAnh", { tran: 20 })
        }))));
      },
      "hop-thu.cho-gui": async () => lay(await cong2.choGui()),
      "hop-thu.cho-gui.nhan": async (t) => lay(await cong2.choGuiNhan({ kenh: chu(t, "kenh", { tran: 32 }), gioiHan: so(t, "gioiHan", { macDinh: 10, tran: 50 }) || 10 })),
      "hop-thu.cho-gui.xong": async (t) => lay(await cong2.choGuiXong({ id: chu(t, "id", { batBuoc: true, tran: 80 }), ok: t.ok === true, loi: chu(t, "loi", { tran: 300 }) })),
      "hop-thu.can-nguoi": async () => lay(await cong2.canNguoi()),
      "hop-thu.can-nguoi.xong": async (t) => lay(await cong2.canNguoiXong(chu(t, "maHoiThoai", { batBuoc: true, tran: 160 }))),
      "hop-thu.cau-hinh.doc": async () => lay(await cong2.cauHinhHopThu()),
      "hop-thu.cau-hinh.ghi": async (t) => {
        const n = so(t, "nguongTinCuGio", { tran: 720 });
        if (n < 1) throw new Error("Ngưỡng tin cũ phải từ 1 giờ.");
        return lay(await cong2.ghiCauHinhHopThu({ nguongTinCuGio: n }));
      },
      "bao-cao.tong-quan": async (t) => lay(await cong2.baoCao(so(t, "soNgay", { macDinh: 14, tran: 365 }) || 14)),
      "ctv.danh-sach": async () => lay(await cong2.danhSachCtv()),
      "ctv.ghi": async (t) => {
        const matKhau = chu(t, "matKhau", { tran: 200 });
        if (matKhau !== "" && matKhau.length < 8) throw new Error("Mật khẩu phải từ 8 ký tự.");
        return lay(await cong2.ghiCtv({
          ma: chu(t, "ma", { tran: 64 }),
          ten: chu(t, "ten", { batBuoc: true }),
          dienThoai: chu(t, "dienThoai", { batBuoc: true, tran: 32 }),
          email: chu(t, "email"),
          maGioiThieu: chu(t, "maGioiThieu", { tran: 40 }),
          ...t.tenDangNhap === void 0 ? {} : { tenDangNhap: chu(t, "tenDangNhap", { tran: 190 }) },
          ...t.hoaHongMacDinh === void 0 ? {} : { hoaHongMacDinh: chu(t, "hoaHongMacDinh", { tran: 16 }) },
          dangBat: t.dangBat !== false,
          choBoLogo: t.choBoLogo === true,
          ...matKhau === "" ? {} : { matKhau }
        }));
      },
      "ctv.thiet-bi": async (t) => {
        const viec = chu(t, "viec", { batBuoc: true, tran: 16 });
        if (!["duyet", "chan"].includes(viec)) throw new Error('"viec" phải là "duyet" hoặc "chan".');
        return lay(await cong2.thietBiCtv({ ma: chu(t, "ma", { batBuoc: true, tran: 64 }), viec }));
      },
      "ctv.nhat-ky": async (t) => lay(await cong2.nhatKyCtv(chu(t, "maCtv", { tran: 64 }))),
      // Tu 17/09/2026 viec moi viet theo MIEN o `viec/*.ts` — tep nay khong phinh them.
      ...viecKho(cong2),
      ...viecDoiTacTien(cong2),
      ...viecCtvThongKeHopThu(cong2),
      ...viecKhachHoSo(cong2),
      ...viecVanDon(cong2),
      ...viecTaiChinhDoiTac(cong2),
      ...viecHangHoa(cong2)
    };
    return {
      viecDangMo: Object.keys(VIEC),
      duong: cong2.duong,
      async lam(viec, thamSo) {
        const ten = String(viec ?? "");
        const lam = Object.prototype.hasOwnProperty.call(VIEC, ten) ? VIEC[ten] : void 0;
        if (lam === void 0) {
          throw new Error(`Việc "${ten}" không có trong danh sách. Đang mở: ${Object.keys(VIEC).join(", ")}`);
        }
        const t = thamSo === null || typeof thamSo !== "object" || Array.isArray(thamSo) ? {} : thamSo;
        return lam(t);
      }
    };
  }

  // web-omi/cau-noi-web.ts
  var ONLY_IN_APP = "Việc này chỉ làm được trong app OMI trên máy tính (bản web không có).";
  var license = {
    shop: "",
    tenShop: "Quản trị web",
    nganh: "",
    manh: [],
    truc: false,
    hetHan: "",
    veHetLuc: "",
    kiemLuc: "",
    diaChiLanding: location.origin,
    keyChe: "",
    tenMay: "Trình duyệt",
    xeon: ""
  };
  var cong = taoCongLanding({
    duong: () => location.origin,
    ma: () => "",
    hanMs: 3e4,
    goi: async (url, options2) => {
      const response = await fetch(url, { ...options2, credentials: "same-origin" });
      if (response.status === 401) location.assign("/admin-login");
      return response;
    }
  });
  var ban = taoBanDieuHanh(cong, { license: () => license });
  async function loadLicense() {
    try {
      const me = await fetch("/api/admin/me", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null);
      const xeon = await fetch("/api/admin/xeon", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null);
      license = {
        ...license,
        shop: String(xeon?.xeon?.shop ?? ""),
        tenShop: String(xeon?.xeon?.tenShop || xeon?.xeon?.shop || "Quản trị web"),
        manh: Array.isArray(xeon?.toi?.manh) ? xeon.toi.manh.map(String) : [],
        xeon: String(xeon?.xeon?.diaChiXeon ?? ""),
        tenMay: `Web · ${String(me?.admin?.name || me?.admin?.login || "")}`
      };
    } catch {
    }
  }
  function csvDownload(name, rows) {
    const cell = (x) => {
      const text2 = String(x ?? "");
      const safe = /^[=+\-@]/.test(text2) ? `'${text2}` : text2;
      return /["\r\n,;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const body = "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    const file = `${String(name || "omi").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80)}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
    link.download = file;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1e3);
    return { ok: true, viSao: "", tenTep: file, soDong: rows.length };
  }
  var listeners = [];
  var working = () => ({ man: "dang-dung", license, canhBao: "" });
  var ready = loadLicense();
  window.vo = {
    kenh: ["man", "nhat-ky", "kich-hoat", "kiem-lai", "roi-may", "mo-lai", "landing", "cai-dat", "kenh", "tep"],
    khiDoi(listener) {
      listeners.push(listener);
    },
    async goi(channel, params) {
      const o = params ?? {};
      switch (channel) {
        case "man":
        case "kiem-lai":
        case "mo-lai":
          await ready;
          return working();
        case "nhat-ky":
          return [];
        case "kich-hoat":
        case "roi-may":
          return { ok: false, viSao: "Bản web đăng nhập bằng tài khoản người, không dùng license key.", man: working() };
        case "landing":
          return ban.lam(o["viec"], o["thamSo"]);
        case "cai-dat":
          return { ok: false, viSao: ONLY_IN_APP, xeon: license.xeon, tenMay: license.tenMay };
        case "kenh":
          return { ok: false, viSao: ONLY_IN_APP, kenh: [] };
        case "tep": {
          if (o["viec"] === "luu-bang" && Array.isArray(o["dong"])) return csvDownload(String(o["ten"] ?? ""), o["dong"]);
          if (o["viec"] === "mo-tim-anh") {
            window.open(`https://www.bing.com/images/search?q=${encodeURIComponent(String(o["tuKhoa"] ?? ""))}`, "_blank", "noopener");
            return { ok: true, viSao: "" };
          }
          return { ok: false, viSao: ONLY_IN_APP };
        }
        default:
          throw new Error(`Kênh "${String(channel)}" không có trên bản web.`);
      }
    }
  };
  var waitFor = async (find, timeoutMs = 15e3) => {
    const end = Date.now() + timeoutMs;
    for (; ; ) {
      const found = find();
      if (found) return found;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  var buttonByText = (test) => [...document.querySelectorAll("button")].find((b) => b.offsetParent !== null && test(b.textContent?.trim() ?? ""));
  function webWording() {
    const fix = () => {
      for (const node of document.querySelectorAll("#ban-giay-phep, .status-pill, .topbar-status, span, strong")) {
        if (node.children.length > 0) continue;
        const text2 = node.textContent ?? "";
        if (text2 === "Đã có vé") node.textContent = "Đã đăng nhập";
        else if (text2.startsWith("License: ")) node.textContent = `Web · ${license.tenShop}`;
      }
    };
    new MutationObserver(fix).observe(document.body, { subtree: true, childList: true, characterData: true });
    fix();
  }
  async function openFromHash() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (hash === "") return;
    history.replaceState(null, "", location.pathname);
    if (hash === "don-moi") {
      (await waitFor(() => buttonByText((t) => t === "+ Đơn thủ công")))?.click();
      return;
    }
    const id = hash.startsWith("don=") ? hash.slice(4) : "";
    if (id === "") return;
    const search = await waitFor(() => document.getElementById("don-tim"));
    if (!search) return;
    search.value = id;
    const names = [
      ["workflow_new", "Đơn mới"],
      ["workflow_stock", "Chờ xác nhận hàng"],
      ["workflow_payment", "Chờ khách CK"],
      ["workflow_purchase", "Đang mua"],
      ["workflow_delivery", "Chờ giao"],
      ["workflow_completed", "Hoàn tất"],
      ["workflow_attention", "Cần xử lý"],
      ["cancelled", "Đã hủy"]
    ];
    const hits = await Promise.all(names.map(async ([nhom]) => {
      const r = await ban.lam("don.danh-sach", { nhom, tuKhoa: id, gioiHan: 5 }).catch(() => null);
      return Array.isArray(r?.than) && r.than.some((o) => o.id === id);
    }));
    const found = names.find((_, i) => hits[i]);
    if (!found) return;
    buttonByText((t) => t.replace(/\d+$/, "").trim() === found[1])?.click();
    const row = await waitFor(() => [...document.querySelectorAll("tbody tr")].find((r) => r.offsetParent !== null && (r.textContent ?? "").includes(id)), 15e3);
    if (row) {
      row.click();
      row.scrollIntoView({ block: "center" });
    }
  }
  void ready.then(async () => {
    await waitFor(() => document.getElementById("view-title"));
    webWording();
    await openFromHash();
  });
  window.addEventListener("hashchange", () => void openFromHash());

  // ../omi/packages/omi-ui/src/bridge.ts
  function humanError(e) {
    const raw = String(e?.message ?? e ?? "Không rõ lỗi");
    return raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
  }
  function asObject(x) {
    return x !== null && typeof x === "object" && !Array.isArray(x) ? x : null;
  }
  var Gateway = class {
    constructor(bridge) {
      this.bridge = bridge;
    }
    bridge;
    /** Current screen decided by the license layer. */
    screen() {
      return this.bridge.goi("man");
    }
    /** Main process pushes a new screen (ticket refreshed, duty flag changed, key removed...). */
    onScreenChange(listener) {
      this.bridge.khiDoi((m) => listener(m));
    }
    log() {
      return this.bridge.goi("nhat-ky").then((x) => Array.isArray(x) ? x : []);
    }
    activate(key, machineName) {
      return this.bridge.goi("kich-hoat", { key, tenMay: machineName });
    }
    recheck() {
      return this.bridge.goi("kiem-lai");
    }
    leave() {
      return this.bridge.goi("roi-may");
    }
    reopen() {
      return this.bridge.goi("mo-lai");
    }
    /** Run one named job against the shop's landing. Never throws. */
    async landing(job, params = {}) {
      try {
        const r = asObject(await this.bridge.goi("landing", { viec: job, thamSo: params }));
        if (r === null) return { ok: false, than: null, viSao: "Máy chủ trả về thứ không đọc được." };
        return { ok: r.ok === true, than: r.than ?? null, viSao: String(r.viSao ?? "") };
      } catch (e) {
        return { ok: false, than: null, viSao: humanError(e) };
      }
    }
    /** Xeon address + machine name ("cai-dat" channel): `thu-noi` or `luu`. */
    async settings(action, params = {}) {
      try {
        const r = asObject(await this.bridge.goi("cai-dat", { ...params, viec: action }));
        return r === null ? { ok: false, viSao: "Vỏ trả về thứ không đọc được." } : { ok: r.ok === true, viSao: String(r.viSao ?? "") };
      } catch (e) {
        return { ok: false, viSao: humanError(e) };
      }
    }
    /** Automation channels (Zalo, personal Facebook) — only the duty machine may start them. */
    async channel(action, channel = "") {
      try {
        const r = asObject(await this.bridge.goi("kenh", { viec: action, kenh: channel }));
        if (r === null) return { ok: false, viSao: "Vỏ trả về thứ không đọc được.", kenh: [] };
        return {
          ok: r.ok === true,
          viSao: String(r.viSao ?? ""),
          kenh: Array.isArray(r.kenh) ? r.kenh : [],
          ...typeof r.daDay === "number" ? { daDay: r.daDay } : {},
          ...typeof r.loi === "string" && r.loi !== "" ? { loi: r.loi } : {}
        };
      } catch (e) {
        return { ok: false, viSao: humanError(e), kenh: [] };
      }
    }
    /** Native "choose spreadsheet" dialog; the file is parsed in the main process. */
    async pickSpreadsheet() {
      const empty = { ok: false, viSao: "", tenTep: "", sheet: "", cacSheet: [], mon: [], cot: {}, soDongDuLieu: 0, boQua: 0, canhBao: [], xemTruoc: [] };
      try {
        const r = asObject(await this.bridge.goi("tep", { viec: "chon-bang-tinh" }));
        if (r === null) return { ...empty, viSao: "Vỏ trả về thứ không đọc được." };
        return { ...empty, ...r, ok: r.ok === true, viSao: String(r.viSao ?? "") };
      } catch (e) {
        return { ...empty, viSao: humanError(e) };
      }
    }
    /**
     * Saves a table to a file the seller picks in a native dialog (the carrier upload sheet).
     * The page hands over ROWS, never a path: choosing where to write on the machine is the shell's.
     */
    async saveTable(name, rows) {
      const empty = { tenTep: "", soDong: 0 };
      try {
        const r = asObject(await this.bridge.goi("tep", { viec: "luu-bang", ten: name, dong: rows }));
        if (r === null) return { ...empty, ok: false, viSao: "Vỏ trả về thứ không đọc được." };
        return { ...empty, ...r, ok: r.ok === true, viSao: String(r.viSao ?? "") };
      } catch (e) {
        return { ...empty, ok: false, viSao: humanError(e) };
      }
    }
    /** Opens the system browser on an image search; the shell builds the URL, not the page. */
    async openImageSearch(keyword) {
      try {
        const r = asObject(await this.bridge.goi("tep", { viec: "mo-tim-anh", tuKhoa: keyword }));
        return r === null ? { ok: false, viSao: "Vỏ trả về thứ không đọc được." } : { ok: r.ok === true, viSao: String(r.viSao ?? "") };
      } catch (e) {
        return { ok: false, viSao: humanError(e) };
      }
    }
  };

  // ../omi/packages/omi-ui/src/dom.ts
  var PROPERTY_ATTRS = /* @__PURE__ */ new Set(["hidden", "disabled", "checked", "value", "textContent"]);
  function h(tag, attrs = null, ...children) {
    const node = document.createElement(tag);
    if (attrs !== null) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === void 0 || value === false) continue;
        if (typeof value === "function") {
          node.addEventListener(key.slice(2), value);
          continue;
        }
        if (PROPERTY_ATTRS.has(key)) {
          node[key] = value;
          continue;
        }
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    }
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function el(id) {
    const node = document.getElementById(id);
    if (node === null) throw new Error(`Trang không có ô "${id}".`);
    return node;
  }
  function str(x) {
    return x === void 0 || x === null ? "" : String(x);
  }
  function money(n) {
    const value = Number(n ?? 0);
    if (!Number.isFinite(value)) return "—";
    return `${value.toLocaleString("vi-VN")}đ`;
  }
  function digits(x) {
    return Number(String(x ?? "").replace(/[^0-9]/g, "")) || 0;
  }
  var two = (n) => n < 10 ? `0${n}` : String(n);
  function clock(iso) {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }
  function day(iso) {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return str(iso) || "—";
    return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function dayClock(iso) {
    const t = clock(iso);
    return t === "" ? "—" : `${day(iso)} ${t}`;
  }
  function status(node, text2, tone = "") {
    node.textContent = text2;
    const resolved = tone === true ? "bad" : tone === false ? "good" : tone;
    node.className = `status-line${resolved === "" ? "" : ` ${resolved}`}`;
  }
  function tableRow(cells, numeric = []) {
    const tr = document.createElement("tr");
    cells.forEach((cell, i) => {
      const td = document.createElement("td");
      if (numeric.includes(i)) td.className = "num";
      if (cell instanceof Node) td.appendChild(cell);
      else td.textContent = str(cell);
      tr.appendChild(td);
    });
    return tr;
  }
  function selectRow(body, tr) {
    for (const old of body.querySelectorAll("tr[data-chon='1']")) old.setAttribute("data-chon", "0");
    tr.setAttribute("data-chon", "1");
  }
  function badge(text2, tone = "") {
    return h("span", { class: `badge${tone === "" ? "" : ` ${tone}`}` }, text2);
  }
  function confirmTwice(button, askText, action) {
    const original = button.textContent ?? "";
    let armed = false;
    let timer = null;
    button.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        button.textContent = askText;
        timer = setTimeout(() => {
          armed = false;
          button.textContent = original;
        }, 6e3);
        return;
      }
      if (timer !== null) clearTimeout(timer);
      armed = false;
      button.textContent = original;
      action();
    });
  }
  function metric(label, id, hint) {
    return h(
      "section",
      { class: "panel metric" },
      h("div", { class: "label" }, label),
      h("div", { class: "value", id }, "—"),
      h("div", { class: "hint" }, hint)
    );
  }
  function table(headers, bodyId, opts = {}) {
    const thead = h("thead", null, h("tr", null, ...headers.map((t) => h("th", null, t))));
    const tbl = h("table", null, thead, h("tbody", { id: bodyId }));
    return h("div", { class: opts.scroll === false ? "table-wrap" : "table-wrap scroll" }, tbl);
  }

  // ../omi/packages/omi-ui/src/screens/broken-screen.ts
  var BrokenScreen = class {
    constructor(gateway, host) {
      this.gateway = gateway;
      this.host = host;
      this.root = h(
        "section",
        { class: "screen", id: "man-hong", hidden: true },
        h("h1", null, "Chưa chạy được"),
        h("p", { class: "lead bad", id: "hong-visao" }),
        h(
          "div",
          { class: "toolbar" },
          h("button", { class: "primary-button", id: "nut-mo-lai", type: "button", onclick: () => void this.retry() }, "Thử lại"),
          h("button", { class: "secondary-button", id: "nut-hong-doi-key", type: "button", onclick: () => this.otherKey() }, "Nhập key khác")
        )
      );
    }
    gateway;
    host;
    root;
    last = null;
    render(data) {
      this.last = data;
      el("hong-visao").textContent = data.viSao;
    }
    /** Used by the boot path when even `man` fails: show a reason without a full screen object. */
    showReason(reason) {
      el("hong-visao").textContent = reason;
    }
    async retry() {
      el("hong-visao").textContent = "Đang thử lại…";
      try {
        this.host.applyScreen(await this.gateway.reopen());
      } catch (e) {
        el("hong-visao").textContent = humanError(e);
      }
    }
    otherKey() {
      this.host.showKeyEntry({ viSao: "Nhập key cho máy này.", xeon: str(this.last?.xeon), tenMay: "" });
    }
  };

  // ../omi/packages/omi-ui/src/screens/full-screen.ts
  var FullScreen = class {
    constructor(gateway, host) {
      this.gateway = gateway;
      this.host = host;
      this.root = h(
        "section",
        { class: "screen", id: "man-day", hidden: true },
        h("h1", null, "Key này đã đủ máy"),
        h("p", { class: "lead bad", id: "day-visao" }),
        table(["Tên máy", "Mã", "Ghép lúc", "Kiểm gần nhất", "Trực"], "day-bang"),
        h("p", { class: "subtle" }, "Vào trang ", h("b", { id: "day-link" }), " trên trình duyệt, nhập key, bấm ", h("b", null, "Bỏ máy này"), " ở một máy không dùng nữa, rồi quay lại đây bấm Thử lại."),
        h(
          "div",
          { class: "toolbar" },
          h("button", { class: "primary-button", id: "nut-day-thu-lai", type: "button", onclick: () => void this.retry() }, "Thử lại"),
          h("button", { class: "secondary-button", id: "nut-day-doi-key", type: "button", onclick: () => this.otherKey() }, "Dùng key khác")
        )
      );
    }
    gateway;
    host;
    root;
    last = null;
    render(data) {
      this.last = data;
      el("day-visao").textContent = data.viSao;
      el("day-link").textContent = `${str(data.xeon)}/may`;
      const body = el("day-bang");
      clear(body);
      for (const m of data.may) {
        body.appendChild(tableRow([m.tenMay, m.id, m.ghepLuc ? dayClock(m.ghepLuc) : "—", m.kiemLuc ? dayClock(m.kiemLuc) : "—", m.truc ? "máy trực" : ""]));
      }
    }
    async retry() {
      el("day-visao").textContent = "Đang kiểm lại…";
      try {
        this.host.applyScreen(await this.gateway.recheck());
      } catch (e) {
        el("day-visao").textContent = humanError(e);
      }
    }
    otherKey() {
      this.host.showKeyEntry({ viSao: "Nhập key khác cho máy này.", xeon: str(this.last?.xeon), tenMay: str(this.last?.tenMay) });
    }
  };

  // ../omi/packages/omi-ui/src/screens/key-entry.ts
  var KeyEntryScreen = class {
    constructor(gateway, host) {
      this.gateway = gateway;
      this.host = host;
      this.root = h(
        "section",
        { class: "screen", id: "man-nhap-key", hidden: true },
        h("h1", null, "Nhập license key của shop"),
        h("p", { class: "lead", id: "nhap-key-visao" }),
        h(
          "div",
          { class: "form-grid" },
          h("label", { for: "o-key" }, "License key"),
          h("input", { id: "o-key", type: "text", placeholder: "TR-XXXX-XXXX-XXXX-XXXX", spellcheck: "false", autocomplete: "off", onkeydown: (e) => {
            if (e.key === "Enter") void this.activate();
          } }),
          h("label", { for: "o-ten-may" }, "Tên máy này"),
          h("input", { id: "o-ten-may", type: "text", placeholder: "máy bán hàng 1" })
        ),
        h(
          "div",
          { class: "toolbar" },
          h("button", { class: "primary-button", id: "nut-kich-hoat", type: "button", onclick: () => void this.activate() }, "Vào bằng key này"),
          h("span", { class: "status-line", id: "kich-hoat-trang-thai" }, "Key do nơi cấp phần mềm gửi. Mỗi key dùng được 3 máy.")
        ),
        h(
          "details",
          { class: "panel advanced" },
          h("summary", null, "Nâng cao: địa chỉ Xeon"),
          h(
            "div",
            { class: "toolbar" },
            h("input", { id: "o-xeon", type: "text", placeholder: "https://xeon.toprun.vn" }),
            h("button", { class: "secondary-button", id: "nut-xeon-thu", type: "button", onclick: () => void this.tryXeon() }, "Thử nối"),
            h("button", { class: "secondary-button", id: "nut-xeon-luu", type: "button", onclick: () => void this.saveXeon() }, "Lưu"),
            h("span", { class: "status-line", id: "xeon-trang-thai" })
          )
        )
      );
    }
    gateway;
    host;
    root;
    render(data) {
      el("nhap-key-visao").textContent = data.viSao;
      const name = el("o-ten-may");
      if (name.value.trim() === "") name.value = str(data.tenMay);
      const xeon = el("o-xeon");
      if (xeon.value.trim() === "") xeon.value = str(data.xeon);
    }
    async activate() {
      const keyInput = el("o-key");
      const key = keyInput.value.trim();
      const line = el("kich-hoat-trang-thai");
      if (key === "") {
        status(line, "Dán key vào ô trên.", "bad");
        return;
      }
      const button = el("nut-kich-hoat");
      button.disabled = true;
      status(line, "Đang kiểm với Xeon…");
      try {
        const result = await this.gateway.activate(key, el("o-ten-may").value);
        status(line, result.ok ? "Xong." : result.viSao, result.ok ? "good" : "bad");
        if (result.ok) keyInput.value = "";
        this.host.applyScreen(result.man);
      } catch (e) {
        status(line, humanError(e), "bad");
      } finally {
        button.disabled = false;
      }
    }
    async tryXeon() {
      status(el("xeon-trang-thai"), "Đang thử…");
      const r = await this.gateway.settings("thu-noi", { xeon: el("o-xeon").value });
      status(el("xeon-trang-thai"), r.viSao, r.ok ? "good" : "bad");
    }
    async saveXeon() {
      const r = await this.gateway.settings("luu", { xeon: el("o-xeon").value, tenMay: el("o-ten-may").value || "may" });
      status(el("xeon-trang-thai"), r.viSao, r.ok ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/shell/log-panel.ts
  var POLL_MS = 2e3;
  var LogPanel = class {
    constructor(gateway) {
      this.gateway = gateway;
    }
    gateway;
    lastFingerprint = "";
    timer = null;
    build() {
      const root = h(
        "section",
        { class: "log-panel" },
        h(
          "div",
          { class: "log-head" },
          h("span", null, "Máy đang làm gì"),
          h("label", { class: "check" }, h("input", { type: "checkbox", id: "hien-may", onchange: () => {
            this.lastFingerprint = "";
            void this.refresh();
          } }), " Hiện cả dòng kỹ thuật"),
          h("button", { class: "secondary-button compact-button", id: "nut-chep", type: "button", onclick: () => void this.copy() }, "Chép nhật ký")
        ),
        h("div", { class: "log-body", id: "nhat-ky-than" })
      );
      return root;
    }
    start() {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), POLL_MS);
      window.addEventListener("beforeunload", () => {
        if (this.timer !== null) clearInterval(this.timer);
      });
    }
    async refresh() {
      let lines2;
      try {
        lines2 = await this.gateway.log();
      } catch {
        return;
      }
      const showMachine = el("hien-may").checked;
      const shown = lines2.filter((d) => showMachine || d.muc !== "may");
      const fingerprint = shown.map((d) => d.luc + d.chu).join("\n");
      if (fingerprint === this.lastFingerprint) return;
      this.lastFingerprint = fingerprint;
      const body = el("nhat-ky-than");
      const wasAtBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;
      body.textContent = "";
      for (const d of shown) {
        body.appendChild(h("div", { class: `lv-${d.muc}` }, h("span", { class: "when" }, `${clock(d.luc)}  `), d.chu));
      }
      if (wasAtBottom) body.scrollTop = body.scrollHeight;
    }
    async copy() {
      const button = el("nut-chep");
      try {
        const lines2 = await this.gateway.log();
        const text2 = lines2.map((d) => `${d.luc}  [${d.muc}] ${d.chu}`).join("\n");
        if (!navigator.clipboard) throw new Error("no clipboard");
        await navigator.clipboard.writeText(text2);
        button.textContent = "Đã chép";
        setTimeout(() => {
          button.textContent = "Chép nhật ký";
        }, 2e3);
      } catch {
        button.textContent = "Không chép được — bôi đen rồi Ctrl+C";
        setTimeout(() => {
          button.textContent = "Chép nhật ký";
        }, 4e3);
      }
    }
  };

  // ../omi/packages/omi-ui/src/shell/app-shell.ts
  var WORKSPACE_LABEL = { common: "Tác vụ chung", landing: "Landing page" };
  var AppShell = class {
    constructor(gateway) {
      this.gateway = gateway;
      this.keyEntry = new KeyEntryScreen(gateway, this);
      this.full = new FullScreen(gateway, this);
      this.broken = new BrokenScreen(gateway, this);
      this.logPanel = new LogPanel(gateway);
      this.navs = {
        common: h("nav", { class: "nav", "data-workspace-nav": "common", "aria-label": "Điều hướng tác vụ chung" }),
        landing: h("nav", { class: "nav", "data-workspace-nav": "landing", "aria-label": "Điều hướng landing page", hidden: true })
      };
      this.viewArea = h("section", { id: "khu-ban", class: "view", "aria-live": "polite", hidden: true });
    }
    gateway;
    views = /* @__PURE__ */ new Map();
    navs;
    viewArea;
    keyEntry;
    full;
    broken;
    logPanel;
    current = null;
    workspace = "common";
    licenseNow = null;
    openedOnce = false;
    /** Build the whole page into `body`. Call once, before `register`. */
    mount(body) {
      const sidebar = h(
        "aside",
        { class: "sidebar" },
        h(
          "div",
          { class: "brand" },
          h("div", { class: "brand-mark" }, "OMI"),
          h("div", null, h("h1", null, "OMI"), h("p", null, "Bàn điều hành của shop"))
        ),
        h(
          "div",
          { class: "workspace-tabs", "aria-label": "Khu vực làm việc" },
          ...["common", "landing"].map((ws) => h("button", { class: `workspace-tab${ws === "common" ? " active" : ""}`, "data-workspace-tab": ws, type: "button", onclick: () => this.setWorkspace(ws) }, WORKSPACE_LABEL[ws]))
        ),
        this.navs.common,
        this.navs.landing,
        h(
          "div",
          { class: "sidebar-status" },
          h("div", { class: "status-dot", id: "trang-thai-cham" }),
          h("div", null, h("strong", { id: "ban-giay-phep" }, "Chưa có license"), h("span", { id: "ban-dia-chi" }, "—"))
        )
      );
      const topbar = h(
        "header",
        { class: "topbar" },
        h(
          "div",
          null,
          h("p", { class: "eyebrow" }, h("span", { id: "ten-shop" }, "—"), " ", h("span", { id: "thanh-truc" })),
          h("h2", { id: "view-title" }, "OMI")
        ),
        h(
          "div",
          { class: "topbar-actions" },
          h("span", { class: "pill", id: "pill-day", "data-muc": "cho" }, "Đang mở…"),
          h("button", { class: "secondary-button", id: "nut-lam-moi", type: "button", onclick: () => this.current?.refresh() }, "Làm mới")
        )
      );
      const main = h(
        "main",
        { class: "main" },
        h("div", { id: "ban-canh-bao", class: "runtime-alert", hidden: true }),
        topbar,
        this.viewArea,
        h("div", { class: "screens" }, this.keyEntry.root, this.full.root, this.broken.root),
        this.logPanel.build()
      );
      body.appendChild(h("button", { id: "sidebar-toggle", class: "sidebar-toggle", type: "button", "aria-label": "Ẩn menu chính", "aria-expanded": "true", onclick: () => this.toggleSidebar() }, "☰"));
      body.appendChild(h("div", { class: "app-shell" }, sidebar, main));
    }
    /** Add a view: sidebar button `#tab-<id>` + container `#than-<id>`. Order of calls = order in nav. */
    register(view) {
      if (this.views.has(view.id)) throw new Error(`View "${view.id}" registered twice.`);
      this.views.set(view.id, view);
      const button = h(
        "button",
        { class: "nav-item", id: `tab-${view.id}`, type: "button", "data-view": view.id, onclick: () => this.open(view.id) },
        h("span", null, view.glyph),
        h("span", null, view.label)
      );
      this.navs[view.workspace].appendChild(button);
      const container = h("div", { class: "view-body", id: `than-${view.id}`, hidden: true });
      this.viewArea.appendChild(container);
      view.mount(container);
    }
    /**
     * A second sidebar entry for a view in the OTHER workspace (Sales Desk lists Đơn hàng, Khách hàng
     * and Fanpage in both). One view, one container, one state — the entry only opens it without
     * switching workspace. Call after `register(view)`.
     */
    alias(viewId, workspace, label, glyph) {
      if (!this.views.has(viewId)) throw new Error(`Alias for unknown view "${viewId}".`);
      const button = h(
        "button",
        { class: "nav-item", id: `tab-${workspace}-${viewId}`, type: "button", "data-view": viewId, "data-alias": "1", onclick: () => this.open(viewId, void 0, { keepWorkspace: true }) },
        h("span", null, glyph),
        h("span", null, label)
      );
      this.navs[workspace].appendChild(button);
    }
    /** Read the screen from the main process, subscribe to changes, start the log. */
    boot() {
      this.gateway.onScreenChange((screen) => this.applyScreen(screen));
      this.gateway.screen().then((screen) => this.applyScreen(screen)).catch((e) => {
        this.showOnly("hong");
        this.broken.showReason(humanError(e));
      });
      this.logPanel.start();
    }
    // ----- ShellApi -----
    open(viewId, params, opts = {}) {
      const view = this.views.get(viewId);
      if (view === void 0) throw new Error(`Không có màn "${viewId}".`);
      this.current = view;
      for (const [id, v] of this.views) {
        el(`than-${id}`).hidden = v !== view;
        el(`tab-${id}`).classList.toggle("active", v === view);
      }
      for (const alias of document.querySelectorAll("[data-alias]")) alias.classList.toggle("active", alias.dataset["view"] === viewId);
      el("view-title").textContent = view.title;
      if (view.workspace !== this.workspace && opts.keepWorkspace !== true) this.setWorkspace(view.workspace);
      view.activate();
      if (params !== void 0) view.receive(params);
    }
    license() {
      return this.licenseNow;
    }
    applyScreen(screen) {
      const s = screen;
      if (s === null || typeof s !== "object" || typeof s.man !== "string") return;
      switch (s.man) {
        case "nhap-key":
          this.showKeyEntry({ viSao: s.viSao, xeon: s.xeon, tenMay: s.tenMay });
          break;
        case "day":
          this.showOnly("day");
          this.full.render({ viSao: s.viSao, may: s.may, xeon: s.xeon, tenMay: s.tenMay, soMay: s.soMay });
          this.setHeader(`key ${str(s.keyChe)}`, "", `Đủ ${s.soMay || 3} máy`, "xau");
          break;
        case "hong":
          this.showOnly("hong");
          this.broken.render({ viSao: s.viSao, xeon: s.xeon });
          this.setHeader("—", "", "Chưa chạy được", "xau");
          break;
        case "dang-dung":
          this.showWorking(s.license, s.canhBao);
          break;
        default:
          return;
      }
      void this.logPanel.refresh();
    }
    forgetLicensed() {
      this.openedOnce = false;
    }
    showKeyEntry(data) {
      this.showOnly("nhap-key");
      this.keyEntry.render(data);
      this.setHeader("chưa có license", "", "Chưa có key", "tat");
      el("ban-giay-phep").textContent = "Chưa có license";
      el("ban-dia-chi").textContent = "—";
      el("trang-thai-cham").classList.remove("online");
    }
    // ----- internals -----
    showWorking(license2, warning) {
      this.licenseNow = license2;
      this.showOnly(null);
      this.setHeader(str(license2.tenShop || license2.shop), license2.truc ? "máy trực" : "", warning ? "Chạy bằng vé cũ" : "Đã có vé", warning ? "cho" : "tot");
      const alert = el("ban-canh-bao");
      alert.hidden = warning === "";
      alert.textContent = warning;
      el("ban-giay-phep").textContent = `License: ${str(license2.tenShop)} · hạn ${day(license2.hetHan)}${license2.truc ? " · máy trực" : ""}`;
      el("trang-thai-cham").classList.add("online");
      for (const view of this.views.values()) view.licenseChanged(license2);
      if (!this.openedOnce) {
        this.openedOnce = true;
        void this.afterLicensed();
      }
    }
    /** First time we have a ticket: probe the landing, then open Orders (or Settings if unreachable). */
    async afterLicensed() {
      for (const view of this.views.values()) view.reset();
      const r = await this.gateway.landing("phien-ban");
      el("ban-dia-chi").textContent = r.ok ? `Landing: đang nối được${r.than?.deployId ? ` · bản ${r.than.deployId}` : ""}` : `Landing: ${r.viSao || "chưa nối được"}`;
      this.open(r.ok ? "don" : "cai-dat");
    }
    /** Show one license screen, or none (`null`) to show the working area. */
    showOnly(screen) {
      for (const name of ["nhap-key", "day", "hong"]) el(`man-${name}`).hidden = name !== screen;
      this.viewArea.hidden = screen !== null;
      document.body.dataset.man = screen ?? "dang-dung";
      if (screen !== null) {
        el("view-title").textContent = screen === "nhap-key" ? "Nhập license key" : screen === "day" ? "Key đã đủ máy" : "Chưa chạy được";
      } else if (this.current !== null) {
        el("view-title").textContent = this.current.title;
      }
    }
    setHeader(shop, duty, pillText, pill) {
      el("ten-shop").textContent = shop;
      el("thanh-truc").textContent = duty;
      const p = el("pill-day");
      p.textContent = pillText;
      p.setAttribute("data-muc", pill);
    }
    setWorkspace(ws) {
      this.workspace = ws;
      document.body.dataset.workspace = ws;
      for (const tab of document.querySelectorAll("[data-workspace-tab]")) tab.classList.toggle("active", tab.dataset.workspaceTab === ws);
      for (const key of ["common", "landing"]) this.navs[key].hidden = key !== ws;
    }
    toggleSidebar() {
      const collapsed = document.body.classList.toggle("sidebar-collapsed");
      const toggle = el("sidebar-toggle");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("aria-label", collapsed ? "Mở menu chính" : "Ẩn menu chính");
    }
  };

  // ../omi/packages/omi-ui/src/shell/view.ts
  var View = class {
    constructor(ctx) {
      this.ctx = ctx;
    }
    ctx;
    root;
    loaded = false;
    /** Build DOM once into the container the shell hands over. */
    mount(root) {
      this.root = root;
      this.build(root);
      const table2 = this.actions;
      if (Object.keys(table2).length === 0) return;
      root.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-action]");
        if (button === null || !root.contains(button)) return;
        const work = table2[button.dataset["action"] ?? ""];
        if (work === void 0) return;
        event.preventDefault();
        if (button instanceof HTMLButtonElement && button.disabled) return;
        void Promise.resolve(work(button, event)).catch((e) => this.actionFailed(button.dataset["action"] ?? "", e));
      });
    }
    /**
     * Named jobs of this screen, keyed by the Desk `data-action` name. A button with
     * `data-action="x"` runs `actions.x(button)`. Views that bind their own listeners leave it empty.
     */
    actions = {};
    /** A job threw (a bug, not a server refusal — those come back as `ok:false`). Default: log to console. */
    actionFailed(action, error) {
      console.error(`[${this.id}] việc "${action}" hỏng:`, error);
    }
    /** Shell calls this when the view becomes visible. */
    activate() {
      if (this.loaded) return;
      this.loaded = true;
      this.load();
    }
    /** First-visit data load. Default: nothing. */
    load() {
    }
    /** Explicit reload (topbar button). Default: run `load()` again. */
    refresh() {
      this.loaded = true;
      this.load();
    }
    /** Forget loaded state so the next visit reloads (new ticket, new shop). */
    reset() {
      this.loaded = false;
    }
    /** License changed (ticket refreshed, duty flag changed). Default: ignore. */
    licenseChanged(_license) {
    }
    /** Another view opened this one with parameters (e.g. Customers → Orders filtered by phone). Default: ignore. */
    receive(_params) {
    }
  };

  // ../omi/packages/omi-ui/src/views/help.ts
  function foldVietnamese(text2) {
    return text2.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  }
  var QUICK_LINKS = [
    { title: "OMI báo chưa có vé / vé hết hạn", text: "Bấm Làm mới hoặc mở Cấu hình → Kiểm lại license. Vé sống 7 giờ, OMI xin lại mỗi 6 giờ; mất mạng lâu hơn thì chạy bằng vé cũ tới khi hết.", keywords: ["license", "ve", "key", "xeon", "het han"] },
    { title: "Key đã đủ 3 máy", text: "Mỗi key dùng được trên 3 máy. Chủ key vào trang quản lý máy trên Xeon để đá một máy cũ ra rồi bấm Thử lại.", keywords: ["key", "3 may", "day may", "license"] },
    { title: "Landing không nối được", text: "Xem chấm trạng thái dưới sidebar. Landing chạy trên hosting của shop: kiểm tra web shop còn mở được không, rồi bấm Làm mới.", keywords: ["landing", "may chu", "khong noi", "hosting"] },
    { title: "Telegram không báo", text: "Màn Kết nối: bot token, chat ID báo động. Bot phải được thêm vào group nhận tin.", keywords: ["telegram", "bot", "chat id", "bao"] },
    { title: "Khách không nhận email", text: "Cấu hình SMTP của landing (host, cổng, tài khoản). Chưa cấu hình thì link xác thực chỉ in ra nhật ký máy chủ.", keywords: ["smtp", "email", "quen mat khau", "xac thuc"] },
    { title: "Fanpage không nhận tin", text: "Màn Kết nối: trang Facebook phải được nối qua app Meta của hệ thống; webhook về Xeon rồi Xeon chuyển về landing theo page.", keywords: ["fanpage", "facebook", "messenger", "webhook", "meta"] },
    { title: "Tạo vận đơn bị hãng từ chối", text: "Tên tỉnh/xã phải khớp danh mục của hãng: dùng ô gợi ý địa chỉ trong đơn, chọn đúng hệ 63 tỉnh cũ hay 34 tỉnh mới, và xem cảnh báo xã bị tách sau sáp nhập.", keywords: ["van don", "spx", "viettel", "dia chi", "tu choi"] },
    { title: "Bảo vệ dữ liệu khách hàng", text: "Thông tin khách, đơn, tồn kho thật và mật khẩu đối tác/CTV là tài sản của shop: không gửi vào chat công khai, không chụp màn hình đăng lên mạng.", keywords: ["bao mat", "du lieu", "khach hang", "rieng tu", "mat khau"] }
  ];
  var FAQS = [
    { question: "Đơn trên web không hiện ở màn Đơn hàng?", answer: [
      "Bấm Tải danh sách đơn, và bỏ lọc số điện thoại / tab quy trình.",
      "Đơn đã xoá nằm ở Thùng rác — khôi phục được.",
      "Nếu vẫn không thấy: mở web shop, đặt thử một đơn nhỏ rồi Tải lại; không thấy nữa thì báo nơi cấp key kèm nhật ký (nút Chép nhật ký)."
    ] },
    { question: "Tồn kho trên web sai so với kho thật?", answer: [
      "Màn Kho hàng sẵn: dùng ±SL kèm lý do, hoặc phiếu nhập kho.",
      "Mọi thay đổi ghi vào Sổ cái — xem dòng gần nhất để biết ai đã sửa gì.",
      "Hủy đơn / xoá đơn tự trả tồn đúng một lần; khôi phục đơn thì lấy lại tồn."
    ] },
    { question: "Đối tác mua hộ không vào được cổng?", answer: [
      "Màn Quản lý đối tác: đối tác phải có ID đăng nhập và đang Mở.",
      "Bấm Reset mật khẩu, chép mật khẩu mới gửi đối tác (chỉ hiện một lần).",
      "Gửi đúng link đăng nhập ở đầu màn — link cũ dạng /partner-<mã> đã đổi."
    ] },
    { question: "CTV báo máy bị chặn?", answer: [
      "Màn CTV/KOL → Máy xin vào: bấm Duyệt máy này.",
      "Khoá CTV sẽ cắt mọi phiên đang mở ngay lập tức."
    ] },
    { question: "Cần gửi câu hỏi cho trợ lý AI / người hỗ trợ?", answer: [
      "Bấm Chép câu hỏi gửi AI ở đầu màn này: OMI chép sẵn thông tin shop, màn đang dùng và nhật ký gần nhất (không kèm key, vé hay mật khẩu).",
      "Dán vào cuộc trò chuyện hỗ trợ và mô tả thêm việc vừa làm."
    ] }
  ];
  var HelpView = class extends View {
    id = "help";
    label = "Help / Hỏi đáp";
    title = "Help / Hỏi đáp";
    workspace = "common";
    glyph = "?";
    actions = {
      "copy-ai-help-prompt": () => this.copyPrompt()
    };
    build(root) {
      root.append(h(
        "div",
        { class: "help-center" },
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Tra cứu nhanh vận hành"), h("p", null, "Các lỗi và thao tác hay gặp khi dùng OMI, web shop (landing), Telegram, Fanpage và vận chuyển.")),
            h("button", { class: "secondary-button", type: "button", "data-action": "copy-ai-help-prompt" }, "Chép câu hỏi gửi AI")
          ),
          h(
            "div",
            { class: "panel-body help-search-row" },
            h("input", { id: "helpSearch", class: "help-search-input", type: "search", placeholder: "Tìm nhanh: license, Telegram, vận đơn, đối tác, CTV, bảo mật…", oninput: () => this.draw() }),
            h("span", { class: "status-line", id: "help-trang-thai" })
          ),
          h("div", { class: "panel-body help-quick-grid", id: "help-nhanh" })
        ),
        h(
          "section",
          { class: "panel" },
          h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Hỏi đáp thường gặp"), h("p", null, "Mở từng mục để xem checklist xử lý."))),
          h("div", { class: "panel-body help-faq-list", id: "help-hoi-dap" })
        )
      ));
      this.draw();
    }
    draw() {
      const query = foldVietnamese(el("helpSearch").value.trim());
      const match = (...texts) => query === "" || texts.some((t) => foldVietnamese(t).includes(query));
      const quick = el("help-nhanh");
      clear(quick);
      const links = QUICK_LINKS.filter((q) => match(q.title, q.text, ...q.keywords));
      for (const q of links) quick.appendChild(h("article", { class: "help-card" }, h("h4", null, q.title), h("p", null, q.text)));
      const faqs = FAQS.filter((f) => match(f.question, ...f.answer));
      if (links.length === 0 && faqs.length === 0) {
        quick.appendChild(h(
          "article",
          { class: "help-card help-empty-card" },
          h("h4", null, "Chưa thấy mục phù hợp"),
          h("p", null, "Thử từ khóa khác như license, Telegram, SMTP, vận đơn, đối tác, CTV hoặc tồn kho.")
        ));
      }
      const list = el("help-hoi-dap");
      clear(list);
      for (const f of faqs) list.appendChild(h("details", { class: "help-faq" }, h("summary", null, f.question), h("ol", null, ...f.answer.map((a) => h("li", null, a)))));
    }
    async copyPrompt() {
      const license2 = this.ctx.shell.license();
      const log = await this.ctx.gateway.log();
      const text2 = [
        "Tôi đang dùng OMI (bàn điều hành của shop) và cần hỗ trợ.",
        `Shop: ${license2?.tenShop ?? "chưa có license"} · ngành ${license2?.nganh ?? "—"} · máy ${license2?.tenMay ?? "—"}${license2?.truc ? " (máy trực)" : ""}`,
        `Mảnh đã mua: ${(license2?.manh ?? []).join(", ") || "—"}`,
        "",
        "Nhật ký gần nhất:",
        ...log.slice(-15).map((d) => `${d.luc ?? ""} ${d.chu ?? ""}`),
        "",
        "Việc tôi vừa làm và điều không như mong đợi:"
      ].join("\n");
      try {
        await navigator.clipboard.writeText(text2);
        status(el("help-trang-thai"), "Đã chép — dán vào cuộc trò chuyện hỗ trợ.", "good");
      } catch {
        status(el("help-trang-thai"), "Máy không cho chép vào bộ nhớ tạm.", "bad");
      }
    }
  };

  // ../omi/packages/omi-ui/src/views/landing-overview.ts
  var REVIEW_PAGES = [
    { id: "home", label: "Trang chủ", path: "/", note: "Catalog, hero, giỏ hàng, sản phẩm nổi bật." },
    { id: "product", label: "Trang sản phẩm", path: "/product.html", note: "Ảnh, size, giá bán web, nút đặt hàng." },
    { id: "account", label: "Tài khoản khách", path: "/account.html", note: "Đăng nhập, tạo tài khoản, quên mật khẩu." },
    { id: "partner_login", label: "Đăng nhập partner", path: "/partner-login", note: "Trang login riêng, không lẫn portal quản lý." },
    { id: "admin", label: "Admin landing", path: "/admin-login", note: "Quản lý đơn và thống kê trên web." }
  ];
  var REVIEW_MARKS = /* @__PURE__ */ new Map();
  function readReview(pageId) {
    return REVIEW_MARKS.get(pageId) ?? "pending";
  }
  function writeReview(pageId, state) {
    if (pageId !== "") REVIEW_MARKS.set(pageId, ["approved", "pending", "changes"].includes(state) ? state : "pending");
  }
  var PERIOD_DAYS = { week: 7, month: 31, year: 366 };
  var PERIOD_LABEL = { week: "Theo tuần hiện tại", month: "Theo tháng hiện tại", year: "Theo năm hiện tại" };
  function formatCount(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "0";
    if (Math.abs(n) < 100 && !Number.isInteger(n)) return n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
    return Math.round(n).toLocaleString("vi-VN");
  }
  function productRange(mode, from = "", to = "", now = /* @__PURE__ */ new Date()) {
    const shift = (days) => {
      const d = new Date(now.getTime());
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    };
    const today = shift(0);
    if (mode === "today") return { from: today, to: today };
    if (mode === "7d") return { from: shift(6), to: today };
    if (mode === "30d") return { from: shift(29), to: today };
    if (mode === "custom" && (from || to)) {
      let a = from || to;
      let b = to || from;
      if (a > b) [a, b] = [b, a];
      return { from: a, to: b };
    }
    return { from: "", to: "" };
  }
  var LandingOverviewView = class extends View {
    id = "tong-quan-landing";
    label = "Tổng quan";
    title = "Tổng quan landing";
    workspace = "landing";
    glyph = "OV";
    period = "week";
    range = "all";
    actions = {
      "refresh-landing-analytics": () => this.loadAnalytics(),
      "set-landing-analytics-period": (b) => {
        this.period = b.dataset["period"] ?? "week";
        this.markActive("period", this.period);
        return this.loadAnalytics();
      },
      "set-landing-product-range": (b) => {
        this.range = b.dataset["range"] ?? "all";
        this.markActive("range", this.range);
        el("tq-khoang-tuy-chon").hidden = this.range !== "custom";
        return this.range === "custom" ? void 0 : this.loadAnalytics();
      },
      "apply-landing-product-range": () => this.loadAnalytics(),
      "go-landing-view": (b) => this.ctx.shell.open(str(b.dataset["view"])),
      "edit-managed-order": (b) => this.ctx.shell.open("don", { moDon: str(b.dataset["orderId"]) }),
      "set-landing-page-review": (b) => {
        writeReview(str(b.dataset["pageId"]), str(b.dataset["status"]));
        this.drawReviews();
      }
    };
    build(root) {
      const segment = (kind, items, active, action) => h(
        "div",
        { class: "segmented-control compact", "data-segment": kind },
        ...items.map(([value, label]) => h("button", { type: "button", class: value === active ? "active" : "", "data-action": action, [`data-${kind}`]: value }, label))
      );
      root.append(
        h("section", { class: "landing-overview-strip", id: "tq-dai-so" }),
        h(
          "section",
          { class: "panel landing-analytics-panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Hiệu quả truy cập web"), h("p", { id: "tq-phu-de" }, "Theo dõi visitor, session và pageview.")),
            h(
              "div",
              { class: "landing-analytics-actions" },
              segment("period", [["week", "Tuần"], ["month", "Tháng"], ["year", "Năm"]], this.period, "set-landing-analytics-period"),
              h("button", { class: "secondary-button compact-button", type: "button", "data-action": "refresh-landing-analytics" }, "Làm mới")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h("div", { class: "landing-analytics-grid", id: "tq-truy-cap" }),
            h("div", { class: "landing-analytics-counter-note" }, "Bấm mua ngay chỉ là lượt nhấp. Chỉ Đơn thành công mới là số đơn máy chủ đã tạo thật."),
            h("div", { class: "landing-analytics-error", id: "tq-loi", hidden: true }),
            h(
              "details",
              { class: "landing-analytics-detail" },
              h("summary", null, h("span", null, "Bảng thống kê chi tiết"), h("small", { id: "tq-ky" }, PERIOD_LABEL[this.period])),
              h(
                "div",
                { class: "table-wrap landing-analytics-table-wrap" },
                h(
                  "table",
                  { class: "landing-analytics-table" },
                  h("thead", null, h("tr", null, ...["Kỳ", "Người truy cập", "Phiên", "Trang / phiên", "Lượt xem trang", "Thêm giỏ", "Bấm mua ngay", "Gửi đặt hàng", "Đơn thành công"].map((t) => h("th", null, t)))),
                  h("tbody", { id: "tq-bang-ngay" })
                )
              )
            ),
            h(
              "div",
              { class: "landing-interest-list" },
              h("div", { class: "section-title-row compact" }, h("h3", null, "Sản phẩm được quan tâm"), h("span", { class: "subtle", id: "tq-khoang-phu-de" }, "Lũy kế theo sản phẩm")),
              h(
                "div",
                { class: "landing-interest-filter" },
                segment("range", [["today", "Hôm nay"], ["7d", "7 ngày"], ["30d", "30 ngày"], ["all", "Lũy kế"], ["custom", "Tùy chọn"]], this.range, "set-landing-product-range"),
                h(
                  "div",
                  { class: "landing-interest-custom-range", id: "tq-khoang-tuy-chon", hidden: true },
                  h("input", { type: "date", id: "tq-tu-ngay", "aria-label": "Từ ngày" }),
                  h("span", { class: "subtle" }, "đến"),
                  h("input", { type: "date", id: "tq-den-ngay", "aria-label": "Đến ngày" }),
                  h("button", { class: "secondary-button compact-button", type: "button", "data-action": "apply-landing-product-range" }, "Áp dụng")
                )
              ),
              h("div", { id: "tq-san-pham" })
            )
          )
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Vận hành web shop"), h("p", null, "Đơn và bộ đếm của landing này.")),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "primary-button", type: "button", "data-action": "go-landing-view", "data-view": "don" }, "Xem đơn hàng"),
              h("span", { class: "badge blue", id: "tq-tong-tien" }, "Tổng tiền —"),
              h("span", { class: "badge amber", id: "tq-cong-no" }, "Công nợ chung —")
            )
          ),
          h("div", { class: "panel-body" }, h("div", { class: "alert-list", id: "tq-canh-bao" }))
        ),
        h(
          "div",
          { class: "grid two omi-section-gap" },
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Việc cần xử lý ngay"), h("p", null, "Ưu tiên từ trên xuống để đơn không bị kẹt."))),
            h("div", { class: "panel-body landing-task-list", id: "tq-viec" })
          ),
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Đơn mới gần nhất"), h("p", null, "Chỉ hiển thị tên khách để scan nhanh."))),
            h(
              "div",
              { class: "panel-body table-wrap" },
              h(
                "table",
                null,
                h("thead", null, h("tr", null, ...["Mã đơn", "Khách", "Trạng thái", ""].map((t) => h("th", null, t)))),
                h("tbody", { id: "tq-don-moi" })
              )
            )
          )
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Duyệt giao diện các trang"), h("p", null, "Mở từng trang quan trọng trên trình duyệt, đánh dấu Đạt / Cần sửa. Trạng thái giữ trong phiên làm việc này.")),
            h("span", { class: "badge amber" }, "Preview online")
          ),
          h("div", { class: "panel-body landing-page-review-grid", id: "tq-duyet-trang" })
        ),
        h("span", { class: "status-line", id: "tq-trang-thai" })
      );
    }
    /** Desk `landingPageReviewCard` without the iframe (the OMI page may not frame outside sites). */
    drawReviews() {
      const box = el("tq-duyet-trang");
      clear(box);
      const origin = str(this.ctx.shell.license()?.diaChiLanding).replace(/\/+$/, "");
      for (const page of REVIEW_PAGES) {
        const state = readReview(page.id);
        const tone = state === "approved" ? "green" : state === "changes" ? "red" : "amber";
        const label = state === "approved" ? "Đạt" : state === "changes" ? "Cần sửa" : "Chưa duyệt";
        box.appendChild(h(
          "article",
          { class: `landing-page-review-card ${state}`, "data-page": page.id },
          h(
            "div",
            { class: "landing-page-review-head" },
            h("div", null, h("strong", null, page.label), h("span", null, page.note)),
            badge(label, tone)
          ),
          h("p", { class: "subtle" }, origin === "" ? page.path : origin + page.path),
          h(
            "div",
            { class: "split-actions compact-actions" },
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "set-landing-page-review", "data-page-id": page.id, "data-status": "approved" }, "Đạt"),
            h("button", { class: "ghost-button compact-button", type: "button", "data-action": "set-landing-page-review", "data-page-id": page.id, "data-status": "pending" }, "Chưa duyệt"),
            h("button", { class: "danger-button compact-button", type: "button", "data-action": "set-landing-page-review", "data-page-id": page.id, "data-status": "changes" }, "Cần sửa")
          )
        ));
      }
    }
    load() {
      this.drawReviews();
      void this.loadOperations();
      void this.loadAnalytics();
    }
    markActive(kind, value) {
      for (const b of this.root.querySelectorAll(`[data-segment="${kind}"] button`)) b.classList.toggle("active", b.dataset[kind] === value);
    }
    metric(label, value, note, tone = "") {
      return h("article", { class: `landing-compact-metric${tone ? ` ${tone}` : ""}` }, h("span", null, label), h("strong", null, formatCount(value)), h("small", null, note));
    }
    async loadOperations() {
      const [orders, counts, purchase, partners] = await Promise.all([
        this.ctx.gateway.landing("don.danh-sach", { gioiHan: 500 }),
        this.ctx.gateway.landing("don.dem-nhom"),
        this.ctx.gateway.landing("mua-ho.bang", { gioiHan: 500 }),
        this.ctx.gateway.landing("doi-tac.danh-sach")
      ]);
      if (!orders.ok) {
        status(el("tq-trang-thai"), orders.viSao, "bad");
        return;
      }
      const rows = orders.than ?? [];
      const dem = counts.than?.dem ?? {};
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const open = rows.filter((o) => !["completed", "cancelled", "returned_to_stock"].includes(o.trangThai));
      const noShipping = open.filter((o) => o.maVanDon === "").length;
      const unassigned = open.filter((o) => o.mon.some((m) => m.maKho === "" && m.maDoiTac === "")).length;
      const toBuy = purchase.ok ? (purchase.than?.canMua ?? []).length : 0;
      const strip = el("tq-dai-so");
      clear(strip);
      strip.append(
        this.metric("Đơn xử lý", counts.than?.tongDangHoatDong ?? open.length, "Đang hoạt động"),
        this.metric("Mới hôm nay", rows.filter((o) => o.taoLuc.slice(0, 10) === today).length, "Trong ngày"),
        this.metric("Chờ đối tác", dem["workflow_purchase"] ?? 0, "Đang mua"),
        this.metric("Sẵn sàng giao", dem["workflow_delivery"] ?? 0, "Có hàng"),
        this.metric("Cần xử lý", dem["workflow_attention"] ?? 0, "Thiếu hàng, lệch tiền…", (dem["workflow_attention"] ?? 0) > 0 ? "bad" : ""),
        this.metric("Chưa vận đơn", noShipping, "Cần mã", noShipping > 0 ? "warn" : "")
      );
      el("tq-tong-tien").textContent = `Tổng tiền ${money(open.reduce((t, o) => t + o.tong, 0))}`;
      const alertRow = (label, value, note) => h(
        "div",
        { class: "alert-row" },
        h("span"),
        h("div", null, h("strong", null, label), h("div", { class: "subtle" }, note)),
        badge(String(value), value ? "amber" : "green")
      );
      const alerts = el("tq-canh-bao");
      clear(alerts);
      alerts.append(
        alertRow("Đơn chưa phân bổ kho / đối tác", unassigned, "Vào Danh sách đơn hàng để chọn kho cho từng dòng."),
        alertRow("Sản phẩm cần mua", toBuy, "Gom theo mã sản phẩm, size và đối tác."),
        alertRow("Vận đơn cần cập nhật", noShipping, "Vào Vận đơn để tạo mã hoặc cập nhật trạng thái giao.")
      );
      let debt = 0;
      let owing = 0;
      for (const p of partners.ok ? partners.than ?? [] : []) {
        const portal = await this.ctx.gateway.landing("mua-ho.cong", { doiTac: p.ma });
        const d = portal.ok ? Number(portal.than?.summary?.debtAmount ?? 0) : 0;
        debt += d;
        if (d > 0) owing += 1;
      }
      el("tq-cong-no").textContent = `Công nợ chung ${money(debt)}`;
      const taskRow = (label, count, view) => h(
        "div",
        { class: "alert-row" },
        h("span"),
        h("div", null, h("strong", null, label), h("div", { class: "subtle" }, count ? "Cần xử lý" : "Đang ổn")),
        h(
          "div",
          { class: "split-actions compact-actions" },
          badge(String(count), count ? "amber" : "green"),
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "go-landing-view", "data-view": view }, "Mở")
        )
      );
      const tasks = el("tq-viec");
      clear(tasks);
      tasks.append(
        taskRow("Phân bổ kho / đối tác cho đơn", unassigned, "don"),
        taskRow("Xác nhận sản phẩm cần mua", toBuy, "mua-ho"),
        taskRow("Cập nhật vận đơn", noShipping, "van-don"),
        taskRow("Xem công nợ đối tác", owing, "doi-tac")
      );
      const recent = el("tq-don-moi");
      clear(recent);
      for (const o of [...rows].sort((a, b) => b.taoLuc.localeCompare(a.taoLuc)).slice(0, 8)) {
        recent.appendChild(h(
          "tr",
          null,
          h("td", null, h("strong", null, o.id)),
          h("td", null, o.khach || "Khách chưa lưu"),
          h("td", null, badge(o.trangThai || "—")),
          h("td", null, h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-managed-order", "data-order-id": o.id }, "Sửa đơn"))
        ));
      }
      if (rows.length === 0) recent.appendChild(h("tr", null, h("td", { colspan: "4" }, "Chưa có đơn.")));
    }
    async loadAnalytics() {
      const errorBox = el("tq-loi");
      const range = productRange(this.range, el("tq-tu-ngay").value, el("tq-den-ngay").value);
      el("tq-phu-de").textContent = "Đang tải số liệu truy cập, giỏ hàng và sản phẩm quan tâm.";
      const r = await this.ctx.gateway.landing("thong-ke.bao-cao", {
        soNgay: PERIOD_DAYS[this.period],
        ...range.from ? { tuNgay: range.from, denNgay: range.to } : {}
      });
      el("tq-ky").textContent = PERIOD_LABEL[this.period];
      if (!r.ok) {
        errorBox.hidden = false;
        errorBox.textContent = r.viSao;
        el("tq-phu-de").textContent = "Chưa đọc được dữ liệu truy cập từ landing.";
        return;
      }
      errorBox.hidden = true;
      const data = r.than?.data ?? {};
      const t = data.totals ?? {};
      const pageViews = Number(t["pageViews"] ?? t["page_view"] ?? 0);
      const sessions = Number(t["sessions"] ?? 0);
      el("tq-phu-de").textContent = `${PERIOD_LABEL[this.period]} · Theo dõi visitor, session và pageview.`;
      const grid = el("tq-truy-cap");
      clear(grid);
      const addCart = Number(t["add_to_cart"] ?? 0);
      grid.append(
        this.metric("Người truy cập", t["visitors"] ?? t["uniqueVisitors"], "Visitor thực tế"),
        this.metric("Phiên truy cập", sessions, "Session"),
        this.metric("Trang / phiên", sessions ? Math.round(pageViews / sessions * 10) / 10 : 0, "Trung bình"),
        this.metric("Lượt xem trang", pageViews, "Page view"),
        this.metric("Thêm giỏ", addCart, `${pageViews ? Math.round(addCart * 1e3 / pageViews) / 10 : 0}% / pageview`),
        this.metric("Bấm mua ngay", t["buy_now"], "Lượt nhấp, chưa phải đơn"),
        this.metric("Gửi đặt hàng", t["order_submit"], "Lượt gửi form"),
        this.metric("Đơn thành công", t["order_success"], "Máy chủ ghi khi đơn có thật")
      );
      const days = el("tq-bang-ngay");
      clear(days);
      for (const row of data.daily ?? []) {
        const pv = Number(row["pageViews"] ?? row["page_view"] ?? 0);
        const ss = Number(row["sessions"] ?? 0);
        days.appendChild(h(
          "tr",
          null,
          h("td", null, h("strong", null, str(row["day"]))),
          ...[row["uniqueVisitors"], ss, ss ? Math.round(pv / ss * 10) / 10 : 0, pv, row["add_to_cart"], row["buy_now"], row["order_submit"], row["order_success"]].map((v) => h("td", null, formatCount(v)))
        ));
      }
      if ((data.daily ?? []).length === 0) days.appendChild(h("tr", null, h("td", { colspan: "9", class: "subtle" }, "Chưa có bảng chi tiết từ landing.")));
      el("tq-khoang-phu-de").textContent = this.range === "all" ? "Lũy kế theo sản phẩm; “Bấm mua” là hành vi, “Đặt” là tạo đơn thành công" : range.from ? `${range.from} – ${range.to}; “Bấm mua” là hành vi, “Đặt” là tạo đơn thành công` : "Chọn khoảng thời gian rồi bấm Áp dụng";
      const list = el("tq-san-pham");
      clear(list);
      const coverage = str(data.productCoverageFrom);
      if (range.from && coverage && range.from < coverage) list.appendChild(h("p", { class: "subtle landing-interest-coverage-note" }, `Số Xem / Giỏ / Bấm mua theo ngày chỉ tích từ ${coverage}.`));
      for (const p of (data.products ?? []).slice(0, 8)) {
        list.appendChild(h(
          "div",
          { class: "landing-interest-row" },
          h("div", null, h("strong", null, p.name || p.code), h("span", null, p.code)),
          h(
            "div",
            { class: "landing-interest-stats" },
            h("span", null, `Xem ${formatCount(p.product_view)}`),
            h("span", null, `Giỏ ${formatCount(p.add_to_cart)}`),
            h("span", null, `Bấm mua ${formatCount(p.buy_now)}`),
            h("span", null, `Đặt ${formatCount(p.order_success)}`)
          )
        ));
      }
      if ((data.products ?? []).length === 0) list.appendChild(h("p", { class: "subtle" }, "Chưa có dữ liệu sản phẩm quan tâm trong khoảng thời gian này."));
    }
  };

  // ../omi/packages/omi-ui/src/views/ask-dialog.ts
  var closeOpen = null;
  function askDialog({ title, message = "", fields, submitLabel = "Lưu" }) {
    closeOpen?.(null);
    return new Promise((resolve) => {
      const inputs = fields.map((f) => h("input", {
        type: "text",
        name: f.name,
        value: f.value ?? "",
        ...f.placeholder ? { placeholder: f.placeholder } : {},
        ...f.numeric ? { inputmode: "numeric" } : {}
      }));
      const submit = h("button", { type: "submit", class: "primary-button", id: "omi-ask-ok" }, submitLabel);
      const cancel = h("button", { type: "button", class: "secondary-button", id: "omi-ask-huy" }, "Huỷ");
      const form = h(
        "form",
        { class: "management-modal-panel omi-ask-panel" },
        h("div", { class: "panel-header" }, h("h3", null, title)),
        h(
          "div",
          { class: "management-modal-body" },
          message === "" ? null : h("p", { class: "subtle" }, message),
          ...fields.map((f, i) => h("label", { class: "field" }, h("span", null, f.label), inputs[i] ?? null)),
          h("div", { class: "split-actions" }, submit, cancel)
        )
      );
      const root = h("div", { class: "management-modal partner-fee-dialog", id: "omi-ask" }, h("div", { class: "management-modal-backdrop" }), form);
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close(null);
      };
      const close = (values) => {
        if (closeOpen !== close) return;
        closeOpen = null;
        document.removeEventListener("keydown", onKey, true);
        root.remove();
        resolve(values);
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        close(Object.fromEntries(inputs.map((input) => [input.name, input.value])));
      });
      cancel.addEventListener("click", () => close(null));
      document.addEventListener("keydown", onKey, true);
      closeOpen = close;
      document.body.appendChild(root);
      const first = inputs[0];
      if (first) {
        first.focus();
        first.select();
      } else submit.focus();
    });
  }
  function amountTextValid(value) {
    return /^-?\s*\d{1,3}([.,\s]?\d{3})*$/.test(String(value || "").trim());
  }
  var AMOUNT_HINT = "Số tiền chỉ gõ chữ số, ví dụ 3220000 hoặc 3.220.000 (không gõ 3tr, 1,5tr).";

  // ../omi/packages/omi-ui/src/views/affiliates.ts
  function initialPassword(random = (n) => Math.floor(Math.random() * n)) {
    const letters = "abcdefghjkmnpqrstuvwxyz";
    const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const all = letters + upper + numbers;
    const pick = (set) => set[random(set.length)] ?? "x";
    const chars = [pick(upper), pick(letters), pick(numbers), ...Array.from({ length: 7 }, () => pick(all))];
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = random(i + 1);
      [chars[i], chars[j]] = [chars[j] ?? "", chars[i] ?? ""];
    }
    return chars.join("");
  }
  var AffiliatesView = class extends View {
    id = "ctv";
    label = "CTV/KOL";
    title = "CTV/KOL Affiliate";
    workspace = "common";
    glyph = "AF";
    list = [];
    book = {};
    selected = "";
    /** CTV đang sửa trong form (rỗng = tạo mới). */
    editing = "";
    config = {};
    actions = {
      "toggle-affiliate-password": () => this.togglePassword(),
      "generate-affiliate-password": () => this.generatePassword(),
      "copy-affiliate-login": () => this.copyLogin(),
      "add-affiliate": () => this.save(),
      "toggle-affiliate-active": (b) => this.toggle(b, "dangBat"),
      "toggle-affiliate-logo": (b) => this.toggle(b, "choBoLogo"),
      "manage-affiliate": (b) => this.openDetail(str(b.dataset["affiliateId"])),
      "edit-affiliate": (b) => this.fillForm(str(b.dataset["affiliateId"])),
      "close-affiliate-detail": () => {
        this.selected = "";
        this.drawDetail();
      },
      "pay-affiliate-commission": (b) => this.pay(str(b.dataset["affiliateId"])),
      "ctv-device": (b) => this.device(str(b.dataset["device"]), b.dataset["next"] === "chan" ? "chan" : "duyet"),
      "edit-affiliate-payment": (b) => this.editPayment(str(b.dataset["paymentId"])),
      "void-affiliate-payment": (b) => this.voidPayment(str(b.dataset["paymentId"])),
      "save-affiliate-config": () => this.saveConfig(),
      "add-affiliate-campaign": () => this.addCampaign(),
      "add-affiliate-rule": () => this.addRule()
    };
    build(root) {
      const field = (id, label, attrs = {}) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, ...attrs }));
      const remove = h("button", { class: "danger-button compact-button", type: "button", id: "nut-ctv-xoa", hidden: true }, "Xoá CTV này");
      confirmTwice(remove, "Bấm lần nữa để xoá hẳn", () => void this.remove());
      root.append(
        h(
          "div",
          { class: "grid three" },
          metric("CTV/KOL", "ctv-so", "Người có mã giới thiệu"),
          metric("Doanh số ghi nhận", "ctv-doanh-so", "Theo đơn có affiliate"),
          metric("Hoa hồng nháp", "ctv-hoa-hong", "Chờ duyệt/đối soát")
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Quản lý CTV & affiliate"),
              h("p", null, "Khách phải vào website qua link ?ref= để đơn được ghi nguồn. CTV đăng nhập ở trang /ctv-login của web shop.")
            ),
            h("button", { class: "primary-button", type: "button", id: "nut-ctv-luu-cau-hinh", "data-action": "save-affiliate-config" }, "Lưu cấu hình affiliate")
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "grid three" },
              h(
                "div",
                { class: "config-form" },
                h("h4", { id: "ctv-form-tieu-de" }, "Tạo tài khoản CTV"),
                field("affiliateName", "Tên", { placeholder: "VD: Runner A" }),
                field("affiliateEmail", "Email", { type: "email" }),
                field("affiliateUsername", "Tên đăng nhập"),
                field("affiliateCode", "Mã ref", { placeholder: "VD: RUNNERA" }),
                field("affiliatePhone", "Số điện thoại"),
                h(
                  "div",
                  { class: "field" },
                  h("label", { for: "affiliatePassword" }, "Mật khẩu tạm"),
                  h("input", { id: "affiliatePassword", type: "password", minlength: "8" }),
                  h(
                    "div",
                    { class: "inline-actions" },
                    h("button", { type: "button", class: "secondary-button compact-button", "data-action": "toggle-affiliate-password" }, "Hiện"),
                    h("button", { type: "button", class: "secondary-button compact-button", "data-action": "generate-affiliate-password" }, "Tạo ngẫu nhiên")
                  )
                ),
                field("affiliateDefaultPercent", "Hoa hồng mặc định (%)", { type: "number", min: "0", step: "0.1", placeholder: "VD: 8" }),
                h(
                  "div",
                  { class: "inline-actions" },
                  h("button", { type: "button", class: "secondary-button", "data-action": "copy-affiliate-login" }, "Copy thông tin đăng nhập"),
                  h("button", { type: "button", class: "secondary-button", id: "nut-ctv-ghi", "data-action": "add-affiliate" }, "Tạo CTV"),
                  remove
                ),
                h("span", { class: "status-line", id: "ctv-trang-thai" })
              ),
              h(
                "div",
                { class: "config-form" },
                h("h4", null, "Thêm chiến dịch"),
                field("campaignName", "Tên chiến dịch", { placeholder: "VD: Novablast Launch" }),
                field("campaignCode", "Mã chiến dịch", { placeholder: "VD: NOVA-MAY" }),
                field("campaignScope", "Áp dụng cho", { placeholder: "productLine/product/brand..." }),
                h("div", { class: "field" }, h("label", { for: "campaignNote" }, "Ghi chú"), h("textarea", { id: "campaignNote" })),
                h("button", { class: "secondary-button", type: "button", "data-action": "add-affiliate-campaign" }, "Thêm chiến dịch")
              ),
              h(
                "div",
                { class: "config-form" },
                h("h4", null, "Hoa hồng cố định theo sản phẩm"),
                field("ruleTargetId", "Mã sản phẩm", { placeholder: "VD: JZ1234" }),
                field("ruleValue", "Số tiền / sản phẩm", { type: "number", min: "0", placeholder: "VD: 100000" }),
                h("button", { class: "secondary-button", type: "button", "data-action": "add-affiliate-rule" }, "Thêm rule"),
                h("span", { class: "status-line", id: "ctv-cau-hinh-trang-thai" })
              )
            ),
            h(
              "div",
              { class: "grid two omi-section-gap" },
              h(
                "section",
                { class: "panel" },
                h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Máy xin vào"), h("p", null, "CTV đăng nhập trên máy lạ phải được duyệt."))),
                h("div", { class: "panel-body table-wrap" }, h(
                  "table",
                  null,
                  h("thead", null, h("tr", null, ...["CTV", "Trạng thái", "Trình duyệt", "IP", "Xin lúc", ""].map((t) => h("th", null, t)))),
                  h("tbody", { id: "ctv-thiet-bi" })
                ))
              ),
              h(
                "section",
                { class: "panel" },
                h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Nhật ký tải ảnh"))),
                h("div", { class: "panel-body table-wrap" }, h(
                  "table",
                  null,
                  h("thead", null, h("tr", null, ...["Lúc", "CTV", "Mã hàng", "Số ảnh", "IP"].map((t) => h("th", null, t)))),
                  h("tbody", { id: "ctv-nhat-ky" })
                ))
              )
            )
          )
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h("div", { class: "panel-header" }, h("h3", null, "Danh sách CTV/KOL"), h("span", { class: "badge blue", id: "ctv-dem" }, "0")),
          h(
            "div",
            { class: "panel-body table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, ...["Tên", "Mã ref", "Đăng nhập", "Link", "Hoa hồng mặc định", "Trạng thái", "Quyền ảnh", "Quản lý"].map((t) => h("th", null, t)))),
              h("tbody", { id: "ctv-bang" })
            )
          )
        ),
        h("section", { class: "panel omi-section-gap", id: "affiliate-detail", hidden: true }),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h("div", { class: "panel-header" }, h("h3", null, "Rule & chiến dịch")),
          h(
            "div",
            { class: "panel-body grid two" },
            h("div", null, h("h4", null, "Rule hoa hồng"), h("div", { id: "ctv-quy-tac" })),
            h("div", null, h("h4", null, "Chiến dịch"), h("div", { id: "ctv-chien-dich" }))
          )
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h("div", { class: "panel-header" }, h("h3", null, "Hoa hồng ghi nhận từ đơn"), h("span", { class: "badge amber", id: "ctv-so-hoa-hong" }, "0")),
          h(
            "div",
            { class: "panel-body table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, ...["Đơn", "CTV/KOL", "Doanh số", "Hoa hồng", "Trạng thái"].map((t) => h("th", null, t)))),
              h("tbody", { id: "ctv-hoa-hong-bang" })
            )
          )
        )
      );
    }
    load() {
      void this.loadAll();
    }
    async loadAll() {
      const line = el("ctv-trang-thai");
      const [accounts, commissions] = await Promise.all([
        this.ctx.gateway.landing("ctv.danh-sach"),
        this.ctx.gateway.landing("ctv.hoa-hong")
      ]);
      if (!accounts.ok) {
        status(line, accounts.viSao, "bad");
        return;
      }
      this.list = accounts.than?.ctv ?? [];
      this.book = commissions.ok ? commissions.than?.data ?? {} : {};
      this.drawSummary();
      this.drawList();
      this.drawDevices(accounts.than?.thietBi ?? []);
      this.drawCommissions();
      this.drawDetail();
      if (!commissions.ok) status(line, `Chưa đọc được hoa hồng: ${commissions.viSao}`, "bad");
      await this.loadConfig();
      await this.loadLog();
    }
    siteOrigin() {
      return str(this.ctx.shell.license()?.diaChiLanding).replace(/\/+$/, "");
    }
    drawSummary() {
      const commissions = this.book.commissions ?? [];
      el("ctv-so").textContent = String(this.list.length);
      el("ctv-doanh-so").textContent = money(commissions.reduce((t, c) => t + Number(c.baseAmount || 0), 0));
      el("ctv-hoa-hong").textContent = money(commissions.filter((c) => c.status !== "void").reduce((t, c) => t + Number(c.commissionAmount || 0), 0));
    }
    drawList() {
      const body = el("ctv-bang");
      clear(body);
      el("ctv-dem").textContent = String(this.list.length);
      const origin = this.siteOrigin();
      for (const c of this.list) {
        body.appendChild(h(
          "tr",
          null,
          h("td", null, c.ten, h("div", null, h("button", { type: "button", class: "ghost-button compact-button", "data-action": "edit-affiliate", "data-affiliate-id": c.ma }, "Sửa"))),
          h("td", null, h("strong", null, c.maGioiThieu)),
          h("td", null, str(c.tenDangNhap) || c.dienThoai, h("div", { class: "subtle" }, c.email)),
          h("td", null, h("code", null, `${origin || "(web shop)"}/?ref=${c.maGioiThieu}`)),
          h("td", null, str(c.hoaHongMacDinh) ? `${str(c.hoaHongMacDinh).replace(/%$/, "")}%` : "—"),
          h(
            "td",
            null,
            badge(c.dangBat ? "active" : "khoá", c.dangBat ? "green" : "red"),
            h("br"),
            h("button", { type: "button", class: "secondary-button compact-button", "data-action": "toggle-affiliate-active", "data-id": c.ma, "data-next": c.dangBat ? "false" : "true" }, c.dangBat ? "Khóa" : "Mở")
          ),
          h(
            "td",
            null,
            c.choBoLogo ? "Được tải không logo" : "Luôn có logo",
            h("br"),
            h("button", { type: "button", class: "secondary-button compact-button", "data-action": "toggle-affiliate-logo", "data-id": c.ma, "data-next": c.choBoLogo ? "false" : "true" }, c.choBoLogo ? "Tắt ảnh sạch" : "Bật ảnh sạch")
          ),
          h("td", null, h("button", { type: "button", class: "primary-button compact-button", "data-action": "manage-affiliate", "data-affiliate-id": c.ma }, "Quản lý"))
        ));
      }
      if (this.list.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "8", class: "subtle" }, "Chưa có CTV/KOL.")));
    }
    drawDevices(devices) {
      const names = new Map(this.list.map((c) => [c.ma, c.ten]));
      const body = el("ctv-thiet-bi");
      clear(body);
      for (const d of devices) {
        const approved = d.trangThai === "da-duyet";
        const button = h("button", { type: "button", class: approved ? "secondary-button compact-button" : "primary-button compact-button", "data-action": "ctv-device", "data-device": d.ma, "data-next": approved ? "chan" : "duyet" }, approved ? "Chặn" : "Duyệt máy này");
        body.appendChild(tableRow([names.get(d.maCtv) ?? d.maCtv, d.trangThai, (d.trinhDuyet || "").slice(0, 40), d.diaChiIp, clock(d.xinLuc) || d.xinLuc, button]));
      }
      if (devices.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "6", class: "subtle" }, "Không có máy nào đang xin vào.")));
    }
    drawCommissions() {
      const names = new Map(this.list.map((c) => [c.ma, c.maGioiThieu]));
      const rows = this.book.commissions ?? [];
      el("ctv-so-hoa-hong").textContent = String(rows.length);
      const body = el("ctv-hoa-hong-bang");
      clear(body);
      for (const c of rows) {
        body.appendChild(tableRow([
          c.orderId,
          names.get(c.affiliateId) ?? c.affiliateCode,
          money(c.baseAmount),
          money(c.commissionAmount),
          badge(c.status || "pending", c.status === "approved" ? "green" : c.status === "void" ? "red" : "blue")
        ], [2, 3]));
      }
      if (rows.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "5", class: "subtle" }, "Chưa có hoa hồng nào.")));
    }
    async loadLog() {
      const r = await this.ctx.gateway.landing("ctv.nhat-ky", {});
      if (!r.ok) return;
      const names = new Map(this.list.map((c) => [c.ma, c.ten]));
      const body = el("ctv-nhat-ky");
      clear(body);
      for (const d of r.than?.dong ?? []) body.appendChild(tableRow([clock(d.luc) || d.luc, names.get(d.maCtv) ?? d.maCtv, d.maHang, d.soAnh, d.diaChiIp], [3]));
    }
    // ----- form -----
    togglePassword() {
      const input = el("affiliatePassword");
      input.type = input.type === "password" ? "text" : "password";
      const button = this.root.querySelector('[data-action="toggle-affiliate-password"]');
      if (button) button.textContent = input.type === "password" ? "Hiện" : "Ẩn";
    }
    generatePassword() {
      const input = el("affiliatePassword");
      input.value = initialPassword();
      input.type = "text";
      const button = this.root.querySelector('[data-action="toggle-affiliate-password"]');
      if (button) button.textContent = "Ẩn";
      input.focus();
    }
    async copyLogin() {
      const line = el("ctv-trang-thai");
      const username = el("affiliateUsername").value.trim() || el("affiliatePhone").value.trim();
      const password = el("affiliatePassword").value;
      if (!username || !password) {
        status(line, "Hãy nhập tên đăng nhập và mật khẩu trước khi copy.", "bad");
        return;
      }
      const origin = this.siteOrigin();
      const text2 = [
        "THÔNG TIN ĐĂNG NHẬP CTV",
        "",
        `Trang đăng nhập: ${origin || "(địa chỉ web shop)"}/ctv-login`,
        `Tên đăng nhập: ${username}`,
        `Mật khẩu ban đầu: ${password}`,
        "",
        "Sau khi đăng nhập, vui lòng đổi mật khẩu và xem mục Hướng dẫn sử dụng trong trang CTV."
      ].join("\n");
      try {
        await navigator.clipboard.writeText(text2);
        status(line, "Đã copy thông tin đăng nhập CTV.", "good");
      } catch {
        status(line, "Máy không cho chép vào bộ nhớ tạm.", "bad");
      }
    }
    fillForm(id) {
      const c = this.list.find((x) => x.ma === id);
      if (c === void 0) return;
      this.editing = id;
      const set = (field, value) => {
        el(field).value = value;
      };
      set("affiliateName", c.ten);
      set("affiliateEmail", c.email);
      set("affiliateUsername", str(c.tenDangNhap));
      set("affiliateCode", c.maGioiThieu);
      set("affiliatePhone", c.dienThoai);
      set("affiliatePassword", "");
      set("affiliateDefaultPercent", str(c.hoaHongMacDinh).replace(/%$/, ""));
      el("ctv-form-tieu-de").textContent = `Sửa CTV: ${c.ten}`;
      el("nut-ctv-ghi").textContent = "Lưu CTV";
      el("nut-ctv-xoa").hidden = false;
      status(el("ctv-trang-thai"), "Mật khẩu để trống = giữ nguyên.");
    }
    resetForm() {
      this.editing = "";
      for (const id of ["affiliateName", "affiliateEmail", "affiliateUsername", "affiliateCode", "affiliatePhone", "affiliatePassword", "affiliateDefaultPercent"]) el(id).value = "";
      el("ctv-form-tieu-de").textContent = "Tạo tài khoản CTV";
      el("nut-ctv-ghi").textContent = "Tạo CTV";
      el("nut-ctv-xoa").hidden = true;
    }
    async save() {
      const value = (id) => el(id).value.trim();
      const line = el("ctv-trang-thai");
      if (value("affiliateName") === "" || value("affiliatePhone") === "" && value("affiliateEmail") === "") {
        status(line, "Cần tên và số điện thoại (hoặc email).", "bad");
        return;
      }
      status(line, "Đang ghi…");
      const current = this.list.find((c) => c.ma === this.editing);
      const r = await this.ctx.gateway.landing("ctv.ghi", {
        ma: this.editing,
        ten: value("affiliateName"),
        dienThoai: value("affiliatePhone"),
        email: value("affiliateEmail"),
        tenDangNhap: value("affiliateUsername"),
        maGioiThieu: value("affiliateCode"),
        hoaHongMacDinh: value("affiliateDefaultPercent"),
        matKhau: el("affiliatePassword").value,
        dangBat: current?.dangBat ?? true,
        choBoLogo: current?.choBoLogo ?? false
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, this.editing ? "Đã lưu CTV." : "Đã tạo CTV.", "good");
      this.resetForm();
      await this.loadAll();
    }
    async toggle(button, flag) {
      const c = this.list.find((x) => x.ma === button.dataset["id"]);
      if (c === void 0) return;
      const next = button.dataset["next"] === "true";
      const r = await this.ctx.gateway.landing("ctv.ghi", {
        ma: c.ma,
        ten: c.ten,
        dienThoai: c.dienThoai,
        email: c.email,
        dangBat: flag === "dangBat" ? next : c.dangBat,
        choBoLogo: flag === "choBoLogo" ? next : c.choBoLogo === true
      });
      if (!r.ok) {
        status(el("ctv-trang-thai"), r.viSao, "bad");
        return;
      }
      await this.loadAll();
    }
    async remove() {
      if (this.editing === "") return;
      const r = await this.ctx.gateway.landing("ctv.xoa", { ma: this.editing });
      if (!r.ok) {
        status(el("ctv-trang-thai"), r.viSao, "bad");
        return;
      }
      if (this.selected === this.editing) this.selected = "";
      this.resetForm();
      status(el("ctv-trang-thai"), "Đã xoá CTV. Lịch sử tải ảnh vẫn giữ.", "good");
      await this.loadAll();
    }
    async device(deviceId, action) {
      const r = await this.ctx.gateway.landing("ctv.thiet-bi", { ma: deviceId, viec: action });
      if (!r.ok) {
        status(el("ctv-trang-thai"), r.viSao, "bad");
        return;
      }
      await this.loadAll();
    }
    // ----- detail -----
    openDetail(id) {
      this.selected = id;
      this.drawDetail();
      el("affiliate-detail").scrollIntoView({ block: "start" });
    }
    drawDetail() {
      const panel = el("affiliate-detail");
      clear(panel);
      const c = this.list.find((x) => x.ma === this.selected);
      panel.hidden = c === void 0;
      if (c === void 0) return;
      const commissions = (this.book.commissions ?? []).filter((x) => x.affiliateId === c.ma);
      const payments = (this.book.payments ?? []).filter((x) => x.affiliateId === c.ma);
      const sum = (rows) => rows.reduce((t, x) => t + Number(x.commissionAmount || 0), 0);
      const approved = sum(commissions.filter((x) => x.status === "approved"));
      const pending = sum(commissions.filter((x) => !["approved", "void"].includes(x.status)));
      const voided = sum(commissions.filter((x) => x.status === "void"));
      const paid = payments.filter((x) => !x.voidedAt).reduce((t, x) => t + Number(x.amount || 0), 0);
      const debt = Math.max(0, approved - paid);
      const overpaid = Math.max(0, paid - approved);
      const card = (label, value, hint) => h("section", { class: "panel metric" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "hint" }, hint));
      panel.append(
        h(
          "div",
          { class: "panel-header" },
          h("div", null, h("h3", null, `Chi tiết CTV: ${c.ten || c.maGioiThieu}`), h("p", null, `Mã ref ${c.maGioiThieu} · ${c.email || str(c.tenDangNhap)}`)),
          h("button", { type: "button", class: "secondary-button", "data-action": "close-affiliate-detail" }, "Đóng")
        ),
        h(
          "div",
          { class: "panel-body" },
          h(
            "div",
            { class: "grid four" },
            card("Đơn liên quan", String(commissions.length), "Đơn có attribution CTV"),
            card("Hoa hồng đã duyệt", money(approved), "Đơn giao thành công"),
            card("Hoa hồng chờ", money(pending), voided ? `Đã hủy ${money(voided)}` : "Chờ giao/đối soát"),
            card("Công nợ CTV", overpaid ? `Trả dư ${money(overpaid)}` : money(debt), `Đã thanh toán ${money(paid)}`)
          ),
          h(
            "div",
            { class: "split-actions omi-actions-top" },
            h("input", { type: "text", inputmode: "numeric", placeholder: "Số tiền trả CTV", id: "ctv-tra-so-tien" }),
            h("input", { type: "text", placeholder: "Ghi chú (tháng 9, chuyển khoản…)", id: "ctv-tra-ghi-chu" }),
            h("button", { type: "button", class: "primary-button", "data-action": "pay-affiliate-commission", "data-affiliate-id": c.ma }, "Ghi thanh toán CTV"),
            h("span", { class: "status-line", id: "ctv-tra-trang-thai" })
          ),
          h("h4", { class: "omi-section-gap" }, "Đơn hàng liên quan"),
          h("div", { class: "table-wrap" }, h(
            "table",
            null,
            h("thead", null, h("tr", null, ...["Mã đơn", "Khách", "Tổng đơn", "Hoa hồng", "Trạng thái"].map((t) => h("th", null, t)))),
            h("tbody", null, ...commissions.length === 0 ? [h("tr", null, h("td", { colspan: "5" }, "Chưa có đơn liên quan."))] : commissions.map((x) => h(
              "tr",
              null,
              h("td", null, h("strong", null, x.orderId)),
              h("td", null, x.customerName),
              h("td", null, money(x.orderTotal)),
              h("td", null, money(x.commissionAmount)),
              h("td", null, badge(x.status || "pending", x.status === "approved" ? "green" : x.status === "void" ? "red" : "amber"))
            )))
          )),
          h("h4", { class: "omi-section-gap" }, "Lịch sử thanh toán CTV"),
          h("div", { class: "table-wrap" }, h(
            "table",
            null,
            h("thead", null, h("tr", null, ...["Thời gian", "Số tiền", "Ghi chú", "Thao tác"].map((t) => h("th", null, t)))),
            h("tbody", { id: "ctv-lich-su-tra" }, ...payments.length === 0 ? [h("tr", null, h("td", { colspan: "4" }, "Chưa thanh toán hoa hồng."))] : payments.map((x) => this.paymentRow(x)))
          ))
        )
      );
    }
    async pay(id) {
      const line = el("ctv-tra-trang-thai");
      const amount = digits(el("ctv-tra-so-tien").value);
      if (amount <= 0) {
        status(line, "Nhập số tiền trả CTV.", "bad");
        return;
      }
      status(line, "Đang ghi…");
      const r = await this.ctx.gateway.landing("ctv.thanh-toan", { maCtv: id, soTien: amount, ghiChu: el("ctv-tra-ghi-chu").value.trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadAll();
      status(el("ctv-tra-trang-thai"), `Đã ghi trả ${money(amount)}.`, "good");
    }
    // ----- Đ4: sửa / hoàn tác một khoản trả, chiến dịch, rule -----
    paymentRow(x) {
      const voided = str(x.voidedAt) !== "";
      const tr = h(
        "tr",
        null,
        h("td", null, `${clock(x.createdAt)} ${x.createdAt.slice(0, 10)}`, voided ? h("div", null, badge("Đã hoàn tác", "red")) : null),
        h("td", null, voided ? h("s", null, money(x.amount)) : money(x.amount)),
        h("td", null, voided && x.voidReason ? `${x.note} (hoàn tác: ${x.voidReason})` : x.note),
        h("td", null, voided ? "—" : h(
          "span",
          { class: "split-actions" },
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-affiliate-payment", "data-payment-id": x.id }, "Sửa"),
          h("button", { class: "danger-button compact-button", type: "button", "data-action": "void-affiliate-payment", "data-payment-id": x.id }, "Hoàn tác")
        ))
      );
      if (voided) tr.className = "is-voided";
      return tr;
    }
    paymentOf(id) {
      return (this.book.payments ?? []).find((x) => x.id === id && !x.voidedAt);
    }
    /** Desk `edit-affiliate-payment` — Desk dùng `prompt`, Electron trả `null`; ở đây là hộp nhập trong trang. */
    async editPayment(id) {
      const line = document.getElementById("ctv-tra-trang-thai") ?? el("ctv-trang-thai");
      const payment = this.paymentOf(id);
      if (payment === void 0) {
        status(line, "Không tìm thấy giao dịch CTV cần sửa.", "bad");
        return;
      }
      const answer = await askDialog({
        title: "Sửa thanh toán CTV",
        fields: [{ name: "amount", label: "Sửa số tiền đã thanh toán", value: String(payment.amount), numeric: true }, { name: "note", label: "Sửa ghi chú", value: payment.note }]
      });
      if (answer === null) return;
      if (!amountTextValid(answer["amount"] ?? "")) {
        status(line, AMOUNT_HINT, "bad");
        return;
      }
      const amount = digits(answer["amount"]);
      if (amount <= 0) {
        status(line, "Số tiền phải lớn hơn 0.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("ctv.sua-thanh-toan", { ma: id, soTien: amount, ghiChu: String(answer["note"] ?? "").trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadAll();
      status(document.getElementById("ctv-tra-trang-thai") ?? el("ctv-trang-thai"), "Đã sửa thanh toán CTV.", "good");
    }
    async voidPayment(id) {
      const line = document.getElementById("ctv-tra-trang-thai") ?? el("ctv-trang-thai");
      const payment = this.paymentOf(id);
      if (payment === void 0) {
        status(line, "Không tìm thấy giao dịch CTV cần hoàn tác.", "bad");
        return;
      }
      const answer = await askDialog({
        title: "Hoàn tác thanh toán CTV",
        message: `Hoàn tác khoản thanh toán ${money(payment.amount)}?`,
        fields: [{ name: "reason", label: "Lý do hoàn tác", value: "Nhập nhầm giao dịch" }],
        submitLabel: "Hoàn tác"
      });
      if (answer === null) return;
      const r = await this.ctx.gateway.landing("ctv.huy-thanh-toan", { ma: id, lyDo: String(answer["reason"] ?? "").trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadAll();
      status(document.getElementById("ctv-tra-trang-thai") ?? el("ctv-trang-thai"), "Đã hoàn tác thanh toán CTV và tính lại công nợ.", "good");
    }
    async loadConfig() {
      const r = await this.ctx.gateway.landing("ctv.cau-hinh");
      if (!r.ok) return;
      this.config = r.than ?? {};
      this.drawConfig();
    }
    /** Desk "Rule & chiến dịch". */
    drawConfig() {
      const rules = el("ctv-quy-tac");
      clear(rules);
      for (const rule of this.config.rules ?? []) {
        rules.appendChild(h("div", { class: "order-card" }, h("strong", null, rule.scope), ` · ${rule.targetId || "global"} · ${rule.type} ${money(rule.value)}`));
      }
      if ((this.config.rules ?? []).length === 0) rules.appendChild(h("p", { class: "subtle" }, "Chưa có rule."));
      const campaigns = el("ctv-chien-dich");
      clear(campaigns);
      for (const c of this.config.campaigns ?? []) {
        campaigns.appendChild(h("div", { class: "order-card" }, h("strong", null, c.name), ` · ${c.code}`, h("div", { class: "subtle" }, c.note)));
      }
      if ((this.config.campaigns ?? []).length === 0) campaigns.appendChild(h("p", { class: "subtle" }, "Chưa có chiến dịch."));
    }
    async saveConfig() {
      const line = el("ctv-cau-hinh-trang-thai");
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("ctv.ghi-cau-hinh", { campaigns: this.config.campaigns ?? [], rules: this.config.rules ?? [] });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.config = r.than ?? this.config;
      this.drawConfig();
      status(line, "Đã lưu cấu hình affiliate.", "good");
    }
    async addCampaign() {
      const line = el("ctv-cau-hinh-trang-thai");
      const value = (id) => el(id).value.trim();
      const code = value("campaignCode").toUpperCase();
      if (code === "" || value("campaignName") === "") {
        status(line, "Cần nhập tên và mã chiến dịch.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("ctv.them-chien-dich", { ten: value("campaignName"), ma: code, phamVi: value("campaignScope"), ghiChu: el("campaignNote").value.trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.config = r.than ?? this.config;
      this.drawConfig();
      for (const id of ["campaignName", "campaignCode", "campaignScope", "campaignNote"]) el(id).value = "";
      status(line, "Đã thêm chiến dịch affiliate.", "good");
    }
    async addRule() {
      const line = el("ctv-cau-hinh-trang-thai");
      const amount = digits(el("ruleValue").value);
      const target = el("ruleTargetId").value.trim();
      if (amount <= 0) {
        status(line, "Cần nhập giá trị hoa hồng.", "bad");
        return;
      }
      if (target === "") {
        status(line, "Cần nhập mã sản phẩm.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("ctv.them-quy-tac", { maSanPham: target, giaTri: amount, loai: "fixed" });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.config = r.than ?? this.config;
      this.drawConfig();
      el("ruleTargetId").value = "";
      el("ruleValue").value = "";
      status(line, "Đã thêm rule hoa hồng. Rule áp cho đơn đặt từ bây giờ.", "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/channels.ts
  var CHANNEL_LABEL = { zalo: "Zalo nhóm", "fb-ca-nhan": "Facebook cá nhân" };
  var LOGIN_LABEL = { logged_in: "đã đăng nhập", logged_out: "CHƯA đăng nhập", checkpoint: "Facebook đòi xác minh", unknown: "chưa rõ" };
  var ChannelsView = class extends View {
    id = "kenh";
    label = "Zalo / FB cá nhân";
    title = "Kênh Zalo nhóm & Facebook cá nhân";
    workspace = "common";
    glyph = "☰";
    onDuty = false;
    build(root) {
      root.append(
        h("div", { class: "runtime-alert", id: "kenh-loi-truc", hidden: true }, "Máy này không phải máy trực. Chỉ máy trực mới chạy Zalo / Facebook cá nhân — đổi máy trực ở trang quản lý máy trên Xeon (tab Cấu hình)."),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Kênh trên máy này"),
              h("p", null, "Bật kênh → cửa sổ Zalo / Facebook mở ra để đăng nhập (quét QR hoặc nhập tài khoản). Đăng nhập xong có thể ẩn cửa sổ; OMI đọc tin khách gửi lên landing, và gõ trả lời từ hàng chờ như người thật. Người trực vừa trả lời tay trong hội thoại nào thì bot im 10 phút ở hội thoại đó.")
            ),
            h(
              "div",
              { class: "toolbar" },
              h("button", { class: "secondary-button compact-button", id: "nut-kenh-tai", type: "button", onclick: () => void this.loadChannels() }, "Làm mới"),
              h("span", { class: "status-line", id: "kenh-trang-thai" })
            )
          ),
          table(["Kênh", "Đăng nhập", "Đang chạy", "Quét lúc", "Gửi lúc", "Gửi / giờ", "Tin đã đẩy", "Lỗi cuối", ""], "kenh-bang")
        )
      );
    }
    load() {
      void this.loadChannels();
    }
    licenseChanged(license2) {
      this.onDuty = license2?.truc === true;
      el("kenh-loi-truc").hidden = this.onDuty;
    }
    renderRows(rows) {
      const body = el("kenh-bang");
      clear(body);
      el("kenh-loi-truc").hidden = this.onDuty;
      for (const k of rows) {
        const toggle = h("button", { type: "button", class: k.bat ? "danger-button compact-button" : "primary-button compact-button", disabled: !this.onDuty && !k.bat, onclick: () => void this.act(k.bat ? "tat" : "bat", k.kenh) }, k.bat ? "Tắt" : "Bật");
        const show = h("button", { type: "button", class: "secondary-button compact-button", onclick: () => void this.act(k.cuaSoHien ? "an" : "hien", k.kenh) }, k.cuaSoHien ? "Ẩn cửa sổ" : "Mở cửa sổ");
        const scan = h("button", { type: "button", class: "secondary-button compact-button", disabled: !k.dangChay, onclick: () => void this.act("quet", k.kenh) }, "Quét ngay");
        const actions = h("span", { class: "toolbar compact" }, toggle, show, scan);
        body.appendChild(tableRow([
          CHANNEL_LABEL[k.kenh] ?? k.kenh,
          LOGIN_LABEL[k.dangNhap] ?? k.dangNhap,
          k.dangChay ? k.dangQuet ? "đang quét" : k.dangGui ? "đang gửi" : "đang chạy" : k.bat ? "bật, chờ máy trực" : "tắt",
          k.quetLuc ? clock(k.quetLuc) : "—",
          k.guiLuc ? clock(k.guiLuc) : "—",
          String(k.guiTrongGio || 0),
          String(k.tinDaDay || 0),
          k.loiCuoi || (k.selectorsVerified ? "" : "selector chưa xác minh với giao diện thật"),
          actions
        ]));
      }
    }
    async loadChannels() {
      const line = el("kenh-trang-thai");
      status(line, "Đang đọc…");
      const r = await this.ctx.gateway.channel("trang-thai");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.renderRows(r.kenh);
      status(line, "", "good");
    }
    async act(action, channel) {
      const line = el("kenh-trang-thai");
      status(line, "Đang làm…");
      const r = await this.ctx.gateway.channel(action, channel);
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.renderRows(r.kenh);
      status(line, action === "quet" ? `Đã quét: đẩy ${r.daDay ?? 0} tin.${r.loi ? ` ${r.loi}` : ""}` : "Xong.", r.loi ? "bad" : "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/content.ts
  var STATUS_LABEL = { nhap: "nháp", dat: "đạt", hong: "còn lỗi", "da-len-lich": "đã lên lịch" };
  var ContentView = class extends View {
    // NOT "noi-dung": that id belongs to the "Nội dung web" screen (chữ trên trang bán hàng).
    // Registering it twice kills the whole page — `AppShell.register` throws, and rightly.
    id = "xuong-noi-dung";
    label = "Content";
    title = "Xưởng nội dung — 5 bước";
    workspace = "common";
    glyph = "ND";
    frame = {};
    batch = null;
    openPostId = "";
    build(root) {
      root.append(
        h(
          "div",
          { class: "toolbar" },
          h("input", { id: "nd-ngay", type: "text", class: "short", placeholder: "Ngày (2026-09-20)" }),
          h("input", { id: "nd-trang", type: "text", placeholder: "Fanpage, cách nhau dấu phẩy" }),
          h("button", { class: "primary-button", id: "nut-noi-dung-tao", type: "button", onclick: () => void this.createBatch() }, "Lập kế hoạch ngày"),
          h("button", { class: "secondary-button", id: "nut-noi-dung-tai", type: "button", onclick: () => void this.loadBatches() }, "Tải lô"),
          h("span", { class: "status-line", id: "noi-dung-trang-thai" }, "Bấm để tải.")
        ),
        h(
          "section",
          { class: "panel" },
          h("div", { class: "panel-header" }, h(
            "div",
            null,
            h("h3", null, "Các lô đã lập"),
            h("p", null, "Mỗi lô là một ngày đăng bài. Bấm một dòng để mở.")
          )),
          table(["Ngày", "Bước", "Số bài", "Đạt", "Còn lỗi", "Bỏ qua", "Sửa lúc"], "nd-bang-lo")
        ),
        h(
          "section",
          { class: "panel", id: "nd-lo", hidden: true },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", { id: "nd-lo-ten" }, "—"), h("p", { id: "nd-lo-buoc" }, "—")),
            h(
              "div",
              { class: "toolbar compact" },
              h("button", { class: "secondary-button compact-button", id: "nut-noi-dung-lui", type: "button", onclick: () => void this.step("lui") }, "← Bước trước"),
              h("button", { class: "secondary-button compact-button", id: "nut-noi-dung-cham", type: "button", onclick: () => void this.judge() }, "Chấm lại"),
              h("button", { class: "primary-button compact-button", id: "nut-noi-dung-toi", type: "button", onclick: () => void this.step("toi") }, "Bước sau →"),
              h("button", { class: "primary-button compact-button", id: "nut-noi-dung-len-lich", type: "button", onclick: () => void this.schedule() }, "Lên lịch")
            )
          ),
          h("div", { class: "facebook-tabs", id: "nd-buoc" }),
          table(["Giờ", "Trang", "Dạng bài", "Mã", "Trạng thái", "Lỗi"], "nd-bang-bai")
        ),
        h(
          "section",
          { class: "panel", id: "nd-bai", hidden: true },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", { id: "nd-bai-ten" }, "—"), h("p", { id: "nd-bai-huong-dan" }, "—")),
            h(
              "div",
              { class: "toolbar compact" },
              h("button", { class: "secondary-button compact-button", id: "nut-noi-dung-xin-viet", type: "button", onclick: () => void this.askBrain() }, "Nhờ bộ não viết"),
              h("button", { class: "secondary-button compact-button", id: "nut-noi-dung-bo-qua", type: "button", onclick: () => void this.skipPost() }, "Bỏ qua bài này"),
              h("button", { class: "primary-button compact-button", id: "nut-noi-dung-luu-bai", type: "button", onclick: () => void this.savePost() }, "Lưu bài")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "form-grid" },
              h("label", { for: "nd-bai-ma" }, "Mã hàng (cách nhau dấu phẩy)"),
              h("input", { id: "nd-bai-ma", type: "text" }),
              h("label", { for: "nd-bai-chu-anh" }, "Chữ in trên ảnh chính"),
              h("input", { id: "nd-bai-chu-anh", type: "text", placeholder: "lấy từ hook, đừng nói hết hook" }),
              h("label", { for: "nd-bai-caption" }, "Caption"),
              h("textarea", { id: "nd-bai-caption", rows: "12" }),
              h("label", { for: "nd-bai-comment" }, "Bình luận đầu (chỗ để link)"),
              h("textarea", { id: "nd-bai-comment", rows: "3" })
            ),
            h("div", { id: "nd-bai-cham" }),
            h("p", { class: "status-line", id: "nd-bai-trang-thai" }, "—")
          )
        )
      );
    }
    load() {
      void this.loadFrame();
      void this.loadBatches();
    }
    /** Steps and post shapes come from the landing so the screen cannot drift from the rules. */
    async loadFrame() {
      const r = await this.ctx.gateway.landing("noi-dung.khuon");
      if (!r.ok) return;
      this.frame = r.than ?? {};
      this.paintSteps();
    }
    paintSteps() {
      const bar = el("nd-buoc");
      clear(bar);
      for (const s of this.frame.buoc ?? []) {
        bar.appendChild(h("button", { class: this.batch?.buoc === s.ma ? "active" : "", type: "button", disabled: true }, s.ten));
      }
    }
    async loadBatches() {
      const line = el("noi-dung-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("noi-dung.lo");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const rows = r.than?.lo ?? [];
      const body = el("nd-bang-lo");
      clear(body);
      for (const b of rows) {
        const tr = tableRow([day(b.ngay), this.stepName(b.buoc), b.soBai, b.soDat, b.soHong, b.soBoQua, day(b.suaLuc)], [2, 3, 4, 5]);
        tr.addEventListener("click", () => void this.openBatch(b.ma));
        body.appendChild(tr);
      }
      status(line, rows.length === 0 ? "Chưa có lô nào — lập kế hoạch cho một ngày." : `${rows.length} lô.`, "good");
    }
    stepName(ma) {
      return (this.frame.buoc ?? []).find((s) => s.ma === ma)?.ten ?? ma;
    }
    async createBatch() {
      const line = el("noi-dung-trang-thai");
      const ngay3 = el("nd-ngay").value.trim();
      const pages = el("nd-trang").value.split(",").map((p) => p.trim()).filter((p) => p !== "");
      if (pages.length === 0) {
        status(line, "Điền ít nhất một fanpage.", "bad");
        return;
      }
      status(line, "Đang lập kế hoạch…");
      const r = await this.ctx.gateway.landing("noi-dung.lo.tao", { ngay: ngay3, trang: pages, khungGio: this.frame.khungGio ?? [] });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.batch = r.than?.lo ?? null;
      this.paintBatch();
      await this.loadBatches();
      status(line, `Đã lập ${this.batch?.bai.length ?? 0} bài cho ngày ${ngay3}.`, "good");
    }
    async openBatch(ma) {
      const line = el("noi-dung-trang-thai");
      const r = await this.ctx.gateway.landing("noi-dung.lo.mo", { ma });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.batch = r.than?.lo ?? null;
      this.openPostId = "";
      el("nd-bai").hidden = true;
      this.paintBatch();
    }
    paintBatch() {
      const batch = this.batch;
      el("nd-lo").hidden = batch === null;
      if (batch === null) return;
      el("nd-lo-ten").textContent = `Lô ngày ${day(batch.ngay)}`;
      el("nd-lo-buoc").textContent = `Đang ở bước: ${this.stepName(batch.buoc)}`;
      this.paintSteps();
      el("nut-noi-dung-len-lich").hidden = batch.buoc !== "len-lich";
      const body = el("nd-bang-bai");
      clear(body);
      for (const post of batch.bai) {
        const dropped = str(post.boQua) !== "";
        const state = dropped ? `bỏ qua — ${post.boQua}` : STATUS_LABEL[post.trangThai] ?? post.trangThai;
        const tr = tableRow([
          post.time,
          post.page,
          this.formatName(post.format),
          post.codes.join(", ") || "—",
          state,
          post.loi.length === 0 ? post.canhBao.length === 0 ? "—" : `${post.canhBao.length} nhắc` : `${post.loi.length} lỗi`
        ], [5]);
        tr.addEventListener("click", () => this.openPost(post.id));
        body.appendChild(tr);
      }
    }
    formatName(ma) {
      return (this.frame.dangBai ?? []).find((f) => f.ma === ma)?.ten ?? ma;
    }
    postById(id) {
      return this.batch?.bai.find((p) => p.id === id) ?? null;
    }
    openPost(id) {
      const post = this.postById(id);
      if (post === null) return;
      this.openPostId = id;
      el("nd-bai").hidden = false;
      const shape = (this.frame.dangBai ?? []).find((f) => f.ma === post.format);
      el("nd-bai-ten").textContent = `${post.time} · ${post.page} · ${this.formatName(post.format)}`;
      el("nd-bai-huong-dan").textContent = shape === void 0 ? str(post.chuDe) : `${shape.huongDan} (${shape.tuMa}–${shape.denMa} mã)`;
      el("nd-bai-ma").value = post.codes.join(", ");
      el("nd-bai-chu-anh").value = post.main;
      el("nd-bai-caption").value = post.caption;
      el("nd-bai-comment").value = post.comment;
      this.paintVerdict(post);
      status(el("nd-bai-trang-thai"), STATUS_LABEL[post.trangThai] ?? post.trangThai, post.trangThai === "hong" ? "bad" : post.trangThai === "nhap" ? "" : "good");
    }
    /** A verdict of "hỏng" with nothing to read is useless: every line says what to change. */
    paintVerdict(post) {
      const box = el("nd-bai-cham");
      clear(box);
      for (const e of post.loi) box.appendChild(h("p", { class: "status-line bad" }, `Lỗi · ${e.message}`));
      for (const w of post.canhBao) box.appendChild(h("p", { class: "status-line" }, `Nhắc · ${w.message}`));
      if (post.loi.length === 0 && post.canhBao.length === 0 && post.trangThai === "dat") {
        box.appendChild(h("p", { class: "status-line good" }, "Bài đạt hết luật."));
      }
    }
    async savePost() {
      const line = el("nd-bai-trang-thai");
      const batch = this.batch;
      if (batch === null || this.openPostId === "") {
        status(line, "Chưa mở bài nào.", "bad");
        return;
      }
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("noi-dung.lo.sua-bai", {
        maLo: batch.ma,
        maBai: this.openPostId,
        ma: el("nd-bai-ma").value.split(",").map((c) => c.trim()).filter((c) => c !== ""),
        chuAnh: el("nd-bai-chu-anh").value,
        caption: el("nd-bai-caption").value,
        comment: el("nd-bai-comment").value
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.replacePost(r.than?.bai ?? null);
      status(line, "Đã lưu. Bấm Chấm lại để xem bài có đạt luật không.", "good");
    }
    async skipPost() {
      const line = el("nd-bai-trang-thai");
      const batch = this.batch;
      if (batch === null || this.openPostId === "") {
        status(line, "Chưa mở bài nào.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("noi-dung.lo.sua-bai", {
        maLo: batch.ma,
        maBai: this.openPostId,
        boQua: "Người trực bỏ qua bài này"
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.replacePost(r.than?.bai ?? null);
      el("nd-bai").hidden = true;
      status(el("noi-dung-trang-thai"), "Đã bỏ bài khỏi lô. Lô vẫn đi tiếp được.", "good");
    }
    replacePost(post) {
      if (post === null || this.batch === null) return;
      this.batch = { ...this.batch, bai: this.batch.bai.map((p) => p.id === post.id ? post : p) };
      this.paintBatch();
      if (this.openPostId === post.id) this.paintVerdict(post);
    }
    async judge() {
      const line = el("noi-dung-trang-thai");
      const batch = this.batch;
      if (batch === null) {
        status(line, "Chưa mở lô nào.", "bad");
        return;
      }
      status(line, "Đang chấm…");
      const r = await this.ctx.gateway.landing("noi-dung.lo.cham", { ma: batch.ma });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.batch = r.than?.lo ?? this.batch;
      this.paintBatch();
      if (this.openPostId !== "") {
        const post = this.postById(this.openPostId);
        if (post !== null) this.paintVerdict(post);
      }
      const live = (this.batch?.bai ?? []).filter((p) => str(p.boQua) === "");
      const passed = live.filter((p) => p.trangThai === "dat" || p.trangThai === "da-len-lich").length;
      const wholeBatch = r.than?.loChung?.loi ?? [];
      status(line, `${passed}/${live.length} bài đạt${wholeBatch.length === 0 ? "." : ` · cả lô: ${wholeBatch.map((e) => e.message).join("; ")}`}`, wholeBatch.length === 0 && passed === live.length ? "good" : "bad");
    }
    async step(direction) {
      const line = el("noi-dung-trang-thai");
      const batch = this.batch;
      if (batch === null) {
        status(line, "Chưa mở lô nào.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("noi-dung.lo.buoc", { ma: batch.ma, huong: direction });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.openBatch(batch.ma);
      status(line, `Đang ở bước ${str(r.than?.ten)}.`, "good");
    }
    async schedule() {
      const line = el("noi-dung-trang-thai");
      const batch = this.batch;
      if (batch === null) {
        status(line, "Chưa mở lô nào.", "bad");
        return;
      }
      status(line, "Đang lên lịch…");
      const r = await this.ctx.gateway.landing("noi-dung.lo.len-lich", { ma: batch.ma });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.openBatch(batch.ma);
      status(line, `${r.than?.soBai ?? 0} bài đã lên lịch. Đẩy sang Meta là việc của bước sau — chưa bài nào được đăng.`, "good");
    }
    /**
     * Asks the brain for a draft.
     *
     * The landing judges what comes back with the same rules as everything else, and retries once
     * with the errors if the first draft fails — so what arrives here is a draft AND its verdict.
     * The screen shows both: a draft that still breaks a rule is kept, with the reason next to it,
     * because the last mile is faster for a person than for another round of guessing.
     */
    async askBrain() {
      const line = el("nd-bai-trang-thai");
      const batch = this.batch;
      if (batch === null || this.openPostId === "") {
        status(line, "Chưa mở bài nào.", "bad");
        return;
      }
      status(line, "Đang hỏi bộ não… (viết một bài mất tới một phút)");
      const r = await this.ctx.gateway.landing("noi-dung.lo.xin-viet", { maLo: batch.ma, maBai: this.openPostId });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const written = r.than?.bai;
      if (written === void 0) {
        status(line, "Bộ não chưa trả về bài nào.", "bad");
        return;
      }
      el("nd-bai-caption").value = written.caption;
      el("nd-bai-chu-anh").value = written.main;
      el("nd-bai-comment").value = written.comment;
      this.replacePost(written);
      this.paintVerdict(written);
      const rounds = Number(r.than?.soLuot ?? 1);
      const passed = written.trangThai === "dat";
      status(line, passed ? `Bộ não viết xong sau ${rounds} lượt, bài đạt hết luật. Đọc lại rồi bấm Lưu bài.` : `Bộ não viết ${rounds} lượt, bài vẫn còn ${written.loi.length} lỗi — sửa nốt rồi bấm Lưu bài.`, passed ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/views/orders/address-fields.ts
  var DEBOUNCE_MS = 250;
  var LEVELS = [
    { cap: "tinh", nhan: "Tỉnh / Thành phố" },
    { cap: "huyen", nhan: "Quận / Huyện" },
    { cap: "xa", nhan: "Phường / Xã" }
  ];
  function addressFields(opts) {
    const p = opts.prefix;
    const id = (cap, what) => `${p}-dc-${cap}-${what}`;
    const valueOf = (cap) => el(id(cap, "o")).value.trim();
    const schemeOf = () => el(`${p}-dc-he`).checked ? "hai-cap" : "ba-cap";
    const timers = /* @__PURE__ */ new Map();
    const seqs = /* @__PURE__ */ new Map();
    async function run(cap) {
      const box = el(id(cap, "goi-y"));
      clear(box);
      const seq2 = (seqs.get(cap) ?? 0) + 1;
      seqs.set(cap, seq2);
      const r = await opts.search({ he: schemeOf(), cap, q: valueOf(cap), tinh: valueOf("tinh"), huyen: valueOf("huyen") });
      if (seq2 !== seqs.get(cap)) return;
      clear(box);
      if (!r.ok) return;
      for (const u of r.than?.muc ?? []) {
        box.appendChild(h("button", { class: "addr-option", type: "button", onclick: () => pick(cap, u.ten) }, u.ten));
      }
    }
    function pick(cap, name) {
      el(id(cap, "o")).value = name;
      clear(el(id(cap, "goi-y")));
      if (cap === "tinh") {
        clearLevel("huyen");
        clearLevel("xa");
      }
      if (cap === "huyen") clearLevel("xa");
      if (cap === "xa") void warnIfSplit();
    }
    function clearLevel(cap) {
      el(id(cap, "o")).value = "";
      clear(el(id(cap, "goi-y")));
      if (cap === "xa") clear(el(`${p}-dc-canh-bao`));
    }
    async function warnIfSplit() {
      const box = el(`${p}-dc-canh-bao`);
      clear(box);
      if (schemeOf() === "hai-cap" || valueOf("tinh") === "" || valueOf("xa") === "") return;
      const r = await opts.checkSplit({ tinh: valueOf("tinh"), huyen: valueOf("huyen"), xa: valueOf("xa") });
      if (!r.ok || r.than?.ambiguous !== true) return;
      box.appendChild(h(
        "p",
        { class: "status-line bad" },
        "Xã này sau sáp nhập 2025 tách làm nhiều xã — hỏi khách rồi bấm chọn đúng xã:"
      ));
      for (const o of r.than?.options ?? []) {
        box.appendChild(h("button", {
          class: "secondary-button compact-button",
          type: "button",
          onclick: () => {
            el(`${p}-dc-he`).checked = true;
            el(id("tinh", "o")).value = o.province;
            el(id("xa", "o")).value = o.ward;
            clearLevel("huyen");
            clear(box);
          }
        }, `${o.ward} · ${o.province}`));
      }
    }
    const rows = LEVELS.map(({ cap, nhan }) => h(
      "div",
      { class: "field addr-field" },
      h("label", { for: id(cap, "o") }, nhan),
      h("input", {
        id: id(cap, "o"),
        type: "text",
        autocomplete: "off",
        placeholder: cap === "tinh" ? "Gõ để tìm…" : "Chọn cấp trên trước",
        oninput: () => {
          const t = timers.get(cap);
          if (t !== void 0) clearTimeout(t);
          timers.set(cap, setTimeout(() => void run(cap), DEBOUNCE_MS));
        }
      }),
      h("div", { class: "addr-options", id: id(cap, "goi-y") })
    ));
    return h(
      "div",
      { class: "addr-fields" },
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "checkbox",
          id: `${p}-dc-he`,
          onchange: () => {
            clearLevel("huyen");
            clearLevel("xa");
            el(id("tinh", "o")).value = "";
          }
        }),
        " Hệ 34 tỉnh mới (2 cấp, không có huyện)"
      ),
      ...rows,
      h("div", { id: `${p}-dc-canh-bao` })
    );
  }
  function writeAddress(prefix, value) {
    const set = (cap, v) => {
      el(`${prefix}-dc-${cap}-o`).value = v ?? "";
    };
    el(`${prefix}-dc-he`).checked = !value.huyen && Boolean(value.xa);
    set("tinh", value.tinh);
    set("huyen", value.huyen);
    set("xa", value.xa);
    clear(el(`${prefix}-dc-canh-bao`));
  }
  function readAddress(prefix) {
    const v = (cap) => el(`${prefix}-dc-${cap}-o`).value.trim();
    return {
      he: el(`${prefix}-dc-he`).checked ? "hai-cap" : "ba-cap",
      tinh: v("tinh"),
      huyen: v("huyen"),
      xa: v("xa")
    };
  }

  // ../omi/packages/omi-ui/src/views/customers/customer-editor.ts
  var shared = null;
  function customerEditor(gateway) {
    if (shared === null) {
      shared = new CustomerEditor(gateway);
      document.body.appendChild(shared.root);
    }
    return shared;
  }
  function addressLine(a) {
    return [a.chiTiet, a.xa, a.huyen, a.tinh].filter(Boolean).join(", ");
  }
  var CustomerEditor = class {
    constructor(gateway) {
      this.gateway = gateway;
      const field = (id, label) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id }));
      this.root = h(
        "div",
        { class: "management-modal", id: "pf-khung", hidden: true },
        h("div", { class: "management-modal-backdrop", "data-pf": "dong" }),
        h(
          "section",
          { class: "management-modal-panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", { id: "pf-tieu-de" }, "Tạo khách hàng mới"), h("p", null, "Thông tin liên hệ, địa chỉ giao hàng và chân dung tư vấn.")),
            h("button", { class: "ghost-button", type: "button", "data-pf": "dong" }, "Đóng")
          ),
          h(
            "div",
            { class: "management-modal-body config-form" },
            h("div", { class: "grid two" }, field("profileName", "Tên khách hàng"), field("profilePhone", "Số điện thoại")),
            h(
              "div",
              { class: "address-editor" },
              h("h3", null, "Địa chỉ giao hàng"),
              h("div", { id: "pf-so-dia-chi" }),
              h(
                "div",
                { class: "field" },
                h("label", { for: "profileAddressDetail" }, "Địa chỉ cụ thể"),
                h("input", { id: "profileAddressDetail", placeholder: "Số nhà, tên đường" })
              ),
              addressFields({
                prefix: "pf",
                search: (input) => this.gateway.landing("dia-chi.tim", { ...input }),
                checkSplit: (input) => this.gateway.landing("dia-chi.doi-hai-cap", { ...input })
              }),
              h(
                "div",
                { class: "split-actions", id: "pf-them-dia-chi-hang", hidden: true },
                h("label", { class: "check" }, h("input", { type: "checkbox", id: "pf-mac-dinh" }), " Đặt làm mặc định"),
                h("button", { class: "secondary-button compact-button", type: "button", "data-pf": "them-dia-chi" }, "Thêm địa chỉ vào hồ sơ")
              )
            ),
            h(
              "div",
              { class: "grid two" },
              field("profileUsualSize", "Size thường đi"),
              field("profileFootForm", "Form chân"),
              field("profileSportsUse", "Môn chơi / mục đích"),
              field("profilePreferredBrands", "Brand thích")
            ),
            h("div", { class: "field" }, h("label", { for: "profileSummary" }, "Tóm tắt chân dung khách"), h("textarea", { id: "profileSummary" })),
            h("div", { class: "inline-panel", id: "pf-lich-su", hidden: true }),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "primary-button", type: "button", id: "pf-luu", "data-pf": "luu" }, "Tạo khách hàng"),
              h("button", { class: "ghost-button", type: "button", "data-pf": "dong" }, "Hủy"),
              h("span", { class: "status-line", id: "pf-trang-thai" })
            )
          )
        )
      );
      this.root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pf]");
        if (b === null) return;
        const job = b.dataset["pf"];
        if (job === "dong") this.close();
        else if (job === "luu") void this.save();
        else if (job === "them-dia-chi") void this.addAddress();
        else if (job === "mac-dinh") void this.setDefault(str(b.dataset["ma"]));
      });
    }
    gateway;
    root;
    profile = null;
    onSaved = null;
    /** Mở khung: `id` rỗng = tạo mới (có thể điền sẵn tên/SĐT). */
    async open(id, opts = {}) {
      this.onSaved = opts.onSaved ?? null;
      this.profile = null;
      this.root.hidden = false;
      for (const i of ["profileName", "profilePhone", "profileAddressDetail", "profileUsualSize", "profileFootForm", "profileSportsUse", "profilePreferredBrands", "profileSummary"]) el(i).value = "";
      writeAddress("pf", {});
      clear(el("pf-so-dia-chi"));
      el("pf-lich-su").hidden = true;
      status(el("pf-trang-thai"), "");
      el("pf-them-dia-chi-hang").hidden = true;
      if (id === "") {
        el("pf-tieu-de").textContent = "Tạo khách hàng mới";
        el("pf-luu").textContent = "Tạo khách hàng";
        el("profileName").value = opts.prefill?.ten ?? "";
        el("profilePhone").value = opts.prefill?.dienThoai ?? "";
        el("profileName").focus();
        return;
      }
      status(el("pf-trang-thai"), "Đang tải hồ sơ…");
      const r = await this.gateway.landing("khach.ho-so.doc", { ma: id });
      if (!r.ok || !r.than?.khach) {
        status(el("pf-trang-thai"), r.viSao || "Không mở được hồ sơ.", "bad");
        return;
      }
      this.fill(r.than);
      status(el("pf-trang-thai"), "");
    }
    close() {
      this.root.hidden = true;
    }
    fill(detail) {
      const p = detail.khach;
      if (p === null) return;
      this.profile = p;
      el("pf-tieu-de").textContent = `Hồ sơ ${p.ten}`;
      el("pf-luu").textContent = "Lưu thay đổi";
      el("profileName").value = p.ten;
      el("profilePhone").value = p.dienThoai;
      el("profileUsualSize").value = p.sizeQuen;
      el("profileFootForm").value = p.formChan;
      el("profileSportsUse").value = p.monChoi;
      el("profilePreferredBrands").value = p.hangThich;
      el("profileSummary").value = p.tomTat;
      this.drawBook(detail.diaChi ?? []);
      el("pf-them-dia-chi-hang").hidden = false;
      const history2 = el("pf-lich-su");
      clear(history2);
      history2.hidden = false;
      history2.appendChild(h("h3", null, "Lịch sử mua hàng"));
      for (const d of detail.don ?? []) history2.appendChild(h("div", null, `${d.maDon} · ${money(d.tong)} · ${d.trangThai} · ${dayClock(d.taoLuc)}`));
      if ((detail.don ?? []).length === 0) history2.appendChild(h("p", { class: "subtle" }, "Chưa có đơn hàng."));
    }
    drawBook(addresses) {
      const book = el("pf-so-dia-chi");
      clear(book);
      for (const a of addresses) {
        const remove = h("button", { class: "ghost-button compact-button danger", type: "button" }, "Xoá");
        confirmTwice(remove, "Bấm lần nữa để xoá", () => void this.removeAddress(a.ma));
        book.appendChild(h(
          "div",
          { class: "order-card" },
          h("strong", null, addressLine(a)),
          a.macDinh ? h("span", { class: "badge green" }, " mặc định") : null,
          h("div", { class: "subtle" }, `${a.nguoiNhan}${a.dienThoai ? ` · ${a.dienThoai}` : ""} · ${a.he === "hai-cap" ? "hệ 2 cấp" : "hệ 3 cấp"}`),
          h(
            "div",
            { class: "split-actions compact-actions" },
            a.macDinh ? null : h("button", { class: "secondary-button compact-button", type: "button", "data-pf": "mac-dinh", "data-ma": a.ma }, "Đặt mặc định"),
            remove
          )
        ));
      }
      if (addresses.length === 0 && this.profile !== null) book.appendChild(h("p", { class: "subtle" }, "Chưa có địa chỉ lưu sẵn — điền bên dưới rồi bấm Thêm."));
    }
    /** Địa chỉ đang gõ ở các ô, hoặc null nếu để trống hết. */
    typedAddress() {
      const a = readAddress("pf");
      const chiTiet = el("profileAddressDetail").value.trim();
      if (a.tinh === "" && a.xa === "" && chiTiet === "") return null;
      return { he: a.he, tinh: a.tinh, huyen: a.huyen, xa: a.xa, chiTiet };
    }
    async save() {
      const line = el("pf-trang-thai");
      const value = (id) => el(id).value.trim();
      if (value("profileName") === "") {
        status(line, "Khách hàng cần có tên.", "bad");
        return;
      }
      status(line, "Đang lưu…");
      const typed = this.profile === null ? this.typedAddress() : null;
      const r = await this.gateway.landing("khach.ho-so.ghi", {
        ...this.profile ? { ma: this.profile.ma } : {},
        ten: value("profileName"),
        dienThoai: value("profilePhone"),
        sizeQuen: value("profileUsualSize"),
        formChan: value("profileFootForm"),
        monChoi: value("profileSportsUse"),
        hangThich: value("profilePreferredBrands"),
        tomTat: value("profileSummary"),
        ...typed === null ? {} : { diaChiMoi: typed }
      });
      if (!r.ok || !r.than?.khach) {
        status(line, r.viSao || "Không lưu được.", "bad");
        return;
      }
      this.fill(r.than);
      status(line, "Đã lưu hồ sơ.", "good");
      this.onSaved?.(r.than.khach);
    }
    async addAddress() {
      const line = el("pf-trang-thai");
      if (this.profile === null) return;
      const typed = this.typedAddress();
      if (typed === null) {
        status(line, "Điền địa chỉ trước.", "bad");
        return;
      }
      const r = await this.gateway.landing("khach.ho-so.dia-chi.ghi", { maKhach: this.profile.ma, ...typed, macDinh: el("pf-mac-dinh").checked });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.drawBook(r.than?.diaChi ?? []);
      el("profileAddressDetail").value = "";
      writeAddress("pf", {});
      status(line, "Đã thêm địa chỉ.", "good");
      if (r.than?.khach) this.onSaved?.(r.than.khach);
    }
    async setDefault(addressId) {
      if (this.profile === null) return;
      const detail = await this.gateway.landing("khach.ho-so.doc", { ma: this.profile.ma });
      const a = detail.than?.diaChi?.find((x) => x.ma === addressId);
      if (!a) return;
      const r = await this.gateway.landing("khach.ho-so.dia-chi.ghi", { maKhach: this.profile.ma, ...a, macDinh: true });
      if (!r.ok) {
        status(el("pf-trang-thai"), r.viSao, "bad");
        return;
      }
      this.drawBook(r.than?.diaChi ?? []);
    }
    async removeAddress(addressId) {
      if (this.profile === null) return;
      const r = await this.gateway.landing("khach.ho-so.dia-chi.xoa", { maKhach: this.profile.ma, ma: addressId });
      if (!r.ok) {
        status(el("pf-trang-thai"), r.viSao, "bad");
        return;
      }
      this.drawBook(r.than?.diaChi ?? []);
    }
  };

  // ../omi/packages/omi-ui/src/views/customers.ts
  var CustomersView = class extends View {
    id = "khach";
    label = "Khách hàng";
    title = "Quản lý khách hàng";
    workspace = "common";
    glyph = "KH";
    profiles = [];
    actions = {
      "open-customer-create": () => customerEditor(this.ctx.gateway).open("", { onSaved: () => void this.loadAll() }),
      "edit-customer-profile": (b) => customerEditor(this.ctx.gateway).open(b.dataset["profileId"] ?? "", { onSaved: () => void this.loadAll() }),
      "select-landing-customer": (b) => this.ctx.shell.open("don", { soanDon: true, maKhach: b.dataset["profileId"] ?? "", khach: b.dataset["name"] ?? "", dienThoai: b.dataset["phone"] ?? "" }),
      "create-profile-from-orders": (b) => customerEditor(this.ctx.gateway).open("", { prefill: { ten: b.dataset["name"] ?? "", dienThoai: b.dataset["phone"] ?? "" }, onSaved: () => void this.loadAll() })
    };
    build(root) {
      const card = (label, id, hint) => h("section", { class: "panel metric" }, h("div", { class: "label" }, label), h("div", { class: "value", id }, "—"), h("div", { class: "hint", id: `${id}-goi-y` }, hint));
      root.append(
        h(
          "div",
          { class: "grid three" },
          card("Tổng khách hàng", "kh-tong", "Hồ sơ hợp nhất từ đơn hàng, hội thoại và nhập tay"),
          card("Đơn có số điện thoại", "kh-don-co-so", "Dùng để đối chiếu lịch sử mua"),
          card("Khách chưa có hồ sơ", "kh-chua-ho-so", "Có trong đơn nhưng chưa vào sổ khách")
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Danh sách khách hàng"), h("p", null, "Danh sách gọn. Bấm vào khách hàng để xem hồ sơ và chỉnh sửa.")),
            h(
              "div",
              { class: "split-actions" },
              h("input", { id: "kh-tu-khoa", type: "text", placeholder: "Tên, điện thoại, địa chỉ, ghi chú", onkeydown: (e) => {
                if (e.key === "Enter") void this.loadAll();
              } }),
              h("button", { class: "secondary-button", id: "nut-kh-tim", type: "button", onclick: () => void this.loadAll() }, "Tìm"),
              h("button", { class: "primary-button", type: "button", "data-action": "open-customer-create" }, "Tạo khách hàng mới"),
              h("span", { class: "badge blue", id: "kh-dem" }, "0 khách")
            )
          ),
          h("span", { class: "status-line", id: "kh-trang-thai" }),
          h(
            "div",
            { class: "panel-body table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, ...["Tên khách hàng", "Số điện thoại", "Khu vực", "Nguồn", "Lịch sử mua", ""].map((t) => h("th", null, t)))),
              h("tbody", { id: "kh-ho-so" })
            )
          )
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Khách trong đơn chưa có hồ sơ"), h("p", null, 'Mỗi số điện thoại một dòng. Bấm dòng để xem đơn; "Tạo hồ sơ" để đưa vào sổ khách.'))),
          table(["Điện thoại", "Tên", "Tỉnh", "Số đơn", "Tổng tiền", "Đơn gần nhất", ""], "kh-theo-don")
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Tài khoản đã đăng ký"), h("p", null, 'Khách tự đăng ký trên web; đơn gắn vào tài khoản tự hiện ở trang "Đơn của tôi".'))),
          table(["Tên đăng nhập", "Tên", "Email", "Điện thoại", "Email xác thực", "Số đơn", "Đăng ký lúc"], "kh-tai-khoan")
        )
      );
    }
    load() {
      void this.loadAll();
    }
    async loadAll() {
      const line = el("kh-trang-thai");
      status(line, "Đang tải…");
      const q = el("kh-tu-khoa").value.trim();
      const [profiles, fromOrders] = await Promise.all([
        this.ctx.gateway.landing("khach.ho-so.danh-sach", { tuKhoa: q, gioiHan: 500 }),
        this.ctx.gateway.landing("khach.danh-sach", { tuKhoa: q, gioiHan: 300 })
      ]);
      if (!profiles.ok) {
        status(line, profiles.viSao, "bad");
        return;
      }
      this.profiles = profiles.than?.khach ?? [];
      this.drawProfiles();
      const known = new Set(this.profiles.map((p) => p.dienThoai).filter(Boolean));
      const byOrders = fromOrders.than?.theoDon ?? [];
      const missing = byOrders.filter((k) => !known.has(k.dienThoai));
      el("kh-tong").textContent = String(this.profiles.length);
      el("kh-don-co-so").textContent = String(byOrders.reduce((t, k) => t + k.soDon, 0));
      el("kh-chua-ho-so").textContent = String(missing.length);
      const body = el("kh-theo-don");
      clear(body);
      for (const k of missing) {
        const make = h("button", { class: "secondary-button compact-button", type: "button", "data-action": "create-profile-from-orders", "data-phone": k.dienThoai, "data-name": k.ten }, "Tạo hồ sơ");
        const tr = tableRow([k.dienThoai, k.ten, k.tinh || "—", k.soDon, money(k.tongTien), day(k.donCuoi), make], [3, 4]);
        tr.addEventListener("click", (e) => {
          if (!e.target.closest("[data-action]")) this.ctx.shell.open("don", { dienThoai: k.dienThoai });
        });
        body.appendChild(tr);
      }
      if (missing.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "7", class: "subtle" }, "Khách nào trong đơn cũng đã có hồ sơ.")));
      const accountBody = el("kh-tai-khoan");
      clear(accountBody);
      for (const a of fromOrders.than?.taiKhoan ?? []) {
        const tr = tableRow([a.tenDangNhap, a.ten, a.email, a.dienThoai || "—", a.emailDaXacThuc ? "có" : "chưa", a.soDon, day(a.taoLuc)], [5]);
        if (a.dienThoai) tr.addEventListener("click", () => this.ctx.shell.open("don", { dienThoai: a.dienThoai }));
        accountBody.appendChild(tr);
      }
      status(line, "");
    }
    drawProfiles() {
      const body = el("kh-ho-so");
      clear(body);
      el("kh-dem").textContent = `${this.profiles.length} khách`;
      const source = { "nhap-tay": "Manual", "don-web": "Đơn web", fanpage: "Fanpage", zalo: "Zalo" };
      for (const p of this.profiles) {
        const area = p.diaChiMacDinh ? p.diaChiMacDinh.xa || p.diaChiMacDinh.tinh : "";
        body.appendChild(h(
          "tr",
          null,
          h("td", null, h("strong", null, p.ten), h("div", { class: "subtle" }, p.tomTat || "Chưa có chân dung khách")),
          h("td", null, p.dienThoai || "Chưa có"),
          h("td", { title: p.diaChiMacDinh ? addressLine(p.diaChiMacDinh) : p.diaChi }, area || p.diaChi || "Chưa có"),
          h("td", null, source[p.nguon] ?? p.nguon),
          h("td", null, `${p.soDon ?? 0} đơn${p.tongTien ? ` · ${money(p.tongTien)}` : ""}`),
          h("td", null, h(
            "div",
            { class: "split-actions compact-actions" },
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-customer-profile", "data-profile-id": p.ma }, "Xem / sửa"),
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "select-landing-customer", "data-profile-id": p.ma, "data-name": p.ten, "data-phone": p.dienThoai }, "Chọn")
          ))
        ));
      }
      if (this.profiles.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "6" }, "Chưa có khách hàng.")));
    }
  };

  // ../omi/packages/omi-ui/src/views/dashboard.ts
  var CHANNEL_LABEL2 = { zalo: "Zalo nhóm", "fb-ca-nhan": "Facebook cá nhân" };
  var DashboardView = class extends View {
    id = "tong-quan";
    label = "Tổng quan";
    title = "Tổng quan";
    workspace = "common";
    glyph = "⌁";
    build(root) {
      root.append(
        h(
          "div",
          { class: "grid four" },
          metric("Đơn 14 ngày", "tq-so-don", "theo báo cáo landing"),
          metric("Còn phải thu", "tq-con-thu", "COD và đơn chưa trả"),
          metric("Cần người thật", "tq-can-nguoi", "bot đã chuyển người"),
          metric("Hàng chờ gửi", "tq-cho-gui", "Zalo / Facebook cá nhân")
        ),
        h(
          "div",
          { class: "grid two" },
          h(
            "section",
            { class: "panel" },
            h(
              "div",
              { class: "panel-header" },
              h("div", null, h("h3", null, "Kết nối"), h("p", null, "Xeon cấp vé, landing giữ dữ liệu, máy trực chạy kênh.")),
              h("span", { class: "status-line", id: "tq-trang-thai" })
            ),
            table(["Thành phần", "Trạng thái", "Ghi chú"], "tq-ket-noi", { scroll: false })
          ),
          h(
            "section",
            { class: "panel" },
            h(
              "div",
              { class: "panel-header" },
              h("div", null, h("h3", null, "Việc cần người"), h("p", null, "Hội thoại bot không chắc — mở Hộp thư để trả lời.")),
              h("button", { class: "secondary-button compact-button", type: "button", onclick: () => this.ctx.shell.open("hop-thu") }, "Mở Hộp thư")
            ),
            table(["Kênh", "Người", "Tin cuối", "Vì sao"], "tq-can-nguoi-bang", { scroll: false })
          )
        )
      );
    }
    load() {
      void this.loadAll();
    }
    async loadAll() {
      const line = el("tq-trang-thai");
      status(line, "Đang tải…");
      const [report, needs, outbox, version, channels] = await Promise.all([
        this.ctx.gateway.landing("bao-cao.tong-quan", { soNgay: 14 }),
        this.ctx.gateway.landing("hop-thu.can-nguoi"),
        this.ctx.gateway.landing("hop-thu.cho-gui"),
        this.ctx.gateway.landing("phien-ban"),
        this.ctx.gateway.channel("trang-thai")
      ]);
      el("tq-so-don").textContent = report.ok ? String(report.than?.tong?.soDon ?? 0) : "—";
      el("tq-con-thu").textContent = report.ok ? money(report.than?.tong?.conPhaiThu) : "—";
      const waiting = needs.ok ? needs.than?.muc ?? [] : [];
      el("tq-can-nguoi").textContent = needs.ok ? String(waiting.length) : "—";
      el("tq-cho-gui").textContent = outbox.ok ? String(outbox.than?.tomTat?.cho ?? 0) : "—";
      const license2 = this.ctx.shell.license();
      const rows = el("tq-ket-noi");
      clear(rows);
      rows.appendChild(tableRow([
        "Xeon / license",
        license2 === null ? badge("chưa có vé", "red") : badge("đã có vé", "green"),
        license2 === null ? "" : `${str(license2.tenShop)} · hạn ${day(license2.hetHan)}${license2.truc ? " · máy trực" : ""}`
      ]));
      rows.appendChild(tableRow([
        "Landing của shop",
        version.ok ? badge("đang nối được", "green") : badge("chưa nối được", "red"),
        version.ok ? version.than?.deployId ? `bản ${version.than.deployId}` : "" : version.viSao
      ]));
      for (const k of channels.ok ? channels.kenh : []) {
        rows.appendChild(tableRow([
          CHANNEL_LABEL2[k.kenh] ?? k.kenh,
          k.dangChay ? badge("đang chạy", "green") : k.bat ? badge("bật, chờ máy trực", "amber") : badge("tắt", ""),
          k.loiCuoi || (k.selectorsVerified ? "" : "selector chưa xác minh")
        ]));
      }
      if (!channels.ok) rows.appendChild(tableRow(["Kênh Zalo / FB", badge("chưa đọc được", "amber"), channels.viSao]));
      const needsBody = el("tq-can-nguoi-bang");
      clear(needsBody);
      for (const m of waiting.slice(0, 8)) needsBody.appendChild(tableRow([m.kenh, m.nguoi, m.tinCuoi, m.lyDo]));
      if (waiting.length === 0) needsBody.appendChild(tableRow([needs.ok ? "Không có hội thoại nào chờ." : needs.viSao, "", "", ""]));
      const failed = [report, needs, outbox, version].filter((r) => !r.ok).length;
      status(line, failed === 0 ? "Đã cập nhật." : `${failed} phần chưa đọc được.`, failed === 0 ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/views/fanpage.ts
  var REFRESH_MS = 15e3;
  var COMMENT_CHANNEL = "facebook-binh-luan";
  var CHANNEL_LABEL3 = {
    facebook: "Messenger",
    [COMMENT_CHANNEL]: "Bình luận",
    zalo: "Zalo nhóm",
    "fb-ca-nhan": "Facebook cá nhân"
  };
  var FanpageView = class extends View {
    id = "fanpage";
    label = "Fanpage";
    title = "Fanpage & hội thoại";
    workspace = "common";
    glyph = "FB";
    threads = [];
    openThread = null;
    filter = "tat-ca";
    channel = "";
    /** Conversation ids the bot handed to a human — marked in the list so they get answered first. */
    needHuman = /* @__PURE__ */ new Set();
    timer = null;
    build(root) {
      root.append(
        h(
          "div",
          { class: "toolbar" },
          h("button", { class: "secondary-button", id: "nut-fanpage-tai", type: "button", onclick: () => void this.loadAll() }, "Tải lại"),
          h("label", { class: "check" }, h("input", { type: "checkbox", id: "fp-tu-tai", checked: true }), ` Tự tải mới (${REFRESH_MS / 1e3} giây)`),
          h("span", { class: "status-line", id: "fanpage-trang-thai" }, "Bấm để tải.")
        ),
        h(
          "div",
          { class: "facebook-desk" },
          h(
            "aside",
            { class: "facebook-conversation-pane" },
            // Chọn fanpage — chép `facebookPageSelector` (Desk `app.js`). Không chọn trang nào = mọi trang.
            h(
              "details",
              { class: "facebook-page-select", id: "fp-chon-trang" },
              h(
                "summary",
                null,
                h("span", { class: "facebook-page-stack" }, h("span", null, "FB")),
                h("strong", { id: "fp-trang-nhan" }, "Chọn fanpage"),
                h("span", { class: "facebook-caret" }, "⌄")
              ),
              h(
                "div",
                { class: "facebook-page-menu" },
                h(
                  "div",
                  { class: "facebook-page-menu-actions" },
                  h("button", { class: "secondary-button compact-button", type: "button", "data-action": "select-all-facebook-pages" }, "Chọn tất cả"),
                  h("button", { class: "secondary-button compact-button", type: "button", "data-action": "clear-facebook-page-selection" }, "Bỏ chọn"),
                  h("button", { class: "secondary-button compact-button", type: "button", "data-action": "refresh-facebook-pages" }, "Tải lại trang"),
                  h("button", { class: "primary-button compact-button", type: "button", "data-action": "load-facebook-selected-conversations" }, "Tải hội thoại")
                ),
                h("div", { class: "facebook-page-options", id: "fp-trang-ds" })
              )
            ),
            h(
              "div",
              { class: "facebook-tabs" },
              this.filterButton("tat-ca", "Tất cả"),
              this.filterButton("chua-doc", "Chưa đọc"),
              this.filterButton("can-nguoi", "Cần người")
            ),
            h(
              "div",
              { class: "facebook-tabs" },
              this.channelButton("", "Mọi kênh"),
              this.channelButton("facebook", "Messenger"),
              this.channelButton(COMMENT_CHANNEL, "Bình luận"),
              this.channelButton("zalo", "Zalo"),
              this.channelButton("fb-ca-nhan", "FB cá nhân")
            ),
            h(
              "div",
              { class: "facebook-search-row" },
              h("input", { id: "fp-tim", type: "text", placeholder: "Tìm người hoặc nội dung", onkeydown: (e) => {
                if (e.key === "Enter") void this.loadThreads();
              } }),
              h("button", { class: "secondary-button compact-button", id: "nut-fanpage-tim", type: "button", onclick: () => void this.loadThreads() }, "Tìm")
            ),
            h(
              "div",
              { class: "facebook-inbox-summary" },
              h("span", { id: "fp-dem" }, "0 hội thoại"),
              h("span", { id: "fp-dem-chua-doc" }, "")
            ),
            h("div", { class: "facebook-thread-list", id: "fp-danh-sach" })
          ),
          h(
            "main",
            { class: "facebook-chat-pane" },
            h(
              "div",
              { class: "facebook-chat-header" },
              h("div", null, h("h3", { id: "fp-ten" }, "Chưa chọn hội thoại"), h("p", { id: "fp-nguon" }, "Bấm một hội thoại bên trái để đọc.")),
              h("button", { class: "secondary-button compact-button", id: "nut-fanpage-xong", type: "button", onclick: () => void this.markHandled() }, "Đã xử lý")
            ),
            h("div", { class: "chat-window", id: "fp-khung-chat" }),
            h(
              "div",
              { class: "facebook-composer" },
              h("textarea", { id: "fp-tra-loi", rows: "2", placeholder: "Trả lời khách… (Ctrl+Enter để gửi)", onkeydown: (e) => {
                const k = e;
                if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) void this.send();
              } }),
              // Ảnh gửi kèm (`facebookReplyAttachmentTemplate`): hoá đơn, QR, ảnh thật của đôi giày.
              h(
                "div",
                { class: "facebook-reply-attachment", id: "fp-anh-kem", hidden: true },
                h("img", { id: "fp-anh-xem", alt: "" }),
                h("span", { id: "fp-anh-ten" }),
                h("button", { class: "ghost-button compact-button", type: "button", "data-action": "clear-facebook-reply-image" }, "Bỏ ảnh")
              ),
              h("input", { id: "fp-anh-tep", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true, onchange: () => void this.pickImage() }),
              h(
                "div",
                { class: "toolbar" },
                h("button", { class: "primary-button", id: "nut-fanpage-gui", type: "button", onclick: () => void this.send() }, "Gửi"),
                h("button", { class: "secondary-button compact-button", type: "button", "data-action": "send-facebook-order-image" }, "Gửi ảnh"),
                h("span", { class: "status-line", id: "fp-gui-trang-thai" })
              )
            )
          ),
          h(
            "aside",
            { class: "facebook-customer-pane" },
            h(
              "section",
              { class: "panel" },
              h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Khách này"))),
              h(
                "div",
                { class: "kv" },
                h("div", { class: "kv-row" }, h("span", null, "Tên hiện"), h("b", { id: "fp-kh-ten" }, "—")),
                h("div", { class: "kv-row" }, h("span", null, "Kênh"), h("b", { id: "fp-kh-kenh" }, "—")),
                h("div", { class: "kv-row" }, h("span", null, "Mã người"), h("b", { id: "fp-kh-ma" }, "—")),
                h("div", { class: "kv-row" }, h("span", null, "Hoạt động"), h("b", { id: "fp-kh-luc" }, "—"))
              )
            ),
            h(
              "section",
              { class: "panel" },
              h("div", { class: "panel-header" }, h(
                "div",
                null,
                h("h3", null, "Đơn của khách"),
                h("p", null, "Messenger không cho biết số điện thoại. Hỏi khách rồi điền vào đây để nối với đơn.")
              )),
              h(
                "div",
                { class: "panel-body" },
                h(
                  "div",
                  { class: "toolbar" },
                  h("input", { id: "fp-kh-dien-thoai", type: "text", placeholder: "Số điện thoại khách", onkeydown: (e) => {
                    if (e.key === "Enter") void this.loadCustomerOrders();
                  } }),
                  h("button", { class: "secondary-button compact-button", id: "nut-fanpage-don", type: "button", onclick: () => void this.loadCustomerOrders() }, "Xem đơn"),
                  h("button", { class: "ghost-button compact-button", type: "button", "data-action": "copy-facebook-customer-phone" }, "Copy SĐT")
                ),
                h(
                  "div",
                  { class: "toolbar" },
                  h("input", { id: "fp-kh-dia-chi", type: "text", placeholder: "Địa chỉ khách nhắn trong chat" }),
                  // Lưu lên hội thoại TRÊN MÁY CHỦ: máy khác mở cuộc này cũng thấy số và địa chỉ.
                  h("button", { class: "secondary-button compact-button", type: "button", "data-action": "apply-facebook-message-contact" }, "Lưu SĐT/địa chỉ")
                ),
                h("div", { id: "fp-don-cua-khach" }),
                h(
                  "div",
                  { class: "toolbar" },
                  h("button", { class: "primary-button compact-button", id: "nut-fanpage-chot-don", type: "button", onclick: () => this.composeOrder() }, "Chốt đơn cho khách này")
                ),
                h("p", { class: "status-line", id: "fp-don-trang-thai" }, "—")
              )
            ),
            h(
              "section",
              { class: "panel" },
              h("div", { class: "panel-header" }, h(
                "div",
                null,
                h("h3", null, "Gợi ý sản phẩm"),
                h("p", null, "Bấm một món để chèn mã, size còn và giá vào ô trả lời — số liệu lấy từ kho, không gõ tay.")
              )),
              h(
                "div",
                { class: "panel-body" },
                h(
                  "div",
                  { class: "toolbar" },
                  h("input", { id: "fp-tim-hang", type: "text", placeholder: "Mã hoặc tên hàng", onkeydown: (e) => {
                    if (e.key === "Enter") void this.searchProducts();
                  } }),
                  h("button", { class: "secondary-button compact-button", id: "nut-fanpage-tim-hang", type: "button", onclick: () => void this.searchProducts() }, "Tìm")
                ),
                h("div", { id: "fp-hang-goi-y" }),
                h("p", { class: "status-line", id: "fp-hang-trang-thai" }, "—")
              )
            )
          )
        )
      );
      this.startAutoRefresh();
    }
    /** Trang Facebook shop đã nối (không token). */
    pages = [];
    /** Trang đang chọn — rỗng = mọi trang. */
    chosenPages = /* @__PURE__ */ new Set();
    /** Ảnh đang chờ gửi kèm (data URL, đọc từ tệp người bán chọn). */
    image = null;
    actions = {
      "refresh-facebook-pages": () => this.loadPages(),
      "select-all-facebook-pages": () => {
        this.chosenPages = new Set(this.pages.map((p) => p.ma));
        this.paintPages();
      },
      "clear-facebook-page-selection": () => {
        this.chosenPages.clear();
        this.paintPages();
      },
      "load-facebook-selected-conversations": () => {
        el("fp-chon-trang").open = false;
        return this.loadThreads();
      },
      "apply-facebook-message-contact": () => this.saveContact(),
      "copy-facebook-customer-phone": () => this.copyPhone(),
      "send-facebook-order-image": () => {
        el("fp-anh-tep").click();
      },
      "clear-facebook-reply-image": () => this.clearImage()
    };
    async loadPages() {
      const r = await this.ctx.gateway.landing("hop-thu.trang");
      if (!r.ok) {
        status(el("fanpage-trang-thai"), r.viSao, "bad");
        return;
      }
      this.pages = r.than?.trang ?? [];
      for (const id of [...this.chosenPages]) if (!this.pages.some((p) => p.ma === id)) this.chosenPages.delete(id);
      this.paintPages();
    }
    paintPages() {
      const box = el("fp-trang-ds");
      clear(box);
      for (const p of this.pages) {
        const input = h("input", {
          type: "checkbox",
          "data-facebook-merge-page-id": p.ma,
          checked: this.chosenPages.has(p.ma),
          onchange: (e) => {
            if (e.target.checked) this.chosenPages.add(p.ma);
            else this.chosenPages.delete(p.ma);
            this.paintPageLabel();
          }
        });
        box.appendChild(h("label", { class: "facebook-page-option" }, input, h("span", null, h("strong", null, p.ten || p.ma), h("small", null, `${p.ma}${p.coToken ? "" : " · chưa có token"}`))));
      }
      if (this.pages.length === 0) box.appendChild(h("p", { class: "subtle" }, "Chưa nối fanpage nào — nối ở màn Kết nối."));
      this.paintPageLabel();
    }
    paintPageLabel() {
      el("fp-trang-nhan").textContent = this.chosenPages.size === 0 ? "Mọi fanpage" : `Đã chọn ${this.chosenPages.size} trang`;
    }
    async saveContact() {
      const line = el("fp-don-trang-thai");
      const thread = this.openThread;
      if (thread === null) {
        status(line, "Chọn một hội thoại trước.", "bad");
        return;
      }
      const dienThoai = el("fp-kh-dien-thoai").value.trim();
      const diaChi2 = el("fp-kh-dia-chi").value.trim();
      if (dienThoai === "" && diaChi2 === "") {
        status(line, "Nhập số điện thoại hoặc địa chỉ.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("hop-thu.lien-he", { ma: thread.ma, dienThoai, diaChi: diaChi2 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, "Đã lưu vào hội thoại.", "good");
    }
    async copyPhone() {
      const phone = el("fp-kh-dien-thoai").value.trim();
      const line = el("fp-don-trang-thai");
      if (phone === "") {
        status(line, "Chưa có số điện thoại.", "bad");
        return;
      }
      try {
        await navigator.clipboard.writeText(phone);
        status(line, "Đã copy số điện thoại.", "good");
      } catch {
        status(line, "Máy không cho chép vào bộ nhớ tạm.", "bad");
      }
    }
    async pickImage() {
      const input = el("fp-anh-tep");
      const file = input.files?.[0];
      input.value = "";
      const line = el("fp-gui-trang-thai");
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        status(line, "Ảnh quá 8 MB — Messenger không nhận.", "bad");
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("Không đọc được ảnh."));
        reader.readAsDataURL(file);
      }).catch((e) => {
        status(line, String(e?.message ?? e), "bad");
        return "";
      });
      if (dataUrl === "") return;
      this.image = { dataUrl, name: file.name };
      el("fp-anh-xem").src = dataUrl;
      el("fp-anh-ten").textContent = file.name;
      el("fp-anh-kem").hidden = false;
      status(line, "Ảnh sẽ gửi kèm khi bấm Gửi.", "good");
    }
    clearImage() {
      this.image = null;
      el("fp-anh-xem").removeAttribute("src");
      el("fp-anh-kem").hidden = true;
    }
    filterButton(value, label) {
      return h("button", {
        class: `${value === "tat-ca" ? "active" : ""}`,
        type: "button",
        "data-loc": value,
        onclick: () => {
          this.filter = value;
          this.paintTabs();
          void this.loadThreads();
        }
      }, label);
    }
    channelButton(value, label) {
      return h("button", {
        class: `${value === "" ? "active" : ""}`,
        type: "button",
        "data-kenh": value,
        onclick: () => {
          this.channel = value;
          this.paintTabs();
          void this.loadThreads();
        }
      }, label);
    }
    paintTabs() {
      for (const b of this.root.querySelectorAll("[data-loc]")) b.classList.toggle("active", b.dataset["loc"] === this.filter);
      for (const b of this.root.querySelectorAll("[data-kenh]")) b.classList.toggle("active", b.dataset["kenh"] === this.channel);
    }
    load() {
      void this.loadPages();
      void this.loadAll();
    }
    /**
     * Reload on a timer while this screen is the one on top.
     *
     * It skips while the reply box has anything in it: a refresh that redraws the thread under
     * someone mid-sentence is how a half-typed answer gets lost.
     */
    startAutoRefresh() {
      if (this.timer !== null) return;
      this.timer = setInterval(() => {
        if (!el("fp-tu-tai").checked) return;
        if (el(`than-${this.id}`).hidden) return;
        if (el("fp-tra-loi").value.trim() !== "") return;
        void this.loadAll({ quiet: true });
      }, REFRESH_MS);
    }
    async loadAll({ quiet = false } = {}) {
      await this.loadHandoffs();
      await this.loadThreads({ quiet });
      if (this.openThread !== null) await this.openConversation(this.openThread.ma, { quiet: true, markRead: false });
    }
    /** Which conversations the bot gave up on. Failure only costs the marks, so it never shows an error. */
    async loadHandoffs() {
      const r = await this.ctx.gateway.landing("hop-thu.can-nguoi");
      if (!r.ok) return;
      this.needHuman = new Set((r.than?.muc ?? []).map((m) => m.maHoiThoai));
    }
    async loadThreads({ quiet = false } = {}) {
      const line = el("fanpage-trang-thai");
      if (!quiet) status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("hop-thu.hoi-thoai", {
        kenh: this.channel,
        loc: this.filter === "chua-doc" ? "chua-doc" : "tat-ca",
        q: el("fp-tim").value.trim(),
        trang: [...this.chosenPages].join(","),
        gioiHan: 200
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const all = r.than?.hoiThoai ?? [];
      this.threads = this.filter === "can-nguoi" ? all.filter((t) => this.needHuman.has(t.ma)) : all;
      this.paintThreads();
      el("fp-dem").textContent = `${this.threads.length} hội thoại`;
      el("fp-dem-chua-doc").textContent = `${r.than?.soChuaDoc ?? 0} chưa đọc`;
      status(line, `${this.threads.length} hội thoại · ${this.needHuman.size} cần người.`, "good");
    }
    paintThreads() {
      const list = el("fp-danh-sach");
      clear(list);
      for (const t of this.threads) {
        const name = str(t.tenNguoi) || str(t.nguoi);
        const item = h(
          "button",
          { class: "facebook-thread-item", type: "button", "data-chon": t.ma === this.openThread?.ma ? "1" : "0", onclick: () => void this.openConversation(t.ma) },
          h(
            "span",
            { class: "who" },
            h("span", null, name),
            this.needHuman.has(t.ma) ? badge("cần người", "amber") : null,
            t.soChuaDoc > 0 ? h("span", { class: "chua-doc" }, String(t.soChuaDoc)) : null,
            h("time", null, clock(t.hoatDongLuc))
          ),
          h("span", { class: "last" }, `${t.chieuCuoi === "di" ? "Mình: " : ""}${str(t.tinCuoi) || "(chưa có nội dung)"}`)
        );
        list.appendChild(item);
      }
      if (this.threads.length === 0) list.appendChild(h("p", { class: "status-line", style: "padding:14px" }, "Chưa có hội thoại nào ở bộ lọc này."));
    }
    async openConversation(id, { quiet = false, markRead = true } = {}) {
      const line = el("fanpage-trang-thai");
      const r = await this.ctx.gateway.landing("hop-thu.hoi-thoai.mo", { ma: id });
      if (!r.ok || !r.than?.hoiThoai) {
        if (!quiet) status(line, r.viSao || "Không mở được hội thoại.", "bad");
        return;
      }
      const switched = this.openThread?.ma !== r.than.hoiThoai.ma;
      this.openThread = r.than.hoiThoai;
      if (switched) {
        el("fp-kh-dien-thoai").value = str(this.openThread.dienThoai);
        el("fp-kh-dia-chi").value = str(this.openThread.diaChi);
      }
      this.paintThread();
      this.paintCustomer();
      this.paintThreads();
      if (markRead) {
        await this.ctx.gateway.landing("hop-thu.hoi-thoai.da-doc", { ma: id });
        void this.loadThreads({ quiet: true });
      }
    }
    paintThread() {
      const box = el("fp-khung-chat");
      const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      clear(box);
      const thread = this.openThread;
      if (thread === null) return;
      for (const m of thread.tin ?? []) {
        const mine = m.chieu === "di";
        const who = mine ? m.boi === "bo-nao" ? "bot" : "mình" : "khách";
        const note = mine && m.trangThai === "cho-gui" ? " · đang chờ máy trực gửi" : mine && m.trangThai === "hong" ? " · GỬI HỎNG" : str(m.baiViet) === "" ? "" : ` · dưới bài ${str(m.baiViet)}`;
        box.appendChild(h(
          "div",
          { class: `message ${mine ? "ai" : "customer"}` },
          m.chu === "" && m.soAnh > 0 ? `(${m.soAnh} ảnh)` : m.chu,
          h("span", { class: "khi" }, `${who} · ${dayClock(m.luc)}${note}`)
        ));
      }
      if ((thread.tin ?? []).length === 0) box.appendChild(h("div", { class: "message system" }, "Chưa có tin nào trong hội thoại này."));
      if (wasAtBottom) box.scrollTop = box.scrollHeight;
    }
    paintCustomer() {
      const thread = this.openThread;
      el("fp-ten").textContent = thread === null ? "Chưa chọn hội thoại" : str(thread.tenNguoi) || str(thread.nguoi);
      el("fp-nguon").textContent = thread === null ? "Bấm một hội thoại bên trái để đọc." : `${CHANNEL_LABEL3[thread.kenh] ?? thread.kenh}${thread.kenh === COMMENT_CHANNEL ? " (trả lời công khai dưới bài)" : ""}${thread.trang ? ` · trang ${thread.trang}` : ""} · ${thread.soTin ?? (thread.tin ?? []).length} tin`;
      el("fp-kh-ten").textContent = thread === null ? "—" : str(thread.tenNguoi) || "—";
      el("fp-kh-kenh").textContent = thread === null ? "—" : CHANNEL_LABEL3[thread.kenh] ?? thread.kenh;
      el("fp-kh-ma").textContent = thread === null ? "—" : str(thread.nguoi);
      el("fp-kh-luc").textContent = thread === null ? "—" : dayClock(thread.hoatDongLuc);
    }
    async send() {
      const line = el("fp-gui-trang-thai");
      const thread = this.openThread;
      if (thread === null) {
        status(line, "Chọn một hội thoại trước.", "bad");
        return;
      }
      const box = el("fp-tra-loi");
      const text2 = box.value.trim();
      if (text2 === "" && this.image === null) {
        status(line, "Chưa có gì để gửi.", "bad");
        return;
      }
      if (this.image !== null && thread.kenh !== "facebook") {
        status(line, "Ảnh chỉ gửi được qua Messenger ở bản này.", "bad");
        return;
      }
      let imageUrl = "";
      if (this.image !== null) {
        status(line, "Đang tải ảnh lên…");
        const up = await this.ctx.gateway.landing("hop-thu.anh.tai-len", { anh: this.image.dataUrl });
        if (!up.ok || !up.than?.url) {
          status(line, up.viSao || "Không tải được ảnh lên.", "bad");
          return;
        }
        imageUrl = up.than.url;
      }
      const lastIncoming = [...thread.tin ?? []].reverse().find((m) => m.chieu === "den");
      if (thread.kenh === COMMENT_CHANNEL && (lastIncoming === void 0 || lastIncoming.maTin === "")) {
        status(line, "Không rõ bình luận nào để trả lời — tải lại hội thoại rồi thử lại.", "bad");
        return;
      }
      status(line, "Đang gửi…");
      const r = await this.ctx.gateway.landing("hop-thu.tra-loi", {
        kenh: thread.kenh,
        nguoi: thread.nguoi,
        chu: text2,
        ...imageUrl === "" ? {} : { anhUrl: imageUrl },
        ...thread.kenh === COMMENT_CHANNEL ? { traLoiTin: lastIncoming?.maTin ?? "" } : {}
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      box.value = "";
      this.clearImage();
      const queued = r.than?.["ketQua"]?.guiNgay === false;
      status(line, queued ? "Đã xếp hàng — máy trực sẽ gõ giúp." : "Đã gửi.", "good");
      await this.openConversation(thread.ma, { quiet: true, markRead: false });
    }
    /** The bot asked for a human and a human has now dealt with it. */
    async markHandled() {
      const line = el("fp-gui-trang-thai");
      const thread = this.openThread;
      if (thread === null) {
        status(line, "Chọn một hội thoại trước.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("hop-thu.can-nguoi.xong", { maHoiThoai: thread.ma });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.needHuman.delete(thread.ma);
      this.paintThreads();
      status(line, "Đã đánh dấu xử lý xong.", "good");
    }
    async loadCustomerOrders() {
      const line = el("fp-don-trang-thai");
      const phone = el("fp-kh-dien-thoai").value.trim();
      if (phone === "") {
        status(line, "Điền số điện thoại khách trước.", "bad");
        return;
      }
      status(line, "Đang tìm đơn…");
      const r = await this.ctx.gateway.landing("don.danh-sach", { dienThoai: phone, gioiHan: 20 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const rows = r.than ?? [];
      const box = el("fp-don-cua-khach");
      clear(box);
      for (const d of rows) {
        const row = h(
          "button",
          { class: "facebook-thread-item", type: "button", onclick: () => this.ctx.shell.open("don", { dienThoai: phone }) },
          h("span", { class: "who" }, h("span", null, d.id), h("time", null, d.trangThai)),
          h("span", { class: "last" }, `${d.khach} · còn phải trả ${Number(d.conPhaiTra).toLocaleString("vi-VN")}đ`)
        );
        box.appendChild(row);
      }
      status(line, rows.length === 0 ? "Chưa có đơn nào cho số này." : `${rows.length} đơn.`, rows.length === 0 ? "bad" : "good");
    }
    /**
     * Products to suggest in the chat.
     *
     * The seller picks, the SCREEN writes the sentence — from the catalogue's own numbers. Typing
     * "còn size 42, 2.890.000đ" by hand is how a customer gets promised a size that sold out an
     * hour ago, and how a price ends up one digit short.
     */
    async searchProducts() {
      const line = el("fp-hang-trang-thai");
      status(line, "Đang tìm…");
      const r = await this.ctx.gateway.landing("hang.tim", { tuKhoa: el("fp-tim-hang").value.trim(), gioiHan: 20 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const items = r.than ?? [];
      const box = el("fp-hang-goi-y");
      clear(box);
      for (const m of items) {
        const inStock = (m.size ?? []).filter((s) => Number(s.ton) > 0);
        const row = h(
          "button",
          { class: "facebook-thread-item", type: "button", onclick: () => this.suggestProduct(m) },
          h("span", { class: "who" }, h("span", null, `${m.ma} · ${m.ten}`), h("time", null, money(m.gia))),
          h("span", { class: "last" }, inStock.length === 0 ? "hết size" : `còn size ${inStock.map((s) => s.size).join(", ")}`)
        );
        box.appendChild(row);
      }
      status(line, items.length === 0 ? "Không thấy món nào." : `${items.length} món — bấm để chèn vào câu trả lời.`, items.length === 0 ? "bad" : "good");
    }
    /** Writes the suggestion into the reply box; the person still reads it before sending. */
    suggestProduct(product) {
      const inStock = (product.size ?? []).filter((s) => Number(s.ton) > 0).map((s) => s.size);
      const sizes = inStock.length === 0 ? "đang hết size, em báo lại khi về hàng ạ" : `còn size ${inStock.join(", ")}`;
      const sentence = `Dạ mẫu ${product.ten} (mã ${product.ma}) ${sizes}, giá ${money(product.gia)} ạ.`;
      const box = el("fp-tra-loi");
      box.value = box.value.trim() === "" ? sentence : `${box.value.trim()}
${sentence}`;
      box.focus();
      status(el("fp-hang-trang-thai"), `Đã chèn ${product.ma}. Đọc lại rồi bấm Gửi.`, "good");
    }
    /** Rule 4: hand the customer to Orders; this screen never writes an order itself. */
    composeOrder() {
      const thread = this.openThread;
      this.ctx.shell.open("don", {
        soanDon: true,
        khach: thread === null ? "" : str(thread.tenNguoi) || str(thread.nguoi),
        dienThoai: el("fp-kh-dien-thoai").value.trim()
      });
    }
  };

  // ../omi/packages/omi-ui/src/views/date-filter.ts
  var two2 = (n) => n < 10 ? `0${n}` : String(n);
  var dayInput = (d) => `${d.getFullYear()}-${two2(d.getMonth() + 1)}-${two2(d.getDate())}`;
  function presetRange(preset, now = /* @__PURE__ */ new Date(), custom = { from: "", to: "" }) {
    if (preset === "all") return { tuNgay: "", denNgay: "" };
    if (preset === "custom") return { tuNgay: custom.from, denNgay: custom.to };
    if (preset === "today") return { tuNgay: dayInput(now), denNgay: dayInput(now) };
    if (preset === "week") {
      const weekday = now.getDay() || 7;
      const from2 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1);
      return { tuNgay: dayInput(from2), denNgay: dayInput(new Date(from2.getFullYear(), from2.getMonth(), from2.getDate() + 6)) };
    }
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { tuNgay: dayInput(from), denNgay: dayInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }
  function rangeLabel(range, allText = "Đang xem tất cả thời gian.") {
    if (range.tuNgay === "" && range.denNgay === "") return allText;
    const show = (d) => d === "" ? "" : d.split("-").reverse().join("/");
    return `Đang xem từ ${show(range.tuNgay) || "đầu kỳ"} đến ${show(range.denNgay) || "hiện tại"}.`;
  }
  function dateFilterPanel(prefix, title, preset, onChange, extraClass = "") {
    const select = h(
      "select",
      { id: `${prefix}Preset` },
      ...[["today", "Hôm nay"], ["week", "Tuần này"], ["month", "Tháng này"], ["all", "Tất cả"], ["custom", "Tùy chọn"]].map(([v, t]) => h("option", { value: v, selected: v === preset }, t))
    );
    const range0 = presetRange(preset);
    const from = h("input", { id: `${prefix}From`, type: "date", value: range0.tuNgay, disabled: preset !== "custom" });
    const to = h("input", { id: `${prefix}To`, type: "date", value: range0.denNgay, disabled: preset !== "custom" });
    const label = h("p", { class: "subtle", id: `${prefix}Label` }, rangeLabel(range0));
    const read = () => presetRange(select.value, /* @__PURE__ */ new Date(), { from: from.value, to: to.value });
    const sync = () => {
      const custom = select.value === "custom";
      from.disabled = !custom;
      to.disabled = !custom;
      if (!custom) {
        const r = read();
        from.value = r.tuNgay;
        to.value = r.denNgay;
      }
      label.textContent = rangeLabel(read());
      onChange();
    };
    select.addEventListener("change", sync);
    from.addEventListener("change", sync);
    to.addEventListener("change", sync);
    const panel = h(
      "section",
      { class: `panel finance-filter-panel${extraClass ? ` ${extraClass}` : ""}` },
      h(
        "div",
        { class: "panel-body config-form" },
        h(
          "div",
          { class: "finance-filter-row" },
          h("div", null, h("h3", null, title), label),
          h(
            "div",
            { class: "finance-filter-controls" },
            h("div", { class: "field" }, h("label", { for: `${prefix}Preset` }, title.startsWith("Kỳ") ? "Khoảng tính" : "Khoảng xem"), select),
            h("div", { class: "field" }, h("label", { for: `${prefix}From` }, "Từ ngày"), from),
            h("div", { class: "field" }, h("label", { for: `${prefix}To` }, "Đến ngày"), to)
          )
        )
      )
    );
    return { panel, read, label };
  }

  // ../omi/packages/omi-ui/src/views/finance.ts
  var ENTRY_GROUPS = [
    ["shipping", "Ship / vận chuyển"],
    ["packaging", "Đóng gói"],
    ["advertising", "Quảng cáo"],
    ["software", "Phần mềm / công cụ"],
    ["salary", "Lương / công xử lý"],
    ["refund", "Hoàn / đổi trả"],
    ["other_income", "Thu khác"],
    ["other_expense", "Chi khác"]
  ];
  var PAYER = { sender: "Shop trả", receiver: "Người nhận trả", "": "Người nhận trả" };
  var FinanceView = class extends View {
    id = "bao-cao";
    label = "Tài chính";
    title = "Tài chính & đối soát";
    workspace = "landing";
    glyph = "TC";
    readRange = () => ({ tuNgay: "", denNgay: "" });
    screen = {};
    actions = {
      "add-finance-entry": () => this.addEntry(),
      "pay-finance-partner": (b) => this.payPartner(b),
      "save-finance-cost-overrides": () => this.saveCostOverrides(),
      "void-finance-entry": (b) => this.voidEntry(str(b.dataset["entryId"])),
      "reload-finance": () => this.loadFinance()
    };
    /** Desk `financeTemplate` (app.js:11779): khung lọc, 9 thẻ số, nhập thu/chi + đối soát partner, ba bảng. */
    buildDesk() {
      const filter = dateFilterPanel("financeDate", "Theo dõi theo thời gian", "month", () => void this.loadFinance(), "omi-section-gap");
      this.readRange = filter.read;
      const head = h(
        "div",
        { class: "section-title-row" },
        h("div", null, h("h3", null, "Tài chính"), h("p", { class: "subtle" }, "Đọc đơn hàng, phí ship, giá mua và khoản phát sinh để ra báo cáo dễ hiểu. Số do máy chủ tính.")),
        h(
          "div",
          { class: "split-actions" },
          h("button", { class: "secondary-button", type: "button", id: "nut-tc-luu-gia-mua", "data-action": "save-finance-cost-overrides" }, "Lưu giá mua đang sửa"),
          h("button", { class: "secondary-button", type: "button", id: "nut-tc-tai", "data-action": "reload-finance" }, "Tải lại")
        )
      );
      const cards = h(
        "div",
        { class: "grid three omi-section-gap" },
        metric("Doanh thu bán hàng", "tc-doanh-thu", "Tổng tiền đơn"),
        metric("Khách đã trả", "tc-khach-tra", "Tiền đã thu"),
        metric("Còn phải thu", "tc-con-thu", "Công nợ khách"),
        metric("Phí ship khách trả", "tc-ship-khach", "Phí báo/thu khách"),
        metric("Tổng phí hãng vận chuyển", "tc-ship-hang", "Số liệu gốc, chưa phân bổ người trả"),
        metric("Shop chịu ship", "tc-ship-shop", "Chênh lệch shop chịu"),
        metric("Giá vốn / mua hàng", "tc-gia-von", "Ưu tiên giá mua thực tế"),
        metric("Chi phí phát sinh", "tc-chi-phi", "Nhập tay ngoài đơn"),
        metric("Lợi nhuận tạm tính", "tc-lai", "Chưa thay thế báo cáo thuế")
      );
      const input = (id, label, attrs = {}) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, ...attrs }));
      const entryPanel = h(
        "section",
        { class: "panel finance-panel" },
        h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Nhập thu / chi phát sinh"), h("p", null, "Gắn với đơn nếu cần."))),
        h(
          "div",
          { class: "panel-body config-form" },
          h(
            "div",
            { class: "grid two" },
            h(
              "div",
              { class: "field" },
              h("label", { for: "financeEntryType" }, "Loại"),
              h("select", { id: "financeEntryType" }, h("option", { value: "chi" }, "Chi"), h("option", { value: "thu" }, "Thu"))
            ),
            h(
              "div",
              { class: "field" },
              h("label", { for: "financeEntryCategory" }, "Nhóm"),
              h("select", { id: "financeEntryCategory" }, ...ENTRY_GROUPS.map(([v, t]) => h("option", { value: v }, t)))
            ),
            input("financeEntryAmount", "Số tiền", { inputmode: "numeric" }),
            input("financeEntryOrderId", "Mã đơn nếu có")
          ),
          h("div", { class: "field" }, h("label", { for: "financeEntryNote" }, "Ghi chú"), h("textarea", { id: "financeEntryNote", rows: "2" })),
          h("button", { class: "primary-button", type: "button", id: "nut-tc-luu-khoan", "data-action": "add-finance-entry" }, "Lưu khoản phát sinh"),
          h("span", { class: "status-line", id: "tc-thu-chi-trang-thai" })
        )
      );
      const partnerPanel = h(
        "section",
        { class: "panel finance-panel" },
        h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Đối soát tiền hàng partner"), h("p", null, "Tham khảo chi phí mua hàng; không dùng để tính công nợ partner."))),
        h(
          "div",
          { class: "panel-body" },
          h("div", { class: "table-wrap" }, h(
            "table",
            null,
            h("thead", null, h("tr", null, ...["Partner", "Tiền hàng tham khảo", "Đã ghi nhận trả", "Chênh lệch", ""].map((t) => h("th", null, t)))),
            h("tbody", { id: "tc-doi-tac" })
          )),
          h("span", { class: "status-line", id: "tc-doi-tac-trang-thai" })
        )
      );
      const section = (title, hint, body) => h(
        "section",
        { class: "panel omi-section-gap" },
        h("div", { class: "panel-header" }, h("div", null, h("h3", null, title), h("p", null, hint))),
        h("div", { class: "panel-body" }, body)
      );
      return h(
        "div",
        { id: "tai-chinh-desk" },
        head,
        filter.panel,
        h("p", { class: "status-line", id: "tc-trang-thai" }, "—"),
        cards,
        h("div", { class: "grid two omi-section-gap" }, entryPanel, partnerPanel),
        section(
          "Đơn hàng & giá mua thực tế",
          "Sửa giá mua ở đây là ghi giá vốn của dòng đơn — báo cáo và công nợ đối tác đọc cùng số này.",
          table(["Đơn", "Sản phẩm", "Giá bán", "Giá mua thực tế", "Giá vốn dòng"], "tc-bang-gia-von")
        ),
        section(
          "Phí ship từ vận đơn",
          "Phí hãng lấy từ lần đồng bộ hành trình ở màn Vận đơn; mỗi kiện một dòng.",
          table(["Đơn", "Vận đơn", "Người trả ship", "COD phải thu", "COD đã thu", "Phí hãng VC", "Shop chịu", "Nguồn"], "tc-bang-phi-ship")
        ),
        section(
          "Thu / chi phát sinh",
          "Các khoản ngoài đơn, có thể gắn mã đơn nếu cần. Khoản nhập nhầm thì Hoàn tác — sổ vẫn giữ dòng đó.",
          table(["Ngày", "Loại", "Nhóm", "Số tiền", "Đơn", "Ghi chú", ""], "tc-bang-thu-chi")
        )
      );
    }
    async loadFinance() {
      const line = el("tc-trang-thai");
      status(line, "Đang tính…");
      const r = await this.ctx.gateway.landing("tai-chinh.bao-cao", this.readRange());
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.screen = r.than ?? {};
      const t = this.screen.tong;
      const set = (id, v) => {
        el(id).textContent = money(v ?? 0);
      };
      set("tc-doanh-thu", t?.doanhThu);
      set("tc-khach-tra", t?.khachDaTra);
      set("tc-con-thu", t?.conPhaiThu);
      set("tc-ship-khach", t?.phiShipKhachTra);
      set("tc-ship-hang", t?.phiHangVanChuyen);
      set("tc-ship-shop", t?.shipShopChiu);
      set("tc-gia-von", t?.giaVon);
      set("tc-chi-phi", t?.chiPhi);
      set("tc-lai", t?.laiUocTinh);
      this.drawPartners();
      this.drawCosts();
      this.drawShipping();
      this.drawEntries();
      status(line, `${t?.soDon ?? 0} đơn trong khoảng.${this.screen.chamTran ? " Chạm trần 500 đơn — thu hẹp khoảng ngày để đủ." : ""}`, "good");
    }
    drawPartners() {
      const body = el("tc-doi-tac");
      clear(body);
      for (const row of this.screen.doiTac ?? []) {
        const amount = h("input", { class: "omi-fee-input", inputmode: "numeric", value: row.conLai > 0 ? String(row.conLai) : "", "data-finance-partner-payment": row.maDoiTac, "aria-label": `Số tiền ghi nhận đã trả cho ${row.tenDoiTac}` });
        body.appendChild(tableRow([
          row.tenDoiTac,
          money(row.tienHang),
          money(row.daTra),
          money(row.conLai),
          h(
            "div",
            { class: "field-inline" },
            amount,
            h("button", { class: "primary-button compact-button", type: "button", "data-action": "pay-finance-partner", "data-partner-id": row.maDoiTac, "data-due": String(row.conLai), disabled: row.conLai <= 0 }, "Ghi nhận đã trả")
          )
        ]));
      }
      if ((this.screen.doiTac ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "5" }, "Chưa có dữ liệu đối soát tiền hàng partner.")));
    }
    drawCosts() {
      const body = el("tc-bang-gia-von");
      clear(body);
      for (const d of this.screen.giaVon ?? []) {
        const cost = h("input", {
          class: "finance-cost-input",
          inputmode: "numeric",
          value: d.giaVon > 0 ? String(d.giaVon) : "",
          "data-finance-cost-order-id": d.maDon,
          "data-finance-cost-line-id": d.maDong,
          "data-original": String(d.giaVon)
        });
        body.appendChild(tableRow([
          h("div", null, h("strong", null, d.maDon), h("div", { class: "subtle" }, d.khach)),
          h("div", null, d.ten || d.ma, h("div", { class: "subtle" }, `Size ${d.size || "—"} · SL ${d.soLuong}${d.nguonGiaVon === "phieu-mua" ? " · giá từ phiếu mua" : ""}`)),
          money(d.giaBan),
          cost,
          money(d.giaVonDong)
        ], [2, 4]));
      }
      if ((this.screen.giaVon ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "5" }, "Chưa có đơn.")));
    }
    drawShipping() {
      const body = el("tc-bang-phi-ship");
      clear(body);
      for (const s of this.screen.phiShip ?? []) {
        body.appendChild(tableRow([
          h("div", null, h("strong", null, s.maDon), s.maPhieu && s.maPhieu !== s.maDon ? h("div", { class: "subtle" }, `Kiện ${s.maPhieu}`) : null),
          s.maVanDon || "—",
          PAYER[s.nguoiTraShip] ?? s.nguoiTraShip,
          money(s.cod),
          s.codDaThu === null ? "—" : money(s.codDaThu),
          s.phi === null ? "—" : money(s.phi),
          money(s.shopChiu),
          s.nguon === "hang" ? `${s.hang.toUpperCase()} đồng bộ` : s.nguon === "chua-dong-bo" ? "Chưa đồng bộ phí" : "Chưa có vận đơn"
        ], [3, 4, 5, 6]));
      }
      if ((this.screen.phiShip ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "8" }, "Chưa có phí ship.")));
    }
    drawEntries() {
      const body = el("tc-bang-thu-chi");
      clear(body);
      for (const e of this.screen.thuChi ?? []) {
        const voided = e.huyLuc !== "";
        const tr = tableRow([
          h("div", null, dayClock(e.taoLuc), voided ? h("div", null, h("span", { class: "badge red" }, "Đã hoàn tác")) : null),
          e.loai === "thu" ? "Thu" : "Chi",
          e.tenNhom || e.nhom,
          voided ? h("s", null, money(e.soTien)) : money(e.soTien),
          e.maDon || (e.maDoiTac ? `Đối tác ${e.maDoiTac}` : ""),
          voided ? `${e.ghiChu} (hoàn tác: ${e.lyDoHuy})` : e.ghiChu,
          voided ? "—" : h("button", { class: "danger-button compact-button", type: "button", "data-action": "void-finance-entry", "data-entry-id": e.ma }, "Hoàn tác")
        ], [3]);
        if (voided) tr.className = "is-voided";
        body.appendChild(tr);
      }
      if ((this.screen.thuChi ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "7" }, "Chưa có khoản phát sinh.")));
    }
    async addEntry() {
      const line = el("tc-thu-chi-trang-thai");
      const amount = digits(el("financeEntryAmount").value);
      if (amount <= 0) {
        status(line, "Số tiền phát sinh không hợp lệ.", "bad");
        return;
      }
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("tai-chinh.thu-chi", {
        loai: el("financeEntryType").value,
        nhom: el("financeEntryCategory").value,
        soTien: amount,
        maDon: el("financeEntryOrderId").value.trim(),
        ghiChu: el("financeEntryNote").value.trim()
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      for (const id of ["financeEntryAmount", "financeEntryOrderId", "financeEntryNote"]) el(id).value = "";
      await this.loadFinance();
      status(el("tc-thu-chi-trang-thai"), "Đã lưu khoản phát sinh.", "good");
    }
    /** Desk `pay-finance-partner`: không ghi quá phần còn lại. Máy chủ ghi vào sổ, gắn đối tác, không tính là chi phí. */
    async payPartner(button) {
      const line = el("tc-doi-tac-trang-thai");
      const partnerId = str(button.dataset["partnerId"]);
      const due = Math.max(0, Number(button.dataset["due"] ?? 0));
      if (partnerId === "" || due <= 0) {
        status(line, "Partner này không còn công nợ mua hàng.", "bad");
        return;
      }
      const input = this.root.querySelector(`[data-finance-partner-payment="${CSS.escape(partnerId)}"]`);
      const amount = Math.min(digits(input?.value ?? ""), due);
      if (amount <= 0) {
        input?.focus();
        status(line, "Hãy nhập số tiền đã thanh toán lớn hơn 0.", "bad");
        return;
      }
      status(line, "Đang ghi…");
      const r = await this.ctx.gateway.landing("tai-chinh.tra-doi-tac", { doiTac: partnerId, soTien: amount, ghiChu: "Thanh toán tiền hàng partner" });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadFinance();
      const name = (this.screen.doiTac ?? []).find((x) => x.maDoiTac === partnerId)?.tenDoiTac ?? partnerId;
      status(el("tc-doi-tac-trang-thai"), `Đã ghi thanh toán ${money(amount)} cho ${name}.`, "good");
    }
    /** Desk `save-finance-cost-overrides`: chỉ gửi ô đã đổi; ghi qua cửa giá vốn (người làm sổ gõ tay thắng mọi nguồn khác). */
    async saveCostOverrides() {
      const line = el("tc-trang-thai");
      const rows = [];
      for (const input of this.root.querySelectorAll("#tc-bang-gia-von [data-finance-cost-order-id]")) {
        const value = digits(input.value);
        if (value <= 0 || value === Number(input.dataset["original"] ?? 0)) continue;
        rows.push({ maDon: str(input.dataset["financeCostOrderId"]), maDong: str(input.dataset["financeCostLineId"]), giaVon: value });
      }
      if (rows.length === 0) {
        status(line, "Chưa có giá mua nào thay đổi.", "bad");
        return;
      }
      status(line, "Đang lưu giá mua…");
      const r = await this.ctx.gateway.landing("gia-von.ghi", { dong: rows.slice(0, 200) });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadFinance();
      status(el("tc-trang-thai"), `Đã lưu giá mua thực tế cho ${r.than?.daGhi?.length ?? rows.length} dòng.`, "good");
    }
    async voidEntry(id) {
      const line = el("tc-trang-thai");
      const answer = await askDialog({ title: "Hoàn tác khoản thu/chi", message: "Khoản này sẽ không còn được tính vào báo cáo; sổ vẫn giữ dòng để đối chiếu.", fields: [{ name: "lyDo", label: "Lý do hoàn tác", value: "Nhập nhầm" }], submitLabel: "Hoàn tác" });
      if (answer === null) return;
      const r = await this.ctx.gateway.landing("tai-chinh.huy-thu-chi", { ma: id, lyDo: answer["lyDo"] ?? "" });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadFinance();
      status(el("tc-trang-thai"), "Đã hoàn tác khoản thu/chi.", "good");
    }
    build(root) {
      root.append(this.buildDesk());
      root.append(
        h(
          "div",
          { class: "toolbar" },
          h("input", { id: "bc-so-ngay", type: "text", class: "short", placeholder: "Số ngày (mặc định 14)" }),
          h("button", { class: "secondary-button", id: "nut-bao-cao-tai", type: "button", onclick: () => void this.loadAll() }, "Xem báo cáo"),
          h("span", { class: "status-line", id: "bao-cao-trang-thai" }, "Bấm để xem.")
        ),
        h(
          "div",
          { class: "grid five", id: "bc-tong", hidden: true },
          metric("Số đơn", "bc-so-don", "trong khoảng đã chọn"),
          metric("Giá trị đơn", "bc-gia-tri", "tổng tiền hàng"),
          metric("Đã thu", "bc-da-thu", "khách đã trả"),
          metric("Còn phải thu", "bc-con-thu", "COD + chưa trả"),
          metric("Đơn huỷ", "bc-huy", "số đơn · giá trị")
        ),
        h(
          "div",
          { class: "grid two" },
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Theo ngày"))),
            table(["Ngày", "Số đơn", "Giá trị", "Đã thu"], "bc-ngay")
          ),
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Món bán chạy"))),
            table(["Mã", "Tên món", "Số lượng", "Giá trị"], "bc-ban-chay")
          )
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Đối soát — đơn còn phải thu ", h("span", { class: "count-chip", id: "ds-so" }, "0")),
              h("p", null, "Khách chuyển khoản xong thì bấm một dòng, nhập số tiền vừa nhận rồi Ghi nhận. Số tiền do máy chủ cộng, màn hình không tự tính.")
            )
          ),
          table(["Mã đơn", "Khách", "Điện thoại", "Tổng", "Đã trả", "Còn phải thu", "Trạng thái", "Tạo lúc"], "ds-bang"),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ds-ma-don", type: "text", placeholder: "Mã đơn" }),
              h("input", { id: "ds-so-tien", type: "text", class: "short", placeholder: "Số tiền vừa nhận" }),
              h("input", { id: "ds-ghi-chu", type: "text", placeholder: "Ghi chú (không bắt buộc)" }),
              h("button", { class: "primary-button", id: "nut-doi-soat-ghi", type: "button", onclick: () => void this.recordPaid() }, "Ghi nhận đã trả"),
              // Dong bao cua VIEC ghi tien nam rieng: neu dung chung voi dong cua DANH SACH thi lan
              // tai lai ngay sau do xoa mat cau "da du tien" truoc khi nguoi ban kip doc.
              h("span", { class: "status-line", id: "ds-ghi-trang-thai" })
            ),
            h("p", { class: "status-line", id: "ds-trang-thai" }, "—")
          )
        ),
        // GIÁ VỐN: báo cáo và công nợ đối tác đọc giá vốn từng dòng. Dòng nào trống thì cả hai ra số
        // sai — và sai theo hướng nguy hiểm nhất: lãi trông có vẻ cao hơn thật.
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Dòng chưa có giá vốn ", h("span", { class: "count-chip", id: "gv-so" }, "0")),
              h("p", null, 'Giá vốn trống thì lãi trông cao hơn thật. Bấm "Bù từ phiếu mua" để lấy giá thật đối tác đã trả; dòng nào không có phiếu thì gõ tay rồi Lưu.')
            ),
            h(
              "div",
              { class: "toolbar compact" },
              h("button", { class: "secondary-button compact-button", id: "nut-gia-von-bu", type: "button", onclick: () => void this.backfillCost() }, "Bù từ phiếu mua"),
              h("button", { class: "primary-button compact-button", id: "nut-gia-von-luu", type: "button", onclick: () => void this.saveCost() }, "Lưu giá vốn đang sửa")
            )
          ),
          table(["Mã đơn", "Khách", "Hàng", "Size", "SL", "Giá bán", "Giá vốn"], "gv-bang"),
          h("div", { class: "panel-body" }, h("p", { class: "status-line", id: "gv-trang-thai" }, "—"))
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Hoàn tiền cho khách"),
              h("p", null, "Không hoàn quá số khách đã trả, và phải ghi lý do — sau này đọc sổ mới biết vì sao tiền đi ra.")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ht-ma-don", type: "text", placeholder: "Mã đơn" }),
              h("input", { id: "ht-so-tien", type: "text", class: "short", placeholder: "Số tiền hoàn" }),
              h("input", { id: "ht-ly-do", type: "text", placeholder: "Lý do hoàn (bắt buộc)" }),
              h("button", { class: "danger-button", id: "nut-hoan-tien", type: "button" }, "Hoàn tiền")
            ),
            h("p", { class: "status-line", id: "ht-trang-thai" }, "—")
          )
        )
      );
      confirmTwice(el("nut-hoan-tien"), "Bấm lần nữa để hoàn tiền", () => void this.refund());
    }
    load() {
      void this.loadAll();
    }
    async loadAll() {
      await this.loadFinance();
      await this.loadReport();
      await this.loadOwing();
      await this.loadMissingCost();
    }
    /**
     * Những dòng chưa có giá vốn — việc còn phải làm của người làm sổ.
     *
     * Ô nhập được điền sẵn GỢI Ý (giá nhập trong danh mục) nhưng gợi ý chưa được ghi vào đâu cả:
     * người làm sổ phải nhìn và bấm Lưu. Tự ghi gợi ý là biến một ước lượng thành số liệu kế toán.
     */
    async loadMissingCost() {
      const line = el("gv-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("gia-von.con-thieu", { gioiHan: 200 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const rows = r.than?.dong ?? [];
      const body = el("gv-bang");
      clear(body);
      for (const d of rows) {
        const input = h("input", {
          type: "text",
          class: "short",
          value: d.goiY > 0 ? String(d.goiY) : "",
          placeholder: d.goiY > 0 ? "gợi ý từ danh mục" : "giá vốn một đôi",
          "data-gia-von": `${d.maDon}|${d.maDong}`
        });
        body.appendChild(tableRow([d.maDon, d.khach, `${d.ma}${d.ten ? ` · ${d.ten}` : ""}`, d.size || "—", d.soLuong, money(d.giaBan), input], [4, 5]));
      }
      el("gv-so").textContent = String(rows.length);
      status(line, rows.length === 0 ? "Mọi dòng đều đã có giá vốn." : `${rows.length} dòng chưa có giá vốn.`, rows.length === 0 ? "good" : "bad");
    }
    /** Lấy giá thật đối tác đã trả. Không bao giờ đè lên số người làm sổ đã gõ — máy chủ giữ luật đó. */
    async backfillCost() {
      const line = el("gv-trang-thai");
      status(line, "Đang bù…");
      const r = await this.ctx.gateway.landing("gia-von.bu-tu-phieu", {});
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const filled = r.than?.daBu?.length ?? 0;
      await this.loadMissingCost();
      status(line, filled > 0 ? `Đã bù ${filled} dòng từ phiếu mua của đối tác.` : r.than?.viSao || "Không có dòng nào bù được từ phiếu mua.", filled > 0 ? "good" : "bad");
    }
    /** Lưu những ô người làm sổ vừa gõ. Ô trống thì bỏ qua — không ghi 0 đè lên gì cả. */
    async saveCost() {
      const line = el("gv-trang-thai");
      const rows = [];
      for (const input of document.querySelectorAll("#gv-bang [data-gia-von]")) {
        const gia = digits(input.value);
        if (gia <= 0) continue;
        const [maDon, maDong] = (input.dataset["giaVon"] ?? "").split("|");
        if (maDon && maDong) rows.push({ maDon, maDong, giaVon: gia });
      }
      if (rows.length === 0) {
        status(line, "Chưa gõ giá vốn cho dòng nào.", "bad");
        return;
      }
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("gia-von.ghi", { dong: rows });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const saved = r.than?.daGhi?.length ?? 0;
      await this.loadMissingCost();
      status(line, `Đã lưu giá vốn ${saved} dòng.`, "good");
    }
    async loadReport() {
      const line = el("bao-cao-trang-thai");
      status(line, "Đang tính…");
      const r = await this.ctx.gateway.landing("bao-cao.tong-quan", { soNgay: digits(el("bc-so-ngay").value) || 14 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const b = r.than ?? {};
      const t = b.tong ?? {};
      el("bc-tong").hidden = false;
      el("bc-so-don").textContent = String(t.soDon ?? 0);
      el("bc-gia-tri").textContent = money(t.giaTri);
      el("bc-da-thu").textContent = money(t.daThu);
      el("bc-con-thu").textContent = money(t.conPhaiThu);
      el("bc-huy").textContent = `${t.soDonHuy ?? 0} đơn · ${money(t.giaTriHuy)}`;
      const byDay = el("bc-ngay");
      clear(byDay);
      for (const n of b.theoNgay ?? []) byDay.appendChild(tableRow([n.ngay, n.soDon, money(n.giaTri), money(n.daThu)], [1, 2, 3]));
      const best = el("bc-ban-chay");
      clear(best);
      for (const m of b.banChay ?? []) best.appendChild(tableRow([m.ma, m.ten, m.soLuong, money(m.giaTri)], [2, 3]));
      status(line, `${b.tuNgay ?? ""} → ${b.denNgay ?? ""}${b.chamTran ? " (chạm trần — còn đơn cũ chưa tính)" : ""}`, "good");
    }
    /** The reconciliation list: every order that still owes something, newest first. */
    async loadOwing() {
      const line = el("ds-trang-thai");
      const r = await this.ctx.gateway.landing("don.danh-sach", { gioiHan: 300 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const owing = (r.than ?? []).filter((d) => Number(d.conPhaiTra) > 0);
      const body = el("ds-bang");
      clear(body);
      for (const d of owing) {
        const tr = tableRow([d.id, d.khach, d.dienThoai, money(d.tong), money(d.daTra), money(d.conPhaiTra), d.trangThaiTien || d.trangThai, day(d.taoLuc)], [3, 4, 5]);
        tr.addEventListener("click", () => {
          el("ds-ma-don").value = d.id;
          el("ds-so-tien").value = String(d.conPhaiTra);
          el("ht-ma-don").value = d.id;
        });
        body.appendChild(tr);
      }
      el("ds-so").textContent = String(owing.length);
      status(line, owing.length === 0 ? "Không còn đơn nào phải thu." : `${owing.length} đơn còn phải thu.`, owing.length === 0 ? "good" : "");
    }
    async recordPaid() {
      const line = el("ds-ghi-trang-thai");
      const id = el("ds-ma-don").value.trim();
      const amount = digits(el("ds-so-tien").value);
      if (id === "" || amount <= 0) {
        status(line, "Cần mã đơn và số tiền lớn hơn 0.", "bad");
        return;
      }
      status(line, "Đang ghi nhận…");
      const r = await this.ctx.gateway.landing("don.ghi-tien", { maDon: id, soTien: amount, ghiChu: el("ds-ghi-chu").value.trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const b = r.than ?? {};
      status(line, `Đơn ${id}: đã trả ${money(b["daTra"])}, còn ${money(b["conPhaiTra"])}${b["traDu"] === true ? " — đủ tiền." : "."}`, "good");
      el("ds-so-tien").value = "";
      el("ds-ghi-chu").value = "";
      void this.loadOwing();
    }
    async refund() {
      const line = el("ht-trang-thai");
      const id = el("ht-ma-don").value.trim();
      const amount = digits(el("ht-so-tien").value);
      const reason = el("ht-ly-do").value.trim();
      if (id === "" || amount <= 0) {
        status(line, "Cần mã đơn và số tiền lớn hơn 0.", "bad");
        return;
      }
      if (reason === "") {
        status(line, "Phải ghi lý do hoàn tiền.", "bad");
        return;
      }
      status(line, "Đang hoàn…");
      const r = await this.ctx.gateway.landing("tien.hoan", { maDon: id, soTien: amount, lyDo: reason });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const b = r.than ?? {};
      status(line, `Đơn ${id}: đã hoàn ${money(b["daHoan"])}. Khách còn được ghi nhận đã trả ${money(b["daTra"])}.`, "good");
      el("ht-so-tien").value = "";
      el("ht-ly-do").value = "";
      void this.loadOwing();
    }
  };

  // ../omi/packages/omi-ui/src/views/inbox.ts
  var InboxView = class extends View {
    id = "hop-thu";
    label = "Hộp thư";
    title = "Hộp thư đa kênh";
    workspace = "common";
    glyph = "◉";
    build(root) {
      root.append(
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Cần người thật ", h("span", { class: "count-chip", id: "cn-so" }, "0")),
              h("p", null, "Bot không chắc nên không trả lời — người trực đọc rồi trả lời tay, xong bấm Đã xử lý.")
            )
          ),
          table(["Lúc", "Kênh", "Người", "Tin cuối", "Vì sao", ""], "cn-bang")
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Tin đến")),
            h(
              "div",
              { class: "toolbar" },
              h("button", { class: "secondary-button compact-button", id: "nut-hop-thu-tai", type: "button", onclick: () => void this.loadAll() }, "Tải tin mới"),
              h("span", { class: "status-line", id: "hop-thu-trang-thai" }, "Bấm để tải.")
            )
          ),
          table(["Lúc", "Kênh", "Người", "Tin", "Ảnh", "Đã xác minh"], "hop-thu-bang"),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ht-kenh", type: "text", class: "short", placeholder: "Kênh", value: "facebook" }),
              h("input", { id: "ht-nguoi", type: "text", placeholder: "Mã người nhận (bấm một tin để điền)" }),
              h("input", { id: "ht-chu", type: "text", class: "wide", placeholder: "Câu trả lời" }),
              h("button", { class: "primary-button", id: "nut-hop-thu-tra-loi", type: "button", onclick: () => void this.reply() }, "Trả lời khách")
            )
          )
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Hàng chờ gửi Zalo / Facebook cá nhân ", h("span", { class: "count-chip", id: "cg-so" }, "0")),
              h("p", { class: "status-line", id: "cg-tom-tat" }, "—")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "toolbar" },
              h("label", { for: "ht-nguong" }, "Bot không tự trả lời tin cũ hơn (giờ)"),
              h("input", { id: "ht-nguong", type: "text", class: "short", placeholder: "24" }),
              h("button", { class: "secondary-button compact-button", id: "nut-ht-nguong-luu", type: "button", onclick: () => void this.saveThreshold() }, "Lưu"),
              h("span", { class: "status-line", id: "ht-nguong-trang-thai" })
            ),
            h("p", { class: "subtle" }, "Bản thử đang bật chế độ thử: máy chủ CHẶN mọi tin gửi cho khách. Bấm trả lời sẽ nhận được câu từ chối rõ ràng — đó là đúng, không phải lỗi.")
          )
        )
      );
    }
    load() {
      void this.loadAll();
    }
    pickRecipient(person, channel) {
      el("ht-nguoi").value = str(person);
      el("ht-kenh").value = str(channel || "facebook");
    }
    async loadAll() {
      void this.loadIncoming();
      void this.loadNeedsHuman();
      void this.loadOutbox();
      const cfg = await this.ctx.gateway.landing("hop-thu.cau-hinh.doc");
      if (cfg.ok && cfg.than?.cauHinh) el("ht-nguong").value = String(cfg.than.cauHinh.nguongTinCuGio ?? 24);
    }
    async loadIncoming() {
      const line = el("hop-thu-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("hop-thu.xem", { gioiHan: 100 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const page = r.than ?? { moc: "", soGoi: 0, tin: [] };
      const body = el("hop-thu-bang");
      clear(body);
      for (const t of page.tin ?? []) {
        const tr = tableRow([clock(t.luc) || t.luc, t.kenh, t.tenNguoi ? `${t.tenNguoi} (${t.nguoi})` : t.nguoi, t.chu, t.soAnh || 0, t.daXacMinh ? "có" : "không"], [4]);
        tr.addEventListener("click", () => {
          selectRow(body, tr);
          this.pickRecipient(t.nguoi, t.kenh);
        });
        body.appendChild(tr);
      }
      status(line, `${page.tin?.length ?? 0} tin (trong ${page.soGoi ?? 0} gói).`, "good");
    }
    async loadNeedsHuman() {
      const r = await this.ctx.gateway.landing("hop-thu.can-nguoi");
      const body = el("cn-bang");
      clear(body);
      if (!r.ok) return;
      const items = r.than?.muc ?? [];
      const chip = el("cn-so");
      chip.textContent = String(items.length);
      chip.setAttribute("data-co", items.length > 0 ? "1" : "0");
      for (const m of items) {
        const done = h("button", { type: "button", class: "secondary-button compact-button", onclick: (e) => {
          e.stopPropagation();
          void this.ctx.gateway.landing("hop-thu.can-nguoi.xong", { maHoiThoai: m.maHoiThoai }).then(() => this.loadNeedsHuman());
        } }, "Đã xử lý");
        const tr = tableRow([clock(m.baoLuc) || m.baoLuc, m.kenh, m.nguoi, m.tinCuoi, m.lyDo, done]);
        tr.addEventListener("click", () => this.pickRecipient(m.nguoi, m.kenh));
        body.appendChild(tr);
      }
    }
    async loadOutbox() {
      const r = await this.ctx.gateway.landing("hop-thu.cho-gui");
      const line = el("cg-tom-tat");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than?.tomTat ?? {};
      const waiting = t.cho ?? 0;
      const chip = el("cg-so");
      chip.textContent = String(waiting);
      chip.setAttribute("data-co", waiting > 0 ? "1" : "0");
      status(line, `chờ ${waiting} · đang gửi ${t["dang-gui"] ?? 0} · đã gửi ${t["da-gui"] ?? 0} · hỏng ${t.hong ?? 0} · quá hạn ${t["qua-han"] ?? 0}`, "good");
    }
    async reply() {
      const person = el("ht-nguoi").value.trim();
      const text2 = el("ht-chu").value.trim();
      const line = el("hop-thu-trang-thai");
      if (person === "" || text2 === "") {
        status(line, "Cần người nhận và câu trả lời.", "bad");
        return;
      }
      status(line, "Đang gửi…");
      const r = await this.ctx.gateway.landing("hop-thu.tra-loi", { nguoi: person, chu: text2, kenh: el("ht-kenh").value.trim() || "facebook" });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, r.than?.ketQua?.xepHang ? "Đã xếp vào hàng chờ — máy trực sẽ gửi." : "Đã gửi.", "good");
      el("ht-chu").value = "";
      await this.loadOutbox();
    }
    async saveThreshold() {
      const line = el("ht-nguong-trang-thai");
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("hop-thu.cau-hinh.ghi", { nguongTinCuGio: Number(el("ht-nguong").value) });
      status(line, r.ok ? "Đã lưu." : r.viSao, r.ok ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/views/integrations.ts
  var ERASE = "__xoa__";
  var IntegrationsView = class extends View {
    id = "ket-noi";
    label = "Kết nối";
    title = "Kết nối & khoá của shop";
    workspace = "common";
    glyph = "KN";
    /** Setting key → its input box. Built when the configuration arrives, so no fixed ids. */
    boxes = /* @__PURE__ */ new Map();
    /** Keys the seller asked to erase; sent as `__xoa__` on the next save. */
    erasing = /* @__PURE__ */ new Set();
    /** Desk's "Thử kết nối" buttons (Đ3): each asks the real service with the SAVED keys; nothing is posted to customers. */
    actions = {
      "refresh-integrations": () => this.loadSettings(),
      "test-shipping-connection": (b) => this.probe("van-don.thu-ket-noi", { hang: str(b.dataset["carrier"]) }, str(b.dataset["carrier"]) === "vtp" ? "Viettel Post" : "SPX"),
      "test-telegram-alert": () => this.probe("tien.thu-telegram", {}, "Telegram"),
      "test-facebook-connection": () => this.probe("hop-thu.thu-facebook", {}, "Facebook")
    };
    build(root) {
      root.append(
        h(
          "div",
          { class: "toolbar" },
          h("button", { class: "secondary-button", id: "nut-ket-noi-tai", type: "button", "data-action": "refresh-integrations" }, "Tải cấu hình"),
          h("button", { class: "primary-button", id: "nut-ket-noi-luu", type: "button", onclick: () => void this.saveSettings() }, "Lưu cấu hình"),
          h("span", { class: "status-line", id: "ket-noi-trang-thai" }, "Bấm để tải.")
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Thử kết nối"), h("p", null, "Hỏi thật dịch vụ bằng khoá ĐÃ LƯU — lưu cấu hình trước rồi mới thử. Không gửi gì cho khách."))
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "secondary-button", id: "nut-thu-spx", type: "button", "data-action": "test-shipping-connection", "data-carrier": "spx" }, "Thử SPX"),
              h("button", { class: "secondary-button", id: "nut-thu-vtp", type: "button", "data-action": "test-shipping-connection", "data-carrier": "vtp" }, "Thử Viettel Post"),
              h("button", { class: "secondary-button", id: "nut-thu-telegram", type: "button", "data-action": "test-telegram-alert" }, "Gửi thử Telegram"),
              h("button", { class: "secondary-button", id: "nut-thu-facebook", type: "button", "data-action": "test-facebook-connection" }, "Thử Facebook")
            ),
            h("p", { class: "status-line", id: "ket-noi-thu" }, "—")
          )
        ),
        h(
          "div",
          { class: "runtime-alert", id: "ket-noi-nhac" },
          "Khoá chỉ nằm trên máy chủ của shop, OMI không giữ và không hiện lại. Ô trống khi lưu = giữ nguyên khoá cũ."
        ),
        h("div", { id: "ket-noi-nhom" })
      );
    }
    load() {
      void this.loadSettings();
    }
    async loadSettings() {
      const line = el("ket-noi-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("cau-hinh.doc");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.draw(r.than?.nhom ?? []);
      status(line, `${this.boxes.size} mục cấu hình. Sửa rồi bấm Lưu cấu hình.`, "good");
    }
    async probe(job, args, name) {
      const line = el("ket-noi-thu");
      status(line, `Đang thử ${name}…`);
      const r = await this.ctx.gateway.landing(job, args);
      if (!r.ok) {
        status(line, `${name}: ${r.viSao}`, "bad");
        return;
      }
      const said = str(r.than?.loiNhan) || str(r.than?.message);
      status(line, `${name}: ${said || (r.than?.ok === false ? "không được" : "được")}`, r.than?.ok !== false);
    }
    draw(groups) {
      const area = el("ket-noi-nhom");
      clear(area);
      this.boxes.clear();
      this.erasing.clear();
      for (const group of groups) {
        const body = h("div", { class: "panel-body" });
        for (const field of group.muc ?? []) body.appendChild(this.fieldRow(field));
        area.appendChild(h(
          "section",
          { class: "panel" },
          h("div", { class: "panel-header" }, h("div", null, h("h3", null, str(group.ten)), h("p", null, str(group.chuThich)))),
          body
        ));
      }
    }
    fieldRow(field) {
      const box = h("input", {
        type: field.biMat ? "password" : "text",
        value: field.biMat ? "" : str(field.giaTri),
        placeholder: field.biMat ? field.daDat ? `đang có ${str(field.duoi)} — để trống là giữ nguyên` : "chưa đặt" : ""
      });
      this.boxes.set(field.khoa, box);
      const note = h("span", { class: "status-line" }, field.daDat ? "đã đặt" : "chưa đặt");
      const row = h(
        "div",
        { class: "field-row" },
        h("label", null, str(field.nhan)),
        box,
        note,
        str(field.goiY) === "" ? null : h("span", { class: "hint" }, str(field.goiY))
      );
      if (field.daDat) {
        const wipe = h("button", { class: "danger-button compact-button", type: "button" }, "Xoá");
        confirmTwice(wipe, "Bấm lần nữa để xoá", () => {
          this.erasing.add(field.khoa);
          box.value = "";
          box.placeholder = "sẽ xoá khi bấm Lưu cấu hình";
          note.textContent = "sẽ xoá";
        });
        row.appendChild(wipe);
      }
      return row;
    }
    async saveSettings() {
      const line = el("ket-noi-trang-thai");
      if (this.boxes.size === 0) {
        status(line, "Chưa tải cấu hình — bấm Tải cấu hình trước.", "bad");
        return;
      }
      const values = {};
      for (const [key, box] of this.boxes) {
        if (this.erasing.has(key)) {
          values[key] = ERASE;
          continue;
        }
        const typed = box.value.trim();
        if (typed === "" && box.type === "password") continue;
        values[key] = typed;
      }
      if (Object.keys(values).length === 0) {
        status(line, "Không có mục nào để lưu.", "bad");
        return;
      }
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("cau-hinh.ghi", { giaTri: values });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const changed = r.than?.daDoi ?? [];
      this.draw(r.than?.nhom ?? []);
      status(line, changed.length === 0 ? "Không có gì đổi." : `Đã lưu ${changed.length} mục: ${changed.join(", ")}.`, "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/orders/sku-suggest.ts
  var MIN_CHARS = 2;
  var DEBOUNCE_MS2 = 250;
  var MAX_ROWS = 8;
  function skuSuggest(opts) {
    let timer = null;
    let seq2 = 0;
    const box = h("div", { class: "order-sku-suggestions", id: opts.boxId });
    const input = h("input", {
      id: opts.inputId,
      type: "text",
      class: "wide",
      placeholder: "Gõ mã hoặc tên hàng để tìm — chọn một size là tự điền một dòng",
      oninput: () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => void run(), DEBOUNCE_MS2);
      }
    });
    async function run() {
      const query = input.value.trim();
      clear(box);
      if (query.length < MIN_CHARS) return;
      seq2 += 1;
      const mine = seq2;
      const r = await opts.search(query);
      if (mine !== seq2) return;
      clear(box);
      if (!r.ok) {
        box.appendChild(h("div", { class: "order-sku-empty" }, r.viSao));
        return;
      }
      const items = (r.than ?? []).slice(0, MAX_ROWS);
      if (items.length === 0) {
        box.appendChild(h("div", { class: "order-sku-empty" }, `Không có món nào khớp "${query}".`));
        return;
      }
      for (const item of items) {
        const sizes = (item.size ?? []).filter((s) => s.ton > 0);
        box.appendChild(h(
          "div",
          { class: "order-sku-suggestion", "data-sku": item.ma },
          h(
            "div",
            { class: "order-sku-detail" },
            h("strong", null, `${item.ma} · ${item.ten}`),
            h("small", null, sizes.length === 0 ? "hết hàng mọi size" : sizes.map((s) => `${s.size} (${s.ton}${s.kho ? ` · ${s.kho}` : ""})`).join("  ")),
            h(
              "div",
              { class: "order-sku-sizes" },
              ...sizes.map((s) => h("button", {
                class: "secondary-button compact-button",
                type: "button",
                "data-sku-size": `${item.ma}|${s.size}`,
                onclick: () => {
                  opts.onPick({ ma: item.ma, ten: item.ten, size: s.size, gia: s.gia || item.gia });
                  clear(box);
                  input.value = "";
                }
              }, `size ${s.size}`))
            )
          ),
          h("div", { class: "order-sku-meta" }, h("strong", null, money(item.gia)))
        ));
      }
    }
    return h("div", { class: "order-product-search" }, input, box);
  }

  // ../omi/packages/omi-ui/src/views/orders/order-editor.ts
  function cartTotals(lines2, o) {
    const lineTotal = (l) => {
      const gross = Math.max(0, l.donGia) * Math.max(1, l.soLuong);
      const off = l.loaiChietKhau === "percent" ? Math.round(gross * Math.min(100, l.chietKhau) / 100) : Math.min(l.chietKhau, gross);
      return { gross, off, total: gross - off };
    };
    const each = lines2.map(lineTotal);
    const subtotal = each.reduce((s, x) => s + x.gross, 0);
    const itemDiscount = each.reduce((s, x) => s + x.off, 0);
    const rest = Math.max(0, subtotal - itemDiscount);
    const orderDiscount = o.loaiChietKhau === "percent" ? Math.round(rest * Math.min(100, o.chietKhau) / 100) : Math.min(o.chietKhau, rest);
    const payable = Math.max(0, subtotal - itemDiscount - orderDiscount + o.phiShip);
    const paid = Math.min(o.daTra, payable);
    return { subtotal, itemDiscount, orderDiscount, shippingFee: o.phiShip, payable, paid, remaining: Math.max(0, payable - paid), lineTotal: (l) => lineTotal(l).total };
  }
  var PAYMENT_METHODS = [["cod", "COD - Thu tiền khi giao hàng"], ["cash", "Tiền mặt"], ["bank_transfer", "Chuyển khoản"], ["card", "Thẻ / POS"], ["e_wallet", "Ví điện tử"], ["other", "Phương thức khác"]];
  var CARRIERS = [["", "Chưa chọn đơn vị"], ["ghtk", "Giao Hàng Tiết Kiệm"], ["ghn", "Giao Hàng Nhanh"], ["viettel_post", "Viettel Post"], ["spx", "SPX Express"], ["external", "Ship ngoài (shipper tự do)"], ["vnpost", "VNPost"], ["ahamove", "Ahamove"], ["grab", "GrabExpress"], ["other", "Đơn vị khác"]];
  var PAYERS = [["", "Chưa chọn (mặc định: người nhận trả)"], ["sender", "Người gửi trả"], ["receiver", "Người nhận trả"]];
  var FULFILLMENT = [["draft", "Chưa bàn giao"], ["ready_to_ship", "Sẵn sàng đóng gói"], ["requested", "Đã tạo yêu cầu vận chuyển"], ["handed_over", "Đã bàn giao hãng vận chuyển"], ["shipping", "Đang giao"], ["delivered", "Đã giao"], ["failed", "Giao thất bại"]];
  var DELIVERY = [
    ["carrier", "Đẩy qua hãng vận chuyển", "Tạo yêu cầu bàn giao cho đơn vị vận chuyển"],
    ["external", "Đẩy vận chuyển ngoài", "Ghi nhận đơn giao bởi đối tác ngoài hệ thống"],
    ["pickup", "Khách nhận tại cửa hàng", "Không cần tạo yêu cầu giao hàng"],
    ["later", "Giao hàng sau", "Lưu đơn trước, bổ sung vận chuyển sau"]
  ];
  var STATUSES = [["pending", "Đơn mới"], ["confirmed_by_customer", "Khách đã xác nhận"], ["processing", "Đang xử lý"], ["ready_to_ship", "Sẵn sàng giao"], ["completed", "Hoàn tất"]];
  var KINDS = [["", "Chưa chọn loại"], ["shoe", "Giày"], ["apparel", "Quần áo"], ["accessory", "Phụ kiện"], ["bag", "Túi"], ["hat", "Mũ"], ["sock", "Tất"], ["other", "Khác"]];
  var options = (list, selected) => list.map(([v, t]) => h("option", { value: v, selected: v === selected }, t));
  var OrderEditor = class {
    constructor(gateway, onDone) {
      this.gateway = gateway;
      this.onDone = onDone;
      this.root = h("section", { class: "managed-order-editor", id: "oe-khung", hidden: true });
      this.root.append(this.header(), h("div", { class: "managed-order-shell" }, this.productPane(), this.detailPane()));
      this.root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-action]");
        if (b === null || !this.root.contains(b)) return;
        const job = this.jobs[b.dataset["action"] ?? ""];
        if (job === void 0) return;
        e.preventDefault();
        void Promise.resolve(job(b));
      });
      this.root.addEventListener("input", (e) => this.onInput(e.target));
      this.root.addEventListener("change", (e) => this.onInput(e.target));
    }
    gateway;
    onDone;
    root;
    cart = [];
    editing = null;
    customer = null;
    addresses = [];
    seq = 0;
    /** Việc của trình soạn đơn — tên Desk. */
    jobs = {
      "close-managed-order-editor": () => {
        this.close();
        this.onDone(null);
      },
      "add-manual-order-product": () => this.addManualProduct(),
      "remove-order-cart-item": (b) => {
        this.cart = this.cart.filter((l) => l.key !== b.dataset["orderItemId"]);
        this.drawCart();
      },
      "lookup-order-customer": () => this.lookupCustomer(),
      "open-order-customer-create": () => customerEditor(this.gateway).open("", {
        prefill: { dienThoai: el("manageOrderCustomerPhoneLookup").value.trim(), ten: el("manageOrderCustomerName").value.trim() },
        onSaved: (p) => {
          void this.selectCustomer(p.ma);
          customerEditor(this.gateway).close();
        }
      }),
      "open-order-customer-address-form": () => {
        if (this.customer === null) return;
        const id = this.customer.ma;
        void customerEditor(this.gateway).open(id, { onSaved: () => void this.selectCustomer(id, { keepAddress: true }) });
      },
      "select-order-customer-address": (b) => this.useAddress(this.addresses.find((a) => a.ma === b.dataset["addressId"]) ?? null),
      "save-managed-order": () => this.save()
    };
    // ----- build -----
    header() {
      return h(
        "div",
        { class: "section-title-row" },
        h("div", null, h("h3", { id: "oe-tieu-de" }, "Tạo đơn hàng"), h("p", { class: "subtle" }, "Chọn sản phẩm ở cột trái, kiểm tra khách hàng và thanh toán ở cột phải.")),
        h("button", { class: "ghost-button", type: "button", "data-action": "close-managed-order-editor" }, "Quay lại danh sách")
      );
    }
    productPane() {
      const field = (id, label, value = "") => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, value }));
      return h(
        "aside",
        { class: "managed-order-product-pane" },
        h("div", { class: "managed-order-pane-head" }, h("strong", null, "Sản phẩm"), h("span", { class: "badge green" }, "Kho của shop")),
        h(
          "div",
          { class: "field order-product-search" },
          h("label", { for: "manageOrderSku" }, "Tìm sản phẩm"),
          skuSuggest({
            inputId: "manageOrderSku",
            boxId: "manageOrderSkuSuggestions",
            search: (query) => this.gateway.landing("hang.tim", { tuKhoa: query, gioiHan: 20 }),
            onPick: (pick) => this.addLine({ ma: pick.ma, ten: pick.ten, size: pick.size, donGia: pick.gia })
          })
        ),
        h(
          "details",
          { class: "managed-order-manual" },
          h("summary", null, "Thêm sản phẩm ngoài danh mục"),
          h(
            "div",
            { class: "config-form" },
            field("manageOrderManualProductCode", "Mã sản phẩm"),
            field("manageOrderManualProductName", "Tên sản phẩm"),
            h("div", { class: "field" }, h("label", { for: "manageOrderManualProductKind" }, "Loại sản phẩm"), h("select", { id: "manageOrderManualProductKind" }, ...options(KINDS, ""))),
            h("div", { class: "grid two" }, field("manageOrderManualProductSize", "Size"), field("manageOrderManualProductQty", "SL", "1")),
            field("manageOrderManualProductPrice", "Giá bán"),
            h("button", { class: "secondary-button", type: "button", "data-action": "add-manual-order-product" }, "Thêm vào đơn")
          )
        )
      );
    }
    detailPane() {
      const field = (id, label, attrs = {}) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, ...attrs }));
      const select = (id, label, list) => h("div", { class: "field" }, h("label", { for: id }, label), h("select", { id }, ...options(list, "")));
      const panel = (title, sub, ...body) => h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-header" }, h("div", null, h("h3", null, title), h("p", null, sub))),
        ...body
      );
      const customer = panel(
        "Khách hàng",
        "Tìm theo số điện thoại hoặc tạo khách mới.",
        h(
          "div",
          { class: "panel-body config-form" },
          h(
            "div",
            { class: "field" },
            h("label", { for: "manageOrderCustomerPhoneLookup" }, "Số điện thoại khách hàng"),
            h(
              "div",
              { class: "field-inline" },
              h("input", { id: "manageOrderCustomerPhoneLookup", placeholder: "Nhập SĐT", onkeydown: (e) => {
                if (e.key === "Enter") void this.lookupCustomer();
              } }),
              h("button", { class: "secondary-button", type: "button", "data-action": "lookup-order-customer" }, "Tìm khách")
            )
          ),
          h("div", { id: "oe-khach" }),
          field("manageOrderCustomerName", "Tên người nhận"),
          h("div", { class: "field" }, h("label", { for: "manageOrderAddressDetail" }, "Địa chỉ chi tiết"), h("input", { id: "manageOrderAddressDetail", placeholder: "Số nhà, tên đường" })),
          addressFields({
            prefix: "oe",
            search: (input) => this.gateway.landing("dia-chi.tim", { ...input }),
            checkSplit: (input) => this.gateway.landing("dia-chi.doi-hai-cap", { ...input })
          }),
          h("button", { class: "secondary-button", type: "button", "data-action": "open-order-customer-create" }, "Tạo khách hàng mới")
        )
      );
      const cart = panel("Sản phẩm trong đơn", "", h("div", { class: "panel-body" }, h("div", { id: "manageOrderCart" })));
      cart.querySelector(".panel-header p")?.setAttribute("id", "oe-so-mon");
      const checkout = panel(
        "Thanh toán",
        "Ghi nhận chiết khấu, phí ship và số tiền khách đã thanh toán.",
        h(
          "div",
          { class: "panel-body order-checkout-grid" },
          h(
            "div",
            { class: "config-form" },
            h(
              "div",
              { class: "grid two" },
              select("manageOrderDiscountType", "Loại chiết khấu toàn đơn", [["money", "Theo số tiền"], ["percent", "Theo phần trăm (%)"]]),
              field("manageOrderDiscountValue", "Chiết khấu toàn đơn", { value: "0", inputmode: "numeric" }),
              field("manageOrderShippingFee", "Phí giao hàng", { value: "0", inputmode: "numeric" }),
              field("manageOrderPaidAmount", "Khách đã trả", { value: "0", inputmode: "numeric" }),
              select("manageOrderPaymentMethod", "Phương thức thanh toán", PAYMENT_METHODS)
            ),
            field("manageOrderTags", "Tags đơn hàng", { placeholder: "vip, sale…" })
          ),
          h("div", { id: "manageOrderTotals", class: "order-total-summary" })
        )
      );
      const delivery = panel(
        "Giao hàng",
        "Chọn cách bàn giao đơn và thông tin vận chuyển.",
        h(
          "div",
          { class: "panel-body config-form" },
          h(
            "div",
            { class: "delivery-method-grid", id: "oe-cach-giao" },
            ...DELIVERY.map(([v, title, detail]) => h(
              "label",
              { class: "delivery-method-card", "data-method": v },
              h("input", { type: "radio", name: "manageOrderDeliveryMethod", value: v }),
              h("strong", null, title),
              h("span", null, detail)
            ))
          ),
          h(
            "div",
            { class: "grid three" },
            select("manageOrderCarrier", "Đơn vị vận chuyển", CARRIERS),
            select("manageOrderShippingPayer", "Người trả phí ship", PAYERS),
            field("manageOrderTrackingCode", "Mã vận đơn"),
            select("manageOrderFulfillmentStatus", "Trạng thái bàn giao", FULFILLMENT)
          ),
          h("label", { class: "check-row" }, h("input", { id: "manageOrderPushToCarrier", type: "checkbox" }), h("span", null, " Đẩy yêu cầu giao hàng sang đơn vị vận chuyển sau khi tạo đơn")),
          field("manageOrderShippingNote", "Ghi chú giao hàng")
        )
      );
      const notes = panel(
        "Ghi chú",
        "Trạng thái và ghi chú vận hành.",
        h(
          "div",
          { class: "panel-body config-form" },
          select("manageOrderStatus", "Trạng thái", STATUSES),
          h("div", { class: "field" }, h("label", { for: "manageOrderNote" }, "Ghi chú đơn hàng"), h("textarea", { id: "manageOrderNote" })),
          h(
            "div",
            { class: "split-actions" },
            h("button", { class: "primary-button", type: "button", id: "oe-luu", "data-action": "save-managed-order" }, "Tạo đơn hàng"),
            h("button", { class: "ghost-button", type: "button", "data-action": "close-managed-order-editor" }, "Hủy"),
            h("span", { class: "status-line", id: "oe-trang-thai" })
          )
        )
      );
      return h("main", { class: "managed-order-detail-pane" }, customer, cart, checkout, delivery, notes);
    }
    // ----- open / close -----
    openCreate(prefill = {}) {
      this.editing = null;
      this.reset();
      el("oe-tieu-de").textContent = "Tạo đơn hàng";
      el("oe-luu").textContent = "Tạo đơn hàng";
      el("manageOrderStatus").value = "pending";
      el("manageOrderCustomerName").value = prefill.khach ?? "";
      el("manageOrderCustomerPhoneLookup").value = prefill.dienThoai ?? "";
      this.root.hidden = false;
      if (prefill.maKhach) void this.selectCustomer(prefill.maKhach);
      else if (prefill.dienThoai) void this.lookupCustomer({ quiet: true });
      el("manageOrderSku").focus();
    }
    openEdit(d) {
      this.editing = d;
      this.reset();
      el("oe-tieu-de").textContent = `Chỉnh sửa đơn ${d.id}`;
      el("oe-luu").textContent = "Lưu thay đổi";
      el("manageOrderCustomerPhoneLookup").value = d.dienThoai;
      el("manageOrderCustomerName").value = d.khach;
      el("manageOrderAddressDetail").value = d.diaChiChiTiet || (d.huyen || d.xa ? "" : d.diaChi);
      writeAddress("oe", { tinh: d.tinh, huyen: d.huyen, xa: d.xa });
      this.cart = (d.mon ?? []).map((m) => ({
        key: this.nextKey(),
        ma: m.ma,
        ten: m.ten,
        size: m.size,
        soLuong: m.soLuong,
        donGia: m.donGia,
        loaiChietKhau: m.loaiChietKhau === "percent" ? "percent" : "money",
        chietKhau: m.chietKhau ?? 0,
        daMua: m.daMua ?? 0
      }));
      el("manageOrderDiscountType").value = d.loaiChietKhau === "percent" ? "percent" : "money";
      el("manageOrderDiscountValue").value = String(d.chietKhau ?? 0);
      el("manageOrderShippingFee").value = String(d.phiShip ?? 0);
      const paid = el("manageOrderPaidAmount");
      paid.value = String(d.daTra ?? 0);
      paid.disabled = true;
      el("manageOrderPaymentMethod").value = d.phuongThucTra || "cod";
      el("manageOrderTags").value = d.nhan ?? "";
      this.setMethod(d.cachGiao || "carrier");
      el("manageOrderCarrier").value = d.hangVanChuyen ?? "";
      el("manageOrderShippingPayer").value = d.nguoiTraShip ?? "";
      el("manageOrderTrackingCode").value = d.maVanDon ?? "";
      el("manageOrderFulfillmentStatus").value = FULFILLMENT.some(([v]) => v === d.trangThaiGiao) ? d.trangThaiGiao : "draft";
      el("manageOrderShippingNote").value = d.ghiChuGiao ?? "";
      const statusSelect = el("manageOrderStatus");
      if (!STATUSES.some(([v]) => v === d.trangThai)) statusSelect.appendChild(h("option", { value: d.trangThai }, d.trangThai));
      statusSelect.value = d.trangThai;
      el("manageOrderNote").value = d.ghiChu ?? "";
      el("manageOrderPushToCarrier").closest("label")?.setAttribute("hidden", "");
      this.drawCart();
      this.root.hidden = false;
      if (d.maKhach) void this.selectCustomer(d.maKhach, { keepAddress: true });
    }
    close() {
      this.root.hidden = true;
    }
    reset() {
      this.cart = [];
      this.customer = null;
      this.addresses = [];
      for (const id of ["manageOrderSku", "manageOrderCustomerPhoneLookup", "manageOrderCustomerName", "manageOrderAddressDetail", "manageOrderTags", "manageOrderTrackingCode", "manageOrderShippingNote", "manageOrderManualProductCode", "manageOrderManualProductName", "manageOrderManualProductSize", "manageOrderManualProductPrice"]) el(id).value = "";
      el("manageOrderManualProductQty").value = "1";
      for (const id of ["manageOrderDiscountValue", "manageOrderShippingFee", "manageOrderPaidAmount"]) el(id).value = "0";
      el("manageOrderPaidAmount").disabled = false;
      el("manageOrderDiscountType").value = "money";
      el("manageOrderPaymentMethod").value = "cod";
      el("manageOrderCarrier").value = "";
      el("manageOrderShippingPayer").value = "";
      el("manageOrderFulfillmentStatus").value = "draft";
      el("manageOrderPushToCarrier").checked = false;
      el("manageOrderPushToCarrier").closest("label")?.removeAttribute("hidden");
      el("manageOrderNote").value = "";
      writeAddress("oe", {});
      this.setMethod("carrier");
      clear(el("oe-khach"));
      status(el("oe-trang-thai"), "");
      this.drawCart();
    }
    // ----- cart -----
    nextKey() {
      this.seq += 1;
      return `dong-${this.seq}`;
    }
    addLine(p) {
      const same = this.cart.find((l) => l.ma.toLowerCase() === p.ma.toLowerCase() && l.size === p.size);
      if (same) same.soLuong += p.soLuong ?? 1;
      else this.cart.push({ key: this.nextKey(), ma: p.ma, ten: p.ten, size: p.size, soLuong: p.soLuong ?? 1, donGia: p.donGia, loaiChietKhau: "money", chietKhau: 0, daMua: 0 });
      this.drawCart();
      status(el("oe-trang-thai"), `Đã thêm ${p.ma}${p.size ? ` size ${p.size}` : ""}.`, "good");
    }
    addManualProduct() {
      const value = (id) => el(id).value.trim();
      const ma = value("manageOrderManualProductCode");
      if (ma === "") {
        status(el("oe-trang-thai"), "Sản phẩm ngoài danh mục cần mã.", "bad");
        return;
      }
      this.addLine({ ma, ten: value("manageOrderManualProductName"), size: value("manageOrderManualProductSize"), soLuong: Math.max(1, digits(value("manageOrderManualProductQty"))), donGia: digits(value("manageOrderManualProductPrice")) });
      for (const id of ["manageOrderManualProductCode", "manageOrderManualProductName", "manageOrderManualProductSize", "manageOrderManualProductPrice"]) el(id).value = "";
      el("manageOrderManualProductQty").value = "1";
    }
    drawCart() {
      const box = el("manageOrderCart");
      clear(box);
      const count = document.getElementById("oe-so-mon");
      if (count) count.textContent = `${this.cart.length} sản phẩm đã chọn.`;
      if (this.cart.length === 0) {
        box.appendChild(h("p", { class: "subtle" }, "Chưa có sản phẩm. Tìm và chọn SKU để thêm vào đơn."));
        this.drawTotals();
        return;
      }
      const totals = this.totals();
      const body = h("tbody");
      for (const l of this.cart) {
        const locked = l.daMua > 0;
        const input = (field) => h("input", { value: String(l[field]), inputmode: "numeric", class: "short", "data-order-item-id": l.key, "data-order-item-field": field });
        body.appendChild(h(
          "tr",
          { "data-order-item-row": l.key, class: locked ? "order-cart-row-locked" : "" },
          h("td", null, h(
            "div",
            { class: "product-media-row" },
            h("span", { class: "product-thumb placeholder" }, l.ma.slice(0, 6) || "SP"),
            h("div", null, h("strong", null, l.ten || l.ma), h("div", { class: "subtle" }, `${l.ma}${l.size ? ` · size ${l.size}` : ""}${locked ? ` · đã mua ${l.daMua}` : ""}`))
          )),
          h("td", null, input("soLuong")),
          h("td", null, input("donGia")),
          h("td", null, h("select", { "data-order-item-id": l.key, "data-order-item-field": "loaiChietKhau" }, ...options([["money", "Theo số tiền"], ["percent", "Theo phần trăm (%)"]], l.loaiChietKhau))),
          h("td", null, input("chietKhau")),
          h("td", null, h("strong", { "data-order-item-total": l.key }, money(totals.lineTotal(l)))),
          h("td", null, locked ? h("button", { class: "ghost-button compact-button", type: "button", disabled: true, title: `Đã mua ${l.daMua}, không thể xóa.` }, "Đã mua") : h("button", { class: "ghost-button compact-button danger", type: "button", "data-action": "remove-order-cart-item", "data-order-item-id": l.key }, "Xóa"))
        ));
      }
      const head = h("thead", null, h("tr", null, ...["Sản phẩm", "SL", "Đơn giá", "Loại CK", "Chiết khấu", "Thành tiền", ""].map((t) => h("th", null, t))));
      box.appendChild(h("div", { class: "order-cart-table-wrap" }, h("table", { class: "order-cart-table" }, head, body)));
      this.drawTotals();
    }
    totals() {
      return cartTotals(this.cart, {
        loaiChietKhau: el("manageOrderDiscountType").value,
        chietKhau: digits(el("manageOrderDiscountValue").value),
        phiShip: digits(el("manageOrderShippingFee").value),
        daTra: digits(el("manageOrderPaidAmount").value)
      });
    }
    drawTotals() {
      const t = this.totals();
      const box = el("manageOrderTotals");
      clear(box);
      const row = (label, value, strong = false) => h("div", { class: strong ? "order-total-emphasis" : "" }, h("span", null, label), h("strong", null, value));
      box.append(
        row("Tổng tiền sản phẩm", money(t.subtotal)),
        row("Chiết khấu từng sản phẩm", `-${money(t.itemDiscount)}`),
        row("Chiết khấu toàn đơn", `-${money(t.orderDiscount)}`),
        row("Phí giao hàng", money(t.shippingFee)),
        row("Khách phải trả", money(t.payable), true),
        row("Khách đã trả", money(t.paid)),
        row("Còn phải trả", money(t.remaining), true)
      );
      for (const cell of this.root.querySelectorAll("[data-order-item-total]")) {
        const line = this.cart.find((l) => l.key === cell.dataset["orderItemTotal"]);
        if (line) cell.textContent = money(t.lineTotal(line));
      }
    }
    onInput(target) {
      const key = target.dataset["orderItemId"];
      const field = target.dataset["orderItemField"];
      if (key && field) {
        const line = this.cart.find((l) => l.key === key);
        if (!line) return;
        const value = target.value;
        if (field === "loaiChietKhau") line.loaiChietKhau = value === "percent" ? "percent" : "money";
        else if (field === "soLuong") line.soLuong = Math.max(line.daMua, Math.max(1, digits(value)));
        else if (field === "donGia") line.donGia = digits(value);
        else if (field === "chietKhau") line.chietKhau = digits(value);
        this.drawTotals();
        return;
      }
      if (target instanceof HTMLInputElement && target.name === "manageOrderDeliveryMethod") {
        this.setMethod(target.value);
        return;
      }
      if (["manageOrderDiscountType", "manageOrderDiscountValue", "manageOrderShippingFee", "manageOrderPaidAmount"].includes(target.id)) this.drawTotals();
    }
    setMethod(method) {
      for (const card of this.root.querySelectorAll("[data-method]")) {
        const on = card.dataset["method"] === method;
        card.classList.toggle("active", on);
        const radio = card.querySelector("input");
        if (radio) radio.checked = on;
      }
    }
    method() {
      return this.root.querySelector('input[name="manageOrderDeliveryMethod"]:checked')?.value ?? "carrier";
    }
    // ----- customer -----
    async lookupCustomer({ quiet = false } = {}) {
      const phone = el("manageOrderCustomerPhoneLookup").value.trim();
      const box = el("oe-khach");
      if (phone === "") {
        if (!quiet) status(el("oe-trang-thai"), "Nhập số điện thoại khách.", "bad");
        return;
      }
      const r = await this.gateway.landing("khach.ho-so.theo-so", { dienThoai: phone });
      if (!r.ok) {
        status(el("oe-trang-thai"), r.viSao, "bad");
        return;
      }
      if (!r.than?.khach) {
        this.customer = null;
        clear(box);
        box.appendChild(h("p", { class: "subtle" }, "Chưa có khách với số này — điền tên, địa chỉ bên dưới hoặc bấm Tạo khách hàng mới."));
        return;
      }
      this.showCustomer(r.than, { keepAddress: false });
    }
    async selectCustomer(id, opts = {}) {
      const r = await this.gateway.landing("khach.ho-so.doc", { ma: id });
      if (!r.ok || !r.than?.khach) return;
      this.showCustomer(r.than, { keepAddress: opts.keepAddress === true });
    }
    showCustomer(detail, { keepAddress }) {
      const p = detail.khach;
      if (p === null) return;
      this.customer = p;
      this.addresses = detail.diaChi ?? [];
      el("manageOrderCustomerPhoneLookup").value = p.dienThoai;
      if (!keepAddress || el("manageOrderCustomerName").value.trim() === "") el("manageOrderCustomerName").value = p.ten;
      const box = el("oe-khach");
      clear(box);
      const chooser = h(
        "div",
        { class: "config-form" },
        h("strong", null, this.addresses.length > 1 ? "Chọn địa chỉ giao hàng" : "Địa chỉ giao hàng"),
        ...this.addresses.map((a) => h(
          "button",
          { class: "secondary-button compact-button", type: "button", "data-action": "select-order-customer-address", "data-address-id": a.ma },
          `${addressLine(a)}${a.nguoiNhan && a.nguoiNhan !== p.ten ? ` · ${a.nguoiNhan}` : ""}${a.macDinh ? " (mặc định)" : ""}`
        ))
      );
      box.appendChild(h(
        "div",
        { class: "inline-panel" },
        h("strong", null, p.ten),
        h("div", null, p.dienThoai),
        p.sizeQuen || p.monChoi ? h("div", { class: "subtle" }, [p.sizeQuen && `size ${p.sizeQuen}`, p.monChoi].filter(Boolean).join(" · ")) : null,
        this.addresses.length === 0 ? h("p", { class: "subtle" }, "Khách chưa có địa chỉ lưu sẵn.") : chooser,
        h("div", { class: "split-actions" }, h("button", { class: "secondary-button compact-button", type: "button", "data-action": "open-order-customer-address-form" }, "Thêm địa chỉ mới vào hồ sơ khách"))
      ));
      if (!keepAddress) this.useAddress(this.addresses.find((a) => a.macDinh) ?? this.addresses[0] ?? null);
    }
    useAddress(a) {
      if (a === null) return;
      el("manageOrderAddressDetail").value = a.chiTiet;
      writeAddress("oe", { tinh: a.tinh, huyen: a.huyen, xa: a.xa });
      if (a.nguoiNhan) el("manageOrderCustomerName").value = a.nguoiNhan;
      for (const b of this.root.querySelectorAll('[data-action="select-order-customer-address"]')) {
        const on = b.dataset["addressId"] === a.ma;
        b.classList.toggle("primary-button", on);
        b.classList.toggle("secondary-button", !on);
      }
    }
    // ----- save -----
    async save() {
      const line = el("oe-trang-thai");
      const name = el("manageOrderCustomerName").value.trim();
      const phone = el("manageOrderCustomerPhoneLookup").value.trim();
      if (name === "" || phone === "") {
        status(line, "Cần tên người nhận và số điện thoại.", "bad");
        return;
      }
      if (this.cart.length === 0) {
        status(line, "Đơn cần ít nhất một sản phẩm.", "bad");
        return;
      }
      const address = readAddress("oe");
      const common = {
        khach: name,
        dienThoai: phone,
        diaChiChiTiet: el("manageOrderAddressDetail").value.trim(),
        tinh: address.tinh,
        huyen: address.huyen,
        xa: address.xa,
        mon: this.cart.map((l) => ({ ma: l.ma, ten: l.ten, size: l.size, soLuong: l.soLuong, donGia: l.donGia, loaiChietKhau: l.loaiChietKhau, chietKhau: l.chietKhau })),
        loaiChietKhau: el("manageOrderDiscountType").value,
        chietKhau: digits(el("manageOrderDiscountValue").value),
        phiShip: digits(el("manageOrderShippingFee").value),
        cachTra: el("manageOrderPaymentMethod").value,
        nhan: el("manageOrderTags").value.trim(),
        cachGiao: this.method(),
        hangVanChuyen: el("manageOrderCarrier").value,
        nguoiTraShip: el("manageOrderShippingPayer").value,
        maVanDon: el("manageOrderTrackingCode").value.trim(),
        trangThaiGiao: el("manageOrderFulfillmentStatus").value,
        ghiChuGiao: el("manageOrderShippingNote").value.trim(),
        ghiChu: el("manageOrderNote").value.trim(),
        trangThai: el("manageOrderStatus").value,
        ...this.customer ? { maKhach: this.customer.ma } : {}
      };
      status(line, "Đang lưu…");
      if (this.editing !== null) {
        const r2 = await this.gateway.landing("don.sua", { maDon: this.editing.id, ...common });
        if (!r2.ok) {
          status(line, r2.viSao, "bad");
          return;
        }
        this.close();
        this.onDone({ maDon: this.editing.id, taoMoi: false, thieu: r2.than?.thieu ?? [] });
        return;
      }
      const r = await this.gateway.landing("don.tao-thu-cong", { ...common, daTra: digits(el("manageOrderPaidAmount").value) });
      if (!r.ok || !r.than) {
        status(line, r.viSao, "bad");
        return;
      }
      const made = r.than;
      if (el("manageOrderPushToCarrier").checked && common.cachGiao === "carrier") {
        const ship = await this.gateway.landing("van-don.tao-tu-don", { maDon: made.maDon, hang: common.hangVanChuyen === "viettel_post" ? "vtp" : common.hangVanChuyen });
        if (!ship.ok) status(line, `Đã tạo ${made.maDon} nhưng chưa tạo được vận đơn: ${ship.viSao}`, "bad");
      }
      this.close();
      this.onDone({ maDon: made.maDon, maBiMat: made.maBiMat, taoMoi: true, thieu: made.thieu ?? [] });
    }
  };

  // ../omi/packages/omi-ui/src/views/orders/product-line.ts
  var KIND_OPTIONS = [
    { ma: "", ten: "Chưa chọn" },
    { ma: "shoe", ten: "Giày" },
    { ma: "apparel", ten: "Quần áo" },
    { ma: "accessory", ten: "Phụ kiện" },
    { ma: "bag", ten: "Balo / túi" },
    { ma: "hat", ten: "Mũ" },
    { ma: "sock", ten: "Tất" },
    { ma: "other", ten: "Khác" }
  ];
  function pushLabel(line) {
    if (line.daMuaDu) return "Đã mua đủ";
    if (line.daMua > 0) return `Đã mua ${line.daMua}/${line.soLuong} · còn ${line.canMua}`;
    if (line.dayMua) return "Hủy đẩy mua";
    return "Đẩy mua";
  }
  function productLine(orderId, line, partners) {
    const data = { "data-order": orderId, "data-line": line.maDong };
    const kind = h(
      "select",
      { class: "landing-kind-select", "data-kind-of": line.maDong },
      ...KIND_OPTIONS.map((k) => h("option", { value: k.ma, ...k.ma === line.loaiSanPham ? { selected: "" } : {} }, k.ten))
    );
    const picker = h(
      "select",
      { class: "landing-partner-select", "data-partner-of": line.maDong, disabled: line.khoaKho },
      h("option", { value: "" }, "Chưa chọn kho"),
      ...partners.map((p) => h("option", { value: p.ma, ...p.ma === line.maDoiTac ? { selected: "" } : {} }, p.ten))
    );
    const assign = h("button", {
      class: "secondary-button compact-button",
      type: "button",
      "data-action": "gan-kho",
      ...data,
      disabled: line.khoaKho
    }, line.khoaKho ? "Đã mua · khóa kho" : "Chọn kho");
    const push = line.maDoiTac === "" ? null : h("button", {
      class: line.dayMua && !line.daMuaDu ? "ghost-button compact-button" : "primary-button compact-button",
      type: "button",
      "data-action": "day-mua",
      ...data,
      disabled: line.daMuaDu || line.daMua > 0
    }, pushLabel(line));
    const swap = line.khoaKho ? null : h("button", {
      class: "ghost-button compact-button",
      type: "button",
      "data-action": "mo-doi-mau",
      ...data
    }, "Đổi mẫu");
    const reassign = line.daMuaDu || line.daMua >= line.soLuong ? null : h(
      "div",
      { class: "compact-actions", "data-reassign-of": line.maDong },
      h("button", { class: "secondary-button compact-button", type: "button", "data-action": "open-reassign-purchase", ...data }, "Lấy hàng từ đơn khác")
    );
    return h(
      "div",
      { class: "landing-order-product-line" },
      h(
        "div",
        { class: "product-media-row" },
        h("strong", null, `${line.ma}${line.ten ? ` ${line.ten}` : ""}`),
        h("span", { class: "subtle" }, `size ${line.size || "—"} · SL ${line.soLuong}`),
        line.kho === "" ? null : h("span", { class: "subtle" }, `Kho: ${line.kho}`)
      ),
      h(
        "div",
        { class: "landing-partner-picker" },
        kind,
        h("button", { class: "secondary-button compact-button", type: "button", "data-action": "luu-loai", ...data }, "Lưu"),
        picker,
        assign,
        push,
        swap
      ),
      reassign
    );
  }
  function reassignPicker(orderId, line, sources) {
    const data = { "data-order": orderId, "data-line": line.maDong };
    if (sources.length === 0) {
      return h(
        "div",
        { class: "omi-reassign" },
        h("span", { class: "subtle" }, "Không có đơn nào đang giữ hàng cùng mã + size."),
        h("button", { class: "secondary-button compact-button", type: "button", "data-action": "close-reassign-purchase", ...data }, "Đóng")
      );
    }
    const missing = Math.max(1, line.soLuong - line.daMua);
    return h(
      "div",
      { class: "omi-reassign field-inline" },
      h(
        "select",
        { "data-reassign-source": line.maDong },
        ...sources.map((s) => h(
          "option",
          { value: s.maDon, "data-has-tracking": s.coVanDon ? "1" : "0" },
          `${s.maDon} · ${s.khach || "Khách chưa lưu"} · giữ ${s.soLuong}${s.coVanDon ? " · ⚠ có vận đơn" : ""}`
        ))
      ),
      missing > 1 ? h("input", { type: "number", min: "1", max: String(missing), value: String(missing), "data-reassign-qty": line.maDong }) : null,
      h("button", { class: "primary-button compact-button", type: "button", "data-action": "confirm-reassign-purchase", ...data }, "Lấy về đơn này"),
      h("button", { class: "secondary-button compact-button", type: "button", "data-action": "close-reassign-purchase", ...data }, "Đóng")
    );
  }

  // ../omi/packages/omi-ui/src/views/orders/status-actions.ts
  var LABELS = {
    "hoan-tac": "Hoàn tác trạng thái",
    "xac-nhan": "Xác nhận",
    "san-sang-giao": "Sẵn sàng giao",
    "cho-ship-bat-buoc": "Chờ ship bắt buộc",
    "hoan-tat": "Hoàn tất"
  };
  var CLASSES = {
    "hoan-tac": "ghost-button compact-button",
    "xac-nhan": "secondary-button compact-button",
    "san-sang-giao": "primary-button compact-button",
    "cho-ship-bat-buoc": "secondary-button compact-button",
    "hoan-tat": "primary-button compact-button"
  };
  function statusCell(order) {
    const jobs = order.viecLamDuoc ?? [];
    return h(
      "div",
      { class: "landing-order-status-cell" },
      badge(order.trangThai || "—", order.trangThai === "completed" ? "green" : order.trangThai === "cancelled" ? "red" : ""),
      // Đơn đi qua bằng đường thoát: nói ra, vì sau này nhìn lại sẽ cần biết vì sao nó được giao
      // khi sổ mua chưa đủ.
      order.epChoShip === true ? badge("ép ship", "amber") : null,
      jobs.length === 0 ? null : h(
        "div",
        { class: "toolbar compact" },
        ...jobs.map((job) => h("button", {
          class: CLASSES[job] ?? "secondary-button compact-button",
          type: "button",
          "data-action": "viec-don",
          "data-order": order.id,
          "data-viec": job,
          "data-line": ""
        }, LABELS[job] ?? job))
      )
    );
  }

  // ../omi/packages/omi-ui/src/views/orders/workflow-tabs.ts
  var WORKFLOW_TABS = [
    { ma: "workflow_new", ten: "Đơn mới" },
    { ma: "workflow_stock", ten: "Chờ xác nhận hàng" },
    { ma: "workflow_payment", ten: "Chờ khách CK" },
    { ma: "workflow_purchase", ten: "Đang mua" },
    { ma: "workflow_delivery", ten: "Chờ giao" },
    { ma: "workflow_completed", ten: "Hoàn tất" },
    { ma: "workflow_attention", ten: "Cần xử lý" },
    { ma: "cancelled", ten: "Đã hủy" }
  ];
  function drawTabs(bar, counts, active) {
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    const tabs = counts.nhom?.length ? counts.nhom : WORKFLOW_TABS;
    for (const tab of tabs) {
      bar.appendChild(h("button", {
        class: `landing-order-status-tab${tab.ma === active ? " is-active" : ""}`,
        type: "button",
        "data-action": "chon-nhom",
        "data-nhom": tab.ma
      }, tab.ten, h("span", null, String(counts.dem?.[tab.ma] ?? 0))));
    }
  }

  // ../omi/packages/omi-ui/src/views/orders.ts
  var JOB_DONE = {
    "xac-nhan": "đã xác nhận",
    "san-sang-giao": "đã chuyển sang sẵn sàng giao",
    "cho-ship-bat-buoc": "đã ép sang chờ ship",
    "hoan-tat": "đã hoàn tất",
    "hoan-tac": "đã hoàn tác một bước"
  };
  var EXTRA_FILTERS = [["", "Theo tab đang chọn"], ["chua-gan-kho", "Chưa phân bổ kho / đối tác"], ["o-doi-tac", "Đang ở đối tác"]];
  var OrdersView = class extends View {
    id = "don";
    label = "Đơn hàng";
    title = "Quản lý đơn hàng";
    workspace = "common";
    glyph = "OD";
    openId = null;
    openDetail = null;
    /** Đang xem thùng rác thay vì danh sách đơn đang làm việc. */
    bin = false;
    rows = [];
    partners = [];
    /** Tab quy trình đang xem. Desk mở ở "Đơn mới" (`state.landingOrderStatus`). */
    tab = "workflow_new";
    counts = {};
    /** Dòng đang chờ đổi mẫu, khi khung đổi mẫu đang mở. */
    swapping = null;
    editor;
    build(root) {
      this.editor = new OrderEditor(this.ctx.gateway, (result) => void this.editorDone(result));
      root.append(
        // Tám tab quy trình thay ô gõ tay tên trạng thái: người bán không phải nhớ `purchase_complete`
        // viết thế nào, và không gõ sai được nữa.
        h("div", { class: "landing-order-status-tabs", id: "don-nhom" }),
        h(
          "div",
          { class: "toolbar don-danh-sach" },
          h("input", { id: "don-tim", type: "text", class: "wide", placeholder: "Mã đơn, tên, SĐT, sản phẩm…", onkeydown: (e) => {
            if (e.key === "Enter") void this.loadOrders();
          } }),
          h("input", { id: "don-loc-dien-thoai", type: "text", placeholder: "Số điện thoại", onkeydown: (e) => {
            if (e.key === "Enter") void this.loadOrders();
          } }),
          h("select", { id: "don-loc-trang-thai", onchange: () => void this.loadOrders() }, ...EXTRA_FILTERS.map(([v, t]) => h("option", { value: v }, t))),
          h("button", { class: "secondary-button", id: "nut-don-tai", type: "button", onclick: () => void this.loadOrders() }, "Tải danh sách đơn"),
          h("button", { class: "secondary-button", id: "nut-don-thung-rac", type: "button", onclick: () => this.toggleBin() }, "Thùng rác"),
          h("button", { class: "primary-button", id: "nut-don-moi", type: "button", onclick: () => this.openCreate({}) }, "+ Đơn thủ công"),
          h("span", { class: "badge blue", id: "don-so-dem" }, "—"),
          h("span", { class: "badge red", id: "don-so-da-xoa", hidden: true }),
          h("span", { class: "status-line", id: "don-trang-thai" }, 'Bấm "Tải danh sách đơn".')
        ),
        this.editor.root,
        // Đổi mẫu: mở khi bấm "Đổi mẫu" trên một dòng món. Đặt ngoài bảng vì bảng vẽ lại liên tục —
        // ô tìm hàng đang gõ dở mà bị vẽ lại là mất chữ.
        h(
          "section",
          { class: "panel", id: "don-doi-mau", hidden: true },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Đổi mẫu"), h("p", { id: "doi-mau-dang-doi" }, "—")),
            h("button", { class: "secondary-button compact-button", id: "nut-doi-mau-dong", type: "button", onclick: () => this.closeSwap() }, "Đóng")
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "form-grid" },
              h("label", { for: "doi-mau-ly-do" }, "Lý do"),
              h("input", { id: "doi-mau-ly-do", type: "text", placeholder: "Đối tác báo hết hàng…" }),
              h("label", { for: "doi-mau-tim" }, "Mẫu mới"),
              this.swapBox()
            ),
            h("p", { class: "status-line", id: "doi-mau-trang-thai" })
          )
        ),
        h(
          "section",
          { class: "panel don-danh-sach" },
          table(["Mã đơn", "Khách", "Điện thoại", "Sản phẩm / đối tác mua", "Tổng", "Đã trả", "Còn phải trả", "Trạng thái", "Vận đơn"], "don-bang")
        ),
        h(
          "section",
          { class: "panel detail don-danh-sach", id: "don-chi-tiet", hidden: true },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", { id: "ct-ma" }, "—"), h("p", { id: "ct-khach" }, "—")),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "primary-button compact-button", id: "nut-ct-sua", type: "button", onclick: () => this.openEdit() }, "Sửa đơn"),
              h("button", { class: "secondary-button compact-button", id: "nut-ct-link-tra-cuu", type: "button", onclick: () => void this.copyTrackingLink() }, "Copy link tra cứu"),
              h("button", { class: "danger-button compact-button", id: "nut-ct-xoa", type: "button" }, "Xoá đơn")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h("p", { class: "subtle", id: "ct-dia-chi" }, "—"),
            // Gợi ý gom kho: gom một kho là một kiện, một lần đóng, một phí ship.
            h("div", { class: "landing-warehouse-suggestion", id: "ct-goi-y-kho" }),
            table(["Mã", "Tên", "Size", "SL", "Đơn giá", "Kho"], "ct-mon", { scroll: false }),
            // Cụm nút trạng thái của đơn đang mở — cùng bộ nút với dòng trong bảng, cùng luật.
            h("div", { class: "toolbar", id: "ct-viec" }),
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ct-ghi-chu", type: "text", placeholder: "Ghi chú (không bắt buộc)" })
            ),
            // Hai đường KẾT THÚC đơn. Cả hai mất thứ gì đó nên hỏi lại; "Hàng hoàn" còn bắt buộc lý
            // do. Khách đã trả tiền thì người bán quyết GIỮ hay HOÀN ngay lúc này (Desk
            // `runOrderLifecycleCancel`) — để sau là để quên.
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ct-ly-do", type: "text", class: "wide", placeholder: "Lý do (bắt buộc khi hàng hoàn)" }),
              h(
                "span",
                { id: "ct-coc", hidden: true },
                h("label", { class: "check" }, h("input", { type: "radio", name: "ct-coc", value: "giu", checked: true }), " Giữ cọc"),
                h("label", { class: "check" }, h("input", { type: "radio", name: "ct-coc", value: "hoan" }), " Hoàn tiền cho khách")
              ),
              h("button", { class: "danger-button compact-button", id: "nut-ct-huy", type: "button" }, "Hủy đơn"),
              h("button", { class: "secondary-button compact-button", id: "nut-ct-hang-hoan", type: "button" }, "Hàng hoàn"),
              h("span", { class: "status-line", id: "ct-ket-thuc" })
            ),
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ct-so-tien", type: "text", placeholder: "Số tiền đã nhận" }),
              h("button", { class: "primary-button", id: "nut-ct-ghi-tien", type: "button", onclick: () => void this.recordPayment() }, "Ghi nhận đã nhận tiền"),
              h("span", { class: "status-line", id: "ct-trang-thai" })
            ),
            h(
              "div",
              { class: "toolbar" },
              h("input", { id: "ct-can-nang", type: "text", placeholder: "Cân nặng (kg, không bắt buộc)" }),
              h("button", { class: "primary-button", id: "nut-ct-van-don", type: "button", onclick: () => void this.createShipment() }, "Tạo vận đơn cho đơn này"),
              h("button", { class: "secondary-button", id: "nut-ct-tra-van-don", type: "button", onclick: () => void this.trackShipment() }, "Tra vận đơn"),
              h("span", { class: "status-line", id: "ct-van-don" })
            ),
            h("pre", { class: "order-log", id: "ct-nhat-ky" })
          )
        )
      );
      confirmTwice(el("nut-ct-xoa"), "Bấm lần nữa: đưa vào thùng rác", () => void this.deleteOrder());
      confirmTwice(el("nut-ct-huy"), "Bấm lần nữa: huỷ đơn, hàng về kho", () => void this.endOrder("huy"));
      confirmTwice(el("nut-ct-hang-hoan"), "Bấm lần nữa: nhận hàng hoàn về kho", () => void this.endOrder("hang-hoan"));
      el("don-nhom").addEventListener("click", (e) => {
        const button = e.target?.closest?.("[data-action]");
        if (button === null) return;
        const work = this.TAB_ACTIONS[button.dataset["action"] ?? ""];
        if (work !== void 0) void work(button.dataset["nhom"] ?? "");
      });
      drawTabs(el("don-nhom"), this.counts, this.tab);
      el("ct-viec").addEventListener("click", (e) => {
        const button = e.target?.closest?.('[data-action="viec-don"]');
        if (button === null) return;
        void this.runOrderJob(button.dataset["order"] ?? "", button.dataset["viec"] ?? "");
      });
      el("don-bang").addEventListener("click", (e) => {
        const button = e.target?.closest?.("[data-action]");
        if (button === null) return;
        e.stopPropagation();
        const work = this.ORDER_ACTIONS[button.dataset["action"] ?? ""];
        if (work === void 0) return;
        const row = button.closest("tr");
        if (row === null) return;
        void work(button.dataset["order"] ?? "", button.dataset["line"] ?? "", row, button);
      });
    }
    load() {
      void this.loadCounts();
      void this.loadPartners().then(() => this.loadOrders());
    }
    /**
     * BỘ ĐIỀU PHỐI TÁC VỤ — một người nhận cho cả bảng đơn, như Sales Desk. Thêm một việc của Desk =
     * thêm một dòng ở đây, và đọc bảng là biết OMI đã có đủ việc của Desk hay chưa.
     */
    ORDER_ACTIONS = {
      "luu-loai": (orderId, lineId2, row) => this.writeLine(orderId, lineId2, {
        loaiSanPham: this.pickerValue(row, `[data-kind-of="${lineId2}"]`)
      }, "Đã lưu loại hàng."),
      "gan-kho": (orderId, lineId2, row) => {
        const partnerId = this.pickerValue(row, `[data-partner-of="${lineId2}"]`);
        const partner = this.partners.find((p) => p.ma === partnerId);
        return this.writeLine(orderId, lineId2, {
          maDoiTac: partnerId,
          maKho: partnerId === "" ? "" : partnerId.replace(/^partner_/, ""),
          tenKho: partner?.ten ?? ""
        }, partnerId === "" ? "Đã bỏ chọn kho." : `Đã giao cho ${partner?.ten ?? partnerId}.`);
      },
      "day-mua": (orderId, lineId2) => {
        const line = this.lineOf(orderId, lineId2);
        const on = !(line?.dayMua ?? false);
        return this.writeLine(orderId, lineId2, { dayMua: on }, on ? "Đã đẩy vào danh sách cần mua." : "Đã rút khỏi danh sách cần mua.");
      },
      "mo-doi-mau": async (orderId, lineId2) => {
        const panel = el("don-doi-mau");
        panel.hidden = false;
        const line = this.lineOf(orderId, lineId2);
        el("doi-mau-dang-doi").textContent = `${orderId} · ${line?.ma ?? ""}${line?.size ? ` size ${line.size}` : ""} → đổi sang:`;
        this.swapping = { orderId, lineId: lineId2 };
        el("doi-mau-tim").focus();
        status(el("doi-mau-trang-thai"), "");
      },
      "khoi-phuc": (orderId) => this.restoreOrder(orderId),
      // ----- Đ4: đối tác -----
      "handoff-order-products": async (orderId) => {
        const line = el("don-trang-thai");
        status(line, `Đang gửi Telegram cho đối tác của ${orderId}…`);
        const r = await this.ctx.gateway.landing("mua-ho.gui-doi-tac", { maDon: orderId });
        if (!r.ok) {
          status(line, r.viSao, "bad");
          return;
        }
        status(line, str(r.than?.message) || `Đã gửi Telegram cho ${r.than?.daGui ?? 0} đối tác.`, (r.than?.daGui ?? 0) > 0 ? "good" : "bad");
      },
      "partner-confirmed": (orderId) => this.actForPartner(orderId, "xac-nhan"),
      // Báo hết hàng thay đối tác làm dòng rời khỏi tay đối tác: bấm hai lần, như mọi nút làm mất việc.
      "partner-out-of-stock": async (orderId, _lineId, _row, button) => {
        if (button.dataset["confirm"] !== "1") {
          button.dataset["confirm"] = "1";
          button.textContent = "Bấm lần nữa: báo hết hàng";
          return;
        }
        await this.actForPartner(orderId, "het-hang");
      },
      "open-reassign-purchase": async (orderId, lineId2, row) => {
        const box = row.querySelector(`[data-reassign-of="${CSS.escape(lineId2)}"]`);
        const item = this.lineOf(orderId, lineId2);
        if (box === null || item === void 0) return;
        const line = el("don-trang-thai");
        status(line, "Đang tìm đơn đang giữ hàng cùng mã + size…");
        const r = await this.ctx.gateway.landing("mua-ho.nguon-chuyen", { maDon: orderId, maDong: lineId2 });
        if (!r.ok) {
          status(line, r.viSao, "bad");
          return;
        }
        clear(box);
        box.appendChild(reassignPicker(orderId, item, r.than?.nguon ?? []));
        status(line, `${(r.than?.nguon ?? []).length} đơn đang giữ ${item.ma} size ${item.size || "—"}.`, "good");
      },
      "close-reassign-purchase": async (orderId, lineId2, row) => {
        const box = row.querySelector(`[data-reassign-of="${CSS.escape(lineId2)}"]`);
        if (box === null) return;
        clear(box);
        box.appendChild(h("button", { class: "secondary-button compact-button", type: "button", "data-action": "open-reassign-purchase", "data-order": orderId, "data-line": lineId2 }, "Lấy hàng từ đơn khác"));
      },
      "confirm-reassign-purchase": async (orderId, lineId2, row, button) => {
        const line = el("don-trang-thai");
        const select = row.querySelector(`[data-reassign-source="${CSS.escape(lineId2)}"]`);
        const source = select?.value ?? "";
        if (source === "") {
          status(line, "Cần chọn đơn đang giữ hàng.", "bad");
          return;
        }
        if (select?.selectedOptions[0]?.dataset["hasTracking"] === "1" && button.dataset["confirm"] !== "1") {
          button.dataset["confirm"] = "1";
          button.textContent = "Đơn nguồn có vận đơn — bấm lần nữa";
          return;
        }
        const qty = Number(row.querySelector(`[data-reassign-qty="${CSS.escape(lineId2)}"]`)?.value ?? 1) || 1;
        status(line, `Đang chuyển hàng từ đơn ${source}…`);
        const r = await this.ctx.gateway.landing("mua-ho.chuyen-phieu", { maDonDich: orderId, maDongDich: lineId2, maDonNguon: source, soLuong: qty });
        if (!r.ok) {
          status(line, `Không chuyển được: ${r.viSao}`, "bad");
          return;
        }
        await this.reload();
        status(line, `${str(r.than?.message) || "Đã chuyển hàng"} ✓`, "good");
      },
      // Cụm nút trạng thái. Tên việc đọc từ CHÍNH nút vừa bấm.
      "viec-don": (orderId, _lineId, _row, button) => this.runOrderJob(orderId, button.dataset["viec"] ?? ""),
      // Duyệt khách của đơn web (Desk `confirm-remote-existing-customer` / `-new-customer`).
      "confirm-remote-existing-customer": (orderId) => this.reviewCustomer(orderId, false),
      "confirm-remote-new-customer": (orderId) => this.reviewCustomer(orderId, true)
    };
    /** Việc của thanh tab. */
    TAB_ACTIONS = {
      "chon-nhom": async (nhom) => {
        this.tab = nhom;
        this.bin = false;
        el("don-loc-trang-thai").value = "";
        el("nut-don-thung-rac").textContent = "Thùng rác";
        drawTabs(el("don-nhom"), this.counts, this.tab);
        await this.loadOrders();
      }
    };
    pickerValue(row, selector) {
      return row.querySelector(selector)?.value ?? "";
    }
    /** Desk `partner-confirmed` / `partner-out-of-stock`: shop bấm thay đối tác cho mọi dòng đang chờ của đơn. */
    async actForPartner(orderId, viec) {
      const line = el("don-trang-thai");
      status(line, "Đang ghi thay đối tác…");
      const r = await this.ctx.gateway.landing("mua-ho.thay-doi-tac", { maDon: orderId, viec, ...viec === "het-hang" ? { lyDo: "Đối tác báo hết hàng. Người thật cần liên hệ lại khách." } : {} });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        await this.reload();
        return;
      }
      await this.reload();
      status(line, str(r.than?.message) || `Đã cập nhật trạng thái ${orderId}.`, "good");
    }
    lineOf(orderId, lineId2) {
      return this.rows.find((d) => d.id === orderId)?.mon?.find((m) => m.maDong === lineId2);
    }
    async runOrderJob(orderId, viec) {
      const line = el("don-trang-thai");
      if (viec === "") return;
      status(line, "Đang làm…");
      const r = await this.ctx.gateway.landing("don.viec", { maDon: orderId, viec });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.reload();
      if (this.openId === orderId) await this.openOrder(orderId);
      status(line, `${orderId}: ${JOB_DONE[viec] ?? "đã xong"}${r.than?.trangThai ? ` (${r.than.trangThai})` : ""}.`, "good");
    }
    /** Gợi ý kho cho đơn đang mở. Hỏng ở đây chỉ mất một gợi ý — im lặng bỏ qua. */
    async loadWarehouseHint(orderId) {
      const box = el("ct-goi-y-kho");
      clear(box);
      const r = await this.ctx.gateway.landing("don.goi-y-kho", { maDon: orderId });
      if (!r.ok || this.openId !== orderId) return;
      const hint = r.than?.goiY;
      if (!hint) return;
      box.appendChild(badge(hint.nhan, hint.mau));
    }
    /**
     * Kết thúc đơn đang mở. Khách đã trả thì gửi luôn quyết định GIỮ / HOÀN; "hoàn" gọi tiếp sổ tiền
     * (`tien.hoan`) với đúng số đã trả — đơn không tự chạm tiền, module Tiền giữ sổ hoàn.
     * Việc OMI không tự làm được (huỷ vận đơn ở hãng) vẫn được NÓI RA.
     */
    async endOrder(cach) {
      if (this.openId === null) return;
      const line = el("ct-ket-thuc");
      const lyDo = el("ct-ly-do").value.trim();
      if (cach === "hang-hoan" && lyDo === "") {
        status(line, "Hàng hoàn phải ghi lý do — khách trả vì sao.", "bad");
        return;
      }
      const id = this.openId;
      const paid = this.openDetail?.daTra ?? 0;
      const giuCoc = paid > 0 ? this.root.querySelector('input[name="ct-coc"]:checked')?.value ?? "giu" : "";
      status(line, "Đang làm…");
      const r = await this.ctx.gateway.landing("don.ket-thuc", { maDon: id, cach, lyDo, giuCoc });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than ?? {};
      let refund = "";
      if (giuCoc === "hoan") {
        const back = await this.ctx.gateway.landing("tien.hoan", { maDon: id, soTien: paid, lyDo: lyDo || (cach === "huy" ? "Huỷ đơn" : "Hàng hoàn") });
        refund = back.ok ? ` Đã ghi hoàn ${money(paid)}.` : ` CHƯA hoàn được tiền: ${back.viSao}`;
      }
      await this.reload();
      await this.openOrder(id);
      const todo = t.canNguoiLam ?? [];
      status(
        el("ct-ket-thuc"),
        `${cach === "huy" ? "Đã huỷ" : "Đã nhận hàng hoàn"} ${id}; ${t.daTraTon ?? 0} dòng về kho.${refund}` + (todo.length > 0 ? ` CÒN PHẢI LÀM: ${todo.join(" ")}` : ""),
        todo.length > 0 || refund.includes("CHƯA") ? "bad" : "good"
      );
    }
    async writeLine(orderId, lineId2, than, okText) {
      const line = el("don-trang-thai");
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("don.dong.ghi", { maDon: orderId, maDong: lineId2, ...than });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.reload();
      status(line, okText, "good");
    }
    /** Ô tìm hàng của khung đổi mẫu: chọn một size là đổi luôn, không có bước xác nhận thừa. */
    swapBox() {
      return skuSuggest({
        inputId: "doi-mau-tim",
        boxId: "doi-mau-goi-y",
        search: (query) => this.ctx.gateway.landing("hang.tim", { tuKhoa: query, gioiHan: 20 }),
        onPick: (pick) => void this.swapLine(pick)
      });
    }
    closeSwap() {
      el("don-doi-mau").hidden = true;
      this.swapping = null;
      el("doi-mau-tim").value = "";
      el("doi-mau-ly-do").value = "";
    }
    /** Đổi một dòng sang mẫu khác. Giá KHÔNG gửi lên — kho quyết giá. */
    async swapLine(pick) {
      const target = this.swapping;
      if (target === null) return;
      const line = el("doi-mau-trang-thai");
      status(line, "Đang đổi…");
      const r = await this.ctx.gateway.landing("don.dong.doi-mau", {
        maDon: target.orderId,
        maDong: target.lineId,
        ma: pick.ma,
        size: pick.size,
        lyDo: el("doi-mau-ly-do").value.trim()
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than ?? {};
      await this.reload();
      if (this.openId === target.orderId) await this.openOrder(target.orderId);
      this.closeSwap();
      status(el("don-trang-thai"), `Đã đổi sang ${pick.ma} size ${pick.size}. ${t.loiNhan ?? ""}`, (t.chenh ?? 0) === 0 ? "good" : "bad");
    }
    async loadPartners() {
      const r = await this.ctx.gateway.landing("doi-tac.danh-sach");
      if (!r.ok) return;
      this.partners = (r.than ?? []).map((p) => ({ ma: p.ma, ten: p.ten || p.ma }));
    }
    /**
     * Another screen opened this one. Customers / Fanpage ask to WRITE an order (`soanDon`, maybe
     * with a profile); Customers' row asks for a phone's orders; Tổng quan landing opens one (`moDon`).
     */
    receive(params) {
      const phone = String(params["dienThoai"] ?? "").trim();
      const name = String(params["khach"] ?? "").trim();
      const orderId = String(params["moDon"] ?? "").trim();
      if (orderId !== "") {
        void this.openOrder(orderId);
        return;
      }
      if (params["soanDon"] === true) {
        this.openCreate({ khach: name, dienThoai: phone, maKhach: String(params["maKhach"] ?? "") });
        return;
      }
      if (phone === "") return;
      el("don-loc-dien-thoai").value = phone;
      this.tab = "";
      this.bin = false;
      drawTabs(el("don-nhom"), this.counts, this.tab);
      void this.loadOrders();
    }
    // ----- editor -----
    /** Trình soạn đơn thay chỗ danh sách (như Desk): ẩn danh sách khi soạn, hiện lại khi xong. */
    showList(on) {
      for (const node of this.root.querySelectorAll(".don-danh-sach, #don-nhom")) node.classList.toggle("omi-an", !on);
    }
    openCreate(prefill) {
      this.showList(false);
      this.editor.openCreate(prefill);
    }
    openEdit() {
      if (this.openDetail === null) return;
      this.showList(false);
      this.editor.openEdit(this.openDetail);
    }
    async editorDone(result) {
      this.showList(true);
      if (result === null) return;
      const line = el("don-trang-thai");
      await this.reload();
      await this.openOrder(result.maDon);
      const missing = this.missingNote(result.thieu);
      status(line, result.taoMoi ? `Đã tạo ${result.maDon}. Mã bí mật cho khách tra đơn: ${result.maBiMat ?? ""} (chỉ hiện một lần).${missing}` : `Đã lưu ${result.maDon}.${missing}`, "good");
    }
    // ----- list -----
    /** Xem thùng rác, hoặc quay về danh sách đơn đang làm việc. Đơn đang mở thì đóng lại. */
    toggleBin() {
      this.bin = !this.bin;
      el("nut-don-thung-rac").textContent = this.bin ? "← Danh sách đơn" : "Thùng rác";
      this.openId = null;
      el("don-chi-tiet").hidden = true;
      void this.loadOrders();
    }
    async reload() {
      await Promise.all([this.loadOrders(), this.loadCounts()]);
    }
    async loadOrders() {
      const line = el("don-trang-thai");
      status(line, "Đang tải…");
      const extra = el("don-loc-trang-thai").value;
      const r = await this.ctx.gateway.landing("don.danh-sach", {
        dienThoai: el("don-loc-dien-thoai").value.trim(),
        tuKhoa: el("don-tim").value.trim(),
        gioiHan: 100,
        // Trong thùng rác thì không lọc theo tab. Ô lọc trạng thái thắng tab khi được chọn.
        ...this.bin ? { daXoa: "chi" } : { nhom: extra || this.tab }
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const rows = r.than ?? [];
      this.rows = rows;
      const body = el("don-bang");
      clear(body);
      for (const d of rows) {
        const hasPartner = (d.mon ?? []).some((m) => m.maDoiTac !== "");
        const partnerJobs = !d.daXoa && hasPartner ? h(
          "div",
          { class: "compact-actions" },
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "handoff-order-products", "data-order": d.id, "data-line": "" }, "Gửi đối tác"),
          h("button", { class: "primary-button compact-button", type: "button", "data-action": "partner-confirmed", "data-order": d.id, "data-line": "" }, "Đối tác xác nhận"),
          h("button", { class: "danger-button compact-button", type: "button", "data-action": "partner-out-of-stock", "data-order": d.id, "data-line": "" }, "Báo hết hàng")
        ) : null;
        const products = h("div", { class: "landing-order-products" }, ...(d.mon ?? []).map((m) => productLine(d.id, m, this.partners)), partnerJobs);
        const customer = h(
          "div",
          null,
          d.khach,
          // Đơn chưa gắn hồ sơ khách: "Chờ duyệt khách" + hai nút (Desk).
          !d.daXoa && (d.maKhach ?? "") === "" ? h(
            "div",
            { class: "landing-customer-review" },
            badge("Chờ duyệt khách", "amber"),
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "confirm-remote-existing-customer", "data-order": d.id, "data-line": "" }, "Khách cũ"),
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "confirm-remote-new-customer", "data-order": d.id, "data-line": "" }, "Khách mới")
          ) : null
        );
        const cells = [d.id, customer, d.dienThoai, products, money(d.tong), money(d.daTra), money(d.conPhaiTra), statusCell(d), d.maVanDon || "—"];
        if (d.daXoa) cells[8] = this.binActions(d.id);
        const tr = tableRow(cells, [4, 5, 6]);
        if (d.daXoa) tr.className = "is-muted-row";
        tr.addEventListener("click", () => {
          selectRow(body, tr);
          void this.openOrder(d.id);
        });
        body.appendChild(tr);
      }
      el("don-so-dem").textContent = this.bin ? `${rows.length} đơn trong thùng rác` : `${rows.length}/${this.counts.tongDangHoatDong ?? rows.length} đơn`;
      const deleted = el("don-so-da-xoa");
      deleted.hidden = !(this.counts.soDaXoa && this.counts.soDaXoa > 0);
      deleted.textContent = `${this.counts.soDaXoa ?? 0} đã xoá`;
      status(line, this.bin ? `${rows.length} đơn trong thùng rác.` : `${rows.length} đơn.`, "good");
    }
    async loadCounts() {
      const r = await this.ctx.gateway.landing("don.dem-nhom");
      if (!r.ok) return;
      this.counts = r.than ?? {};
      drawTabs(el("don-nhom"), this.counts, this.tab);
    }
    binActions(orderId) {
      const restore = h("button", { class: "secondary-button compact-button", type: "button", "data-action": "khoi-phuc", "data-order": orderId, "data-line": "" }, "Khôi phục");
      const purge = h("button", { class: "danger-button compact-button", type: "button" }, "Xoá vĩnh viễn");
      purge.addEventListener("click", (e) => e.stopPropagation());
      confirmTwice(purge, "Bấm lần nữa: xoá hẳn, không lấy lại được", () => void this.purgeOrder(orderId));
      return h("div", { class: "toolbar compact" }, restore, purge);
    }
    /**
     * Duyệt khách của một đơn web. "Khách cũ" tìm hồ sơ theo SĐT của đơn và gắn vào; không có hồ sơ
     * nào thì nói ra (không tự tạo — đó là nút "Khách mới").
     */
    async reviewCustomer(orderId, isNew) {
      const line = el("don-trang-thai");
      const row = this.rows.find((d) => d.id === orderId);
      let params = { maDon: orderId, moi: true };
      if (!isNew) {
        const found = await this.ctx.gateway.landing("khach.ho-so.theo-so", { dienThoai: row?.dienThoai ?? "" });
        if (!found.ok) {
          status(line, found.viSao, "bad");
          return;
        }
        if (!found.than?.khach) {
          status(line, `Chưa có hồ sơ nào với số ${row?.dienThoai ?? ""} — bấm "Khách mới" để tạo.`, "bad");
          return;
        }
        params = { maDon: orderId, maKhach: found.than.khach.ma };
      }
      const r = await this.ctx.gateway.landing("don.duyet-khach", params);
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.reload();
      status(el("don-trang-thai"), r.than?.taoMoi ? `Đã tạo hồ sơ khách cho ${orderId}.` : `Đã gắn ${orderId} vào hồ sơ khách.`, "good");
    }
    async restoreOrder(orderId) {
      const line = el("don-trang-thai");
      status(line, `Đang khôi phục ${orderId}…`);
      const r = await this.ctx.gateway.landing("don.khoi-phuc", { maDon: orderId });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than ?? {};
      if (t.daKhoiPhuc === false) {
        status(line, t.viSao || "Đơn này không ở thùng rác.", "bad");
        return;
      }
      await this.reload();
      status(line, `Đã khôi phục ${orderId}.${this.missingNote(t.stock?.thieu ?? [])}`, "good");
    }
    async purgeOrder(orderId) {
      const line = el("don-trang-thai");
      status(line, `Đang xoá hẳn ${orderId}…`);
      const r = await this.ctx.gateway.landing("don.xoa-vinh-vien", { maDon: orderId });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.reload();
      status(line, `Đã xoá hẳn ${orderId}.`, "good");
    }
    // ----- detail -----
    async openOrder(orderId) {
      const line = el("don-trang-thai");
      status(line, `Đang mở đơn ${orderId}…`);
      const r = await this.ctx.gateway.landing("don.mo", { maDon: orderId });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.renderDetail(r.than ?? {});
      status(line, "");
    }
    renderDetail(d) {
      this.openId = d.id;
      this.openDetail = d;
      el("don-chi-tiet").hidden = false;
      el("ct-ma").textContent = `${d.id} · ${d.trangThai}`;
      el("ct-khach").textContent = `${d.khach} · ${d.dienThoai}${d.email ? ` · ${d.email}` : ""} · tổng ${money(d.tong)} · đã trả ${money(d.daTra)} · còn ${money(d.conPhaiTra)}${d.maChuyenKhoan ? ` · mã CK ${d.maChuyenKhoan}` : ""}`;
      const extras = [d.phiShip ? `ship ${money(d.phiShip)}` : "", d.chietKhau ? `chiết khấu ${d.loaiChietKhau === "percent" ? `${d.chietKhau}%` : money(d.chietKhau)}` : "", d.nhan ? `nhãn: ${d.nhan}` : "", d.ghiChuGiao ? `giao: ${d.ghiChuGiao}` : ""].filter(Boolean).join(" · ");
      el("ct-dia-chi").textContent = `${d.diaChi ?? ""}${d.ghiChu ? ` — ghi chú: ${d.ghiChu}` : ""}${extras ? ` — ${extras}` : ""}`;
      const items = el("ct-mon");
      clear(items);
      for (const m of d.mon ?? []) items.appendChild(tableRow([m.ma, m.ten, m.size, m.soLuong, money(m.donGia), m.kho || "—"], [3, 4]));
      el("ct-nhat-ky").textContent = (d.nhatKy ?? []).map((n) => `${n.luc}  ${n.trangThai} (${n.boi})${n.ghiChu ? ` — ${n.ghiChu}` : ""}`).join("\n");
      const jobs = el("ct-viec");
      clear(jobs);
      jobs.appendChild(statusCell(d));
      el("ct-so-tien").value = d.conPhaiTra > 0 ? String(d.conPhaiTra) : "";
      el("ct-ly-do").value = "";
      el("ct-coc").hidden = !(d.daTra > 0);
      const keep = this.root.querySelector('input[name="ct-coc"][value="giu"]');
      if (keep) keep.checked = true;
      status(el("ct-ket-thuc"), "");
      void this.loadWarehouseHint(d.id);
      status(el("ct-trang-thai"), "");
    }
    async afterMutation(line, r, okText) {
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, okText, "good");
      if (this.openId !== null) await this.openOrder(this.openId);
    }
    async recordPayment() {
      if (this.openId === null) return;
      const amount = digits(el("ct-so-tien").value);
      const line = el("ct-trang-thai");
      if (!(amount > 0)) {
        status(line, "Nhập số tiền đã nhận.", "bad");
        return;
      }
      status(line, "Đang ghi…");
      const r = await this.ctx.gateway.landing("don.ghi-tien", { maDon: this.openId, soTien: amount, ghiChu: el("ct-ghi-chu").value.trim() });
      await this.afterMutation(line, r, `Đã ghi nhận ${money(amount)}.`);
    }
    async createShipment() {
      if (this.openId === null) return;
      const line = el("ct-van-don");
      status(line, "Đang tạo vận đơn…");
      const r = await this.ctx.gateway.landing("van-don.tao-tu-don", {
        maDon: this.openId,
        canNangKg: Number(el("ct-can-nang").value.replace(/[^0-9.]/g, "")) || 0
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than ?? {};
      status(line, `Đã tạo: ${t.maVanDon || "—"}${t.hang ? ` (${t.hang})` : ""}${t.cod ? ` · COD ${money(t.cod)}` : ""}`, "good");
      await this.openOrder(this.openId);
    }
    async trackShipment() {
      if (this.openId === null) return;
      const line = el("ct-van-don");
      status(line, "Đang tra…");
      const r = await this.ctx.gateway.landing("van-don.tra", { maPhieu: this.openId });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than ?? {};
      status(line, `${t.maVanDon ? `Mã ${t.maVanDon} · ` : ""}${t.trangThai || t.loiNhan || "chưa có thông tin"}`, t.ok === false ? "bad" : "good");
    }
    /**
     * "Copy link tra cứu" (Desk `copy-order-tracking-link`). Mã cũ không đọc lại được (landing chỉ giữ
     * bản băm), nên cấp MÃ MỚI — mã cũ hết hiệu lực, và câu báo nói rõ điều đó.
     */
    async copyTrackingLink() {
      if (this.openId === null) return;
      const line = el("ct-trang-thai");
      const r = await this.ctx.gateway.landing("don.ma-tra-cuu", { maDon: this.openId });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const text2 = `Tra cứu đơn ${this.openId}: ${r.than?.duongTraCuu ?? ""}
Mã tra cứu: ${r.than?.maBiMat ?? ""}`;
      try {
        await navigator.clipboard.writeText(text2);
        status(line, `Đã copy link + mã tra cứu MỚI (${r.than?.maBiMat ?? ""}). Mã cũ hết hiệu lực.`, "good");
      } catch {
        status(line, `Mã tra cứu mới: ${r.than?.maBiMat ?? ""} — máy không cho chép vào bộ nhớ tạm.`, "bad");
      }
    }
    missingNote(thieu) {
      return thieu.length === 0 ? "" : ` Ngoài kho: ${thieu.map((x) => `${x.code}${x.size ? ` size ${x.size}` : ""}`).join(", ")}.`;
    }
    async deleteOrder() {
      if (this.openId === null) return;
      const line = el("ct-trang-thai");
      const id = this.openId;
      status(line, "Đang xoá…");
      const r = await this.ctx.gateway.landing("don.xoa", { maDon: id });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.openId = null;
      this.openDetail = null;
      el("don-chi-tiet").hidden = true;
      const t = r.than ?? {};
      await this.reload();
      status(
        el("don-trang-thai"),
        t.daXoa === false ? t.viSao || "Đơn này đã ở thùng rác." : `Đã đưa ${id} vào thùng rác; hàng đã về kho. Bấm "Thùng rác" để khôi phục.`,
        t.daXoa === false ? "bad" : "good"
      );
    }
  };

  // ../omi/packages/omi-ui/src/views/partners.ts
  var DETAIL_TABS = [
    ["overview", "Tổng quan"],
    ["portal_view", "Xem như đối tác"],
    ["products", "Danh sách sản phẩm"],
    ["orders", "Danh sách đơn hàng"],
    ["payments", "Thanh toán, công nợ"]
  ];
  var PORTAL_TABS = [
    ["overview", "Tổng quan"],
    ["needs", "Sản phẩm cần mua"],
    ["orders", "Mã đơn cần đóng"],
    ["history", "Lịch sử sản phẩm"],
    ["purchases", "Phiên mua"],
    ["fees", "Công nợ"]
  ];
  var NEW = "__new__";
  var PartnersView = class extends View {
    id = "doi-tac";
    label = "Quản lý đối tác";
    title = "Quản lý đối tác";
    workspace = "landing";
    glyph = "PT";
    partners = [];
    selected = "";
    tab = "overview";
    portalTab = "overview";
    portals = /* @__PURE__ */ new Map();
    /** Sổ công nợ trong kỳ đang chọn, theo đối tác. */
    ledgers = /* @__PURE__ */ new Map();
    payrollPreset = "week";
    payrollCustom = { from: "", to: "" };
    policies = [];
    editingPolicy = "";
    actions = {
      "edit-partner-fee-payment": (b) => this.editPayment(str(b.dataset["paymentId"])),
      "void-partner-fee-payment": (b) => this.voidPayment(str(b.dataset["paymentId"])),
      "prefill-partner-purchase": (b) => this.prefillPurchase(b),
      "confirm-partner-purchase": () => this.confirmPurchase(),
      "edit-managed-order": (b) => this.ctx.shell.open("don", { moDon: str(b.dataset["orderId"]) }),
      "edit-partner-policy": (b) => {
        this.editingPolicy = str(b.dataset["policyId"]);
        this.drawPolicies();
        el("partnerPolicyName").focus();
      },
      "cancel-partner-policy-edit": () => {
        this.editingPolicy = "";
        this.drawPolicies();
      },
      "save-partner-policy": () => this.savePolicy(),
      "new-procurement-partner": () => {
        this.selected = NEW;
        this.tab = "overview";
        this.drawAll();
      },
      "select-procurement-partner": (b) => this.select(str(b.dataset["partnerId"])),
      "set-partner-detail-tab": (b) => {
        this.tab = b.dataset["tab"] ?? "overview";
        this.drawDetail();
        void this.ensurePortal();
        void this.ensureLedger();
      },
      "set-partner-portal-preview-tab": (b) => {
        this.portalTab = b.dataset["tab"] ?? "overview";
        this.drawDetail();
      },
      "reload-partner-portal-preview": () => this.ensurePortal(true),
      "save-procurement-partner": () => this.save(),
      "cancel-procurement-partner-edit": () => {
        this.selected = this.partners[0]?.ma ?? "";
        this.drawAll();
      },
      "toggle-procurement-partner": () => this.toggleActive(),
      "reset-partner-password": () => this.resetPassword(),
      "copy-partner-login": () => this.copyLogin(true),
      "copy-partner-login-page": () => this.copyLogin(false),
      "pay-partner-fee": () => this.money("tra"),
      "add-partner-fee-adjustment": () => this.money("phat_sinh")
    };
    build(root) {
      root.append(
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Quản lý đối tác"), h("p", null, "Chọn một đối tác trong danh sách để xem thông tin, xử lý đơn/sản phẩm và công nợ.")),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "primary-button", type: "button", "data-action": "new-procurement-partner" }, "Tạo đối tác"),
              h("button", { class: "secondary-button", type: "button", id: "nut-doi-tac-tai", onclick: () => void this.loadPartners() }, "Tải lại")
            )
          ),
          h(
            "div",
            { class: "panel-body landing-partner-layout" },
            h(
              "div",
              { class: "landing-partner-login-card" },
              h("div", null, h("strong", null, "Link đăng nhập cố định cho đối tác"), h("p", { class: "subtle", id: "doi-tac-link-dang-nhap" }, "—")),
              h("button", { class: "secondary-button compact-button", type: "button", "data-action": "copy-partner-login-page" }, "Copy link đăng nhập")
            ),
            h("div", { class: "landing-partner-list", id: "doi-tac-bang" }),
            h("div", { class: "landing-partner-detail", id: "doi-tac-chi-tiet" })
          )
        ),
        h("span", { class: "status-line", id: "doi-tac-trang-thai" }),
        // Desk `settingsTemplate` → "Chính sách đối tác": bot đọc để trả lời khách về hàng của từng đối tác.
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Chính sách đối tác"), h("p", null, "Nếu đối tác không có chính sách riêng, AI dùng chính sách mặc định của shop."))
          ),
          h(
            "div",
            { class: "panel-body config-form" },
            h("div", { class: "qa-list", id: "doi-tac-chinh-sach" }),
            h("div", { class: "subtle", id: "partnerPolicyEditing" }),
            h("div", { class: "field" }, h("label", { for: "partnerPolicyName" }, "Tên đối tác / tên file"), h("input", { id: "partnerPolicyName" })),
            h(
              "div",
              { class: "field" },
              h("label", { for: "partnerPolicyText" }, "Chính sách bán hàng"),
              h("textarea", { id: "partnerPolicyText", placeholder: "Để trống nghĩa là dùng chính sách mặc định của shop." })
            ),
            h(
              "div",
              { class: "field" },
              h("label", { for: "partnerHandlingNote" }, "Ghi chú xử lý nội bộ"),
              h("textarea", { id: "partnerHandlingNote", placeholder: "Ví dụ: báo Zalo cho ai, giờ cutoff, cần xác nhận tồn trước khi báo khách..." })
            ),
            h("div", { class: "split-actions", id: "doi-tac-chinh-sach-nut" }),
            h("span", { class: "status-line", id: "doi-tac-chinh-sach-trang-thai" })
          )
        )
      );
    }
    load() {
      void this.loadPartners();
      void this.loadPolicies();
    }
    // ----- Đ4: kỳ lương, sổ công nợ, sửa / hoàn tác CK -----
    payrollRange() {
      return presetRange(this.payrollPreset, /* @__PURE__ */ new Date(), this.payrollCustom);
    }
    /** Khung "Kỳ tính lương partner" — vẽ lại mỗi lần tab vẽ, giữ lựa chọn trong view. */
    payrollPanel() {
      const f = dateFilterPanel("partnerPayroll", "Kỳ tính lương partner", this.payrollPreset, () => {
        const select = document.getElementById("partnerPayrollPreset");
        this.payrollPreset = select?.value ?? "week";
        this.payrollCustom = { from: document.getElementById("partnerPayrollFrom")?.value ?? "", to: document.getElementById("partnerPayrollTo")?.value ?? "" };
        this.ledgers.clear();
        void this.ensureLedger(true);
      }, "omi-section-gap");
      if (this.payrollPreset === "custom") {
        f.panel.querySelector("#partnerPayrollFrom").value = this.payrollCustom.from;
        f.panel.querySelector("#partnerPayrollTo").value = this.payrollCustom.to;
        f.label.textContent = rangeLabel(this.payrollRange(), "Đang tính toàn bộ lịch sử lương partner.");
      }
      return f.panel;
    }
    async ensureLedger(force = false) {
      const p = this.current();
      if (p === null || this.tab !== "overview" && this.tab !== "payments" || !force && this.ledgers.has(p.ma)) return;
      const r = await this.ctx.gateway.landing("mua-ho.so-cong-no", { doiTac: p.ma, ...this.payrollRange() });
      if (!r.ok) return;
      this.ledgers.set(p.ma, r.than ?? {});
      this.drawDetail();
    }
    paymentLine(id) {
      return [...this.ledgers.values()].flatMap((l) => l.thanhToan ?? []).find((x) => x.ma === id && !x.huyLuc);
    }
    /** Desk `edit-partner-fee-payment`: hộp nhập trong trang, số tiền chỉ nhận chữ số. */
    async editPayment(id) {
      const line = el("doi-tac-trang-thai");
      const original = this.paymentLine(id);
      if (original === void 0) {
        status(line, "Không tìm thấy giao dịch CK cần sửa.", "bad");
        return;
      }
      const answer = await askDialog({
        title: `Sửa giao dịch CK của ${original.tenDoiTac}`,
        fields: [{ name: "amount", label: "Số tiền CK thực tế", value: String(original.soTien), numeric: true }, { name: "note", label: "Ghi chú CK", value: original.ghiChu }],
        submitLabel: "Lưu"
      });
      if (answer === null) return;
      if (!amountTextValid(answer["amount"] ?? "")) {
        status(line, AMOUNT_HINT, "bad");
        return;
      }
      const amount = digits(answer["amount"]);
      if (amount <= 0) {
        status(line, "Số tiền CK phải lớn hơn 0.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("mua-ho.sua-tien", { ma: id, soTien: amount, ghiChu: String(answer["note"] ?? "").trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.afterMoneyChange(`Đã sửa giao dịch CK của ${original.tenDoiTac}.`);
    }
    /** Desk `void-partner-fee-payment`: hỏi lý do; khoản vẫn nằm trong lịch sử, gạch ngang, không tính nữa. */
    async voidPayment(id) {
      const line = el("doi-tac-trang-thai");
      const original = this.paymentLine(id);
      if (original === void 0) {
        status(line, "Không tìm thấy giao dịch CK cần hoàn tác.", "bad");
        return;
      }
      const answer = await askDialog({
        title: "Hoàn tác giao dịch CK",
        message: `Hoàn tác giao dịch CK ${money(original.soTien)} của ${original.tenDoiTac}? Khoản này sẽ không còn được tính vào Đã CK.`,
        fields: [{ name: "reason", label: "Lý do hoàn tác", value: "Nhập nhầm giao dịch" }],
        submitLabel: "Hoàn tác"
      });
      if (answer === null) return;
      const r = await this.ctx.gateway.landing("mua-ho.huy-tien", { ma: id, lyDo: String(answer["reason"] ?? "").trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.afterMoneyChange("Đã hoàn tác giao dịch CK; công nợ đã được tính lại.");
    }
    async afterMoneyChange(message) {
      this.ledgers.clear();
      await this.ensurePortal(true);
      await this.ensureLedger(true);
      const line = el("doi-tac-trang-thai");
      status(line, message, "good");
    }
    /** Desk `prefill-partner-purchase`: đưa dòng cần mua lên form xác nhận. */
    prefillPurchase(button) {
      const set = (id, v) => {
        const n = document.getElementById(id);
        if (n) n.value = v;
      };
      set("dtPurchaseProductCode", str(button.dataset["productCode"]));
      set("dtPurchaseSize", str(button.dataset["size"]));
      set("dtPurchaseQty", str(button.dataset["missingQty"]) || "1");
      set("dtPurchaseCost", str(button.dataset["unitCost"]));
      const line = document.getElementById("dtPurchaseStatus");
      if (line) status(line, "Đã đưa dòng cần mua lên form xác nhận.", "good");
      document.getElementById("dtPurchaseQty")?.focus();
    }
    /** Desk `confirm-partner-purchase`: shop ghi phiên mua THAY đối tác; máy chủ chia vào các đơn như cổng. */
    async confirmPurchase() {
      const p = this.current();
      const line = el("dtPurchaseStatus");
      if (p === null) return;
      const value = (id) => el(id).value.trim();
      const quantity = Math.trunc(Number(value("dtPurchaseQty")) || 0);
      const cost = digits(value("dtPurchaseCost"));
      if (value("dtPurchaseProductCode") === "" || quantity <= 0) {
        status(line, "Cần mã sản phẩm và số lượng mua được.", "bad");
        return;
      }
      if (cost <= 0) {
        status(line, "Cần nhập giá mua thực tế lớn hơn 0.", "bad");
        return;
      }
      status(line, "Đang ghi phiên mua…");
      const r = await this.ctx.gateway.landing("mua-ho.mua-thay", {
        doiTac: p.ma,
        maMon: value("dtPurchaseProductCode"),
        size: value("dtPurchaseSize"),
        soLuong: quantity,
        giaVon: cost,
        ghiChu: value("dtPurchaseNote")
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const done = r.than?.soLuong ?? quantity;
      await this.ensurePortal(true);
      status(el("dtPurchaseStatus"), `Đã xác nhận ${quantity} sản phẩm; phân bổ ${done}, còn dư ${r.than?.thua ?? 0}.`, "good");
    }
    // ----- chính sách đối tác -----
    async loadPolicies() {
      const r = await this.ctx.gateway.landing("mua-ho.chinh-sach");
      if (!r.ok) {
        status(el("doi-tac-chinh-sach-trang-thai"), r.viSao, "bad");
        return;
      }
      this.policies = r.than?.chinhSach ?? [];
      this.drawPolicies();
    }
    drawPolicies() {
      const list = el("doi-tac-chinh-sach");
      clear(list);
      for (const item of this.policies) {
        list.appendChild(h(
          "div",
          { class: "knowledge-card" },
          h(
            "div",
            { class: "knowledge-card-header" },
            h("div", null, h("div", { class: "product-title" }, item.tenHienThi || item.ten), h("div", { class: "subtle" }, `policy_source: ${item.ten}`)),
            h(
              "div",
              { class: "policy-card-actions" },
              badge(item.macDinh ? "Mặc định" : "Đối tác", item.macDinh ? "green" : "blue"),
              h("button", { class: "ghost-button compact-button", type: "button", "data-action": "edit-partner-policy", "data-policy-id": item.ma }, "Sửa")
            )
          ),
          h("div", null, item.noiDung),
          h("div", { class: "subtle" }, item.ghiChu || "Không có ghi chú xử lý riêng.")
        ));
      }
      const editing = this.policies.find((x) => x.ma === this.editingPolicy) ?? null;
      el("partnerPolicyEditing").textContent = editing ? `Đang sửa: ${editing.tenHienThi || editing.ten}` : "";
      el("partnerPolicyName").value = editing?.ten ?? "";
      el("partnerPolicyText").value = editing?.noiDung ?? "";
      el("partnerHandlingNote").value = editing?.ghiChu ?? "";
      const actions = el("doi-tac-chinh-sach-nut");
      clear(actions);
      actions.append(
        h("button", { class: "primary-button", type: "button", "data-action": "save-partner-policy" }, editing ? "Cập nhật chính sách" : "Lưu chính sách đối tác"),
        editing ? h("button", { class: "ghost-button", type: "button", "data-action": "cancel-partner-policy-edit" }, "Hủy sửa") : ""
      );
    }
    async savePolicy() {
      const line = el("doi-tac-chinh-sach-trang-thai");
      const name = el("partnerPolicyName").value.trim();
      if (name === "") {
        status(line, "Cần nhập tên đối tác hoặc tên file.", "bad");
        return;
      }
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("mua-ho.ghi-chinh-sach", {
        ma: this.editingPolicy,
        ten: name,
        noiDung: el("partnerPolicyText").value.trim(),
        ghiChu: el("partnerHandlingNote").value.trim()
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const wasEditing = this.editingPolicy !== "";
      this.policies = r.than?.chinhSach ?? this.policies;
      this.editingPolicy = "";
      this.drawPolicies();
      status(line, wasEditing ? "Đã cập nhật chính sách đối tác." : "Đã lưu chính sách đối tác.", "good");
    }
    loginPage() {
      const origin = str(this.ctx.shell.license()?.diaChiLanding).replace(/\/+$/, "");
      return `${origin || "(địa chỉ web shop)"}/partner-login`;
    }
    async loadPartners() {
      const line = el("doi-tac-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("doi-tac.danh-sach");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.partners = r.than ?? [];
      if (this.selected === "" || this.selected !== NEW && !this.partners.some((p) => p.ma === this.selected)) this.selected = this.partners[0]?.ma ?? NEW;
      this.portals.clear();
      this.ledgers.clear();
      this.drawAll();
      status(line, "");
      await this.ensurePortal();
      await this.ensureLedger();
    }
    current() {
      return this.selected === NEW ? null : this.partners.find((p) => p.ma === this.selected) ?? null;
    }
    select(id) {
      this.selected = id;
      this.drawAll();
      void this.ensurePortal();
      void this.ensureLedger();
    }
    drawAll() {
      el("doi-tac-link-dang-nhap").textContent = this.loginPage();
      const list = el("doi-tac-bang");
      clear(list);
      for (const p of this.partners) {
        const portal = this.portals.get(p.ma);
        const need = portal?.needs?.length;
        list.appendChild(h(
          "button",
          { class: `landing-partner-list-item${p.ma === this.selected ? " active" : ""}`, type: "button", "data-action": "select-procurement-partner", "data-partner-id": p.ma },
          h("span", null, h("strong", null, p.ten || p.ma), h("small", null, `ID: ${str(p.dangNhap) || p.ma}${p.dienThoai ? ` · ${p.dienThoai}` : ""}`)),
          h(
            "span",
            null,
            badge(p.trangThai === "paused" ? "paused" : "active", p.trangThai === "paused" ? "red" : "green"),
            h("small", null, need === void 0 ? "" : `${need} dòng cần mua · nợ ${money(portal?.summary?.debtAmount ?? 0)}`)
          )
        ));
      }
      if (this.partners.length === 0) list.appendChild(h("div", { class: "copy-box" }, "Chưa có đối tác."));
      this.drawDetail();
    }
    drawDetail() {
      const box = el("doi-tac-chi-tiet");
      clear(box);
      const p = this.current();
      const creating = p === null;
      box.append(h(
        "div",
        { class: "section-title-row" },
        h(
          "div",
          null,
          h("h3", null, creating ? "Tạo đối tác mới" : p.ten || p.ma),
          h("p", { class: "subtle" }, creating ? "Sau khi lưu, đối tác đăng nhập cổng bằng ID + mật khẩu dưới đây." : `ID: ${str(p.dangNhap) || p.ma} · Link đăng nhập: ${this.loginPage()}`)
        ),
        creating ? null : h("button", { class: "secondary-button compact-button", type: "button", "data-action": "toggle-procurement-partner" }, p.trangThai === "paused" ? "Mở" : "Khóa")
      ));
      if (!creating) {
        box.append(h(
          "div",
          { class: "view-tabs partner-detail-tabs" },
          ...DETAIL_TABS.map(([value, label]) => h("button", { type: "button", class: this.tab === value ? "active" : "", "data-action": "set-partner-detail-tab", "data-tab": value }, label))
        ));
      }
      if (creating || this.tab === "overview") {
        box.append(this.overviewTab(p));
        return;
      }
      const portal = this.portals.get(p.ma);
      if (portal === void 0) {
        box.append(h("div", { class: "partner-portal-preview omi-section-gap" }, h(
          "div",
          { class: "empty-state" },
          h("h3", null, "Đang tải đúng dữ liệu Portal…"),
          h("p", { id: "doi-tac-cong-loi" }, "Cùng nguồn dữ liệu với Portal đối tác."),
          h("button", { class: "secondary-button", type: "button", "data-action": "reload-partner-portal-preview" }, "Tải lại")
        )));
        return;
      }
      if (this.tab === "portal_view") box.append(this.portalViewTab(p, portal));
      if (this.tab === "products") box.append(this.productsTab(p, portal));
      if (this.tab === "orders") box.append(this.ordersTab(portal));
      if (this.tab === "payments") box.append(this.paymentsTab(portal));
    }
    async ensurePortal(force = false) {
      const p = this.current();
      if (p === null || !force && this.portals.has(p.ma)) return;
      const r = await this.ctx.gateway.landing("mua-ho.cong", { doiTac: p.ma });
      if (!r.ok) {
        const note = document.getElementById("doi-tac-cong-loi");
        if (note) note.textContent = r.viSao;
        return;
      }
      this.portals.set(p.ma, r.than ?? {});
      this.drawAll();
    }
    // ----- tabs -----
    overviewTab(p) {
      const field = (id, label, value, attrs = {}) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, value, ...attrs }));
      const creating = p === null;
      const portal = p ? this.portals.get(p.ma) : void 0;
      const card = (label, value, hint) => h("section", { class: "panel metric" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "hint" }, hint));
      return h(
        "div",
        null,
        h(
          "div",
          { class: "config-form omi-section-gap" },
          h(
            "div",
            { class: "grid three" },
            field("dt-ten", "Tên đối tác", str(p?.ten)),
            field("dt-ma", "Mã đối tác", str(p?.ma), creating ? { placeholder: "VD: partner_yen" } : { disabled: "true" }),
            field("dt-ma-cong", "Mã trên link cổng riêng", str(p?.maCong), { placeholder: "VD: cong-yen" }),
            field("dt-dang-nhap", "ID đăng nhập", str(p?.dangNhap)),
            creating ? h(
              "div",
              { class: "field" },
              h("label", { for: "dt-mat-khau" }, "Mật khẩu lần đầu"),
              h("input", { id: "dt-mat-khau", type: "password", autocomplete: "new-password", placeholder: "Để trống để tự tạo" }),
              h("small", null, "Mật khẩu chỉ hiện một lần sau khi tạo.")
            ) : h("div", { class: "field" }, h("label", null, "Mật khẩu"), h("div", { class: "copy-box" }, "Dùng nút Reset mật khẩu nếu cần cấp lại.")),
            field("dt-dien-thoai", "Số điện thoại", str(p?.dienThoai)),
            field("dt-email", "Email", str(p?.email)),
            field("dt-tinh", "Tỉnh/TP lấy hàng (chuẩn SPX)", str(p?.tinh)),
            field("dt-huyen", "Quận/Huyện lấy hàng", str(p?.huyen)),
            field("dt-xa", "Phường/Xã lấy hàng", str(p?.xa)),
            field("dt-dia-chi", "Số nhà, tên đường (lấy hàng)", str(p?.diaChiChiTiet)),
            field("dt-telegram", "Telegram chat ID", str(p?.telegramChatId), { placeholder: "Đối tác nhắn /start cho bot của shop rồi lấy chat ID" }),
            field("dt-cong-mon", "Công / sản phẩm", String(p?.congMoiMon ?? 0), { inputmode: "numeric" }),
            field("dt-cong-don", "Công / đơn hàng", String(p?.congMoiDon ?? 0), { inputmode: "numeric" }),
            h(
              "div",
              { class: "field" },
              h("label", { for: "dt-cach-tinh" }, "Cách tính công"),
              h(
                "select",
                { id: "dt-cach-tinh" },
                ...[["ca-hai", "Theo sản phẩm + đơn"], ["moi-mon", "Chỉ theo sản phẩm"], ["moi-don", "Chỉ theo đơn"]].map(([v, t]) => h("option", { value: v ?? "", selected: (str(p?.cachTinh) || "ca-hai") === v }, t ?? ""))
              )
            )
          ),
          h(
            "div",
            { class: "split-actions" },
            h("button", { class: "primary-button", type: "button", id: "nut-doi-tac-ghi", "data-action": "save-procurement-partner" }, creating ? "Tạo đối tác" : "Lưu thay đổi"),
            creating ? h("button", { class: "secondary-button", type: "button", "data-action": "cancel-procurement-partner-edit" }, "Huỷ") : null,
            creating ? null : h("button", { class: "secondary-button", type: "button", "data-action": "copy-partner-login" }, "Copy đăng nhập"),
            creating ? null : h("button", { class: "secondary-button", type: "button", "data-action": "reset-partner-password" }, "Reset mật khẩu")
          ),
          h("p", { class: "status-line", id: "dt-trang-thai" })
        ),
        creating ? null : this.payrollPanel(),
        creating ? null : h(
          "div",
          { class: "grid three omi-section-gap" },
          card("SL còn thiếu", String((portal?.needs ?? []).reduce((t, n) => t + Number(n.missingQty || 0), 0)), `${(portal?.needs ?? []).length} dòng mã/size còn mở`),
          card("Đơn liên quan", String(new Set((portal?.orders ?? []).map((o) => o.orderId)).size), "Đơn đã phân bổ cho đối tác"),
          card("Công nợ trong kỳ", money(this.ledgers.get(p.ma)?.doiTac?.[0]?.conNo ?? 0), rangeLabel(this.payrollRange(), "Đang tính toàn bộ lịch sử lương partner."))
        )
      );
    }
    portalViewTab(p, portal) {
      const needs = portal.needs ?? [];
      const summary = portal.summary ?? {};
      const card = (label, value, hint) => h("section", { class: "panel metric" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "hint" }, hint));
      const sum = (key) => needs.reduce((t, n) => t + Number(n[key] ?? 0), 0);
      const section = (title, ...children) => h("div", { class: "partner-portal-preview-section" }, title ? h("h4", null, title) : null, ...children);
      const cards = (rows, empty) => h("div", { class: "partner-portal-card-list" }, ...rows.length ? rows : [h("p", { class: "subtle empty" }, empty)]);
      const needCard = (n) => h(
        "div",
        { class: "order-card" },
        h("strong", null, `${n.productCode} · size ${n.size}`),
        " ",
        badge(Number(n.backlogQty || 0) > 0 ? "Mua bù" : n.purchasedQty > 0 ? "Đã mua một phần" : "Cần mua", Number(n.backlogQty || 0) > 0 ? "amber" : "blue"),
        h("div", { class: "subtle" }, n.productName),
        h("div", null, `Cần ${n.requiredQty} · đã mua ${n.purchasedQty} · còn thiếu ${n.missingQty} · giá vốn ${money(n.unitCost)}`)
      );
      const orderCard = (o) => h(
        "div",
        { class: "order-card" },
        h("strong", null, o.orderId),
        ` · ${o.customerName}`,
        h("div", { class: "subtle" }, `${o.productCode} size ${o.size} · SL ${o.quantity} · đã mua ${o.purchasedQty}${o.packingStatusLabel ? ` · ${o.packingStatusLabel}` : ""}`)
      );
      let content;
      switch (this.portalTab) {
        case "needs":
          content = section("Sản phẩm cần mua", h("p", { class: "subtle" }, "Chỉ hiển thị các mã/size còn thiếu như portal đối tác; nút xác nhận được bỏ ở chế độ admin xem."), cards(needs.map(needCard), "Chưa có sản phẩm cần mua."));
          break;
        case "orders":
          content = section("", cards((portal.orders ?? []).filter((o) => o.missingQty > 0).map(orderCard), "Chưa có mã đơn hàng liên quan."));
          break;
        case "history":
          content = section("Lịch sử sản phẩm được giao", cards((portal.orders ?? []).map(orderCard), "Chưa có lịch sử sản phẩm được giao."));
          break;
        case "purchases":
          content = section("", cards((portal.purchases ?? []).map((s) => h(
            "div",
            { class: "order-card" },
            h("strong", null, dayClock(s.createdAt)),
            ` · ${str(s.productCode)} size ${str(s.size)} · SL ${s.quantity ?? 0}`,
            h("div", { class: "subtle" }, `Giá ${money(s.unitCost ?? 0)} · công ${money(s.feeAmount ?? 0)}${s.note ? ` · ${s.note}` : ""}`)
          )), "Chưa có phiên mua nào."));
          break;
        case "fees":
          content = h(
            "div",
            null,
            section("", h(
              "div",
              { class: "grid four" },
              card("Công theo sản phẩm/đơn", money(summary.feeAmount ?? 0), "Theo phiên mua/đơn"),
              card("Chi phí phát sinh", money(summary.adjustmentAmount ?? 0), "Khoản cộng thêm"),
              card("Đã thanh toán", money(summary.paidAmount ?? 0), "Admin đã xác nhận"),
              card("Công nợ còn thiếu", money(summary.debtAmount ?? 0), "Đối tác theo dõi")
            )),
            section("", cards((portal.payments ?? []).map((x) => h("div", { class: "order-card" }, h("strong", null, money(x.amount)), ` · ${dayClock(x.createdAt)}`, h("div", { class: "subtle" }, x.note))), "Chưa có lịch sử thanh toán."))
          );
          break;
        default:
          content = h(
            "div",
            null,
            section("", h(
              "div",
              { class: "grid three" },
              card("Số lượng còn thiếu", String(sum("missingQty")), "Tổng cần mua"),
              card("Đã mua đã ghi nhận", String(summary.purchasedQty ?? 0), "Tổng lịch sử mua của partner"),
              card("Công nợ lịch sử", money(summary.debtAmount ?? 0), "Xem chi tiết ở tab Công nợ")
            )),
            section("Sản phẩm cần mua", cards(needs.slice(0, 5).map(needCard), "Chưa có sản phẩm cần mua.")),
            section("Đơn hàng liên quan", cards((portal.orders ?? []).slice(0, 5).map(orderCard), "Chưa có đơn hàng cần đóng."))
          );
      }
      return h(
        "div",
        { class: "partner-portal-preview omi-section-gap" },
        h(
          "div",
          { class: "partner-portal-preview-header" },
          h(
            "div",
            null,
            h("span", { class: "eyebrow" }, "Chế độ chỉ xem"),
            h("h3", null, `Màn hình đối tác: ${p.ten || p.ma}`),
            h("p", { class: "subtle" }, "Admin dùng tab này để đối chiếu trạng thái đối tác đang thấy. Muốn sửa trạng thái hoặc phân phối lại, hãy dùng các tab quản trị bên cạnh.")
          ),
          h(
            "div",
            { class: "split-actions" },
            badge(p.trangThai === "paused" ? "paused" : "active", p.trangThai === "paused" ? "red" : "green"),
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "reload-partner-portal-preview" }, "Tải lại")
          )
        ),
        h(
          "div",
          { class: "grid three" },
          card("Mã/size cần mua", String(needs.length), "Chỉ các dòng còn thiếu"),
          card("Đơn mới", String(sum("newQty")), "Số lượng chưa từng mua"),
          card("Còn thiếu mua bù", String(sum("backlogQty")), `Tổng còn thiếu ${sum("missingQty")}`)
        ),
        h(
          "div",
          { class: "view-tabs partner-portal-preview-tabs" },
          ...PORTAL_TABS.map(([value, label]) => h("button", { type: "button", class: this.portalTab === value ? "active" : "", "data-action": "set-partner-portal-preview-tab", "data-tab": value }, label))
        ),
        content
      );
    }
    productsTab(p, portal) {
      const rows = portal.needs ?? [];
      const body = h("tbody");
      for (const n of rows) {
        const orders = h("td");
        (n.orders ?? []).slice(0, 4).forEach((o, i) => {
          if (i > 0) orders.appendChild(h("br"));
          orders.append(`${o.orderId} (${o.remainingQty})`);
        });
        body.appendChild(h(
          "tr",
          null,
          h("td", null, h("strong", null, n.productCode), h("div", { class: "subtle" }, `size ${n.size}`)),
          h("td", null, n.productName),
          h("td", null, String(n.requiredQty)),
          h("td", null, String(n.purchasedQty)),
          h("td", null, String(n.missingQty)),
          orders,
          h("td", null, h("button", {
            class: "secondary-button compact-button",
            type: "button",
            "data-action": "prefill-partner-purchase",
            "data-partner-id": p.ma,
            "data-product-code": n.productCode,
            "data-size": n.size,
            "data-missing-qty": String(n.missingQty),
            "data-unit-cost": n.unitCost > 0 ? String(n.unitCost) : ""
          }, "Nhập đã mua"))
        ));
      }
      if (rows.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "7", class: "subtle" }, "Chưa có sản phẩm cần mua.")));
      const head = h("thead", null, h("tr", null, ...["Mã / size", "Tên sản phẩm", "Cần", "Đã mua", "Còn thiếu", "Đơn ưu tiên", ""].map((t) => h("th", null, t))));
      const input = (id, label, attrs = {}) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, ...attrs }));
      const form = h(
        "div",
        { class: "config-form omi-section-gap" },
        h(
          "div",
          { class: "grid three" },
          h("div", { class: "field" }, h("label", null, "Đối tác xác nhận"), h("div", { class: "copy-box" }, p.ten || p.ma)),
          input("dtPurchaseProductCode", "Mã sản phẩm"),
          input("dtPurchaseSize", "Size"),
          input("dtPurchaseQty", "Số lượng thực tế mua được", { value: "1", inputmode: "numeric" }),
          input("dtPurchaseCost", "Giá mua thực tế / sản phẩm", { inputmode: "numeric" }),
          input("dtPurchaseNote", "Ghi chú"),
          h("div", { class: "field" }, h("label", null, " "), h("button", { class: "primary-button", type: "button", "data-action": "confirm-partner-purchase" }, "Xác nhận phiên mua"))
        ),
        h("span", { class: "status-line", id: "dtPurchaseStatus" })
      );
      return h("div", null, form, h("div", { class: "table-wrap omi-section-gap" }, h("table", null, head, body)));
    }
    ordersTab(portal) {
      const rows = portal.orders ?? [];
      return h("div", { class: "table-wrap omi-section-gap" }, h(
        "table",
        null,
        h("thead", null, h("tr", null, ...["Mã đơn", "Khách", "Sản phẩm", "Đã mua / cần", "Đóng gói", "Ngày", ""].map((t) => h("th", null, t)))),
        h("tbody", null, ...rows.length === 0 ? [h("tr", null, h("td", { colspan: "7", class: "subtle" }, "Chưa có đơn liên quan."))] : rows.map((o) => h(
          "tr",
          null,
          h("td", null, h("strong", null, o.orderId)),
          h("td", null, o.customerName || "Khách chưa lưu"),
          h("td", null, `${o.productCode} · size ${o.size} · SL ${o.quantity}`),
          h("td", null, `${o.purchasedQty} / ${o.quantity}`),
          h("td", null, str(o.packingStatusLabel) || "—"),
          h("td", null, dayClock(o.createdAt)),
          h("td", null, h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-managed-order", "data-order-id": o.orderId }, "Sửa đơn"))
        )))
      ));
    }
    paymentsTab(portal) {
      const s = portal.summary ?? {};
      const card = (label, value, hint) => h("section", { class: "panel metric" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "hint" }, hint));
      const overpaid = Math.max(0, (s.paidAmount ?? 0) - (s.feeAmount ?? 0) - (s.adjustmentAmount ?? 0));
      const history2 = (rows, empty) => h("tbody", null, ...rows.length === 0 ? [h("tr", null, h("td", { colspan: "3" }, empty))] : rows.map((x) => h("tr", null, h("td", null, dayClock(x.createdAt)), h("td", null, money(x.amount)), h("td", null, x.note))));
      const period = this.ledgers.get(this.selected);
      const row = period?.doiTac?.[0];
      const periodDue = row === void 0 ? "—" : row.traDu > 0 ? `Trả dư ${money(row.traDu)}` : money(row.conNo);
      const paymentRows = period?.thanhToan ?? [];
      const historyBody = h("tbody", { id: "doi-tac-lich-su-ck" }, ...paymentRows.length === 0 ? [h("tr", null, h("td", { colspan: "6" }, period === void 0 ? "Đang tải lịch sử trong kỳ…" : "Chưa có lịch sử thanh toán trong kỳ này."))] : paymentRows.map((x) => {
        const voided = str(x.huyLuc) !== "";
        const tr = h(
          "tr",
          null,
          h("td", null, dayClock(x.taoLuc), voided ? h("div", null, h("span", { class: "badge red" }, "Đã hoàn tác")) : null),
          h("td", null, voided ? h("s", null, money(x.soTien)) : money(x.soTien)),
          h("td", null, "CK"),
          h("td", null, str(x.boi) || "admin"),
          h("td", null, voided ? `${x.ghiChu}${x.lyDoHuy ? ` (hoàn tác: ${x.lyDoHuy})` : ""}` : x.ghiChu),
          h("td", null, voided ? "—" : h(
            "span",
            { class: "split-actions" },
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-partner-fee-payment", "data-payment-id": x.ma }, "Sửa"),
            h("button", { class: "danger-button compact-button", type: "button", "data-action": "void-partner-fee-payment", "data-payment-id": x.ma }, "Hoàn tác")
          ))
        );
        if (voided) tr.className = "is-voided";
        return tr;
      }));
      return h(
        "div",
        null,
        this.payrollPanel(),
        h(
          "div",
          { class: "grid four omi-section-gap" },
          card("Tiền công trong kỳ", money(row?.tienCong ?? 0), `${row?.phienMua ?? 0} phiên · ${row?.soMon ?? 0} SP · ${row?.soDon ?? 0} đơn`),
          card("Chi phí phát sinh trong kỳ", money(row?.chiPhiThem ?? 0), "Khoản cộng thêm"),
          card("Đã CK trong kỳ", money(row?.daChuyen ?? 0), "Không tính khoản đã hoàn tác"),
          card("Còn nợ trong kỳ", periodDue, rangeLabel(this.payrollRange(), "Toàn bộ lịch sử"))
        ),
        h("h4", { class: "omi-section-gap" }, "Lịch sử CK thanh toán trong kỳ"),
        h("div", { class: "table-wrap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Thời gian", "Số tiền", "Phương thức", "Người xác nhận", "Ghi chú", "Thao tác"].map((t) => h("th", null, t)))),
          historyBody
        )),
        h("h4", { class: "omi-section-gap" }, "Toàn bộ lịch sử"),
        h(
          "div",
          { class: "grid four omi-section-gap" },
          card("Tiền công", money(s.feeAmount ?? 0), "Theo phiên mua/đơn xử lý"),
          card("Chi phí phát sinh", money(s.adjustmentAmount ?? 0), "Khoản cộng thêm vào công nợ"),
          card("Đã CK", money(s.paidAmount ?? 0), "Số tiền thực tế đã chuyển"),
          card("Còn nợ", overpaid > 0 ? `Trả dư ${money(overpaid)}` : money(s.debtAmount ?? 0), "Tiền công + chi phí − đã CK")
        ),
        h(
          "div",
          { class: "split-actions omi-actions-top" },
          h("input", { id: "partnerFeePaymentAmount", type: "text", inputmode: "numeric", placeholder: "Số tiền", class: "short" }),
          h("input", { id: "partnerFeePaymentNote", type: "text", placeholder: "Ghi chú (bắt buộc với chi phí phát sinh)" }),
          h("button", { class: "primary-button", type: "button", "data-action": "pay-partner-fee" }, "Ghi CK thanh toán"),
          h("button", { class: "secondary-button", type: "button", "data-action": "add-partner-fee-adjustment" }, "+ Chi phí phát sinh"),
          h("span", { class: "status-line", id: "partnerFeeStatus" })
        ),
        h("h4", { class: "omi-section-gap" }, "Lịch sử CK thanh toán"),
        h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Thời gian"), h("th", null, "Số tiền"), h("th", null, "Ghi chú"))), history2(portal.payments ?? [], "Chưa có lịch sử thanh toán."))),
        h("h4", { class: "omi-section-gap" }, "Chi phí phát sinh"),
        h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Thời gian"), h("th", null, "Số tiền"), h("th", null, "Ghi chú"))), history2(portal.adjustments ?? [], "Chưa có chi phí phát sinh.")))
      );
    }
    // ----- actions -----
    async save() {
      const line = el("dt-trang-thai");
      const value = (id) => el(id).value.trim();
      const p = this.current();
      const code = p?.ma ?? value("dt-ma");
      if (code === "" || value("dt-ten") === "" || value("dt-ma-cong") === "") {
        status(line, "Cần mã, tên, và mã trên link cổng riêng.", "bad");
        return;
      }
      let password = p === null ? el("dt-mat-khau").value : "";
      const login = value("dt-dang-nhap");
      if (p === null && password === "" && login !== "") password = initialPassword();
      if (password !== "" && password.length < 8) {
        status(line, "Mật khẩu đối tác phải dài ít nhất 8 ký tự.", "bad");
        return;
      }
      if (password !== "" && login === "") {
        status(line, "Đặt mật khẩu thì phải có ID đăng nhập.", "bad");
        return;
      }
      status(line, "Đang ghi…");
      const r = await this.ctx.gateway.landing("doi-tac.ghi", {
        ma: code,
        ten: value("dt-ten"),
        maCong: value("dt-ma-cong"),
        dienThoai: value("dt-dien-thoai"),
        bat: p === null ? true : p.trangThai !== "paused",
        dangNhap: login,
        matKhau: password,
        congMoiMon: digits(value("dt-cong-mon")),
        congMoiDon: digits(value("dt-cong-don")),
        cachTinh: el("dt-cach-tinh").value,
        tinh: value("dt-tinh"),
        huyen: value("dt-huyen"),
        xa: value("dt-xa"),
        diaChiChiTiet: value("dt-dia-chi"),
        telegramChatId: value("dt-telegram"),
        email: value("dt-email")
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.selected = code;
      await this.loadPartners();
      if (password !== "") status(el("dt-trang-thai"), `Đã tạo đối tác. Mật khẩu lần đầu: ${password} — chép gửi đối tác ngay, màn này không hiện lại.`, "good");
      else status(el("dt-trang-thai"), "Đã lưu thay đổi.", "good");
    }
    async toggleActive() {
      const p = this.current();
      if (p === null) return;
      const r = await this.ctx.gateway.landing("doi-tac.ghi", {
        ma: p.ma,
        ten: p.ten,
        maCong: p.maCong,
        dienThoai: p.dienThoai,
        dangNhap: str(p.dangNhap),
        bat: p.trangThai === "paused",
        congMoiMon: p.congMoiMon ?? 0,
        congMoiDon: p.congMoiDon ?? 0,
        cachTinh: str(p.cachTinh) || "ca-hai",
        tinh: str(p.tinh),
        huyen: str(p.huyen),
        xa: str(p.xa),
        diaChiChiTiet: str(p.diaChiChiTiet),
        telegramChatId: str(p.telegramChatId),
        email: str(p.email)
      });
      if (!r.ok) {
        status(el("doi-tac-trang-thai"), r.viSao, "bad");
        return;
      }
      await this.loadPartners();
    }
    async resetPassword() {
      const p = this.current();
      const line = el("dt-trang-thai");
      if (p === null) return;
      if (str(p.dangNhap) === "") {
        status(line, "Đối tác chưa có ID đăng nhập — điền ID rồi Lưu trước.", "bad");
        return;
      }
      const password = initialPassword();
      const r = await this.ctx.gateway.landing("doi-tac.ghi", {
        ma: p.ma,
        ten: p.ten,
        maCong: p.maCong,
        dienThoai: p.dienThoai,
        dangNhap: str(p.dangNhap),
        matKhau: password,
        bat: p.trangThai !== "paused",
        congMoiMon: p.congMoiMon ?? 0,
        congMoiDon: p.congMoiDon ?? 0,
        cachTinh: str(p.cachTinh) || "ca-hai",
        tinh: str(p.tinh),
        huyen: str(p.huyen),
        xa: str(p.xa),
        diaChiChiTiet: str(p.diaChiChiTiet),
        telegramChatId: str(p.telegramChatId),
        email: str(p.email)
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Mật khẩu mới: ${password} — chép gửi đối tác ngay, màn này không hiện lại. Phiên cũ của đối tác vẫn còn tới khi hết hạn.`, "good");
    }
    async copyLogin(withAccount) {
      const p = this.current();
      const text2 = withAccount && p ? ["THÔNG TIN ĐĂNG NHẬP ĐỐI TÁC", "", `Trang đăng nhập: ${this.loginPage()}`, `ID đăng nhập: ${str(p.dangNhap) || "(chưa có)"}`, "Mật khẩu: shop gửi riêng."].join("\n") : this.loginPage();
      const line = document.getElementById("dt-trang-thai") ?? el("doi-tac-trang-thai");
      try {
        await navigator.clipboard.writeText(text2);
        status(line, withAccount ? "Đã copy thông tin đăng nhập đối tác." : "Đã copy link đăng nhập.", "good");
      } catch {
        status(line, "Máy không cho chép vào bộ nhớ tạm.", "bad");
      }
    }
    async money(kind) {
      const p = this.current();
      const line = el("partnerFeeStatus");
      if (p === null) return;
      const amount = digits(el("partnerFeePaymentAmount").value);
      const note = el("partnerFeePaymentNote").value.trim();
      if (amount <= 0) {
        status(line, "Số tiền chỉ gõ chữ số, ví dụ 3220000 hoặc 3.220.000.", "bad");
        return;
      }
      if (kind === "phat_sinh" && note === "") {
        status(line, "Chi phí phát sinh phải ghi là khoản gì.", "bad");
        return;
      }
      status(line, "Đang ghi…");
      const r = await this.ctx.gateway.landing("mua-ho.tien", { doiTac: p.ma, soTien: amount, loai: kind, ghiChu: note });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.ensurePortal(true);
      status(el("partnerFeeStatus"), kind === "tra" ? `Đã ghi CK ${money(amount)}.` : `Đã cộng chi phí phát sinh ${money(amount)}.`, "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/products/catalog-kit.ts
  var KIND_OPTIONS2 = [
    ["", "Chưa chọn"],
    ["shoe", "Giày"],
    ["apparel", "Quần áo"],
    ["accessory", "Phụ kiện"],
    ["bag", "Balo / túi"],
    ["hat", "Mũ"],
    ["sock", "Tất"],
    ["other", "Khác"]
  ];
  function kindLabel(value) {
    const v = String(value || "").trim().toLowerCase();
    if (["shoe", "shoes", "footwear", "giày", "giay"].includes(v)) return "Giày";
    if (["apparel", "clothing", "quần áo", "quan ao"].includes(v)) return "Quần áo";
    if (["accessory", "accessories", "hardware", "phụ kiện", "phu kien"].includes(v)) return "Phụ kiện";
    if (["bag", "balo", "túi", "tui"].includes(v)) return "Balo / túi";
    if (["hat", "cap", "mũ", "mu"].includes(v)) return "Mũ";
    if (["sock", "socks", "tất", "tat"].includes(v)) return "Tất";
    return value || "Chưa phân loại";
  }
  function kindSelect(selected, attrs) {
    const options2 = KIND_OPTIONS2.some(([v]) => v === selected) ? KIND_OPTIONS2 : [...KIND_OPTIONS2, [selected, kindLabel(selected)]];
    return h("select", attrs, ...options2.map(([value, label]) => h("option", { value, ...value === selected ? { selected: true } : {} }, label)));
  }
  function priceStatusText(mode, manual) {
    if (mode === "source_higher_than_manual") return "Nguồn cao hơn";
    if (manual > 0) return "Giá tay";
    return "Theo nguồn";
  }
  function isInternalImage(url) {
    const u = String(url || "").trim().toLowerCase();
    if (!u) return true;
    if (/\/assets\/thumbnails\//.test(u) || /^assets\/thumbnails\//.test(u)) return true;
    return /(^|[_/-])(thumb|thumbnail|compare|source-thumb|original-thumb)([_./-]|$)/i.test(u);
  }
  function galleryOf(p) {
    return [...new Set([p.thumbnailImage, p.highImage, ...p.galleryImages ?? []].map((u) => String(u ?? "").trim()).filter((u) => u !== "" && !isInternalImage(u)))];
  }
  function imageSrc(url, landingBase) {
    const u = String(url || "").trim();
    if (u === "" || /^(https?:|data:)/i.test(u)) return u;
    return landingBase === "" ? "" : `${landingBase.replace(/\/+$/, "")}/${u.replace(/^\/+/, "")}`;
  }
  function sizeKindMismatch(kind, sizes) {
    const k = String(kind || "").toLowerCase();
    const labels = sizes.map((s) => String(s || "").trim()).filter(Boolean);
    const shoe = labels.some((s) => /^\d{2,3}(?:\s?(?:1\/3|2\/3)|[.,]5)?$/.test(s));
    const apparel = labels.some((s) => /^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|A\/|A-|\d{2}")/i.test(s));
    if (["shoe", "footwear", "giày", "giay"].includes(k)) return apparel && !shoe;
    if (["apparel", "quần áo", "quan ao", "clothing"].includes(k)) return shoe && !apparel;
    return false;
  }
  function issuesOf(p) {
    const issues = [];
    const kind = String(p.loai ?? "").trim();
    const sizes = (p.size ?? []).filter((s) => Number(s.ton) > 0);
    if (!String(p.hang ?? "").trim()) issues.push({ key: "missingBrand", label: "Thiếu hãng", color: "amber" });
    if (!kind) issues.push({ key: "missingKind", label: "Thiếu loại", color: "amber" });
    if (!Number(p.soAnh ?? 0)) issues.push({ key: "missingImage", label: "Thiếu ảnh", color: "amber" });
    if (sizes.length === 0) issues.push({ key: "missingSize", label: "Không có size", color: "red" });
    if (Number(p.giaNiemYet) > 0 && Number(p.gia) > Number(p.giaNiemYet)) issues.push({ key: "invalidPrice", label: "Giá sale > niêm yết", color: "red" });
    if (kind && sizes.length && sizeKindMismatch(kind, sizes.map((s) => s.size))) issues.push({ key: "sizeKindMismatch", label: "Loại/size lệch", color: "amber" });
    return issues;
  }
  var ISSUE_OPTIONS = [
    ["all", "Tất cả cảnh báo"],
    ["missingBrand", "Thiếu hãng"],
    ["missingKind", "Thiếu loại sản phẩm"],
    ["missingImage", "Thiếu ảnh"],
    ["missingSize", "Không có size"],
    ["invalidPrice", "Giá sale > giá niêm yết"],
    ["sizeKindMismatch", "Loại sản phẩm không khớp size"]
  ];
  function searchText(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function slugText(value) {
    return searchText(value).replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function productThumb(url, code) {
    return url ? h("img", { class: "product-thumb", src: url, alt: "" }) : h("span", { class: "product-thumb placeholder" }, code || "SP");
  }

  // ../omi/packages/omi-ui/src/views/products/web-content.ts
  var lines = (value) => Array.isArray(value) ? value.map(String).join("\n") : String(value ?? "");
  var splitLines = (value) => value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  var text = (x) => x === void 0 || x === null ? "" : String(x);
  function stripFence(raw) {
    return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  function normaliseSeoText(value) {
    return String(value || "").replace(/\r/g, "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function lineId(value) {
    return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function seoHeadingKey(title) {
    const t = lineId(String(title || "").replace(/^#+\s*/, "").replace(/[:：]+$/, ""));
    const rules = [
      ["seoTitle", ["tieu-de-seo", "seo-title"]],
      ["metaDescription", ["meta-description", "mo-ta-seo"]],
      ["quickSummary", ["tom-tat-nhanh", "tom-tat-san-pham", "quick-summary"]],
      ["overview", ["tong-quan", "overview"]],
      ["design", ["thiet-ke", "design"]],
      ["technology", ["cong-nghe", "technology", "cau-truc"]],
      ["realExperience", ["trai-nghiem-thuc-te", "cam-giac-chay", "ride"]],
      ["paceReview", ["danh-gia-theo-pace", "pace"]],
      ["distanceReview", ["danh-gia-theo-cu-ly", "cu-ly", "distance"]],
      ["weightReview", ["danh-gia-theo-can-nang", "can-nang", "weight"]],
      ["levelReview", ["danh-gia-theo-trinh-do", "trinh-do", "level"]],
      ["pros", ["uu-diem", "diem-manh", "pros"]],
      ["cons", ["nhuoc-diem", "diem-yeu", "cons"]],
      ["competitors", ["so-sanh-doi-thu", "doi-thu", "comparison"]],
      ["shouldBuy", ["ai-nen-mua", "nen-mua"]],
      ["shouldNotBuy", ["ai-khong-nen-mua", "khong-nen-mua"]],
      ["finalVerdict", ["ket-luan-cuoi-bai", "final-verdict"]],
      ["conclusion", ["ket-luan"]],
      ["faq", ["faq", "cau-hoi-thuong-gap", "hoi-dap"]]
    ];
    return rules.find(([, needles]) => needles.some((n) => t === n || t.includes(n)))?.[0] ?? "";
  }
  function parseSeoArticle(source, product) {
    const cleaned = normaliseSeoText(source);
    const blocks = [];
    let current = { title: "Tổng quan", body: [] };
    for (const raw of cleaned.split("\n")) {
      const line = raw.trim();
      if (line === "") {
        current.body.push("");
        continue;
      }
      if (seoHeadingKey(line) && line.length < 80) {
        if (current.body.join("\n").trim()) blocks.push({ title: current.title, body: current.body.join("\n").trim() });
        current = { title: line.replace(/^#+\s*/, ""), body: [] };
      } else current.body.push(line);
    }
    if (current.body.join("\n").trim()) blocks.push({ title: current.title, body: current.body.join("\n").trim() });
    const map = /* @__PURE__ */ new Map();
    for (const b of blocks) {
      const key = seoHeadingKey(b.title);
      if (key) map.set(key, [map.get(key), b.body].filter(Boolean).join("\n\n").trim());
    }
    const paragraphs = cleaned.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    const first = (...values) => values.map((v) => String(v ?? "").trim()).find(Boolean) ?? "";
    const titles = [
      ["overview", "Tổng quan"],
      ["design", "Thiết kế"],
      ["technology", "Công nghệ"],
      ["realExperience", "Trải nghiệm thực tế"],
      ["paceReview", "Đánh giá theo pace"],
      ["distanceReview", "Đánh giá theo cự ly"],
      ["weightReview", "Đánh giá theo cân nặng"],
      ["levelReview", "Đánh giá theo trình độ"],
      ["pros", "Ưu điểm"],
      ["cons", "Nhược điểm"],
      ["competitors", "So sánh đối thủ"],
      ["shouldBuy", "Ai nên mua?"],
      ["shouldNotBuy", "Ai không nên mua?"],
      ["conclusion", "Kết luận"]
    ];
    const faq = [];
    let pending = "";
    for (const raw of normaliseSeoText(map.get("faq") ?? cleaned).split("\n")) {
      const line = raw.trim().replace(/^[-*•\d.)\s]+/, "").trim();
      if (!line) continue;
      const qa = line.match(/^(.+\?)\s*(?:-|:|–)\s*(.+)$/);
      if (qa) {
        faq.push({ question: qa[1].trim(), answer: qa[2].trim() });
        pending = "";
        continue;
      }
      if (line.includes("?")) {
        pending = line;
        continue;
      }
      if (pending && line.length > 8) {
        faq.push({ question: pending, answer: line });
        pending = "";
      }
    }
    return {
      seoTitle: first(map.get("seoTitle"), `${product.name || "sản phẩm"}: đánh giá chi tiết, thông số và gợi ý chọn mua`).slice(0, 180),
      metaDescription: first(map.get("metaDescription"), paragraphs.find((p) => p.length >= 80)).slice(0, 320),
      quickSummary: first(map.get("quickSummary"), paragraphs.slice(0, 2).join("\n\n")),
      sections: titles.map(([key, title]) => ({ key, title, body: map.get(key) ?? "" })).filter((s) => s.body),
      faq: faq.slice(0, 20),
      source: { type: "manual_import", productCode: product.code, parsedAt: (/* @__PURE__ */ new Date()).toISOString() }
    };
  }
  function listLike(value) {
    const out = String(value || "").split(/\n|[•]/).map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter((l) => l.length >= 4);
    return out.length ? out.join("\n") : String(value || "").trim();
  }
  function externalAiPrompt(p) {
    return `Bạn là trợ lý nghiên cứu thông tin sản phẩm giày/thể thao cho website bán hàng.

Nhiệm vụ:
Tìm thông tin chắc chắn về sản phẩm bên dưới, ưu tiên nguồn chính thức hoặc trang bán hàng đang cung cấp dữ liệu. Không bịa thông tin. Nếu không chắc, để mảng/trường đó rỗng hoặc ghi rõ "chưa xác minh" trong reviewNotes/missingInfo.

Sản phẩm:
- Tên sản phẩm: ${p.name}
- Mã sản phẩm/SKU: ${p.code}
- Brand: ${p.brand}
- Category hiện có: ${p.category}
- Gender: ${p.gender}
- Giá: ${p.price || ""}
- Nguồn hàng: ${p.sourceName}
- Dòng sản phẩm hiện có nếu có: ${p.line}

Yêu cầu nghiên cứu:
1. Xác định dòng sản phẩm chung, ví dụ: Nike Rival Fly 4, Adidas Ultraboost Light, ASICS Novablast 4.
2. Tách thông tin dùng chung cho cả dòng sản phẩm khỏi thông tin riêng của mã/màu này.
3. Chỉ ghi công nghệ/tính năng nếu tìm được nguồn đáng tin.
4. Không tự thêm thông số kỹ thuật như drop, trọng lượng, carbon plate, loại foam nếu không có nguồn.
5. Nếu thông tin chỉ suy luận từ tên sản phẩm, đưa vào "reviewNotes", không đưa vào phần chắc chắn.
6. Viết tiếng Việt rõ ràng, ngắn gọn, phù hợp website bán hàng.

Hãy trả về DUY NHẤT một JSON hợp lệ, không markdown, không giải thích ngoài JSON.

Schema bắt buộc:
{
  "confidence": "high | medium | low",
  "sources": [{ "title": "", "url": "", "usedFor": "" }],
  "productLine": {
    "name": "", "brand": "",
    "family": "running | tennis | pickleball | trail | accessory | lifestyle | other",
    "intent": "daily | tempo | race | stability | court | walking | lifestyle | accessory | general",
    "matchKeywords": [], "intro": "", "features": [], "technologies": [], "bestFor": [], "notFor": [],
    "fitGuide": "", "sizeNote": "", "careNote": ""
  },
  "productSpecific": { "mode": "append", "intro": "", "features": [], "notes": [], "sizeNote": "" },
  "reviewNotes": [],
  "missingInfo": []
}

Quy tắc điền:
- productLine: chỉ chứa thông tin dùng chung cho cả dòng sản phẩm.
- productSpecific: chỉ chứa thông tin riêng cho mã/màu/phiên bản đang nghiên cứu.
- matchKeywords: gồm tên dòng, mã model, các từ khóa giúp nhận diện sản phẩm cùng dòng.
- features: mỗi ý là một câu ngắn.
- technologies: chỉ liệt kê công nghệ có nguồn xác minh.
- bestFor: nhóm khách/mục đích phù hợp.
- notFor: trường hợp nên tư vấn dòng khác.
- fitGuide: mô tả form chung nếu có nguồn; nếu không chắc, để rỗng.
- sizeNote: khuyến nghị chọn size; nếu không có nguồn, chỉ ghi khuyến nghị an toàn chung.
- reviewNotes: ghi các điểm cần người thật kiểm tra lại.`;
  }
  var WebContentForm = class {
    constructor(current) {
      this.current = current;
      const area = (id, label, rows, placeholder = "") => {
        const node = h("textarea", { id, rows: String(rows), ...placeholder ? { placeholder } : {} });
        this.areas.set(id, node);
        return h("div", { class: "field" }, h("label", { for: id }, label), node);
      };
      this.lineName = h("input", { id: "webProductLineName", placeholder: "VD: Nike Rival Fly 4" });
      this.overrideMode = h("select", { id: "webOverrideMode" }, h("option", { value: "append" }, "Bổ sung vào mô tả dòng"), h("option", { value: "replace" }, "Thay thế mô tả dòng"));
      this.statusLine = h("span", { class: "status-line", id: "hs-web-trang-thai" });
      const aiBlock = h(
        "details",
        { class: "nested-panel omi-section-gap", open: true },
        h("summary", null, "AI ngoài thủ công ", h("span", { class: "badge amber" }, "Không gọi API")),
        h(
          "div",
          { class: "grid two omi-section-gap" },
          h(
            "div",
            { class: "config-form" },
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "secondary-button", type: "button", "data-action": "generate-external-ai-prompt" }, "Tạo prompt"),
              h("button", { class: "ghost-button", type: "button", "data-action": "clear-external-ai-helper" }, "Làm mới")
            ),
            area("externalAIPrompt", "Prompt đưa cho AI ngoài", 14, "Bấm Tạo prompt để sinh nội dung...")
          ),
          h(
            "div",
            { class: "config-form" },
            h("div", { class: "split-actions" }, h("button", { class: "primary-button", type: "button", "data-action": "apply-external-ai-json" }, "Nhận diện & điền vào form")),
            area("externalAIResult", "Dán JSON kết quả", 14, '{"confidence":"medium","productLine":{...}}'),
            h("p", { class: "subtle" }, "Khuyến nghị: chỉ lưu các trường có nguồn chắc. Nếu AI ghi “chưa xác minh”, giữ trong ghi chú hoặc để trống.")
          )
        )
      );
      const seoBlock = h(
        "details",
        { class: "nested-panel omi-section-gap", open: true },
        h("summary", null, "Import bài SEO mẫu ", h("span", { class: "badge green" }, "Không gọi API")),
        h(
          "div",
          { class: "grid two omi-section-gap" },
          h(
            "div",
            { class: "config-form" },
            area("seoArticleSourceText", "Dán bài mẫu chuẩn SEO", 12, "Dán bài mẫu chuẩn SEO vào đây..."),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "primary-button", type: "button", "data-action": "parse-seo-article-template" }, "Tự chia vào cấu trúc Bước 14"),
              h("button", { class: "secondary-button", type: "button", "data-action": "clear-seo-article-template" }, "Xóa bài mẫu")
            )
          ),
          h(
            "div",
            { class: "config-form" },
            area("webSeoArticleJSON", "Bài SEO đã nhận diện", 16),
            h("p", { class: "subtle" }, "Có thể sửa JSON nếu cần. Bấm Lưu nội dung web để lưu cùng mã này.")
          )
        )
      );
      const lineBlock = h(
        "div",
        { class: "config-form" },
        h("h4", null, "Mô tả chung của dòng"),
        area("webLineIntro", "Giới thiệu", 4),
        area("webLineFeatures", "Tính năng nổi bật", 4, "Mỗi dòng một ý"),
        area("webLineTechnologies", "Công nghệ / cấu trúc", 4, "Mỗi dòng một ý"),
        area("webLineBestFor", "Phù hợp với", 3),
        area("webLineNotFor", "Không nên ưu tiên nếu", 3),
        area("webLineFitGuide", "Hướng dẫn fit", 3),
        area("webLineSizeNote", "Ghi chú size chung", 2)
      );
      const ownBlock = h(
        "div",
        { class: "config-form" },
        h("h4", null, "Mô tả riêng của mã này"),
        h("div", { class: "field" }, h("label", { for: "webOverrideMode" }, "Cách dùng"), this.overrideMode),
        area("webOverrideIntro", "Giới thiệu riêng", 4),
        area("webOverrideFeatures", "Điểm riêng", 3, "Mỗi dòng một ý"),
        area("webOverrideNotes", "Ghi chú kiểm tra", 3, "Mỗi dòng một ý"),
        area("webOverrideSizeNote", "Ghi chú size riêng", 2)
      );
      this.root = h(
        "section",
        { class: "nested-panel omi-section-gap", id: "hs-noi-dung-web" },
        h(
          "div",
          { class: "panel-header compact" },
          h(
            "div",
            null,
            h("h3", null, "Nội dung website cho sản phẩm"),
            h("p", null, "Mô tả dòng sản phẩm và mô tả riêng hiện dưới trang sản phẩm. SEO title / description / từ khoá ở khung trên.")
          ),
          h(
            "div",
            { class: "split-actions" },
            h("button", { class: "secondary-button", type: "button", "data-action": "cache-product-images", "data-cache-scope": "selected" }, "Tải gallery ảnh sản phẩm này"),
            h("button", { class: "primary-button", type: "button", "data-action": "save-product-web-fields" }, "Lưu nội dung web")
          )
        ),
        h(
          "div",
          { class: "grid two" },
          h("div", { class: "field" }, h("label", { for: "webProductLineName" }, "Tên dòng sản phẩm"), this.lineName),
          area("webLineKeywords", "Từ khóa nhận diện cùng dòng", 2, "Mỗi dòng một từ khóa")
        ),
        this.statusLine,
        aiBlock,
        seoBlock,
        h("div", { class: "grid two omi-section-gap" }, lineBlock, ownBlock)
      );
    }
    current;
    root;
    areas = /* @__PURE__ */ new Map();
    lineName;
    overrideMode;
    statusLine;
    area(id) {
      return this.areas.get(id);
    }
    set(id, value) {
      const v = lines(value);
      if (v !== "") this.area(id).value = v;
    }
    /** Fills from the saved `webContent` of a product (empty product = empty form). */
    fill(p) {
      const c = p.webContent ?? {};
      const own = c["rieng"] ?? {};
      for (const node of this.areas.values()) node.value = "";
      this.lineName.value = text(c["dongSanPham"]);
      this.area("webLineKeywords").value = lines(c["tuKhoaDong"]);
      this.area("webLineIntro").value = text(c["gioiThieu"]);
      this.area("webLineFeatures").value = lines(c["tinhNang"]);
      this.area("webLineTechnologies").value = lines(c["congNghe"]);
      this.area("webLineBestFor").value = lines(c["phuHopVoi"]);
      this.area("webLineNotFor").value = lines(c["khongNenNeu"]);
      this.area("webLineFitGuide").value = text(c["huongDanFit"]);
      this.area("webLineSizeNote").value = text(c["ghiChuSize"]);
      this.overrideMode.value = own["cheDo"] === "replace" ? "replace" : "append";
      this.area("webOverrideIntro").value = text(own["gioiThieu"]);
      this.area("webOverrideFeatures").value = lines(own["tinhNang"]);
      this.area("webOverrideNotes").value = lines(own["ghiChu"]);
      this.area("webOverrideSizeNote").value = text(own["ghiChuSize"]);
      this.area("webSeoArticleJSON").value = c["baiSeo"] ? JSON.stringify(c["baiSeo"], null, 2) : "";
      status(this.statusLine, "");
    }
    /** The content object `hang.noi-dung-web` sends. Throws on unreadable SEO JSON. */
    read() {
      const raw = this.area("webSeoArticleJSON").value.trim();
      let baiSeo = null;
      if (raw !== "") {
        try {
          baiSeo = JSON.parse(stripFence(raw));
        } catch (e) {
          throw new Error(`JSON bài SEO không hợp lệ: ${e.message}`);
        }
      }
      return {
        dongSanPham: this.lineName.value.trim(),
        tuKhoaDong: splitLines(this.area("webLineKeywords").value),
        gioiThieu: this.area("webLineIntro").value.trim(),
        tinhNang: splitLines(this.area("webLineFeatures").value),
        congNghe: splitLines(this.area("webLineTechnologies").value),
        phuHopVoi: splitLines(this.area("webLineBestFor").value),
        khongNenNeu: splitLines(this.area("webLineNotFor").value),
        huongDanFit: this.area("webLineFitGuide").value.trim(),
        ghiChuSize: this.area("webLineSizeNote").value.trim(),
        rieng: {
          cheDo: this.overrideMode.value,
          gioiThieu: this.area("webOverrideIntro").value.trim(),
          tinhNang: splitLines(this.area("webOverrideFeatures").value),
          ghiChu: splitLines(this.area("webOverrideNotes").value),
          ghiChuSize: this.area("webOverrideSizeNote").value.trim()
        },
        ...baiSeo === null ? {} : { baiSeo }
      };
    }
    say(message, tone = "") {
      status(this.statusLine, message, tone);
    }
    actions = {
      "generate-external-ai-prompt": () => {
        const p = this.current();
        this.area("externalAIPrompt").value = externalAiPrompt({
          code: p.code,
          name: p.name,
          brand: p.brand,
          category: text(p.category),
          gender: text(p.gender),
          price: Number(p.price ?? 0),
          sourceName: text(p.sourceName),
          line: this.lineName.value.trim()
        });
        this.say("Đã tạo prompt. Copy sang AI ngoài rồi dán JSON kết quả vào ô bên phải.", "good");
      },
      "clear-external-ai-helper": () => {
        this.area("externalAIPrompt").value = "";
        this.area("externalAIResult").value = "";
        this.say("");
      },
      "apply-external-ai-json": () => {
        const raw = this.area("externalAIResult").value.trim();
        if (raw === "") {
          this.say("Chưa dán JSON kết quả AI ngoài.", "bad");
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stripFence(raw));
        } catch (e) {
          this.say(`JSON không hợp lệ: ${e.message}`, "bad");
          return;
        }
        const line = parsed["productLine"] ?? {};
        const own = parsed["productSpecific"] ?? {};
        if (text(line["name"])) this.lineName.value = text(line["name"]);
        this.set("webLineKeywords", line["matchKeywords"]);
        this.set("webLineIntro", line["intro"]);
        this.set("webLineFeatures", line["features"]);
        this.set("webLineTechnologies", line["technologies"]);
        this.set("webLineBestFor", line["bestFor"]);
        this.set("webLineNotFor", line["notFor"]);
        this.set("webLineFitGuide", line["fitGuide"]);
        this.set("webLineSizeNote", line["sizeNote"]);
        this.overrideMode.value = own["mode"] === "replace" ? "replace" : "append";
        this.set("webOverrideIntro", own["intro"]);
        this.set("webOverrideFeatures", own["features"]);
        const notes = [...Array.isArray(own["notes"]) ? own["notes"] : [], ...Array.isArray(parsed["reviewNotes"]) ? parsed["reviewNotes"] : []];
        this.set("webOverrideNotes", notes.filter(Boolean));
        this.set("webOverrideSizeNote", own["sizeNote"]);
        this.say(`Đã điền nháp từ JSON AI ngoài. Confidence: ${text(parsed["confidence"]) || "chưa ghi"}. Hãy kiểm tra trước khi lưu.`, "good");
      },
      "parse-seo-article-template": () => {
        const source = this.area("seoArticleSourceText").value.trim();
        if (source === "") {
          this.say("Chưa có bài mẫu để phân tích.", "bad");
          return;
        }
        const p = this.current();
        const article = parseSeoArticle(source, { code: p.code, name: this.lineName.value.trim() || p.name });
        this.area("webSeoArticleJSON").value = JSON.stringify(article, null, 2);
        const section = (key) => article.sections.find((s) => s.key === key)?.body ?? "";
        if (article.quickSummary) {
          this.area("webLineIntro").value = article.quickSummary;
          this.area("webOverrideIntro").value = article.quickSummary;
        }
        if (section("technology")) this.area("webLineTechnologies").value = listLike(section("technology"));
        if (section("pros")) this.area("webLineFeatures").value = listLike(section("pros"));
        if (section("shouldBuy")) this.area("webLineBestFor").value = listLike(section("shouldBuy"));
        if (section("shouldNotBuy")) this.area("webLineNotFor").value = listLike(section("shouldNotBuy"));
        this.say(`Đã chia bài SEO: ${article.sections.length} mục, ${article.faq.length} FAQ. Kiểm tra rồi bấm Lưu nội dung web.`, "good");
      },
      "clear-seo-article-template": () => {
        this.area("seoArticleSourceText").value = "";
        this.area("webSeoArticleJSON").value = "";
        this.say("Đã xóa bài mẫu SEO khỏi form.", "good");
      }
    };
    /** The SEO title / description the parsed article suggests (the editor fills its SEO boxes when empty). */
    suggestedSeo() {
      try {
        const a = JSON.parse(this.area("webSeoArticleJSON").value || "{}");
        return { title: text(a.seoTitle), description: text(a.metaDescription) };
      } catch {
        return { title: "", description: "" };
      }
    }
  };

  // ../omi/packages/omi-ui/src/views/products/product-editor.ts
  var seq = 0;
  var nextId = (prefix) => `${prefix}_${Date.now()}_${seq += 1}`;
  var ProductEditor = class {
    constructor(host) {
      this.host = host;
      this.root = this.build();
    }
    host;
    web = new WebContentForm(() => this.current());
    root;
    loaded = null;
    variants = [];
    images = [];
    dragFrom = -1;
    deleteArmedUntil = 0;
    input(id, label, placeholder = "") {
      return h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, ...placeholder ? { placeholder } : {}, oninput: () => this.drawReview() }));
    }
    build() {
      const statusSelect = h(
        "select",
        { id: "hs-trang-thai", onchange: () => this.drawReview() },
        h("option", { value: "orderable" }, "Đang bán"),
        h("option", { value: "hidden" }, "Tạm ẩn")
      );
      const kindBox = h("div", { class: "field", id: "hs-loai-o" }, h("label", null, "Loại sản phẩm"), kindSelect("", { id: "hs-loai" }));
      const basics = h(
        "div",
        { class: "grid two" },
        this.input("hs-ma", "Mã sản phẩm", "KJ6158"),
        this.input("hs-ten", "Tên sản phẩm", "Giày chạy Nike Pegasus 40"),
        this.input("hs-hang", "Tên hãng", "adidas, Nike..."),
        kindBox,
        this.input("hs-nguon", "Nguồn hàng"),
        h("div", { class: "field" }, h("label", { for: "hs-trang-thai" }, "Trạng thái"), statusSelect),
        this.input("hs-mon", "Môn thể thao"),
        this.input("hs-nhom-hang", "Nhóm hàng", "Footwear / APPAREL / HARDWARE"),
        this.input("hs-gioi-tinh", "Giới tính"),
        this.input("hs-slug", "Slug trang sản phẩm"),
        this.input("hs-gia-sale", "Giá sale"),
        this.input("hs-gia-niem-yet", "Giá niêm yết", "3500000")
      );
      const variants = h(
        "section",
        { class: "catalog-editor-block" },
        h(
          "div",
          { class: "section-title-row" },
          h("div", null, h("h3", null, "Biến thể sản phẩm"), h("p", { class: "subtle" }, "SKU mặc định theo Mã sản phẩm-Biến thể. Giá mặc định lấy từ sản phẩm nhưng có thể sửa riêng từng dòng.")),
          h("button", { class: "secondary-button", type: "button", "data-action": "add-catalog-variant" }, "Thêm biến thể")
        ),
        h("div", { id: "hs-bien-the" }),
        h("p", { class: "subtle", id: "hs-nguon-khac" }),
        h(
          "details",
          { class: "landing-advanced-data" },
          h("summary", null, "Dán nhanh size (mỗi dòng: size, tồn, giá)"),
          h("textarea", { id: "hs-size", rows: "4", placeholder: "41, 2, 2890000\n42, 3, 2890000", oninput: () => this.variantsFromText() })
        )
      );
      const gallery = h(
        "section",
        { class: "catalog-editor-block landing-image-manager" },
        h(
          "div",
          { class: "section-title-row compact" },
          h("div", null, h("h3", null, "Ảnh sản phẩm"), h("p", { class: "subtle" }, "Kéo thả để đổi thứ tự. Ảnh đầu là ảnh chính/sideview."))
        ),
        h(
          "div",
          { class: "field-inline" },
          h("input", { id: "catalogGalleryLink", placeholder: "Dán link ảnh sản phẩm" }),
          h("button", { class: "secondary-button", type: "button", "data-action": "add-catalog-gallery-link" }, "Thêm link"),
          h(
            "label",
            { class: "secondary-button catalog-upload-label" },
            "Upload ảnh",
            h("input", { id: "landingProductImageUpload", type: "file", accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp", multiple: true, onchange: (e) => void this.addFiles(e) })
          ),
          h("button", { class: "secondary-button", type: "button", id: "nut-hang-tim-anh", onclick: () => void this.findImage() }, "Tìm ảnh trên web")
        ),
        h("div", { id: "landingProductPasteZone", class: "landing-paste-zone", tabindex: "0", onpaste: (e) => void this.paste(e) }, "Paste hoặc chọn file ảnh .jpg, .jpeg, .png, .webp"),
        h("div", { id: "landingGalleryPreview", ondragstart: (e) => this.dragStart(e), ondragover: (e) => e.preventDefault(), ondrop: (e) => this.drop(e) })
      );
      const texts = h(
        "div",
        null,
        this.input("hs-mo-ta", "Mô tả ngắn", "Đệm êm, nhẹ, chạy đường dài"),
        h("div", { class: "field" }, h("label", { for: "hs-gioi-thieu" }, "Giới thiệu sản phẩm"), h("textarea", { id: "hs-gioi-thieu", rows: "5", oninput: () => this.drawReview() })),
        h("div", { class: "grid two" }, this.input("hs-seo-tieu-de", "SEO title"), this.input("hs-seo-mo-ta", "SEO description")),
        this.input("hs-seo-tu-khoa", "SEO keywords", "giày chạy, nike pegasus, pegasus 40"),
        h("div", { class: "field" }, h("label", { for: "hs-chinh-sach" }, "Chính sách / ghi chú"), h("textarea", { id: "hs-chinh-sach", rows: "3" }))
      );
      const review = h(
        "section",
        { class: "panel omi-section-gap" },
        h(
          "div",
          { class: "panel-header" },
          h("div", null, h("h3", null, "Duyệt lên website"), h("p", null, "Luồng an toàn: điền nháp → kiểm tra → lưu nội dung web → bật bán → xem thử storefront. Bước 1 và 6 chưa đạt thì chỉ lưu được ở trạng thái Tạm ẩn.")),
          h("span", { class: "badge blue", id: "hs-duyet-tom-tat" }, "0/6")
        ),
        h("div", { class: "panel-body landing-review-checklist", id: "hs-duyet" })
      );
      const actions = h(
        "div",
        { class: "split-actions omi-section-gap" },
        h("button", { class: "primary-button", type: "button", id: "nut-hang-luu", "data-action": "save-landing-product" }, "Lưu & cập nhật web"),
        h("button", { class: "ghost-button danger", type: "button", id: "nut-hang-xoa", "data-action": "delete-landing-product" }, "Xóa khỏi landing"),
        h("button", { class: "ghost-button", type: "button", "data-action": "cancel-landing-product" }, "Quay lại danh sách"),
        h("span", { class: "status-line", id: "hang-sua-trang-thai" })
      );
      const card = h(
        "div",
        { class: "editor-card landing-product-editor" },
        h(
          "div",
          { class: "section-title-row" },
          h("div", null, h("span", { class: "landing-price-status", id: "hs-che-do-gia" }), h("p", { class: "subtle", id: "hs-canh-bao-gia" })),
          h("button", { class: "ghost-button compact-button", type: "button", id: "nut-hang-ve-gia-nguon", "data-action": "reset-landing-manual-price", hidden: true }, "Dùng lại giá nguồn")
        ),
        basics,
        variants,
        gallery,
        texts,
        review,
        actions
      );
      return h(
        "section",
        { class: "panel", id: "hang-editor", hidden: true },
        h(
          "div",
          { class: "panel-header" },
          h("div", null, h("h3", { id: "hs-tieu-de" }, "Thêm sản phẩm landing"), h("p", null, "Trang riêng để sửa sâu sản phẩm, tách khỏi danh sách catalog.")),
          h("button", { class: "secondary-button", type: "button", "data-action": "cancel-landing-product" }, "Quay lại danh sách")
        ),
        h("div", { class: "panel-body" }, card, this.web.root)
      );
    }
    // ---------------------------------------------------------------- open / fill
    get editingCode() {
      return this.loaded?.code ?? "";
    }
    open(product) {
      this.loaded = product;
      const p = product ?? {};
      const set = (id, value) => {
        el(id).value = str(value);
      };
      set("hs-ma", p.code);
      set("hs-ten", p.name);
      set("hs-hang", p.brand);
      set("hs-nguon", p.sourceName ?? "");
      set("hs-mon", p.category);
      set("hs-nhom-hang", p.division);
      set("hs-gioi-tinh", p.gender);
      set("hs-slug", p.slug);
      set("hs-gia-sale", p.price ? String(p.price) : "");
      set("hs-gia-niem-yet", p.listPrice ? String(p.listPrice) : "");
      set("hs-mo-ta", p.shortDescription);
      set("hs-gioi-thieu", p.description);
      set("hs-seo-tieu-de", p.seoTitle);
      set("hs-seo-mo-ta", p.seoDescription);
      set("hs-seo-tu-khoa", p.seoKeywords);
      set("hs-chinh-sach", p.policy);
      el("hs-trang-thai").value = p.status === "hidden" ? "hidden" : "orderable";
      const kindBox = el("hs-loai-o");
      kindBox.replaceChild(kindSelect(str(p.productKind), { id: "hs-loai" }), el("hs-loai"));
      el("hs-ma").disabled = product !== null;
      el("hs-tieu-de").textContent = product ? `Chi tiết sản phẩm ${product.code}` : "Thêm sản phẩm landing";
      el("nut-hang-xoa").hidden = product === null;
      const own = (p.sizes ?? []).filter((s) => !s.nguon || s.nguon === "own");
      const others = (p.sizes ?? []).filter((s) => s.nguon && s.nguon !== "own");
      this.variants = own.map((s) => ({
        id: nextId("bt"),
        size: s.size,
        sku: str(s.sku),
        qty: String(s.qty ?? 0),
        listPrice: s.listPrice ? String(s.listPrice) : "",
        costPrice: s.costPrice ? String(s.costPrice) : "",
        price: String(s.sourcePrice || s.price || ""),
        warehouseId: str(s.warehouseId)
      }));
      el("hs-nguon-khac").textContent = others.length ? `Hàng nguồn khác (sửa ở Kho hàng sẵn / Kho đối tác): ${others.map((s) => `${s.size} · ${s.nguon} · ${s.qty}`).join("; ")}` : "";
      this.images = galleryOf(p).map((url) => ({ id: nextId("anh"), url, pending: false }));
      const mode = str(p.priceMode) || "source";
      el("hs-che-do-gia").textContent = product ? priceStatusText(mode, Number(p.manualPrice ?? 0)) : "";
      el("hs-che-do-gia").className = `landing-price-status${mode === "source_higher_than_manual" ? " warning" : Number(p.manualPrice ?? 0) > 0 ? " manual" : ""}`;
      el("hs-canh-bao-gia").textContent = product ? [p.sourcePrice ? `Nguồn ${money(p.sourcePrice)}` : "", p.manualPrice ? `Giá tay ${money(p.manualPrice)}` : "", str(p.priceWarning)].filter(Boolean).join(" · ") : "";
      el("nut-hang-ve-gia-nguon").hidden = !(Number(p.manualPrice ?? 0) > 0);
      status(el("hang-sua-trang-thai"), "");
      this.web.fill(product ?? { code: "", name: "", brand: "", listPrice: 0, thumbnailImage: "", shortDescription: "", sizes: [] });
      this.syncText();
      this.drawVariants();
      this.drawGallery();
      this.root.hidden = false;
    }
    /** The product as the form shows it right now (prompt building reads it). */
    current() {
      const value = (id) => el(id).value.trim();
      return {
        code: this.loaded?.code ?? value("hs-ma"),
        name: value("hs-ten"),
        brand: value("hs-hang"),
        listPrice: digits(value("hs-gia-niem-yet")),
        thumbnailImage: this.images[0]?.url ?? "",
        shortDescription: value("hs-mo-ta"),
        sizes: [],
        category: value("hs-mon"),
        gender: value("hs-gioi-tinh"),
        sourceName: value("hs-nguon"),
        price: digits(value("hs-gia-sale"))
      };
    }
    // ---------------------------------------------------------------- variants
    variantsFromText() {
      const sale = digits(el("hs-gia-sale").value);
      this.variants = el("hs-size").value.split("\n").map((d) => d.trim()).filter(Boolean).map((d) => {
        const p = d.split(/[,;\t=|]/).map((x) => x.trim());
        const size2 = p[0] ?? "";
        const old = this.variants.find((v) => v.size === size2);
        return {
          id: old?.id ?? nextId("bt"),
          size: size2,
          sku: old?.sku ?? "",
          qty: String(digits(p[1] ?? "0")),
          listPrice: old?.listPrice ?? "",
          costPrice: old?.costPrice ?? "",
          price: String(digits(p[2] ?? "") || sale || ""),
          warehouseId: old?.warehouseId ?? ""
        };
      });
      this.drawVariants(false);
    }
    syncText() {
      el("hs-size").value = this.variants.map((v) => [v.size, digits(v.qty), digits(v.price)].join(", ")).join("\n");
    }
    drawVariants(syncText = true) {
      const box = el("hs-bien-the");
      clear(box);
      if (this.variants.length === 0) {
        box.appendChild(h("p", { class: "subtle" }, "Chưa có biến thể. Bấm Thêm biến thể để tạo dòng đầu tiên."));
      } else {
        const code = el("hs-ma").value.trim();
        const cell = (v, key, numeric = false) => h("td", null, h("input", {
          value: v[key],
          "data-catalog-variant-id": v.id,
          "data-catalog-variant-field": key,
          ...numeric ? { inputmode: "numeric" } : {},
          ...key === "sku" ? { placeholder: code && v.size ? `${code}-${v.size}` : "" } : {},
          oninput: (e) => {
            v[key] = e.target.value;
            this.syncText();
            this.drawReview();
          }
        }));
        const rows = this.variants.map((v) => h(
          "tr",
          null,
          cell(v, "size"),
          cell(v, "sku"),
          cell(v, "qty", true),
          cell(v, "listPrice", true),
          cell(v, "costPrice", true),
          cell(v, "price", true),
          h("td", null, h("button", { class: "ghost-button compact-button danger", type: "button", "data-action": "remove-catalog-variant", "data-variant-id": v.id }, "Xóa"))
        ));
        const head = h("thead", null, h("tr", null, ...["Tên biến thể", "Mã SKU biến thể", "Số lượng", "Giá niêm yết", "Giá nhập", "Giá bán lẻ", ""].map((t) => h("th", null, t))));
        box.appendChild(h("div", { class: "catalog-variant-table-wrap" }, h("table", { class: "catalog-variant-table" }, head, h("tbody", null, ...rows))));
      }
      if (syncText) this.syncText();
      this.drawReview();
    }
    // ---------------------------------------------------------------- gallery
    drawGallery() {
      const box = el("landingGalleryPreview");
      clear(box);
      const base = this.host.landingBase();
      const cards = this.images.map((image, index) => h(
        "article",
        {
          class: `landing-gallery-card${index === 0 ? " sideview" : ""}`,
          draggable: "true",
          "data-landing-gallery-index": String(index)
        },
        h("img", { src: imageSrc(image.url, base), alt: "" }),
        h("div", { class: "subtle" }, `${index === 0 ? "Ảnh 1 · sideview" : `Ảnh ${index + 1}`}${image.pending ? " · chờ tải lên" : ""}`),
        h(
          "div",
          { class: "split-actions compact-actions" },
          h("button", { class: "ghost-button compact-button", type: "button", "data-action": "move-landing-image", "data-index": String(index), "data-direction": "-1", disabled: index === 0 }, "Lên"),
          h("button", { class: "ghost-button compact-button", type: "button", "data-action": "move-landing-image", "data-index": String(index), "data-direction": "1", disabled: index === this.images.length - 1 }, "Xuống"),
          index === 0 ? h("span", { class: "badge green" }, "Sideview") : h("button", { class: "ghost-button compact-button", type: "button", "data-action": "set-catalog-sideview-image", "data-image-id": image.id }, "Đặt sideview"),
          h("button", { class: "ghost-button compact-button danger", type: "button", "data-action": "remove-landing-image", "data-index": String(index) }, "Xóa")
        )
      ));
      box.appendChild(cards.length ? h("div", { class: "landing-gallery-grid" }, ...cards) : h("p", { class: "subtle" }, "Chưa có ảnh."));
      this.drawReview();
    }
    dragStart(event) {
      const card = event.target?.closest?.("[data-landing-gallery-index]");
      this.dragFrom = card ? Number(card.dataset["landingGalleryIndex"]) : -1;
    }
    drop(event) {
      event.preventDefault();
      const card = event.target?.closest?.("[data-landing-gallery-index]");
      if (!card || this.dragFrom < 0) return;
      this.moveImage(this.dragFrom, Number(card.dataset["landingGalleryIndex"]));
      this.dragFrom = -1;
    }
    moveImage(from, to) {
      if (from === to || from < 0 || to < 0 || from >= this.images.length || to >= this.images.length) return;
      const [image] = this.images.splice(from, 1);
      if (image) this.images.splice(to, 0, image);
      this.drawGallery();
    }
    async readFiles(files) {
      const line = el("hang-sua-trang-thai");
      for (const file of files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type))) {
        if (file.size > 8 * 1024 * 1024) {
          status(line, `${file.name}: ảnh lớn hơn 8 MB.`, "bad");
          continue;
        }
        const url = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => resolve("");
          reader.readAsDataURL(file);
        });
        if (url) this.images.push({ id: nextId("anh"), url, pending: true });
      }
      this.drawGallery();
      status(line, "Ảnh mới sẽ tải lên landing khi bấm Lưu.", "good");
    }
    async addFiles(event) {
      const input = event.target;
      const files = [...input.files ?? []];
      input.value = "";
      await this.readFiles(files);
    }
    async paste(event) {
      const files = [...event.clipboardData?.files ?? []];
      if (files.length === 0) return;
      event.preventDefault();
      await this.readFiles(files);
    }
    async findImage() {
      const keyword = ["hs-hang", "hs-ma", "hs-ten"].map((id) => el(id).value.trim()).filter(Boolean).join(" ");
      const line = el("hang-sua-trang-thai");
      if (keyword === "") {
        status(line, "Điền mã hoặc tên để tìm ảnh.", "bad");
        return;
      }
      const r = await this.host.gateway.openImageSearch(keyword);
      status(line, r.ok ? "Đã mở trình duyệt — chép link ảnh vào ô Dán link ảnh sản phẩm." : r.viSao, r.ok ? "good" : "bad");
    }
    // ---------------------------------------------------------------- review (6 steps)
    steps() {
      const value = (id) => el(id).value.trim();
      const sized = this.variants.filter((v) => v.size.trim() !== "");
      const inStock = sized.filter((v) => digits(v.qty) > 0);
      const list = digits(value("hs-gia-niem-yet"));
      const prices = sized.map((v) => digits(v.price) || digits(value("hs-gia-sale"))).filter((x) => x > 0);
      const sale = digits(value("hs-gia-sale")) || (prices.length ? Math.min(...prices) : 0);
      return [
        { title: "Sản phẩm", note: "Mã, tên, giá bán và ít nhất một size.", ok: value("hs-ma") !== "" && value("hs-ten") !== "" && sized.length > 0 && prices.length === sized.length, hard: true },
        { title: "Dòng sản phẩm", note: "Hãng và loại sản phẩm để web phân loại, lọc nhanh.", ok: value("hs-hang") !== "" && el("hs-loai").value !== "", hard: false },
        { title: "Mô tả", note: "Mô tả ngắn hoặc giới thiệu sản phẩm.", ok: value("hs-mo-ta") !== "" || el("hs-gioi-thieu").value.trim() !== "", hard: false },
        { title: "SEO", note: "SEO title và SEO description (AI ngoài / bài SEO mẫu giúp điền).", ok: value("hs-seo-tieu-de") !== "" && value("hs-seo-mo-ta") !== "", hard: false },
        { title: "Ảnh / gallery", note: "Ít nhất một ảnh; ảnh đầu là sideview.", ok: this.images.length > 0, hard: false },
        { title: "Duyệt lên website", note: "Còn size có hàng, giá sale không cao hơn giá niêm yết.", ok: inStock.length > 0 && !(list > 0 && sale > list), hard: true }
      ];
    }
    drawReview() {
      const box = document.getElementById("hs-duyet");
      if (box === null) return;
      clear(box);
      const steps = this.steps();
      steps.forEach((s, i) => box.appendChild(h(
        "div",
        { class: "landing-review-step", "data-review-ok": s.ok ? "1" : "0" },
        h("strong", null, String(i + 1)),
        h("div", null, h("b", null, s.title), h("span", null, s.note)),
        h("span", { class: `badge ${s.ok ? "green" : s.hard ? "red" : "amber"}` }, s.ok ? "Đạt" : s.hard ? "Chưa đạt" : "Nên bổ sung")
      )));
      el("hs-duyet-tom-tat").textContent = `${steps.filter((s) => s.ok).length}/6`;
    }
    // ---------------------------------------------------------------- save / delete
    payload() {
      const value = (id) => el(id).value.trim();
      const code = this.loaded?.code ?? value("hs-ma");
      const sale = digits(value("hs-gia-sale"));
      const listPrice = digits(value("hs-gia-niem-yet"));
      const ready2 = this.images.filter((i) => !i.pending).map((i) => i.url);
      const body = {
        code,
        name: value("hs-ten"),
        brand: value("hs-hang"),
        productKind: el("hs-loai").value,
        sourceName: value("hs-nguon"),
        status: el("hs-trang-thai").value,
        category: value("hs-mon"),
        division: value("hs-nhom-hang") || el("hs-loai").value,
        gender: value("hs-gioi-tinh"),
        slug: value("hs-slug") ? slugText(value("hs-slug")) : "",
        listPrice,
        thumbnailImage: ready2[0] ?? "",
        highImage: ready2[0] ?? "",
        galleryImages: ready2.slice(1),
        shortDescription: value("hs-mo-ta"),
        description: el("hs-gioi-thieu").value.trim(),
        seoTitle: value("hs-seo-tieu-de"),
        seoDescription: value("hs-seo-mo-ta"),
        seoKeywords: value("hs-seo-tu-khoa"),
        policy: el("hs-chinh-sach").value.trim(),
        sizes: this.variants.filter((v) => v.size.trim() !== "").map((v) => ({
          size: v.size.trim(),
          qty: digits(v.qty),
          price: digits(v.price) || sale,
          ...digits(v.listPrice) ? { listPrice: digits(v.listPrice) } : {},
          ...v.sku.trim() ? { sku: v.sku.trim() } : {},
          ...digits(v.costPrice) ? { costPrice: digits(v.costPrice) } : {},
          ...v.warehouseId ? { warehouseId: v.warehouseId } : {}
        }))
      };
      if (!body["slug"]) delete body["slug"];
      if (this.loaded !== null) {
        const shown = Number(this.loaded.price ?? 0);
        if (sale > 0 && sale !== shown) body["giaTay"] = sale;
        else if (sale === 0 && Number(this.loaded.manualPrice ?? 0) > 0) body["giaTay"] = 0;
      }
      return body;
    }
    actions = {
      "add-catalog-variant": () => {
        const code = el("hs-ma").value.trim();
        this.variants.push({ id: nextId("bt"), size: "", sku: code ? `${code}-` : "", qty: "0", listPrice: el("hs-gia-niem-yet").value, costPrice: "", price: el("hs-gia-sale").value, warehouseId: "" });
        this.drawVariants();
      },
      "remove-catalog-variant": (b) => {
        this.variants = this.variants.filter((v) => v.id !== b.dataset["variantId"]);
        this.drawVariants();
      },
      "add-catalog-gallery-link": () => {
        const input = el("catalogGalleryLink");
        const url = input.value.trim();
        if (!/^https?:\/\//i.test(url)) {
          status(el("hang-sua-trang-thai"), "Cần nhập link ảnh hợp lệ.", "bad");
          return;
        }
        this.images.push({ id: nextId("anh"), url, pending: false });
        input.value = "";
        this.drawGallery();
      },
      "move-landing-image": (b) => {
        const index = Number(b.dataset["index"] ?? 0);
        this.moveImage(index, index + Number(b.dataset["direction"] ?? 0));
      },
      "remove-landing-image": (b) => {
        this.images.splice(Number(b.dataset["index"] ?? 0), 1);
        this.drawGallery();
      },
      "remove-catalog-gallery-image": (b) => {
        this.images = this.images.filter((i) => i.id !== b.dataset["imageId"]);
        this.drawGallery();
      },
      "set-catalog-sideview-image": (b) => {
        const index = this.images.findIndex((i) => i.id === b.dataset["imageId"]);
        this.moveImage(index, 0);
      },
      "save-landing-product": () => this.save(),
      "delete-landing-product": (b) => this.remove(b),
      "save-product-web-fields": () => this.saveWeb(),
      "reset-landing-manual-price": () => this.resetPrice(),
      "cache-product-images": () => this.cacheImages(),
      ...this.web.actions
    };
    async save() {
      const line = el("hang-sua-trang-thai");
      const body = this.payload();
      const code = str(body["code"]);
      const sizes = body["sizes"];
      if (code === "" || str(body["name"]) === "") {
        status(line, "Cần nhập mã và tên sản phẩm landing.", "bad");
        return;
      }
      if (sizes.length === 0) {
        status(line, "Cần ít nhất một dòng size.", "bad");
        return;
      }
      const failedHard = this.steps().map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.hard && !s.ok);
      if (body["status"] === "orderable" && failedHard.length > 0 && failedHard.some((s) => s.n === 1)) {
        status(line, `Bước ${failedHard.map((s) => s.n).join(", ")} chưa đạt: ${failedHard.map((s) => s.note).join(" ")}`, "bad");
        return;
      }
      if (body["status"] === "orderable" && failedHard.length > 0) {
        body["status"] = "hidden";
      }
      status(line, "Đang lưu…");
      let r = await this.host.gateway.landing("hang.ghi", body);
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const pending = this.images.filter((i) => i.pending);
      for (const image of pending) {
        const up = await this.host.gateway.landing("hang.tai-anh", { ma: code, anh: image.url });
        if (!up.ok || !up.than?.url) {
          status(line, `Đã lưu ${code}, nhưng ảnh chưa tải lên được: ${up.viSao}`, "bad");
          return;
        }
        image.url = up.than.url;
        image.pending = false;
      }
      if (pending.length > 0) {
        const ready2 = this.images.map((i) => i.url);
        r = await this.host.gateway.landing("hang.ghi", { ...body, thumbnailImage: ready2[0] ?? "", highImage: ready2[0] ?? "", galleryImages: ready2.slice(1) });
        if (!r.ok) {
          status(line, r.viSao, "bad");
          return;
        }
      }
      const hiddenNote = body["status"] === "hidden" && el("hs-trang-thai").value === "orderable" ? " Bước 6 chưa đạt nên sản phẩm lưu ở trạng thái Tạm ẩn." : "";
      status(line, `Đã lưu ${code} (${r.than?.soBienThe ?? sizes.length} size).${hiddenNote}`, hiddenNote ? "bad" : "good");
      await this.host.changed(code);
    }
    async remove(button) {
      const code = this.loaded?.code ?? el("hs-ma").value.trim();
      const line = el("hang-sua-trang-thai");
      if (code === "") {
        status(line, "Điền mã cần xoá.", "bad");
        return;
      }
      if (Date.now() > this.deleteArmedUntil) {
        this.deleteArmedUntil = Date.now() + 6e3;
        button.textContent = "Bấm lần nữa để xoá";
        setTimeout(() => {
          button.textContent = "Xóa khỏi landing";
        }, 6e3);
        return;
      }
      this.deleteArmedUntil = 0;
      button.textContent = "Xóa khỏi landing";
      const r = await this.host.gateway.landing("hang.xoa", { ma: code });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Đã xoá ${code}${r.than?.conNguonKhac ? " (vẫn còn hàng có sẵn của nguồn khác)." : "."}`, "good");
      this.host.close();
      await this.host.changed("");
    }
    async saveWeb() {
      const code = this.loaded?.code ?? "";
      if (code === "") {
        this.web.say("Lưu sản phẩm trước rồi mới lưu nội dung web.", "bad");
        return;
      }
      let content;
      try {
        content = this.web.read();
      } catch (e) {
        this.web.say(e.message, "bad");
        return;
      }
      const seo = this.web.suggestedSeo();
      if (el("hs-seo-tieu-de").value.trim() === "" && seo.title) el("hs-seo-tieu-de").value = seo.title;
      if (el("hs-seo-mo-ta").value.trim() === "" && seo.description) el("hs-seo-mo-ta").value = seo.description;
      this.web.say("Đang lưu nội dung web…");
      const r = await this.host.gateway.landing("hang.noi-dung-web", {
        ma: code,
        seoTitle: el("hs-seo-tieu-de").value.trim(),
        seoDescription: el("hs-seo-mo-ta").value.trim(),
        seoKeywords: el("hs-seo-tu-khoa").value.trim(),
        noiDung: content
      });
      if (!r.ok) {
        this.web.say(r.viSao, "bad");
        return;
      }
      this.web.say(`Đã lưu nội dung web của ${code}.`, "good");
      this.drawReview();
      await this.host.changed(code);
    }
    async resetPrice() {
      const code = this.loaded?.code ?? "";
      if (code === "") return;
      const line = el("hang-sua-trang-thai");
      const r = await this.host.gateway.landing("hang.ve-gia-nguon", { ma: code });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Đã dùng lại giá nguồn cho ${code}.`, "good");
      await this.host.changed(code);
    }
    async cacheImages() {
      const code = this.loaded?.code ?? "";
      if (code === "") {
        this.web.say("Lưu sản phẩm trước rồi mới tải gallery ảnh.", "bad");
        return;
      }
      this.web.say("Đang tải ảnh về landing…");
      const r = await this.host.gateway.landing("hang.tai-anh-ve", { ma: code });
      if (!r.ok) {
        this.web.say(r.viSao, "bad");
        return;
      }
      this.web.say(`Đã tải ${r.than?.taiDuoc ?? 0} ảnh${r.than?.hong ? `, ${r.than.hong} ảnh không tải được` : ""}.`, r.than?.hong ? "bad" : "good");
      await this.host.changed(code);
    }
  };

  // ../omi/packages/omi-ui/src/views/products.ts
  var ProductsView = class extends View {
    id = "hang";
    label = "Hàng hoá";
    title = "Hàng hoá & kho";
    workspace = "common";
    glyph = "▦";
    editor = new ProductEditor({
      gateway: this.ctx.gateway,
      landingBase: () => this.landingBase(),
      changed: async (code) => {
        this.closeEditor();
        if (code !== "") el("hang-tu-khoa").value = code;
        await Promise.all([this.search(), this.loadUndo()]);
      },
      close: () => this.closeEditor()
    });
    landingBase() {
      return str(this.ctx.shell.license()?.diaChiLanding).replace(/\/+$/, "");
    }
    build(root) {
      const filters = h(
        "div",
        { class: "grid three" },
        h(
          "div",
          { class: "field" },
          h("label", { for: "hang-tu-khoa" }, "Tìm mã / tên sản phẩm landing"),
          h("input", { id: "hang-tu-khoa", type: "text", placeholder: "VD: JQ1234, Boston, Samba", onkeydown: (e) => {
            if (e.key === "Enter") void this.search();
          } })
        ),
        h(
          "div",
          { class: "field" },
          h("label", { for: "hang-loc-size" }, "Còn size"),
          h("input", { id: "hang-loc-size", type: "text", placeholder: "VD: 42, 42.5, M" })
        ),
        h(
          "div",
          { class: "field" },
          h("label", { for: "hang-loc-nguon" }, "Nguồn hàng"),
          h(
            "select",
            { id: "hang-loc-nguon" },
            h("option", { value: "" }, "Tất cả nguồn"),
            h("option", { value: "own" }, "Hàng của shop"),
            h("option", { value: "ready" }, "Kho hàng sẵn"),
            h("option", { value: "campaign" }, "Kho đối tác")
          )
        )
      );
      const list = h(
        "section",
        { class: "panel", id: "hang-danh-sach" },
        h(
          "div",
          { class: "panel-header" },
          h("div", null, h("h3", null, "Sản phẩm landing"), h("p", null, "Catalog của shop: hàng nhà, kho hàng sẵn và kho đối tác. Sửa ở đây là sửa thẳng trên landing.")),
          h(
            "div",
            { class: "split-actions" },
            h("button", { class: "secondary-button", type: "button", id: "nut-hang-hoan-tac", "data-action": "undo-landing-products", disabled: true }, "Hoàn tác"),
            h("button", { class: "secondary-button", type: "button", id: "nut-hang-tim", onclick: () => void this.search() }, "Tìm hàng"),
            h("button", { class: "primary-button", type: "button", id: "nut-hang-them", "data-action": "create-landing-product" }, "Thêm sản phẩm"),
            h("span", { class: "badge blue", id: "hang-so-mon" }, "0 sản phẩm")
          )
        ),
        h(
          "div",
          { class: "panel-body" },
          filters,
          h("span", { class: "status-line", id: "hang-trang-thai" }, "Để trống rồi bấm tìm = xem danh mục."),
          h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, ...["Mã", "Tên", "Size", "Gallery", "Giá", "Trạng thái", ""].map((t) => h("th", null, t)))),
              h("tbody", { id: "hang-bang" })
            )
          )
        )
      );
      root.append(list, this.editor.root);
    }
    actions = {
      "create-landing-product": () => this.openEditor(null),
      "edit-landing-product": (b) => this.edit(str(b.dataset["code"]), false),
      "edit-web-product": (b) => this.edit(str(b.dataset["code"]), true),
      "cancel-landing-product": () => this.closeEditor(),
      "toggle-product-web-status": (b) => this.toggleWeb(b),
      "undo-landing-products": () => this.undo(),
      "add-catalog-variant": (b) => this.editor.actions["add-catalog-variant"](b),
      "remove-catalog-variant": (b) => this.editor.actions["remove-catalog-variant"](b),
      "add-catalog-gallery-link": (b) => this.editor.actions["add-catalog-gallery-link"](b),
      "move-landing-image": (b) => this.editor.actions["move-landing-image"](b),
      "remove-landing-image": (b) => this.editor.actions["remove-landing-image"](b),
      "remove-catalog-gallery-image": (b) => this.editor.actions["remove-catalog-gallery-image"](b),
      "set-catalog-sideview-image": (b) => this.editor.actions["set-catalog-sideview-image"](b),
      "save-landing-product": (b) => this.editor.actions["save-landing-product"](b),
      "delete-landing-product": (b) => this.editor.actions["delete-landing-product"](b),
      "save-product-web-fields": (b) => this.editor.actions["save-product-web-fields"](b),
      "reset-landing-manual-price": (b) => this.editor.actions["reset-landing-manual-price"](b),
      "cache-product-images": (b) => this.editor.actions["cache-product-images"](b),
      "generate-external-ai-prompt": (b) => this.editor.actions["generate-external-ai-prompt"](b),
      "clear-external-ai-helper": (b) => this.editor.actions["clear-external-ai-helper"](b),
      "apply-external-ai-json": (b) => this.editor.actions["apply-external-ai-json"](b),
      "parse-seo-article-template": (b) => this.editor.actions["parse-seo-article-template"](b),
      "clear-seo-article-template": (b) => this.editor.actions["clear-seo-article-template"](b)
    };
    load() {
      void this.search();
      void this.loadUndo();
    }
    /** Sửa nhanh web "Chi tiết" mở đúng sản phẩm ở đây. */
    receive(params) {
      const code = str(params["ma"]);
      if (code !== "") void this.edit(code, params["noiDungWeb"] === true);
    }
    openEditor(product) {
      el("hang-danh-sach").hidden = true;
      this.editor.open(product);
      this.editor.root.scrollIntoView?.({ block: "start" });
    }
    closeEditor() {
      this.editor.root.hidden = true;
      el("hang-danh-sach").hidden = false;
    }
    async search() {
      const line = el("hang-trang-thai");
      status(line, "Đang tìm…");
      const r = await this.ctx.gateway.landing("hang.tim", {
        tuKhoa: el("hang-tu-khoa").value.trim(),
        size: el("hang-loc-size").value.trim(),
        nguon: el("hang-loc-nguon").value,
        gioiHan: 200
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const rows = r.than ?? [];
      const body = el("hang-bang");
      clear(body);
      const base = this.landingBase();
      for (const m of rows) body.appendChild(this.row(m, base));
      if (rows.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "7" }, "Chưa có sản phẩm phù hợp. Bấm Thêm sản phẩm hoặc nhập ở Đồng bộ kho.")));
      el("hang-so-mon").textContent = `${rows.length} sản phẩm`;
      status(line, `${rows.length} món.`, "good");
    }
    /** Desk `landingProductRow`. */
    row(m, base) {
      const sizes = (m.size ?? []).filter((s) => Number(s.ton) > 0);
      const hidden = m.trangThai === "hidden";
      const title = [m.hang, m.ten].filter(Boolean).join(" ");
      return h(
        "tr",
        null,
        h("td", null, h("strong", null, m.ma)),
        h("td", null, h(
          "div",
          { class: "product-media-row" },
          productThumb(imageSrc(str(m.anh), base), m.ma),
          h("div", null, h("div", { class: "product-title" }, title), h("div", { class: "subtle" }, `${m.nguon || "TopRun"} · ${kindLabel(str(m.loai))}`))
        )),
        h("td", null, `${sizes.length} size`, h("div", { class: "subtle" }, sizes.map((s) => `${s.size}:${s.ton}`).join(", "))),
        h("td", null, h("div", { class: "landing-thumb-strip" }, m.anh ? h("img", { src: imageSrc(str(m.anh), base), alt: "" }) : null), h("div", { class: "subtle" }, `${m.soAnh ?? 0} ảnh`)),
        h("td", null, money(m.gia), m.giaTay ? h("div", { class: `landing-price-status${m.cheDoGia === "source_higher_than_manual" ? " warning" : " manual"}` }, m.cheDoGia === "source_higher_than_manual" ? "Nguồn cao hơn" : "Giá tay") : null),
        h("td", null, h("span", { class: `badge ${hidden ? "amber" : "green"}` }, hidden ? "Tạm ẩn" : "Đang bán")),
        h("td", null, h(
          "div",
          { class: "split-actions compact-actions" },
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-landing-product", "data-code": m.ma }, "Sửa"),
          h("button", { class: "ghost-button compact-button", type: "button", "data-action": "edit-web-product", "data-code": m.ma }, "Nội dung web"),
          h("button", { class: "ghost-button compact-button", type: "button", "data-action": "toggle-product-web-status", "data-code": m.ma, "data-status": hidden ? "hidden" : "orderable" }, hidden ? "Đưa lên web" : "Ẩn khỏi web")
        ))
      );
    }
    async edit(code, webContent) {
      if (code === "") return;
      const line = el("hang-trang-thai");
      status(line, `Đang tải món ${code}…`);
      const r = await this.ctx.gateway.landing("hang.doc", { ma: code });
      if (!r.ok || r.than === null) {
        status(line, r.viSao || "Không thấy món.", "bad");
        return;
      }
      status(line, "");
      this.openEditor(r.than);
      if (webContent) el("hs-noi-dung-web").scrollIntoView?.({ block: "start" });
    }
    async toggleWeb(button) {
      const code = str(button.dataset["code"]);
      const show = button.dataset["status"] !== "orderable";
      const line = el("hang-trang-thai");
      const r = await this.ctx.gateway.landing("hang.bat-tat-web", { ma: code, hien: show });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await Promise.all([this.search(), this.loadUndo()]);
      status(line, show ? `Đã đẩy ${code} lên web.` : `Đã ẩn ${code} khỏi web.`, "good");
    }
    async loadUndo() {
      const r = await this.ctx.gateway.landing("hang.hoan-tac.xem", {});
      const button = el("nut-hang-hoan-tac");
      const head = r.ok ? r.than?.hoanTac ?? null : null;
      button.disabled = head === null;
      button.textContent = head === null ? "Hoàn tác" : `Hoàn tác: ${head.nhan}`;
    }
    async undo() {
      const line = el("hang-trang-thai");
      const r = await this.ctx.gateway.landing("hang.hoan-tac", {});
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.closeEditor();
      await Promise.all([this.search(), this.loadUndo()]);
      status(line, `Đã hoàn tác "${str(r.than?.daHoanTac?.nhan)}" (${(r.than?.daHoanTac?.maMon ?? []).join(", ")}).`, "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/purchasing.ts
  var OPS_TABS = [["purchase", "Sản phẩm cần mua"], ["sessions", "Phiên mua"], ["fees", "Tiền công"]];
  var sessionOf = (s) => s.maLenh ? s.maLenh.replace(/#\d+$/, "") : s.maPhieu;
  var PurchasingView = class extends View {
    id = "mua-ho";
    label = "Sản phẩm cần mua";
    title = "Sản phẩm cần mua";
    workspace = "landing";
    glyph = "CM";
    tab = "purchase";
    board = {};
    partners = [];
    ledger = {};
    readRange = () => ({ tuNgay: "", denNgay: "" });
    actions = {
      "set-partner-ops-tab": (b) => this.setTab(b.dataset["tab"] ?? "purchase"),
      "prefill-partner-purchase": (b) => this.prefill({
        partnerId: str(b.dataset["partnerId"]),
        productCode: str(b.dataset["productCode"]),
        size: str(b.dataset["size"]),
        quantity: str(b.dataset["missingQty"]) || "1",
        cost: str(b.dataset["unitCost"]),
        note: ""
      }, "Đã đưa dòng cần mua lên form xác nhận."),
      "confirm-partner-purchase": () => this.confirm(),
      "edit-partner-purchase": (b) => this.editSession(str(b.dataset["sessionId"])),
      "reassign-purchase-partner": (b) => this.moveSlips(str(b.dataset["sessionId"])),
      "pay-partner-fee": (b) => this.money(str(b.dataset["partnerId"]), "tra", Number(b.dataset["due"] ?? 0)),
      "add-partner-fee-adjustment": (b) => this.money(str(b.dataset["partnerId"]), "phat_sinh", 0),
      "edit-partner-fee-payment": (b) => this.editPayment(str(b.dataset["paymentId"])),
      "void-partner-fee-payment": (b) => this.voidPayment(str(b.dataset["paymentId"]))
    };
    build(root) {
      const input = (id, label, attrs = {}) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, ...attrs }));
      const purchase = h(
        "div",
        { id: "mh-tab-purchase" },
        h(
          "div",
          { class: "grid three" },
          metric("Sản phẩm cần mua", "mh-so-dong", "Gom theo mã sản phẩm, size và đối tác"),
          metric("Tổng SL cần mua", "mh-tong-can", "Tính từ các đơn chưa hoàn tất"),
          metric("SL còn thiếu", "mh-tong-thieu", "Sau các phiên mua đã xác nhận")
        ),
        h(
          "div",
          { class: "config-form omi-section-gap" },
          h(
            "div",
            { class: "grid three" },
            h("div", { class: "field" }, h("label", { for: "purchasePartnerId" }, "Đối tác xác nhận"), h("select", { id: "purchasePartnerId" }, h("option", { value: "" }, "Chọn đối tác"))),
            input("purchaseProductCode", "Mã sản phẩm"),
            input("purchaseSize", "Size"),
            input("purchaseQty", "Số lượng thực tế mua được", { value: "1", inputmode: "numeric" }),
            input("purchaseActualCostPrice", "Giá mua thực tế / sản phẩm", { inputmode: "numeric" }),
            input("purchaseNote", "Ghi chú"),
            h("div", { class: "field" }, h("label", null, " "), h("button", { class: "primary-button", type: "button", id: "nut-mh-xac-nhan", "data-action": "confirm-partner-purchase" }, "Xác nhận phiên mua"))
          ),
          h("span", { class: "status-line", id: "mh-form-trang-thai" })
        ),
        h("div", { class: "table-wrap omi-section-gap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Mã / size", "Đối tác", "Cần mua", "Đã mua", "Còn thiếu", "Đơn ưu tiên", ""].map((t) => h("th", null, t)))),
          h("tbody", { id: "mh-can-mua" })
        )),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Đối tác báo hết hàng"), h("p", null, "Những dòng shop phải tự tìm nguồn khác hoặc báo lại khách."))
          ),
          table(["Lúc", "Đối tác", "Mã đơn", "Hàng", "Lý do"], "mh-bao-het")
        )
      );
      const sessions = h(
        "div",
        { id: "mh-tab-sessions", class: "omi-an" },
        h("div", { class: "table-wrap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Phiên mua", "Đối tác", "Sản phẩm", "SL xác nhận", "Đơn được phân bổ", "Tiền hàng", ""].map((t) => h("th", null, t)))),
          h("tbody", { id: "mh-da-mua" })
        )),
        h("span", { class: "status-line", id: "mh-phien-trang-thai" })
      );
      const filter = dateFilterPanel("purchasePayroll", "Kỳ tính lương partner", "week", () => void this.loadLedger());
      this.readRange = filter.read;
      const fees = h(
        "div",
        { id: "mh-tab-fees", class: "omi-an" },
        filter.panel,
        h("div", { class: "table-wrap omi-section-gap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Đối tác", "Phiên mua", "SP đã mua", "Đơn xử lý", "Tiền công", "Chi phí phát sinh", "Đã CK", "Còn thiếu", ""].map((t) => h("th", null, t)))),
          h("tbody", { id: "mh-cong-no" })
        )),
        h("span", { class: "status-line", id: "mh-cong-no-trang-thai" }),
        h("h3", { class: "omi-section-gap" }, "Lịch sử CK thanh toán"),
        h("div", { class: "table-wrap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Thời gian", "Đối tác", "Số tiền", "Phương thức", "Người xác nhận", "Ghi chú", "Thao tác"].map((t) => h("th", null, t)))),
          h("tbody", { id: "mh-lich-su-ck" })
        )),
        h("h3", { class: "omi-section-gap" }, "Lịch sử chi phí phát sinh"),
        h("div", { class: "table-wrap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Thời gian", "Đối tác", "Số tiền", "Người nhập", "Ghi chú"].map((t) => h("th", null, t)))),
          h("tbody", { id: "mh-lich-su-chi-phi" })
        ))
      );
      root.append(
        h(
          "div",
          { class: "toolbar" },
          h("label", { for: "mh-doi-tac" }, "Đối tác"),
          h("select", { id: "mh-doi-tac", onchange: () => void this.loadBoard() }, h("option", { value: "" }, "Tất cả đối tác")),
          h("button", { class: "secondary-button", id: "nut-mua-ho-tai", type: "button", onclick: () => void this.loadAll() }, "Tải lại"),
          h("span", { class: "status-line", id: "mua-ho-trang-thai" }, "Bấm để tải.")
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Sản phẩm cần mua"), h("p", null, "Gom theo sản phẩm/size đã được phân bổ đối tác để xử lý nhanh theo lô.")),
            h("div", { class: "split-actions", id: "mh-tabs" })
          ),
          h("div", { class: "panel-body" }, purchase, sessions, fees)
        )
      );
      this.drawTabs();
    }
    load() {
      void this.loadAll();
    }
    async loadAll() {
      await this.loadPartners();
      await this.loadBoard();
      if (this.tab === "fees") await this.loadLedger();
    }
    setTab(tab) {
      this.tab = tab;
      this.drawTabs();
      for (const [t] of OPS_TABS) el(`mh-tab-${t}`).classList.toggle("omi-an", t !== tab);
      if (tab === "fees") void this.loadLedger();
    }
    drawTabs() {
      const box = el("mh-tabs");
      clear(box);
      for (const [value, label] of OPS_TABS) {
        box.appendChild(h("button", { class: `${this.tab === value ? "primary-button" : "secondary-button"} compact-button`, type: "button", "data-action": "set-partner-ops-tab", "data-tab": value }, label));
      }
    }
    partnerName(id) {
      return this.partners.find((p) => p.ma === id)?.ten || id || "Chưa gán";
    }
    /** Fills both partner pickers. A failure here must not stop the board: it only narrows it. */
    async loadPartners() {
      const r = await this.ctx.gateway.landing("doi-tac.danh-sach");
      if (!r.ok) return;
      this.partners = r.than ?? [];
      for (const [id, first] of [["mh-doi-tac", "Tất cả đối tác"], ["purchasePartnerId", "Chọn đối tác"]]) {
        const picker = el(id);
        const chosen = picker.value;
        clear(picker);
        picker.appendChild(h("option", { value: "" }, first));
        for (const p of this.partners) picker.appendChild(h("option", { value: p.ma }, id === "mh-doi-tac" ? `${p.ten} (${p.ma})` : p.ten));
        picker.value = chosen;
      }
    }
    async loadBoard() {
      const line = el("mua-ho-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("mua-ho.bang", { doiTac: el("mh-doi-tac").value, gioiHan: 200 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.board = r.than ?? {};
      const needs = this.needRows();
      this.drawNeeds(needs);
      this.drawSessions();
      const outOfStock = this.board.baoHet ?? [];
      const outBody = el("mh-bao-het");
      clear(outBody);
      for (const o of outOfStock) outBody.appendChild(tableRow([dayClock(o.baoLuc), this.partnerName(o.maDoiTac), o.maDon, `${o.maMon}${o.size ? ` · ${o.size}` : ""}`, str(o.lyDo) || "—"]));
      if (outOfStock.length === 0) outBody.appendChild(h("tr", null, h("td", { colspan: "5" }, "Không có dòng nào bị báo hết.")));
      status(line, `${needs.length} mã/size còn phải mua · ${(this.board.daMua ?? []).length} phiếu đã mua · ${outOfStock.length} dòng báo hết.`, "good");
    }
    /** Desk `purchaseNeedRows`: lines still to buy, grouped by code + size + partner, oldest orders first. */
    needRows() {
      const boughtByLine = /* @__PURE__ */ new Map();
      for (const s of this.board.daMua ?? []) boughtByLine.set(s.maDong, (boughtByLine.get(s.maDong) ?? 0) + Number(s.soLuong || 0));
      const rows = /* @__PURE__ */ new Map();
      for (const t of this.board.canMua ?? []) {
        const key = `${t.maMon.toLowerCase()}|${t.size.toLowerCase()}|${t.maDoiTac}`;
        const row = rows.get(key) ?? { key, maMon: t.maMon, ten: t.ten, size: t.size, maDoiTac: t.maDoiTac, canMua: 0, daMua: 0, conThieu: 0, don: [] };
        const bought = boughtByLine.get(t.maDong) ?? 0;
        row.conThieu += t.soLuong;
        row.daMua += bought;
        row.canMua += t.soLuong + bought;
        row.don.push({ maDon: t.maDon, con: t.soLuong });
        rows.set(key, row);
      }
      return [...rows.values()];
    }
    drawNeeds(rows) {
      el("mh-so-dong").textContent = String(rows.length);
      el("mh-tong-can").textContent = String(rows.reduce((t, r) => t + r.canMua, 0));
      el("mh-tong-thieu").textContent = String(rows.reduce((t, r) => t + r.conThieu, 0));
      const body = el("mh-can-mua");
      clear(body);
      for (const r of rows) {
        const orders = h("div", null);
        r.don.slice(0, 4).forEach((o, i) => {
          if (i > 0) orders.appendChild(h("br"));
          orders.append(`${o.maDon} (${o.con})`);
        });
        body.appendChild(tableRow([
          h("div", null, h("strong", null, r.maMon), h("div", { class: "subtle" }, `${r.ten} · size ${r.size || "—"}`)),
          this.partnerName(r.maDoiTac),
          r.canMua,
          r.daMua,
          badge(String(r.conThieu), r.conThieu > 0 ? "amber" : "green"),
          orders,
          h("button", {
            class: "secondary-button compact-button",
            type: "button",
            "data-action": "prefill-partner-purchase",
            "data-partner-id": r.maDoiTac,
            "data-product-code": r.maMon,
            "data-size": r.size,
            "data-missing-qty": String(r.conThieu)
          }, "Nhập đã mua")
        ], [2, 3]));
      }
      if (rows.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "7" }, "Chưa có sản phẩm nào được gán đối tác.")));
    }
    sessions() {
      const groups = /* @__PURE__ */ new Map();
      for (const s of this.board.daMua ?? []) groups.set(sessionOf(s), [...groups.get(sessionOf(s)) ?? [], s]);
      return [...groups.entries()].map(([id, slips]) => ({ id, slips }));
    }
    /** Desk `partnerPurchaseSessionsTemplate` + chuyển phiếu sang đối tác khác (phiếu ghi nhầm người). */
    drawSessions() {
      const body = el("mh-da-mua");
      clear(body);
      for (const { id, slips } of this.sessions()) {
        const first = slips[0];
        const quantity = slips.reduce((t, s) => t + Number(s.soLuong || 0), 0);
        const allocations = h("div", null);
        slips.forEach((s, i) => {
          if (i > 0) allocations.appendChild(h("br"));
          allocations.append(`${s.maDon}: ${s.soLuong}`);
        });
        const picker = h(
          "select",
          { "data-session-partner": id },
          ...this.partners.map((p) => h("option", { value: p.ma, selected: p.ma === first.maDoiTac }, p.ten))
        );
        body.appendChild(tableRow([
          h("div", null, h("strong", null, id), h("div", { class: "subtle" }, dayClock(first.taoLuc))),
          this.partnerName(first.maDoiTac),
          `${first.maMon} · size ${first.size || "—"}`,
          quantity,
          allocations,
          money(slips.reduce((t, s) => t + Number(s.giaVon || 0) * Number(s.soLuong || 0), 0)),
          h(
            "div",
            { class: "split-actions compact-actions" },
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-partner-purchase", "data-session-id": id }, "Sửa / bổ sung"),
            picker,
            h("button", { class: "ghost-button compact-button", type: "button", "data-action": "reassign-purchase-partner", "data-session-id": id }, "Chuyển đối tác")
          )
        ], [3, 5]));
      }
      if ((this.board.daMua ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "7" }, "Chưa có phiên mua.")));
    }
    prefill(draft, message) {
      el("purchasePartnerId").value = draft.partnerId;
      el("purchaseProductCode").value = draft.productCode;
      el("purchaseSize").value = draft.size;
      el("purchaseQty").value = draft.quantity;
      el("purchaseActualCostPrice").value = draft.cost;
      el("purchaseNote").value = draft.note;
      status(el("mh-form-trang-thai"), message, "good");
    }
    /** Desk `edit-partner-purchase`: đưa phiên lên form; xác nhận lại là ghi một phiên BỔ SUNG, lịch sử giữ nguyên. */
    editSession(id) {
      const session = this.sessions().find((s) => s.id === id);
      if (session === void 0) return;
      const first = session.slips[0];
      this.setTab("purchase");
      this.prefill({
        partnerId: first.maDoiTac,
        productCode: first.maMon,
        size: first.size,
        quantity: String(session.slips.reduce((t, s) => t + Number(s.soLuong || 0), 0)),
        cost: first.giaVon > 0 ? String(first.giaVon) : "",
        note: first.ghiChu
      }, "Đã đưa phiên mua lên form. Khi xác nhận lại, hệ thống sẽ ghi như một phiên bổ sung để giữ lịch sử.");
    }
    /** Desk `confirm-partner-purchase` — shop ghi THAY đối tác; máy chủ chia vào các dòng đang chờ. */
    async confirm() {
      const line = el("mh-form-trang-thai");
      const partnerId = el("purchasePartnerId").value;
      const productCode = el("purchaseProductCode").value.trim();
      const quantity = Math.trunc(Number(el("purchaseQty").value) || 0);
      const cost = digits(el("purchaseActualCostPrice").value);
      if (partnerId === "" || productCode === "" || quantity <= 0) {
        status(line, "Cần chọn đối tác, mã sản phẩm và số lượng mua được.", "bad");
        return;
      }
      if (cost <= 0) {
        status(line, "Cần nhập giá mua thực tế lớn hơn 0.", "bad");
        return;
      }
      status(line, "Đang ghi phiên mua…");
      const r = await this.ctx.gateway.landing("mua-ho.mua-thay", {
        doiTac: partnerId,
        maMon: productCode,
        size: el("purchaseSize").value.trim(),
        soLuong: quantity,
        giaVon: cost,
        ghiChu: el("purchaseNote").value.trim()
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadBoard();
      const allocated = r.than?.soLuong ?? quantity;
      status(el("mh-form-trang-thai"), `Đã xác nhận ${quantity} sản phẩm; phân bổ ${allocated}, còn dư ${r.than?.thua ?? 0}.`, "good");
      for (const id of ["purchaseProductCode", "purchaseSize", "purchaseActualCostPrice", "purchaseNote"]) el(id).value = "";
      el("purchaseQty").value = "1";
    }
    /** Mọi phiếu của một phiên sang đối tác khác — phiếu ghi nhầm người; tiền công đi theo phiếu. */
    async moveSlips(id) {
      const line = el("mh-phien-trang-thai");
      const session = this.sessions().find((s) => s.id === id);
      const picker = this.root.querySelector(`[data-session-partner="${CSS.escape(id)}"]`);
      if (session === void 0 || picker === null) return;
      const target = picker.value;
      if (target === session.slips[0].maDoiTac) {
        status(line, "Phiên này đã thuộc đối tác đó. Chọn đối tác khác trong ô cạnh nút.", "bad");
        return;
      }
      status(line, "Đang chuyển phiếu…");
      for (const slip of session.slips) {
        const r = await this.ctx.gateway.landing("mua-ho.chuyen-phieu", { maPhieu: slip.maPhieu, doiTacMoi: target });
        if (!r.ok) {
          status(line, r.viSao, "bad");
          return;
        }
      }
      await this.loadBoard();
      status(el("mh-phien-trang-thai"), `Đã chuyển phiên ${id} sang ${this.partnerName(target)}.`, "good");
    }
    // ----- Tiền công -----
    async loadLedger() {
      const line = el("mh-cong-no-trang-thai");
      status(line, "Đang tính công nợ…");
      const r = await this.ctx.gateway.landing("mua-ho.so-cong-no", this.readRange());
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.ledger = r.than ?? {};
      const body = el("mh-cong-no");
      clear(body);
      for (const s of this.ledger.doiTac ?? []) {
        const due = s.traDu > 0 ? badge(`Trả dư ${money(s.traDu)}`, "green") : badge(money(s.conNo), s.conNo > 0 ? "amber" : "green");
        body.appendChild(tableRow([
          h("strong", null, s.tenDoiTac),
          s.phienMua,
          s.soMon,
          s.soDon,
          money(s.tienCong),
          money(s.chiPhiThem),
          money(s.daChuyen),
          due,
          h(
            "div",
            { class: "split-actions compact-actions" },
            h("input", { type: "text", inputmode: "numeric", placeholder: "Số tiền CK", class: "omi-fee-input", "data-partner-fee-payment": s.maDoiTac }),
            h("button", { class: "primary-button compact-button", type: "button", "data-action": "pay-partner-fee", "data-partner-id": s.maDoiTac, "data-due": String(s.conNo) }, "Ghi CK"),
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "add-partner-fee-adjustment", "data-partner-id": s.maDoiTac }, "+ Chi phí")
          )
        ], [1, 2, 3, 4, 5, 6]));
      }
      if ((this.ledger.doiTac ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "9" }, "Chưa có công nợ.")));
      const history2 = el("mh-lich-su-ck");
      clear(history2);
      for (const x of this.ledger.thanhToan ?? []) {
        const voided = str(x.huyLuc) !== "";
        const tr = tableRow([
          h("div", null, dayClock(x.taoLuc), voided ? h("div", null, badge("Đã hoàn tác", "red")) : null),
          x.tenDoiTac,
          voided ? h("s", null, money(x.soTien)) : money(x.soTien),
          "CK",
          str(x.boi) || "admin",
          x.ghiChu,
          voided ? "—" : h(
            "span",
            { class: "split-actions" },
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-partner-fee-payment", "data-payment-id": x.ma }, "Sửa"),
            h("button", { class: "danger-button compact-button", type: "button", "data-action": "void-partner-fee-payment", "data-payment-id": x.ma }, "Hoàn tác")
          )
        ]);
        if (voided) tr.className = "is-voided";
        history2.appendChild(tr);
      }
      if ((this.ledger.thanhToan ?? []).length === 0) history2.appendChild(h("tr", null, h("td", { colspan: "7" }, "Chưa có lịch sử thanh toán trong kỳ này.")));
      const extras = el("mh-lich-su-chi-phi");
      clear(extras);
      for (const x of (this.ledger.chiPhi ?? []).filter((c) => !c.huyLuc)) extras.appendChild(tableRow([dayClock(x.taoLuc), x.tenDoiTac, money(x.soTien), str(x.boi) || "admin", x.ghiChu]));
      if ((this.ledger.chiPhi ?? []).length === 0) extras.appendChild(h("tr", null, h("td", { colspan: "5" }, "Chưa có chi phí phát sinh trong kỳ này.")));
      status(line, rangeLabel(this.readRange(), "Đang tính toàn bộ lịch sử lương partner."), "good");
    }
    /** Desk `pay-partner-fee` / `add-partner-fee-adjustment`: hộp nhập trong trang. */
    async money(partnerId, kind, due) {
      const line = el("mh-cong-no-trang-thai");
      if (partnerId === "") {
        status(line, "Thiếu đối tác.", "bad");
        return;
      }
      const typed = this.root.querySelector(`[data-partner-fee-payment="${CSS.escape(partnerId)}"]`)?.value.trim() ?? "";
      const name = this.partnerName(partnerId);
      const answer = kind === "tra" ? await askDialog({
        title: `Ghi CK thanh toán cho ${name}`,
        message: `Công nợ hiện tại: ${money(due)}`,
        fields: [
          { name: "amount", label: "Số tiền CK thực tế", value: typed || (due > 0 ? String(due) : ""), numeric: true },
          { name: "note", label: "Ghi chú CK (bỏ trống nếu không có)", value: `CK thanh toán công partner - ${rangeLabel(this.readRange())}` }
        ],
        submitLabel: "Ghi CK"
      }) : await askDialog({
        title: `Chi phí phát sinh cho ${name}`,
        fields: [{ name: "amount", label: "Số tiền", value: "", numeric: true }, { name: "note", label: "Nội dung chi phí", value: "", placeholder: "Ví dụ: phí ship nội bộ, đóng gói..." }],
        submitLabel: "Ghi chi phí"
      });
      if (answer === null) {
        status(line, kind === "tra" ? "Đã huỷ, chưa ghi CK." : "Đã huỷ, chưa ghi chi phí phát sinh.");
        return;
      }
      if (!amountTextValid(answer["amount"] ?? "")) {
        status(line, AMOUNT_HINT, "bad");
        return;
      }
      const amount = digits(answer["amount"]);
      const note = String(answer["note"] ?? "").trim();
      if (amount <= 0) {
        status(line, "Hãy nhập số tiền lớn hơn 0.", "bad");
        return;
      }
      if (kind === "phat_sinh" && note === "") {
        status(line, "Chi phí phát sinh phải ghi là khoản gì.", "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("mua-ho.tien", { doiTac: partnerId, soTien: amount, loai: kind, ghiChu: note });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadLedger();
      status(el("mh-cong-no-trang-thai"), kind === "tra" ? `Đã ghi CK ${money(amount)} cho ${name}.` : `Đã ghi chi phí phát sinh ${money(amount)} cho ${name}.`, "good");
    }
    async editPayment(id) {
      const line = el("mh-cong-no-trang-thai");
      const original = (this.ledger.thanhToan ?? []).find((x) => x.ma === id && !x.huyLuc);
      if (original === void 0) {
        status(line, "Không tìm thấy giao dịch CK cần sửa.", "bad");
        return;
      }
      const answer = await askDialog({
        title: `Sửa giao dịch CK của ${original.tenDoiTac}`,
        fields: [{ name: "amount", label: "Số tiền CK thực tế", value: String(original.soTien), numeric: true }, { name: "note", label: "Ghi chú CK", value: original.ghiChu }]
      });
      if (answer === null) return;
      if (!amountTextValid(answer["amount"] ?? "")) {
        status(line, AMOUNT_HINT, "bad");
        return;
      }
      const r = await this.ctx.gateway.landing("mua-ho.sua-tien", { ma: id, soTien: digits(answer["amount"]), ghiChu: String(answer["note"] ?? "").trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadLedger();
      status(el("mh-cong-no-trang-thai"), `Đã sửa giao dịch CK của ${original.tenDoiTac}.`, "good");
    }
    async voidPayment(id) {
      const line = el("mh-cong-no-trang-thai");
      const original = (this.ledger.thanhToan ?? []).find((x) => x.ma === id && !x.huyLuc);
      if (original === void 0) {
        status(line, "Không tìm thấy giao dịch CK cần hoàn tác.", "bad");
        return;
      }
      const answer = await askDialog({
        title: "Hoàn tác giao dịch CK",
        message: `Hoàn tác giao dịch CK ${money(original.soTien)} của ${original.tenDoiTac}? Khoản này sẽ không còn được tính vào Đã CK.`,
        fields: [{ name: "reason", label: "Lý do hoàn tác", value: "Nhập nhầm giao dịch" }],
        submitLabel: "Hoàn tác"
      });
      if (answer === null) return;
      const r = await this.ctx.gateway.landing("mua-ho.huy-tien", { ma: id, lyDo: String(answer["reason"] ?? "").trim() });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadLedger();
      status(el("mh-cong-no-trang-thai"), "Đã hoàn tác giao dịch CK; công nợ đã được tính lại.", "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/quick-edit.ts
  var WIRE = {
    name: "ten",
    listPrice: "giaNiemYet",
    salePrice: "giaBan",
    productKind: "loai",
    category: "nhom",
    brand: "hang",
    gender: "gioiTinh",
    status: "trangThai"
  };
  var NUMERIC = ["listPrice", "salePrice"];
  var PAGE = 60;
  var QuickEditView = class extends View {
    id = "sua-nhanh";
    label = "Sửa nhanh web";
    title = "Sửa nhanh web";
    workspace = "landing";
    glyph = "SN";
    cards = [];
    visible = PAGE;
    build(root) {
      const select = (id, label, ...options2) => h("div", { class: "field" }, h("label", { for: id }, label), h("select", { id, onchange: () => {
        this.visible = PAGE;
        this.draw();
      } }, ...options2));
      const toolbar = h(
        "div",
        { class: "landing-web-toolbar" },
        h(
          "div",
          { class: "field" },
          h("label", { for: "sn-tu-khoa" }, "Tìm sản phẩm"),
          h("input", { id: "sn-tu-khoa", type: "text", placeholder: "Tên, mã, hãng, loại sản phẩm, size", oninput: () => {
            this.visible = PAGE;
            this.draw();
          } })
        ),
        select("sn-loai", "Loại", h("option", { value: "all" }, "Tất cả loại")),
        select("sn-hang", "Hãng", h("option", { value: "all" }, "Tất cả hãng")),
        select(
          "sn-trang-thai",
          "Trạng thái",
          h("option", { value: "all" }, "Tất cả trạng thái"),
          h("option", { value: "orderable" }, "Đang bán hợp lệ"),
          h("option", { value: "hidden" }, "Đang ẩn / bị ẩn")
        ),
        select("sn-canh-bao", "Cảnh báo", ...ISSUE_OPTIONS.map(([value, label]) => h("option", { value }, label)))
      );
      root.append(
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Sửa nhanh web"), h("p", null, "Lướt như trang chủ, nhưng có đủ trường quản trị để sửa nhanh dữ liệu sai.")),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "secondary-button", type: "button", id: "nut-sua-nhanh-hoan-tac", "data-action": "undo-landing-products", disabled: true }, "Hoàn tác"),
              h("button", { class: "secondary-button", type: "button", id: "nut-sua-nhanh-tai", onclick: () => void this.loadItems() }, "Tải lại"),
              h("button", { class: "secondary-button", type: "button", "data-action": "open-landing-content" }, "Chỉnh nội dung trang"),
              h("button", { class: "primary-button", type: "button", id: "nut-sua-nhanh-luu", "data-action": "save-landing-quick-edit" }, "Lưu tất cả")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            toolbar,
            h("span", { class: "status-line", id: "sua-nhanh-trang-thai" }),
            h("div", { class: "landing-web-edit-grid", id: "sua-nhanh-bang" }),
            h("div", { class: "center-actions", id: "sn-xem-them" })
          )
        )
      );
    }
    actions = {
      "open-landing-content": () => this.ctx.shell.open("noi-dung"),
      "save-landing-quick-edit": () => this.save(),
      "load-more-landing-quick-edit": () => {
        this.visible += PAGE;
        this.draw();
      },
      "reset-landing-manual-price": (b) => this.resetPrice(str(b.dataset["code"])),
      "edit-landing-product": (b) => this.ctx.shell.open("hang", { ma: str(b.dataset["code"]) }),
      "undo-landing-products": () => this.undo()
    };
    load() {
      void this.loadItems();
    }
    valuesOf(m) {
      return {
        name: m.ten,
        listPrice: String(m.giaNiemYet || ""),
        salePrice: String(m.gia || ""),
        productKind: str(m.loai),
        category: str(m.nhom),
        brand: m.hang,
        gender: str(m.gioiTinh),
        status: m.trangThai === "hidden" ? "hidden" : "orderable"
      };
    }
    async loadItems() {
      const line = el("sua-nhanh-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("hang.tim", { tuKhoa: "", gioiHan: 1e3 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.cards = (r.than ?? []).map((item) => ({ item, was: this.valuesOf(item), now: this.valuesOf(item) }));
      this.fillFilters();
      this.draw();
      status(line, `${this.cards.length} sản phẩm. Sửa xong bấm Lưu tất cả.`, "good");
      void this.loadUndo();
    }
    fillFilters() {
      const refill = (id, allLabel, values) => {
        const select = el(id);
        const keep = select.value || "all";
        clear(select);
        select.append(h("option", { value: "all" }, allLabel), ...values.map((v) => h("option", { value: v.value }, v.label)));
        select.value = values.some((v) => v.value === keep) ? keep : "all";
      };
      const uniq = (pick) => [...new Set(this.cards.map(pick).map((x) => x.trim()).filter(Boolean))];
      refill("sn-loai", "Tất cả loại", uniq((c) => str(c.item.loai)).map((value) => ({ value, label: kindLabel(value) })).sort((a, b) => a.label.localeCompare(b.label, "vi")));
      refill("sn-hang", "Tất cả hãng", uniq((c) => c.item.hang).sort((a, b) => a.localeCompare(b, "vi")).map((value) => ({ value, label: value })));
    }
    /** Desk `landingQuickEditFilteredProducts`. */
    filtered() {
      const query = searchText(el("sn-tu-khoa").value);
      const kind = el("sn-loai").value || "all";
      const brand = el("sn-hang").value || "all";
      const state = el("sn-trang-thai").value || "all";
      const issue = el("sn-canh-bao").value || "all";
      return this.cards.filter(({ item }) => {
        const issues = issuesOf(item).map((i) => i.key);
        const shown = item.trangThai === "hidden" || issues.includes("invalidPrice") ? "hidden" : "orderable";
        const text2 = searchText([item.ma, item.ten, item.hang, item.nguon, item.loai, item.nhom, item.gioiTinh, (item.size ?? []).map((s) => s.size).join(" ")].join(" "));
        return (!query || text2.includes(query)) && (kind === "all" || str(item.loai) === kind) && (brand === "all" || item.hang === brand) && (state === "all" || shown === state) && (issue === "all" || issues.includes(issue));
      });
    }
    draw() {
      const list = this.filtered();
      const grid = el("sua-nhanh-bang");
      clear(grid);
      const base = str(this.ctx.shell.license()?.diaChiLanding).replace(/\/+$/, "");
      for (const card of list.slice(0, this.visible)) grid.appendChild(this.card(card, base));
      if (list.length === 0) grid.appendChild(h("div", { class: "copy-box" }, "Chưa có sản phẩm phù hợp."));
      const more = el("sn-xem-them");
      clear(more);
      if (this.visible < list.length) {
        more.appendChild(h("button", { class: "secondary-button", type: "button", "data-action": "load-more-landing-quick-edit" }, `Xem thêm ${Math.min(PAGE, list.length - this.visible)} sản phẩm`));
      }
    }
    /** Desk `landingQuickEditCard`. */
    card(state, base) {
      const { item, now } = state;
      const bind = (node, fieldName) => {
        node.setAttribute("data-quick-field", fieldName);
        node.addEventListener("input", () => {
          now[fieldName] = node.value;
        });
        node.addEventListener("change", () => {
          now[fieldName] = node.value;
        });
        return node;
      };
      const input = (fieldName, placeholder, cls = "") => bind(h("input", { value: now[fieldName], placeholder, "aria-label": placeholder, ...cls ? { class: cls } : {}, ...NUMERIC.includes(fieldName) ? { inputmode: "numeric" } : {} }), fieldName);
      const issues = issuesOf(item);
      const sizes = (item.size ?? []).filter((s) => Number(s.ton) > 0);
      const list = Number(item.giaNiemYet || 0);
      const discount = list > 0 && item.gia > 0 && item.gia < list ? Math.round((1 - item.gia / list) * 100) : 0;
      const mode = str(item.cheDoGia) || "source";
      const statusSelect = bind(h(
        "select",
        { "aria-label": "Trạng thái" },
        h("option", { value: "orderable", ...now.status !== "hidden" ? { selected: true } : {} }, "Đang bán"),
        h("option", { value: "hidden", ...now.status === "hidden" ? { selected: true } : {} }, "Tạm ẩn")
      ), "status");
      const more = h(
        "details",
        { class: "landing-web-card-more" },
        h("summary", null, `Thông tin khác${issues.length ? ` · ${issues.length} cảnh báo` : ""}`),
        issues.length ? h("div", { class: "landing-issue-list" }, ...issues.map((i) => h("span", { class: `badge ${i.color}` }, i.label))) : null,
        h("div", { class: "grid two" }, input("brand", "Hãng"), input("gender", "Giới tính")),
        h("div", { class: "grid two" }, statusSelect, h("span", { class: "subtle" }, item.nguon || "TopRun")),
        h(
          "div",
          { class: "landing-web-card-meta" },
          `${item.nguon || "TopRun"} · ${sizes.length} size${discount ? ` · Sale ${discount}%` : ""}`,
          item.giaNguon ? ` · Nguồn ${money(item.giaNguon)}` : "",
          item.giaTay ? ` · Giá tay ${money(item.giaTay)}` : ""
        ),
        item.canhBaoGia ? h("div", { class: "landing-price-warning" }, item.canhBaoGia) : null,
        h(
          "div",
          { class: "landing-web-card-links" },
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "edit-landing-product", "data-code": item.ma }, "Chi tiết"),
          item.giaTay ? h("button", { class: "ghost-button compact-button", type: "button", "data-action": "reset-landing-manual-price", "data-code": item.ma }, "Dùng lại giá nguồn") : null
        )
      );
      const src = imageSrc(str(item.anh), base);
      return h(
        "article",
        { class: "landing-web-edit-card", "data-quick-product": item.ma },
        h("div", { class: "landing-web-card-media" }, src ? h("img", { src, alt: "" }) : h("span", null, item.ma)),
        h(
          "div",
          { class: "landing-web-card-body" },
          h("strong", { class: "landing-web-card-name" }, [item.hang, item.ten, item.ma].filter(Boolean).join(" ")),
          h("div", { class: "landing-web-card-code" }, item.ma),
          input("name", "Tên sản phẩm", "landing-web-name-input"),
          h("div", { class: "landing-web-price-row" }, input("listPrice", "Niêm yết", "landing-web-list-price"), input("salePrice", "Giá sale", "landing-web-sale-price")),
          h("div", { class: `landing-price-status${mode === "source_higher_than_manual" ? " warning" : item.giaTay ? " manual" : ""}` }, priceStatusText(mode, Number(item.giaTay ?? 0))),
          h("div", { class: "landing-web-fast-fields" }, bind(kindSelect(now.productKind, { "aria-label": "Phân loại" }), "productKind"), input("category", "Môn thể thao")),
          more
        )
      );
    }
    async save() {
      const line = el("sua-nhanh-trang-thai");
      const changed = [];
      for (const card of this.cards) {
        const patch = { ma: card.item.ma };
        for (const f of Object.keys(WIRE)) {
          const before = NUMERIC.includes(f) ? digits(card.was[f]) : card.was[f].trim();
          const after = NUMERIC.includes(f) ? digits(card.now[f]) : card.now[f].trim();
          if (before === after) continue;
          if (f === "name" && after === "") continue;
          if (f === "salePrice" && after === 0) continue;
          patch[WIRE[f]] = after;
        }
        if (Object.keys(patch).length > 1) changed.push(patch);
      }
      if (changed.length === 0) {
        status(line, "Chưa sửa thẻ nào.", "bad");
        return;
      }
      status(line, `Đang lưu ${changed.length} món…`);
      const r = await this.ctx.gateway.landing("hang.sua-nhanh", { mon: changed });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const done = new Set(r.than?.daSua ?? []);
      const missing = r.than?.khongThay ?? [];
      for (const card of this.cards) if (done.has(card.item.ma)) card.was = { ...card.now };
      status(line, `Đã sửa ${done.size} món${missing.length === 0 ? "." : `; không thấy mã: ${missing.join(", ")}.`}`, missing.length === 0 ? "good" : "bad");
      void this.loadUndo();
    }
    async resetPrice(code) {
      const line = el("sua-nhanh-trang-thai");
      const r = await this.ctx.gateway.landing("hang.ve-gia-nguon", { ma: code });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadItems();
      status(line, `Đã dùng lại giá nguồn cho ${code}.`, "good");
    }
    async loadUndo() {
      const r = await this.ctx.gateway.landing("hang.hoan-tac.xem", {});
      const head = r.ok ? r.than?.hoanTac ?? null : null;
      const button = el("nut-sua-nhanh-hoan-tac");
      button.disabled = head === null;
      button.textContent = head === null ? "Hoàn tác" : `Hoàn tác: ${head.nhan}`;
    }
    async undo() {
      const line = el("sua-nhanh-trang-thai");
      const r = await this.ctx.gateway.landing("hang.hoan-tac", {});
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      await this.loadItems();
      status(line, `Đã hoàn tác "${str(r.than?.daHoanTac?.nhan)}".`, "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/settings.ts
  function kv(label, id) {
    return h("div", { class: "kv-row" }, h("span", null, label), h("b", { id }, "—"));
  }
  var SettingsView = class extends View {
    id = "cai-dat";
    label = "Cấu hình";
    title = "Cấu hình";
    workspace = "common";
    glyph = "⚙";
    build(root) {
      root.append(
        h(
          "div",
          { class: "grid two" },
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel-header" }, h("div", null, h("h3", null, "License của máy này"))),
            h(
              "div",
              { class: "kv" },
              kv("Shop", "cd-shop"),
              kv("Key", "cd-key"),
              kv("Mảnh đã mua", "cd-manh"),
              kv("Hết hạn", "cd-het-han"),
              kv("Máy này", "cd-may"),
              kv("Vé máy", "cd-ve"),
              kv("Landing của shop", "cd-landing"),
              kv("Quản lý máy", "cd-trang-may")
            ),
            h(
              "div",
              { class: "panel-body" },
              h(
                "div",
                { class: "toolbar" },
                h("button", { class: "secondary-button", id: "nut-cd-kiem-lai", type: "button", onclick: () => void this.recheck() }, "Kiểm lại license"),
                h("button", { class: "danger-button", id: "nut-cd-roi", type: "button" }, "Rời key khỏi máy này"),
                h("span", { class: "status-line", id: "cd-trang-thai" })
              ),
              h("p", { class: "subtle" }, "Mỗi key dùng được 3 máy. Máy đầu tiên nhập key là máy trực (chạy Zalo, Facebook cá nhân). Đổi máy trực hay bỏ máy: vào trang quản lý máy ở trên, nhập key.")
            )
          ),
          h(
            "section",
            { class: "panel" },
            h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Nối với Xeon"), h("p", null, "Chỉ đổi khi nơi cấp phần mềm bảo đổi."))),
            h(
              "div",
              { class: "panel-body" },
              h(
                "div",
                { class: "form-grid" },
                h("label", { for: "cd-xeon" }, "Địa chỉ Xeon"),
                h("input", { id: "cd-xeon", type: "text", placeholder: "https://xeon.toprun.vn" }),
                h("label", { for: "cd-ten-may" }, "Tên máy này"),
                h("input", { id: "cd-ten-may", type: "text", placeholder: "máy bán hàng 1" })
              ),
              h(
                "div",
                { class: "toolbar" },
                h("button", { class: "secondary-button", id: "nut-cd-xeon-thu", type: "button", onclick: () => void this.tryXeon() }, "Thử nối"),
                h("button", { class: "primary-button", id: "nut-cd-xeon-luu", type: "button", onclick: () => void this.saveXeon() }, "Lưu"),
                h("span", { class: "status-line", id: "cd-xeon-trang-thai" })
              )
            )
          )
        )
      );
      confirmTwice(el("nut-cd-roi"), "Bấm lần nữa để rời key", () => void this.leave());
    }
    licenseChanged(license2) {
      if (license2 === null) return;
      el("cd-shop").textContent = `${str(license2.tenShop)}${license2.shop ? ` (${license2.shop})` : ""}`;
      el("cd-key").textContent = str(license2.keyChe);
      el("cd-manh").textContent = license2.manh.length ? license2.manh.join(", ") : "—";
      el("cd-het-han").textContent = day(license2.hetHan);
      el("cd-may").textContent = `${str(license2.tenMay)}${license2.truc ? " · MÁY TRỰC" : ""}`;
      el("cd-ve").textContent = `sống tới ${day(license2.veHetLuc)} ${clock(license2.veHetLuc)} · kiểm lúc ${clock(license2.kiemLuc)}`;
      el("cd-landing").textContent = str(license2.diaChiLanding) || "chưa đăng ký";
      el("cd-trang-may").textContent = `${str(license2.xeon)}/may`;
      const xeon = el("cd-xeon");
      if (xeon.value.trim() === "") xeon.value = str(license2.xeon);
      const name = el("cd-ten-may");
      if (name.value.trim() === "") name.value = str(license2.tenMay);
      void this.ctx.gateway.landing("giay-phep").then((r) => {
        if (r.ok && r.than?.tenManh) el("cd-manh").textContent = r.than.tenManh.join(", ") || "—";
      });
    }
    async recheck() {
      const line = el("cd-trang-thai");
      status(line, "Đang kiểm với Xeon…");
      try {
        const screen = await this.ctx.gateway.recheck();
        status(line, screen.man === "dang-dung" ? "Đã kiểm." : "viSao" in screen ? screen.viSao : "", screen.man === "dang-dung" ? "good" : "bad");
        this.ctx.shell.applyScreen(screen);
      } catch (e) {
        status(line, humanError(e), "bad");
      }
    }
    async leave() {
      const line = el("cd-trang-thai");
      try {
        const r = await this.ctx.gateway.leave();
        if (!r.ok) {
          status(line, r.viSao, "bad");
          return;
        }
        this.ctx.shell.forgetLicensed();
        this.ctx.shell.applyScreen(r.man);
      } catch (e) {
        status(line, humanError(e), "bad");
      }
    }
    async tryXeon() {
      status(el("cd-xeon-trang-thai"), "Đang thử…");
      const r = await this.ctx.gateway.settings("thu-noi", { xeon: el("cd-xeon").value });
      status(el("cd-xeon-trang-thai"), r.viSao, r.ok ? "good" : "bad");
    }
    async saveXeon() {
      const r = await this.ctx.gateway.settings("luu", { xeon: el("cd-xeon").value, tenMay: el("cd-ten-may").value });
      status(el("cd-xeon-trang-thai"), r.viSao, r.ok ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/views/shipping.ts
  var SHEET_HEADER = ["Mã đơn", "Người nhận", "Điện thoại", "Tỉnh/Thành", "Quận/Huyện", "Phường/Xã", "Địa chỉ", "COD", "Nội dung hàng", "Ghi chú"];
  var CARRIERS2 = [["spx", "SPX"], ["vtp", "Viettel Post"]];
  var PAYER_LABEL = { shop: "Shop trả", customer: "Khách trả", "": "—" };
  var STATE_LABEL = {
    "": "Chờ ship",
    pending: "Chờ lấy hàng",
    picked_up: "Đã lấy hàng",
    in_transit: "Đang giao",
    delivering: "Đang giao",
    delivered: "Đã giao",
    delivery_failed: "Giao thất bại",
    returning: "Đang hoàn",
    returned: "Đã hoàn",
    cancelled: "Đã huỷ"
  };
  var ShippingView = class extends View {
    id = "van-don";
    label = "Vận đơn";
    title = "Vận đơn & giao hàng";
    workspace = "landing";
    glyph = "VD";
    rows = [];
    lines = [];
    picked = /* @__PURE__ */ new Set();
    /** Carrier chosen per row (row key → spx/vtp); empty = the shop's default. */
    carrierOf = /* @__PURE__ */ new Map();
    actions = {
      "batch-create-shipments": () => this.batchCreate(),
      "dismiss-batch-results": () => {
        clear(el("vd-ket-qua-loat"));
        el("vd-ket-qua-khung").classList.add("omi-an");
      },
      "toggle-all-shipping-orders": () => this.toggleAll(),
      "create-shipping-shipment": (b) => this.createWaybill(str(b.dataset["orderId"]), str(b.dataset["parcelId"])),
      "get-shipping-label": (b) => this.printLabel(str(b.dataset["slip"])),
      "cancel-shipping-shipment": (b) => this.cancel(b),
      "toggle-external-cod": (b) => this.externalCod(b),
      "sync-manual-shipments": () => this.sync(),
      "sync-spx-tracking": () => this.sync(),
      "sync-viettelpost-tracking": () => this.sync(),
      "load-shipping-report": () => this.loadReport(),
      "export-external-shipping": () => this.exportSheet()
    };
    build(root) {
      const filter = h(
        "select",
        { id: "vd-loc" },
        h("option", { value: "ready" }, "Chờ ship (chưa có mã)"),
        h("option", { value: "tracking" }, "Đã có mã vận đơn"),
        h("option", { value: "external" }, "Ship ngoài"),
        h("option", { value: "all" }, "Tất cả")
      );
      filter.addEventListener("change", () => this.drawRows());
      const toolbar = h(
        "div",
        { class: "shipping-export-toolbar" },
        h(
          "div",
          null,
          h("h3", null, "Vận đơn"),
          h("p", { class: "subtle" }, "Mỗi kiện một dòng. Tạo vận đơn hàng loạt, in phiếu gửi, huỷ ở hãng, rồi đồng bộ hành trình + phí về.")
        ),
        h(
          "div",
          { class: "split-actions" },
          h("div", { class: "field shipping-status-filter" }, h("label", { for: "vd-loc" }, "Trạng thái vận đơn"), filter),
          h("span", { class: "badge blue", id: "vd-dem" }, "0 dòng"),
          h("button", { class: "secondary-button", id: "nut-van-don-tai", type: "button", onclick: () => void this.loadOrders() }, "Tải đơn"),
          h("button", { class: "secondary-button", id: "nut-vd-dong-bo", type: "button", "data-action": "sync-manual-shipments" }, "Đồng bộ hành trình"),
          h("button", { class: "primary-button", id: "nut-vd-tao-loat", type: "button", "data-action": "batch-create-shipments" }, "Tạo vận đơn hàng loạt"),
          h("button", { class: "secondary-button", id: "nut-van-don-xuat", type: "button", "data-action": "export-external-shipping" }, "Xuất file Ship ngoài")
        )
      );
      const batch = h(
        "div",
        { class: "inline-panel omi-an", id: "vd-ket-qua-khung" },
        h(
          "div",
          { class: "section-title-row" },
          h("strong", null, "Kết quả tạo vận đơn hàng loạt"),
          h("button", { class: "secondary-button compact-button", id: "nut-vd-dong-ket-qua", type: "button", "data-action": "dismiss-batch-results" }, "Đóng")
        ),
        h("div", { id: "vd-ket-qua-loat" })
      );
      const list = h(
        "section",
        { class: "panel" },
        h(
          "div",
          { class: "panel-header" },
          h("div", null, h("h3", null, "Vận đơn"), h("p", null, "Theo dõi đơn vị vận chuyển, mã vận đơn và trạng thái giao hàng. Xuất tệp KHÔNG đánh dấu đơn là đã gửi.")),
          h("button", { class: "secondary-button compact-button", id: "nut-vd-chon-het", type: "button", "data-action": "toggle-all-shipping-orders" }, "Chọn tất cả")
        ),
        h(
          "div",
          { class: "panel-body" },
          toolbar,
          h("p", { class: "status-line", id: "van-don-trang-thai" }, "Bấm để tải."),
          batch,
          table(["", "Đơn hàng", "Khách", "Sản phẩm", "Nơi nhận", "COD", "Đơn vị", "Người trả ship", "Mã vận đơn", "Trạng thái", ""], "van-don-bang")
        )
      );
      const single = h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Tạo vận đơn cho một đơn"))),
        h(
          "div",
          { class: "panel-body" },
          h(
            "div",
            { class: "toolbar" },
            h("input", { id: "vd-ma-don", type: "text", placeholder: "Mã đơn" }),
            h("input", { id: "vd-hang", type: "text", class: "short", placeholder: "Hãng (spx / vtp)" }),
            h("input", { id: "vd-can-nang", type: "text", class: "short", placeholder: "Cân nặng (kg)" }),
            h("button", { class: "primary-button", id: "nut-van-don-tao", type: "button", onclick: () => void this.createWaybill() }, "Tạo vận đơn")
          ),
          h("input", { id: "vd-dan-do", type: "text", placeholder: "Dặn dò cho shipper (không bắt buộc)" }),
          h("p", { class: "status-line", id: "vd-tao-trang-thai" }, "Thiếu khoá hãng thì máy chủ nói rõ thiếu gì, và không gọi hãng.")
        )
      );
      const track = h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-header" }, h("div", null, h("h3", null, "Kiện đang ở đâu"))),
        h(
          "div",
          { class: "panel-body" },
          h(
            "div",
            { class: "toolbar" },
            h("input", { id: "vd-tra-ma", type: "text", placeholder: "Mã đơn hoặc mã vận đơn" }),
            h("button", { class: "secondary-button", id: "nut-van-don-tra", type: "button", onclick: () => void this.track() }, "Tra vận đơn")
          ),
          h("p", { class: "status-line", id: "vd-tra-ket-qua" }, "—")
        )
      );
      const report = h(
        "section",
        { class: "panel" },
        h(
          "div",
          { class: "panel-header" },
          h("div", null, h("h3", null, "Báo cáo vận chuyển"), h("p", null, "COD dự kiến so với COD hãng đã thu, phí ship thật, kiện hoàn và kiện giao lỗi.")),
          h("button", { class: "secondary-button compact-button", id: "nut-vd-bao-cao", type: "button", "data-action": "load-shipping-report" }, "Tải báo cáo")
        ),
        h(
          "div",
          { class: "panel-body" },
          h(
            "div",
            { class: "grid three" },
            metric("Vận đơn", "vd-bc-so", "Không tính vận đơn đã huỷ"),
            metric("Đang giao", "vd-bc-dang-giao", "Chưa tới trạng thái cuối"),
            metric("Đã giao", "vd-bc-da-giao", "Hãng báo giao xong"),
            metric("Hàng hoàn", "vd-bc-hoan", "Đang hoàn + đã hoàn"),
            metric("COD dự kiến / đã thu", "vd-bc-cod", "Theo số hãng trả"),
            metric("Phí ship thật", "vd-bc-phi", "Phí hãng tính")
          ),
          h("p", { class: "status-line", id: "vd-bc-trang-thai" }, "—"),
          table(["Mã phiếu", "Hãng", "Mã vận đơn", "Trạng thái", "COD", "Đã thu", "Phí", "Cập nhật", "Cảnh báo"], "vd-bc-bang")
        )
      );
      root.append(list, h("div", { class: "grid two" }, single, track), report);
    }
    load() {
      void this.loadOrders();
    }
    async loadOrders(quiet = false) {
      const line = el("van-don-trang-thai");
      if (!quiet) status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("van-don.danh-sach", { chuaCoVanDon: false, gioiHan: 200 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.rows = r.than ?? [];
      this.picked.clear();
      this.drawRows();
      if (!quiet) status(line, `${this.rows.length} đơn.`, "good");
    }
    /** Orders → one line per parcel, each with its own waybill when it has one. */
    allLines() {
      const out = [];
      for (const d of this.rows) {
        const parcels = d.kien ?? [];
        const slips = d.vanDonKien ?? [];
        if (parcels.length === 0) {
          out.push({ key: d.id, order: d, parcel: null, code: str(d.maVanDon), carrier: str(d.hangVanChuyen), state: str(d.trangThaiGiao) });
          continue;
        }
        for (const p of parcels) {
          const s = slips.find((x) => x.maKien === p.maKien);
          out.push({ key: p.maKien, order: d, parcel: p, code: str(s?.maVanDon), carrier: str(s?.hang), state: str(s?.trangThaiGiao) });
        }
      }
      return out;
    }
    drawRows() {
      const mode = el("vd-loc").value;
      this.lines = this.allLines().filter((l) => {
        const external = l.order.cachGiao === "external";
        if (mode === "ready") return l.code === "" && !external;
        if (mode === "tracking") return l.code !== "";
        if (mode === "external") return external;
        return true;
      });
      const body = el("van-don-bang");
      clear(body);
      for (const l of this.lines) body.appendChild(this.row(l));
      if (this.lines.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "11" }, "Chưa có đơn cần tạo vận đơn.")));
      el("vd-dem").textContent = `${this.lines.length}/${this.allLines().length} dòng`;
    }
    row(l) {
      const d = l.order;
      const tick = h("input", { type: "checkbox", checked: this.picked.has(l.key) });
      tick.addEventListener("change", () => {
        if (tick.checked) this.picked.add(l.key);
        else this.picked.delete(l.key);
      });
      const cod = l.parcel === null ? d.cod : l.parcel.cod;
      const where = [d.xa, d.huyen, d.tinh].filter((x) => str(x) !== "").join(", ");
      const head = h(
        "div",
        null,
        h("strong", null, d.id),
        l.parcel === null ? null : h("div", { class: "subtle" }, badge(`kiện ${l.parcel.thuTu}${l.parcel.tenKho ? ` · ${l.parcel.tenKho}` : ""}`, "violet"), " Mã kiện: ", h("strong", null, l.key)),
        h("div", { class: "subtle" }, day(d.taoLuc))
      );
      const external = d.cachGiao === "external";
      const carrier = h(
        "select",
        { "data-shipping-carrier": l.key, disabled: l.code !== "" || external },
        ...CARRIERS2.map(([v, t]) => h("option", { value: v, selected: (this.carrierOf.get(l.key) ?? (l.carrier || "spx")) === v }, t))
      );
      carrier.addEventListener("change", () => this.carrierOf.set(l.key, carrier.value));
      const state = external ? cod <= 0 ? "Ship ngoài · đã thu COD" : "Ship ngoài" : l.code === "" ? "Chờ ship" : STATE_LABEL[l.state] ?? l.state;
      const tr = tableRow([
        tick,
        head,
        d.khach,
        str(d.tenMon) || `${d.soMon} món`,
        where || "—",
        money(cod),
        external ? "Ship ngoài" : carrier,
        PAYER_LABEL[str(d.nguoiTraShip)] ?? str(d.nguoiTraShip),
        l.code || "Chưa có",
        state,
        this.rowActions(l, cod)
      ], [5]);
      if (l.parcel !== null) tr.dataset["kien"] = l.key;
      tr.addEventListener("click", (e) => {
        const t = e.target;
        if (t !== tick && t.tagName !== "SELECT" && t.tagName !== "BUTTON") el("vd-ma-don").value = d.id;
      });
      return tr;
    }
    /** Desk's action cell: external → "Đã thu COD"; has waybill → label + cancel; none → create. */
    rowActions(l, cod) {
      if (l.order.cachGiao === "external") {
        return cod <= 0 ? "" : h("button", { class: "primary-button compact-button", type: "button", "data-action": "toggle-external-cod", "data-order-id": l.order.id, "data-cod": String(cod) }, "Đã thu COD");
      }
      if (l.code !== "") {
        return h(
          "div",
          { class: "split-actions" },
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "get-shipping-label", "data-slip": l.key }, `Phiếu gửi ${l.carrier === "vtp" ? "Viettel Post" : "SPX"}`),
          h("button", { class: "secondary-button compact-button", type: "button", "data-action": "cancel-shipping-shipment", "data-slip": l.key }, "Hủy VĐ")
        );
      }
      return h("button", { class: "primary-button compact-button", type: "button", "data-action": "create-shipping-shipment", "data-order-id": l.order.id, "data-parcel-id": l.parcel === null ? "" : l.key }, "Tạo vận đơn");
    }
    toggleAll() {
      const all = this.lines.filter((l) => l.code === "");
      const every = all.length > 0 && all.every((l) => this.picked.has(l.key));
      this.picked.clear();
      if (!every) for (const l of all) this.picked.add(l.key);
      this.drawRows();
      status(el("van-don-trang-thai"), every ? "Đã bỏ chọn." : `Đã chọn ${this.picked.size} dòng chưa có vận đơn.`, "good");
    }
    async batchCreate() {
      const line = el("van-don-trang-thai");
      const chosen = this.lines.filter((l) => this.picked.has(l.key) && l.code === "" && l.order.cachGiao !== "external");
      if (chosen.length === 0) {
        status(line, "Tích chọn các dòng chưa có vận đơn trước.", "bad");
        return;
      }
      if (chosen.length > 50) {
        status(line, "Tối đa 50 dòng một lần.", "bad");
        return;
      }
      status(line, `Đang tạo ${chosen.length} vận đơn…`);
      const byCarrier = /* @__PURE__ */ new Map();
      for (const l of chosen) {
        const c = this.carrierOf.get(l.key) ?? (l.carrier || "spx");
        byCarrier.set(c, [...byCarrier.get(c) ?? [], l]);
      }
      const lines2 = [];
      let made = 0;
      for (const [hang, group] of byCarrier) {
        const r = await this.ctx.gateway.landing(
          "van-don.tao-hang-loat",
          { hang, phieu: group.map((l) => ({ maDon: l.order.id, ...l.parcel === null ? {} : { maKien: l.key } })) }
        );
        if (!r.ok) {
          lines2.push(`${hang.toUpperCase()}: ${r.viSao}`);
          continue;
        }
        made += r.than?.soTao ?? 0;
        for (const k of r.than?.ketQua ?? []) {
          lines2.push(`${k.maKien || k.maDon}: ${k.ok ? `✓ ${str(k.maVanDon)}` : `✗ ${str(k.loiNhan)}`}`);
        }
      }
      const box = el("vd-ket-qua-loat");
      clear(box);
      for (const t of lines2) box.appendChild(h("div", null, t));
      el("vd-ket-qua-khung").classList.remove("omi-an");
      status(line, `Đã tạo ${made}/${chosen.length} vận đơn.`, made === chosen.length ? "good" : "bad");
      await this.loadOrders(true);
    }
    async createWaybill(orderId = "", parcelId = "") {
      const line = el("vd-tao-trang-thai");
      const id = str(orderId) || el("vd-ma-don").value.trim();
      if (id === "") {
        status(line, "Nhập mã đơn trước.", "bad");
        return;
      }
      const key = parcelId || id;
      status(line, `Đang tạo vận đơn cho ${key}…`);
      const typed = el("vd-hang").value.trim();
      const r = await this.ctx.gateway.landing("van-don.tao-tu-don", {
        maDon: id,
        ...parcelId === "" ? {} : { maKien: parcelId },
        hang: orderId === "" ? typed : this.carrierOf.get(key) ?? typed,
        canNangKg: Number(el("vd-can-nang").value.replace(",", ".")) || 0,
        danDo: el("vd-dan-do").value.trim()
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const b = r.than ?? {};
      const missing = Array.isArray(b["thieu"]) ? b["thieu"] : [];
      if (missing.length > 0) {
        status(line, `Chưa tạo được: thiếu ${missing.join(", ")}.`, "bad");
        return;
      }
      status(line, `Đơn ${key}: vận đơn ${str(b["maVanDon"]) || "(hãng chưa trả mã)"} — ${str(b["hang"])}.`, "good");
      void this.loadOrders();
    }
    /** The carrier's printable label: the landing asks the carrier for a link; we copy it for the seller. */
    async printLabel(slip) {
      const line = el("van-don-trang-thai");
      status(line, `Đang lấy phiếu gửi ${slip}…`);
      const r = await this.ctx.gateway.landing("van-don.nhan", { maPhieu: slip });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const link = str(r.than?.duongDan);
      if (link === "") {
        status(line, str(r.than?.loiNhan) || "Hãng chưa trả phiếu.", "bad");
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        status(line, `Đã copy link phiếu gửi ${slip} — dán vào trình duyệt để in: ${link}`, "good");
      } catch {
        status(line, `Phiếu gửi ${slip}: ${link}`, "good");
      }
    }
    /** Cancelling at the carrier loses the waybill: two clicks, like every destructive button. */
    async cancel(button) {
      const slip = str(button.dataset["slip"]);
      if (button.dataset["confirm"] !== "1") {
        button.dataset["confirm"] = "1";
        button.textContent = "Bấm lần nữa để huỷ";
        return;
      }
      const line = el("van-don-trang-thai");
      status(line, `Đang huỷ vận đơn ${slip} ở hãng…`);
      const r = await this.ctx.gateway.landing("van-don.huy", { maPhieu: slip });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        button.dataset["confirm"] = "";
        button.textContent = "Hủy VĐ";
        return;
      }
      status(line, str(r.than?.loiNhan) || `Đã huỷ vận đơn ${slip}.`, "good");
      await this.loadOrders(true);
    }
    /** Ship ngoài: no carrier to report the money, so the seller records the COD they collected. */
    async externalCod(button) {
      const orderId = str(button.dataset["orderId"]);
      const cod = Number(button.dataset["cod"] ?? 0);
      const line = el("van-don-trang-thai");
      if (cod <= 0) {
        status(line, "Đơn này không còn COD để thu.", "bad");
        return;
      }
      status(line, `Đang ghi đã thu ${money(cod)} cho ${orderId}…`);
      const r = await this.ctx.gateway.landing("don.ghi-tien", { maDon: orderId, soTien: cod, ghiChu: "Thu COD ship ngoài" });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Đã ghi thu COD ${money(cod)} cho ${orderId}.`, "good");
      await this.loadOrders(true);
    }
    async sync() {
      const line = el("van-don-trang-thai");
      status(line, "Đang hỏi hãng hành trình + phí…");
      const r = await this.ctx.gateway.landing("van-don.dong-bo", {});
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const errors = r.than?.loi ?? [];
      status(line, `Đã kiểm ${r.than?.daKiem ?? 0} vận đơn, cập nhật ${(r.than?.capNhat ?? []).length}.${errors.length > 0 ? ` Lỗi: ${errors.slice(0, 3).join("; ")}` : ""}`, errors.length > 0 ? "bad" : "good");
      await this.loadOrders(true);
    }
    async loadReport() {
      const line = el("vd-bc-trang-thai");
      status(line, "Đang tải báo cáo…");
      const r = await this.ctx.gateway.landing("van-don.bao-cao");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const t = r.than?.tong ?? {};
      el("vd-bc-so").textContent = String(t["soVanDon"] ?? 0);
      el("vd-bc-dang-giao").textContent = String(t["dangGiao"] ?? 0);
      el("vd-bc-da-giao").textContent = String(t["daGiao"] ?? 0);
      el("vd-bc-hoan").textContent = String(t["hoan"] ?? 0);
      el("vd-bc-cod").textContent = `${money(t["codDuKien"] ?? 0)} / ${money(t["codDaThu"] ?? 0)}`;
      el("vd-bc-phi").textContent = money(t["phi"] ?? 0);
      const body = el("vd-bc-bang");
      clear(body);
      for (const d of r.than?.dong ?? []) {
        const state = d.daHuy ? badge("đã huỷ", "red") : STATE_LABEL[d.trangThaiGiao] ?? (d.trangThai || "—");
        const warn = d.canhBao.length === 0 ? "—" : badge(d.canhBao.join(" · "), "amber");
        body.appendChild(tableRow([
          d.maPhieu,
          d.hang.toUpperCase(),
          d.maVanDon,
          state,
          money(d.cod),
          d.codDaThu === null ? "—" : money(d.codDaThu),
          d.phi === null ? "—" : money(d.phi),
          day(d.capNhatLuc),
          warn
        ], [4, 5, 6]));
      }
      status(line, `${(r.than?.dong ?? []).length} vận đơn · ${t["canhBao"] ?? 0} cần xử lý.`, (t["canhBao"] ?? 0) > 0 ? "bad" : "good");
    }
    /**
     * Tệp nộp cho hãng / ship ngoài. Không ghi gì lên đơn — xem bất biến 1 ở đầu tệp.
     * MỖI KIỆN MỘT DÒNG, mang mã kiện (`ORD-1-01`) và COD của riêng kiện đó.
     */
    async exportSheet() {
      const line = el("van-don-trang-thai");
      const chosen = this.lines.filter((x) => this.picked.has(x.key));
      const take = chosen.length > 0 ? chosen : this.lines;
      if (take.length === 0) {
        status(line, "Không có đơn nào để xuất.", "bad");
        return;
      }
      const sheet = [SHEET_HEADER];
      for (const { key, order: d, parcel } of take) {
        sheet.push([key, d.khach, d.dienThoai, d.tinh, d.huyen, d.xa, d.diaChi, parcel?.cod ?? d.cod, d.tenMon, d.ghiChu]);
      }
      const r = await this.ctx.gateway.saveTable("van-don", sheet);
      if (!r.ok) {
        status(line, r.viSao || "Chưa lưu tệp.", "bad");
        return;
      }
      const parcelCount = take.filter((x) => x.parcel !== null).length;
      status(
        line,
        `Đã ghi ${r.tenTep} — ${take.length} dòng${parcelCount > 0 ? ` (${parcelCount} kiện tách kho)` : ""}. Đơn vẫn CHƯA được đánh dấu đã gửi.`,
        "good"
      );
    }
    async track() {
      const line = el("vd-tra-ket-qua");
      const code = el("vd-tra-ma").value.trim();
      if (code === "") {
        status(line, "Nhập mã đơn hoặc mã vận đơn.", "bad");
        return;
      }
      status(line, "Đang tra…");
      const r = await this.ctx.gateway.landing("van-don.tra", { maPhieu: code });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const b = r.than ?? {};
      if (b.ok === false) {
        status(line, str(b.loiNhan) || "Hãng chưa biết mã này.", "bad");
        return;
      }
      status(line, `${str(b.maVanDon)} · ${str(b.hang)} · ${str(b.trangThai) || "chưa rõ trạng thái"}${str(b.moTa) === "" ? "" : ` — ${str(b.moTa)}`}`, "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/site-content.ts
  var LAYOUT = [
    { rows: [
      [{ key: "heroEyebrow", label: "Eyebrow hero" }, { key: "heroTitle", label: "Tiêu đề hero" }],
      { key: "heroDescription", label: "Mô tả hero", kind: "area", rows: 3 },
      [{ key: "primaryButtonText", label: "Text nút chính" }, { key: "secondaryButtonText", label: "Text nút phụ" }],
      [{ key: "productSectionTitle", label: "Tiêu đề khu sản phẩm" }, { key: "productIntroTitle", label: "Tiêu đề giới thiệu sản phẩm" }],
      { key: "productIntroDefault", label: "Giới thiệu sản phẩm mặc định", kind: "area", rows: 5, hint: "Dùng {productName}, {productKind} để chèn tên và loại hàng." },
      { key: "orderNote", label: "Ghi chú đặt hàng", kind: "area", rows: 3 },
      [{ key: "cartNote", label: "Ghi chú giỏ hàng", kind: "area", rows: 3 }, { key: "contactNote", label: "Ghi chú liên hệ", kind: "area", rows: 3 }],
      [{ key: "shippingFeeDefault", label: "Phí ship mặc định (đồng)" }, { key: "soNgayHangOrder", label: "Hàng order mấy ngày về" }]
    ] },
    {
      title: "Chuyển khoản ngân hàng (VietQR) — STK nhận tiền của QR checkout & hóa đơn fanpage",
      note: "Để trống STK là khách không thấy QR ngân hàng và nút gửi mã CK trong Fanpage bị khóa.",
      rows: [
        [{ key: "bankCode", label: "Mã ngân hàng VietQR (VD: TCB)" }, { key: "bankName", label: "Tên ngân hàng (VD: Techcombank)" }],
        [{ key: "bankAccountNumber", label: "Số tài khoản nhận tiền" }, { key: "bankAccountName", label: "Chủ tài khoản (IN HOA không dấu)" }],
        { key: "bankInstruction", label: "Hướng dẫn chuyển khoản ngân hàng", kind: "area", rows: 3 }
      ]
    },
    { title: "Thanh toán MoMo cá nhân & chat nhanh", rows: [
      [{ key: "momoEnabled", label: "Bật QR MoMo cá nhân trên checkout", kind: "check" }, { key: "momoDepositPercent", label: "Tỷ lệ cần chuyển (%)" }],
      [{ key: "momoOwnerName", label: "Tên tài khoản MoMo" }, { key: "momoPhone", label: "Số MoMo cá nhân" }],
      [{ key: "momoQrImageUrl", label: "URL ảnh QR MoMo" }, { key: "momoTransferPrefix", label: "Tiền tố mã CK" }],
      { key: "momoInstruction", label: "Hướng dẫn chuyển khoản MoMo", kind: "area", rows: 3 },
      [{ key: "messengerUrl", label: "Link Messenger" }, { key: "zaloUrl", label: "Link Zalo OA/cá nhân" }],
      [{ key: "zaloPhone", label: "Số Zalo" }, { key: "chatMessageTemplate", label: "Tin nhắn mẫu khi khách bấm chat", hint: "{orderId}, {paymentReference}, {total}" }]
    ] },
    { title: "Email xác nhận đơn", rows: [
      { key: "orderEmailSubject", label: "Tiêu đề email", hint: "{orderId}" },
      { key: "orderEmailBody", label: "Nội dung email", kind: "area", rows: 8, hint: "{customerName}, {orderId}, {orderUrl}" }
    ] },
    { title: "Chính sách bot đọc", note: "Ba ô này là thứ bộ não đọc để trả lời khách về đổi trả, ship, bảo hành. Để trống thì bot chuyển người thật.", rows: [
      { key: "chinhSachDoiTra", label: "Chính sách đổi trả", kind: "area", rows: 3 },
      { key: "chinhSachShip", label: "Chính sách ship", kind: "area", rows: 3 },
      { key: "chinhSachBaoHanh", label: "Chính sách bảo hành", kind: "area", rows: 3 }
    ] }
  ];
  var ALL_FIELDS = LAYOUT.flatMap((b) => b.rows.flatMap((r) => Array.isArray(r) ? r : [r]));
  var SiteContentView = class extends View {
    id = "noi-dung";
    label = "Nội dung web";
    title = "Nội dung web";
    workspace = "landing";
    glyph = "ND";
    contentLoaded = false;
    actions = {
      "save-landing-content": () => this.save()
    };
    build(root) {
      const form = h("div", { class: "panel-body config-form" });
      for (const block of LAYOUT) {
        if (block.title) form.appendChild(h("div", { class: "section-title-row compact" }, h("h4", null, block.title)));
        for (const row of block.rows) {
          form.appendChild(Array.isArray(row) ? h("div", { class: "grid two" }, ...row.map((f) => this.field(f))) : this.field(row));
        }
        if (block.note) form.appendChild(h("p", { class: "subtle" }, block.note));
      }
      root.append(
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Nội dung web"), h("p", null, "Chỉnh các text mặc định của landing page mà không sửa code.")),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "secondary-button", id: "nut-noi-dung-tai", type: "button", onclick: () => void this.loadContent() }, "Tải lại"),
              h("button", { class: "primary-button", id: "nut-noi-dung-luu", type: "button", "data-action": "save-landing-content" }, "Lưu & cập nhật web")
            )
          ),
          h("span", { class: "status-line", id: "noi-dung-trang-thai" }, "Đang tải…"),
          form
        )
      );
    }
    field(f) {
      const id = `nd-${f.key}`;
      if (f.kind === "check") return h("label", { class: "check-row" }, h("input", { id, type: "checkbox" }), ` ${f.label}`);
      const input = f.kind === "area" ? h("textarea", { id, rows: String(f.rows ?? 3) }) : h("input", { id, type: "text" });
      return h("div", { class: "field" }, h("label", { for: id }, f.label), input, f.hint ? h("small", { class: "subtle" }, f.hint) : null);
    }
    load() {
      void this.loadContent();
    }
    async loadContent() {
      const line = el("noi-dung-trang-thai");
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("noi-dung.doc");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const content = r.than ?? {};
      for (const f of ALL_FIELDS) {
        const node = el(`nd-${f.key}`);
        if (f.kind === "check") node.checked = str(content[f.key]) === "true";
        else node.value = str(content[f.key]);
      }
      this.contentLoaded = true;
      status(line, "Sửa rồi bấm Lưu. Web đọc ngay sau khi lưu.", "good");
    }
    async save() {
      const line = el("noi-dung-trang-thai");
      if (!this.contentLoaded) {
        status(line, "Bấm Tải lại trước đã — chưa đọc được nội dung đang có.", "bad");
        return;
      }
      const changes = {};
      for (const f of ALL_FIELDS) {
        const node = el(`nd-${f.key}`);
        changes[f.key] = f.kind === "check" ? String(node.checked) : node.value;
      }
      status(line, "Đang lưu…");
      const r = await this.ctx.gateway.landing("noi-dung.ghi", { doi: changes });
      status(line, r.ok ? "Đã lưu — web đã đọc nội dung mới." : r.viSao, r.ok ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/views/stock-sync.ts
  var BATCH = 500;
  var StockSyncView = class extends View {
    id = "dong-bo-kho";
    label = "Đồng bộ kho";
    title = "Đồng bộ kho";
    workspace = "common";
    glyph = "ĐK";
    fromFile = [];
    build(root) {
      const select = (id, label, options2, onchange) => h(
        "div",
        { class: "field" },
        h("label", { for: id }, label),
        h("select", { id, onchange }, ...options2.map(([value, text2]) => h("option", { value }, text2)))
      );
      const step = (n, title, note, tag) => h("div", { class: "pipeline-step" }, h("div", { class: "pipeline-index" }, n), h("div", null, h("h4", null, title), h("p", null, note)), h("span", { class: "badge blue" }, tag));
      const importForm = h(
        "div",
        { class: "config-form" },
        h(
          "div",
          { class: "grid two" },
          select("importInputMode", "Kiểu đầu vào", [["excel", "Excel .xlsx / .xlsm"], ["google_sheet", "Google Sheet link"], ["csv", "CSV dự phòng"]], () => this.drawImportMode()),
          select("importSourceType", "Nguồn catalog", [["own", "Kho nội bộ của shop"], ["partner", "Kho đối tác"]], () => this.drawImportMode()),
          h(
            "div",
            { class: "field" },
            h("label", { for: "importSourceName", id: "importSourceNameLabel" }, "Tên kho"),
            h("input", { id: "importSourceName", placeholder: "Tên kho hoặc đối tác", disabled: true })
          ),
          select("importSizeSystem", "Hệ size trong file", [["EU", "EU"], ["US_MEN", "US Men"], ["UK", "UK"]], () => void 0)
        ),
        h(
          "div",
          { class: "field", id: "importSheetRow", hidden: true },
          h("label", { for: "importSheetURL" }, "Google Sheet URL"),
          h("input", { id: "importSheetURL", placeholder: "Dán link Google Sheet public hoặc link Publish to web CSV" })
        ),
        h(
          "div",
          { class: "field", id: "importFileRow" },
          h("label", null, "Chọn file"),
          h(
            "div",
            { class: "toolbar" },
            h("button", { class: "secondary-button", id: "nut-hang-chon-tep", type: "button", onclick: () => void this.pickFile() }, "Chọn tệp…"),
            h("span", { class: "status-line", id: "hang-tep-trang-thai" }, "Chưa chọn tệp.")
          ),
          h(
            "div",
            { id: "hang-tep-xem", hidden: true },
            h("p", { class: "subtle", id: "hang-tep-cot" }),
            h("div", { class: "table-wrap scroll" }, h("table", null, h("tbody", { id: "hang-tep-bang" }))),
            h(
              "div",
              { class: "toolbar" },
              h("button", { class: "primary-button", id: "nut-hang-nhap", type: "button", onclick: () => void this.importFile() }, "Nhập lên landing"),
              h("span", { class: "status-line", id: "hang-nhap-trang-thai" })
            )
          )
        ),
        h(
          "div",
          { class: "field", id: "importCsvRow", hidden: true },
          h("label", { for: "importCSV" }, "Dán CSV tồn kho"),
          h("textarea", { id: "importCSV", class: "code-textarea", rows: "8", placeholder: "product_code,product_name,brand,category,gender,color,size,stock_qty,sale_price,cost_price\nADZ-BOSTON12,adidas Adizero Boston 12,adidas,road_running,unisex,White/Blue,42,3,2890000,1900000" })
        ),
        h("div", { class: "subtle" }, "Import catalog chấp nhận cả nội bộ và đối tác để tạo sản phẩm mới hoặc làm mới nguồn tương ứng. Cùng một mã ở đối tác không cộng vào tồn nội bộ. Nghiệp vụ nhập thêm hàng của shop dùng Phiếu nhập kho nội bộ bên dưới."),
        h(
          "div",
          { class: "split-actions", id: "importSheetActions", hidden: true },
          h("button", { class: "secondary-button", type: "button", id: "nut-nhap-bang-xem", onclick: () => void this.importSheet(true) }, "Xem trước"),
          h("button", { class: "primary-button", type: "button", id: "nut-nhap-bang", "data-action": "import-inventory" }, "Import vào catalog"),
          h("button", { class: "secondary-button", type: "button", "data-action": "load-import-sample" }, "Dùng CSV mẫu")
        ),
        h("span", { class: "status-line", id: "importStatus" })
      );
      root.append(
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Pipeline đồng bộ kho"), h("p", null, "Đọc file Excel / Sheet / CSV, chuẩn hóa mã sản phẩm và size theo hãng trước khi đưa vào catalog.")),
            h(
              "div",
              { class: "split-actions" },
              h("button", { class: "secondary-button", type: "button", "data-action": "cache-product-images", "data-cache-scope": "all" }, "Tải gallery toàn bộ")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "stock-pipeline" },
              step("1", "Import", "Đọc file Excel / Google Sheet / CSV và nhận cột theo tiêu đề.", "Sheet"),
              step("2", "Code", "Gom các dòng size theo mã sản phẩm; SKU biến thể mặc định Mã-Size.", "Cross-check"),
              step("3", "Size", "Chuẩn hóa size US / UK / EU về size web (EU, chữ S–3XL).", "Brand rule"),
              step("4", "Merge", "Ghi theo mã + nguồn: hàng đối tác không cộng vào tồn của shop.", "Catalog"),
              step("5", "Publish", "Còn tồn thì lên web và bot tư vấn được; ảnh ngoài tải về landing.", "AI ready")
            ),
            h("span", { class: "status-line", id: "cacheImagesStatus" })
          )
        ),
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, "Import kho hàng"), h("p", null, "Đầu vào chính là file Excel .xlsx/.xlsm. Google Sheet public và CSV vẫn giữ làm phương án dự phòng.")),
            h("span", { class: "badge green" }, "Excel/Sheet ready")
          ),
          h(
            "div",
            { class: "panel-body import-layout" },
            importForm,
            h("div", { class: "inline-panel" }, h("h3", null, "Kết quả import gần nhất"), h("div", { id: "importResult", class: "subtle" }, "Chưa import lần nào trong phiên này."))
          )
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Những lần nạp gần đây"),
              h("p", null, "Máy chủ nhớ 50 lần gần nhất. Khi danh mục tự nhiên thiếu món, đây là chỗ đầu tiên để xem lần nạp nào đã làm gì.")
            ),
            h("button", { class: "secondary-button compact-button", id: "nut-lich-su-nap-tai", type: "button", onclick: () => void this.loadHistory() }, "Tải lại")
          ),
          table(["Lúc", "Nguồn", "Việc", "Số món", "Số size", "Bị bỏ"], "lich-su-nap-bang")
        ),
        // Phiếu nhập kho nội bộ — chép `internalInventoryReceiptTemplate` (Desk `app.js:7410`).
        h(
          "section",
          { class: "panel omi-section-gap" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Phiếu nhập kho nội bộ"),
              h("p", null, "Cộng thêm hàng vào kho của shop theo SKU biến thể. Có thể chọn nhiều dòng trong cùng một phiếu.")
            ),
            h("span", { class: "badge green" }, "Chỉ kho nội bộ")
          ),
          h(
            "div",
            { class: "panel-body" },
            h(
              "div",
              { class: "grid three" },
              this.field("inventoryReceiptSupplier", "Nhà cung cấp", "Tên nhà cung cấp"),
              this.field("inventoryReceiptLot", "Mã lô hàng", "VD: LOT-2026-05"),
              this.field("inventoryReceiptInvoice", "Số hóa đơn / chứng từ", "VD: HD-001")
            ),
            h(
              "div",
              { class: "field" },
              h("label", { for: "inventoryReceiptNote" }, "Ghi chú lô hàng"),
              h("textarea", { id: "inventoryReceiptNote", rows: "2", placeholder: "Điều kiện nhập, vận chuyển, ghi chú kiểm đếm..." })
            ),
            h(
              "div",
              { class: "field order-product-search omi-section-gap" },
              h("label", { for: "inventoryReceiptSearch" }, "Tìm SKU hoặc tên sản phẩm để thêm biến thể"),
              h(
                "div",
                { class: "field-inline" },
                h("input", { id: "inventoryReceiptSearch", placeholder: "Gõ SKU, mã hoặc tên sản phẩm", autocomplete: "off", onkeydown: (e) => {
                  if (e.key === "Enter") void this.lookupReceiptSku();
                } }),
                h("button", { class: "secondary-button", type: "button", "data-action": "lookup-inventory-receipt-sku" }, "Tìm")
              ),
              h("div", { id: "inventoryReceiptSuggestions", class: "order-sku-suggestions" })
            ),
            h(
              "div",
              { class: "table-wrap omi-section-gap" },
              h(
                "table",
                null,
                h("thead", null, h("tr", null, ...["Sản phẩm", "SKU biến thể", "Size", "Kho", "Tồn hiện tại", "Số lượng nhập", "Giá nhập", "Thành tiền", ""].map((t) => h("th", null, t)))),
                h("tbody", { id: "inventoryReceiptLines" })
              )
            ),
            h(
              "div",
              { class: "section-title-row omi-section-gap" },
              h("div", { class: "subtle", id: "inventoryReceiptTotal" }, "Tổng nhập: 0 sản phẩm · Giá trị lô: 0đ"),
              h("button", { class: "primary-button", type: "button", "data-action": "save-inventory-receipt" }, "Lưu phiếu và cộng tồn")
            ),
            h("span", { class: "status-line", id: "inventoryReceiptStatus" }),
            h(
              "div",
              { class: "omi-section-gap" },
              h("h3", null, "Phiếu nhập gần nhất"),
              h("div", { class: "table-wrap" }, h(
                "table",
                null,
                h("thead", null, h("tr", null, ...["Mã phiếu", "Ngày nhập", "Nhà cung cấp", "Ghi chú", "Số lượng", "Giá trị"].map((t) => h("th", null, t)))),
                h("tbody", { id: "inventoryReceiptHistory" })
              ))
            )
          )
        )
      );
      this.drawReceiptLines();
    }
    field(id, label, placeholder) {
      return h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, placeholder }));
    }
    /** Dòng của phiếu đang soạn: một biến thể (mã + size + kho) một dòng. */
    receiptLines = [];
    actions = {
      "lookup-inventory-receipt-sku": () => this.lookupReceiptSku(),
      "add-inventory-receipt-line": (b) => this.addReceiptLine(b),
      "remove-inventory-receipt-line": (b) => {
        this.receiptLines = this.receiptLines.filter((l) => l.key !== b.dataset["sku"]);
        this.drawReceiptLines();
      },
      "save-inventory-receipt": () => this.saveReceipt(),
      "import-inventory": () => this.importSheet(false),
      "load-import-sample": () => this.loadSample(),
      "cache-product-images": () => this.cacheAllImages()
    };
    /** Desk: Excel mode picks a file; Google Sheet mode shows the link box; CSV mode the paste box. */
    drawImportMode() {
      const mode = el("importInputMode").value;
      const own = el("importSourceType").value !== "partner";
      el("importFileRow").hidden = mode !== "excel";
      el("importSheetRow").hidden = mode !== "google_sheet";
      el("importCsvRow").hidden = mode !== "csv";
      el("importSheetActions").hidden = mode === "excel";
      const name = el("importSourceName");
      name.disabled = own;
      if (own) name.value = "";
      el("importSourceNameLabel").textContent = own ? "Tên kho" : "Tên đối tác";
    }
    /** Desk `load-import-sample` (sample rows without web links: the page may not carry outside addresses). */
    loadSample() {
      el("importInputMode").value = "csv";
      el("importSourceType").value = "own";
      el("importSizeSystem").value = "US_MEN";
      el("importCSV").value = [
        "product_code,sku,product_name,brand,category,gender,color,size,stock_qty,sale_price,cost_price,policy_note",
        "NB-SC-TRAINER,NB-SC-TRAINER-42,New Balance FuelCell SuperComp Trainer,New Balance,road_running,unisex,White/Green,US 9,2,3650000,2400000,Hàng kho nội bộ",
        "AS-NOVA4,AS-NOVA4-41,ASICS Novablast 4,ASICS,road_running,unisex,Blue,US 8,5,3150000,2100000,Hàng kho nội bộ"
      ].join("\n");
      this.drawImportMode();
      status(el("importStatus"), "Đã nạp CSV mẫu vào form import.", "good");
    }
    /** Google Sheet / CSV: the landing reads, converts sizes and (unless `preview`) writes. */
    async importSheet(preview) {
      const line = el("importStatus");
      const mode = el("importInputMode").value;
      if (mode === "excel") {
        status(line, "Kiểu Excel: bấm Chọn tệp… rồi Nhập lên landing.", "bad");
        return;
      }
      const args = {
        heSize: el("importSizeSystem").value,
        nguon: el("importSourceType").value,
        tenNguon: el("importSourceName").value.trim(),
        xemTruoc: preview,
        ...mode === "google_sheet" ? { sheetUrl: el("importSheetURL").value.trim() } : { csv: el("importCSV").value }
      };
      status(line, preview ? "Đang đọc bảng…" : "Đang import…");
      const r = await this.ctx.gateway.landing("hang.nhap-bang", args);
      if (!r.ok || r.than === null) {
        status(line, r.viSao, "bad");
        return;
      }
      const k = r.than;
      const box = el("importResult");
      clear(box);
      const stepRow = (n, title, detail, tag) => h("div", { class: "step" }, h("div", { class: "step-index" }, String(n)), h("div", null, h("h4", null, title), h("p", null, detail)), h("span", { class: "badge blue" }, tag));
      box.append(
        h("div", { class: "subtle" }, `${str(k.nguonDoc)} · ${el("importSourceType").value === "partner" ? el("importSourceName").value.trim() : "Kho nội bộ"}`),
        h(
          "div",
          { class: "workflow" },
          stepRow(1, "Đã đọc bảng", `${k.soDong ?? 0} dòng dữ liệu, ${(k.soDong ?? 0) - (k.boQua ?? 0)} dòng hợp lệ.`, "Import"),
          stepRow(2, "Quy về EU", `${k.soMonDoc ?? 0} sản phẩm, ${k.boQua ?? 0} dòng lỗi mã / size.`, "Size"),
          stepRow(3, "Cập nhật catalog", k.daGhi ? `${k.soMon ?? 0} sản phẩm · ${k.soBienThe ?? 0} size được thêm/cập nhật.` : "Chưa ghi — đang xem trước.", "Catalog")
        ),
        h("p", { class: "subtle" }, `Cột nhận: ${Object.entries(k.cot ?? {}).map(([f, c]) => `${f} = ${c}`).join(" · ") || "không"}`),
        ...(k.canhBao ?? []).map((w) => h("div", { class: "subtle" }, w)),
        h("div", { class: "table-wrap" }, h(
          "table",
          null,
          h("thead", null, h("tr", null, ...["Mã", "Tên", "Hãng", "Size:tồn"].map((t) => h("th", null, t)))),
          h("tbody", { id: "importResultRows" }, ...(k.xem ?? []).map((m) => tableRow([str(m.ma), str(m.ten), str(m.hang), str(m.size)])))
        ))
      );
      if (preview || !k.daGhi) {
        status(line, `Đọc được ${k.soMonDoc ?? 0} sản phẩm${k.boQua ? `, bỏ ${k.boQua} dòng` : ""}. ${preview ? "Kiểm tra rồi bấm Import vào catalog." : "Chưa ghi gì."}`, (k.soMonDoc ?? 0) > 0 ? "good" : "bad");
        return;
      }
      status(line, `Đã import ${k.soMon ?? 0} sản phẩm, ${k.soBienThe ?? 0} size.`, "good");
      await this.loadHistory();
    }
    /** Desk "Tải gallery toàn bộ": landing copies remote photos, a batch at a time. */
    async cacheAllImages() {
      const line = el("cacheImagesStatus");
      status(line, "Đang tải ảnh về landing…");
      const r = await this.ctx.gateway.landing("hang.tai-anh-ve", { tatCa: true });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Đã tải ${r.than?.taiDuoc ?? 0} ảnh từ ${r.than?.soMon ?? 0} sản phẩm${r.than?.hong ? `, ${r.than.hong} ảnh lỗi` : ""}.`, r.than?.hong ? "bad" : "good");
    }
    suggestions = [];
    async lookupReceiptSku() {
      const box = el("inventoryReceiptSuggestions");
      const query = el("inventoryReceiptSearch").value.trim();
      clear(box);
      if (query === "") return;
      const r = await this.ctx.gateway.landing("hang.tim", { tuKhoa: query, gioiHan: 12 });
      if (!r.ok) {
        box.appendChild(h("div", { class: "order-sku-empty" }, r.viSao));
        return;
      }
      this.suggestions = [];
      for (const item of r.than ?? []) {
        for (const size2 of item.size) {
          if (size2.nguon !== void 0 && size2.nguon !== "" && size2.nguon !== "own") continue;
          const warehouse = size2.maKho || "kho-chinh";
          this.suggestions.push({ key: `${item.ma}|${size2.size}|${warehouse}`, code: item.ma, name: item.ten, size: size2.size, warehouse, available: size2.ton, quantity: 1, unitCost: 0 });
        }
      }
      if (this.suggestions.length === 0) {
        box.appendChild(h("div", { class: "order-sku-empty" }, "Không tìm thấy SKU kho nội bộ phù hợp."));
        return;
      }
      for (const s of this.suggestions) {
        box.appendChild(h(
          "button",
          { type: "button", class: "order-sku-suggestion", "data-action": "add-inventory-receipt-line", "data-sku": s.key },
          h("span", { class: "order-sku-thumb" }, "SP"),
          h("span", { class: "order-sku-detail" }, h("strong", null, s.name), h("small", null, `${s.code} · size ${s.size} · ${s.warehouse}`)),
          h("span", { class: "order-sku-meta" }, h("small", null, `Tồn hiện tại: ${s.available}`))
        ));
      }
    }
    addReceiptLine(button) {
      const found = this.suggestions.find((s) => s.key === button.dataset["sku"]);
      if (found === void 0) return;
      if (!this.receiptLines.some((l) => l.key === found.key)) this.receiptLines.push({ ...found });
      clear(el("inventoryReceiptSuggestions"));
      el("inventoryReceiptSearch").value = "";
      this.drawReceiptLines();
    }
    drawReceiptLines() {
      const body = el("inventoryReceiptLines");
      clear(body);
      for (const line of this.receiptLines) {
        const input = (field) => h("input", {
          value: String(line[field]),
          inputmode: "numeric",
          class: "short",
          oninput: (e) => {
            line[field] = digits(e.target.value);
            this.drawReceiptTotal();
          }
        });
        body.appendChild(h(
          "tr",
          null,
          h("td", null, line.name),
          h("td", null, line.code),
          h("td", null, line.size),
          h("td", null, line.warehouse),
          h("td", { class: "num" }, String(line.available)),
          h("td", null, input("quantity")),
          h("td", null, input("unitCost")),
          h("td", { class: "num", "data-line-total": line.key }, money(line.quantity * line.unitCost)),
          h("td", null, h("button", { class: "ghost-button compact-button danger", type: "button", "data-action": "remove-inventory-receipt-line", "data-sku": line.key }, "Xóa"))
        ));
      }
      if (this.receiptLines.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "9", class: "subtle" }, "Chưa chọn biến thể.")));
      this.drawReceiptTotal();
    }
    drawReceiptTotal() {
      const qty = this.receiptLines.reduce((t, l) => t + l.quantity, 0);
      const cost = this.receiptLines.reduce((t, l) => t + l.quantity * l.unitCost, 0);
      el("inventoryReceiptTotal").textContent = `Tổng nhập: ${qty} sản phẩm · Giá trị lô: ${money(cost)}`;
      for (const cell of el("inventoryReceiptLines").querySelectorAll("[data-line-total]")) {
        const line = this.receiptLines.find((l) => l.key === cell.dataset["lineTotal"]);
        if (line) cell.textContent = money(line.quantity * line.unitCost);
      }
    }
    async saveReceipt() {
      const line = el("inventoryReceiptStatus");
      if (this.receiptLines.length === 0) {
        status(line, "Chưa chọn biến thể nào.", "bad");
        return;
      }
      const bad = this.receiptLines.find((l) => l.quantity < 1);
      if (bad) {
        status(line, `${bad.code} size ${bad.size}: số lượng nhập phải từ 1.`, "bad");
        return;
      }
      const value = (id) => el(id).value.trim();
      const note = [value("inventoryReceiptLot") && `Lô: ${value("inventoryReceiptLot")}`, value("inventoryReceiptInvoice") && `Chứng từ: ${value("inventoryReceiptInvoice")}`, value("inventoryReceiptNote")].filter(Boolean).join(" · ");
      status(line, "Đang lưu phiếu…");
      const r = await this.ctx.gateway.landing("hang.phieu-nhap", {
        nhaCungCap: value("inventoryReceiptSupplier"),
        ghiChu: note,
        dong: this.receiptLines.map((l) => ({ ma: l.code, size: l.size, maKho: l.warehouse, soLuong: l.quantity, giaVon: l.unitCost, nguon: "own" }))
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Đã lưu phiếu ${str(r.than?.id)}: cộng ${r.than?.totalQuantity ?? 0} sản phẩm vào kho.`, "good");
      this.receiptLines = [];
      this.drawReceiptLines();
      for (const id of ["inventoryReceiptSupplier", "inventoryReceiptLot", "inventoryReceiptInvoice", "inventoryReceiptNote"]) el(id).value = "";
      await this.loadReceipts();
    }
    async loadReceipts() {
      const r = await this.ctx.gateway.landing("hang.ds-phieu-nhap", { gioiHan: 6 });
      const body = el("inventoryReceiptHistory");
      clear(body);
      if (!r.ok) {
        body.appendChild(h("tr", null, h("td", { colspan: "6", class: "subtle" }, r.viSao)));
        return;
      }
      for (const p of r.than?.phieu ?? []) {
        body.appendChild(tableRow([p.id, dayClock(p.createdAt), p.supplier || "—", p.note || "", p.totalQuantity, money(p.totalCost)], [4, 5]));
      }
      if ((r.than?.phieu ?? []).length === 0) body.appendChild(h("tr", null, h("td", { colspan: "6", class: "subtle" }, "Chưa có phiếu nhập nào.")));
    }
    load() {
      void this.loadHistory();
      void this.loadReceipts();
    }
    async loadHistory() {
      const line = el("hang-nhap-trang-thai");
      const r = await this.ctx.gateway.landing("hang.lich-su-nap");
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const runs = r.than?.lan ?? [];
      const body = el("lich-su-nap-bang");
      clear(body);
      for (const run of runs) {
        body.appendChild(tableRow([dayClock(run.luc), str(run.nguon), str(run.viec), run.soMon ?? 0, run.soBienThe ?? 0, run.biBo ?? 0], [3, 4, 5]));
      }
    }
    async pickFile() {
      const line = el("hang-tep-trang-thai");
      status(line, "Đang mở hộp thoại…");
      el("hang-tep-xem").hidden = true;
      this.fromFile = [];
      const r = await this.ctx.gateway.pickSpreadsheet();
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      this.fromFile = r.mon;
      const columns = Object.entries(r.cot).map(([k, v]) => `${k} = ${v}`).join(" · ");
      el("hang-tep-cot").textContent = `Tệp ${r.tenTep} (sheet ${r.sheet}): ${r.soDongDuLieu} dòng → ${this.fromFile.length} món${r.boQua ? `, bỏ ${r.boQua} dòng thiếu mã` : ""}. Cột nhận được: ${columns || "không"}.${r.canhBao.length ? ` Lưu ý: ${r.canhBao.join(" ")}` : ""}`;
      const body = el("hang-tep-bang");
      clear(body);
      for (const rowCells of r.xemTruoc) body.appendChild(tableRow(rowCells.map((x) => String(x ?? ""))));
      el("hang-tep-xem").hidden = false;
      status(line, this.fromFile.length ? "Xem lại rồi bấm Nhập." : "Không ra món nào.", this.fromFile.length === 0 ? "bad" : "good");
    }
    async importFile() {
      const line = el("hang-nhap-trang-thai");
      if (this.fromFile.length === 0) {
        status(line, "Chưa có món để nhập.", "bad");
        return;
      }
      status(line, `Đang nhập ${this.fromFile.length} món…`);
      const total = { soMon: 0, soBienThe: 0, biBo: 0 };
      const batches = [];
      for (let i = 0; i < this.fromFile.length; i += BATCH) batches.push(this.fromFile.slice(i, i + BATCH));
      for (const [index, batch] of batches.entries()) {
        const r = await this.ctx.gateway.landing("hang.nap-them", { mon: batch });
        if (!r.ok) {
          status(line, `Gói ${index + 1}/${batches.length}: ${r.viSao}`, "bad");
          return;
        }
        total.soMon += r.than?.soMon ?? 0;
        total.soBienThe += r.than?.soBienThe ?? 0;
        total.biBo += r.than?.biBo ?? 0;
        status(line, `Đã nhập ${total.soMon}/${this.fromFile.length}…`);
      }
      this.fromFile = [];
      el("hang-tep-xem").hidden = true;
      await this.loadHistory();
      status(line, `Xong: ${total.soMon} món, ${total.soBienThe} size${total.biBo ? `, landing bỏ ${total.biBo}` : ""}.`, "good");
    }
  };

  // ../omi/packages/omi-ui/src/views/ready-stock.ts
  var MOVEMENT_KIND = {
    "nhap": "Nhập kho",
    "dieu-chinh": "Điều chỉnh",
    "chuyen-di": "Chuyển đi",
    "chuyen-den": "Chuyển đến",
    "hoan-hang": "Hàng hoàn"
  };
  var ReadyStockView = class extends View {
    id = "hang-co-san";
    label = "Kho hàng sẵn";
    title = "Kho hàng sẵn";
    workspace = "landing";
    glyph = "KS";
    warehouses = [];
    actions = {
      "rs-reload": () => this.loadAll(),
      "rs-import": () => this.importLine(),
      "rs-adjust": (b) => this.openRowForm(b, "adjust"),
      "rs-transfer": (b) => this.openRowForm(b, "transfer"),
      "rs-price": (b) => this.openRowForm(b, "price"),
      "rs-policy": () => this.savePolicy(),
      "rs-row-cancel": (b) => {
        b.closest("tr")?.remove();
      },
      "rs-row-save": (b) => this.saveRowForm(b)
    };
    build(root) {
      const input = (id, placeholder, type = "text") => h("input", { id, type, placeholder });
      root.append(
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h(
              "div",
              null,
              h("h3", null, "Kho hàng sẵn"),
              h("p", { id: "rs-tom-tat" }, "Nguồn sự thật tồn hàng sẵn (tách hẳn kho order). Đang tải…")
            ),
            h(
              "div",
              { class: "panel-actions" },
              h("button", { class: "secondary-button", type: "button", id: "nut-hang-co-san-tai", "data-action": "rs-reload" }, "Tải lại")
            )
          ),
          h(
            "div",
            { class: "panel-body" },
            h("span", { class: "status-line", id: "hang-co-san-trang-thai" }),
            h(
              "div",
              { class: "omi-two-cards" },
              h(
                "div",
                { class: "omi-card" },
                h("h4", null, "Phiếu nhập kho sẵn"),
                h("p", { class: "subtle" }, "Mã phải có sẵn trong danh mục (thêm ở màn Hàng hoá trước); tên và ảnh lấy từ đó."),
                h(
                  "div",
                  { class: "omi-form-2" },
                  h("label", null, "Mã sản phẩm", input("rs-import-code", "VD: IC1304")),
                  h("label", null, "Size", input("rs-import-size", "VD: 42 / US 8.5")),
                  h("label", null, "Chi nhánh", h("select", { id: "rs-import-branch" })),
                  h("label", null, "Số lượng", h("input", { id: "rs-import-qty", type: "number", min: "1", value: "1" })),
                  h("label", null, "Giá vốn", input("rs-import-cost", "đ/đôi", "number")),
                  h("label", null, "Hoặc mã kho mới", input("rs-import-branch-new", "VD: kho-cau-giay")),
                  h("label", null, "Nhà cung cấp", input("rs-import-supplier", "Tuỳ chọn"))
                ),
                h("label", null, "Ghi chú phiếu", input("rs-import-note", "NCC, đợt hàng...")),
                h(
                  "div",
                  { class: "omi-actions-top" },
                  h("button", { class: "primary-button", type: "button", "data-action": "rs-import" }, "Nhập kho"),
                  h("span", { class: "status-line", id: "rs-import-trang-thai" })
                )
              ),
              h(
                "div",
                { class: "omi-card" },
                h("h4", null, "Chi nhánh / kho"),
                h("p", { class: "subtle" }, "Kho nào đang giữ bao nhiêu đôi. Mã kho mới xuất hiện khi nhập phiếu vào nó lần đầu."),
                h(
                  "table",
                  { class: "data-table" },
                  h("thead", null, h("tr", null, h("th", null, "Kho"), h("th", null, "Số đôi"), h("th", null, "Dòng size"), h("th", null, "Nguồn"))),
                  h("tbody", { id: "rs-kho" })
                )
              )
            ),
            h(
              "div",
              { class: "omi-card omi-section-gap" },
              h("h4", null, "Chính sách bán hàng sẵn (hiển thị trên web)"),
              h("label", null, "Tóm tắt chính sách", h("textarea", { id: "rs-policy-summary", rows: "3" })),
              h(
                "div",
                { class: "omi-inline-form" },
                h("label", null, h("input", { type: "checkbox", id: "rs-policy-cod", checked: true }), " Cho COD"),
                h("label", null, "Cọc (%)", h("input", { type: "number", id: "rs-policy-deposit", min: "0", max: "100", value: "0" })),
                h("button", { class: "secondary-button", type: "button", id: "nut-rs-luu-chinh-sach", "data-action": "rs-policy" }, "Lưu chính sách"),
                h("span", { class: "status-line", id: "rs-policy-trang-thai" })
              ),
              h("p", { class: "subtle" }, "Cọc 0% = khách hàng sẵn không phải cọc (COD toàn phần). Phần hàng order trong cùng đơn vẫn cọc như cũ.")
            ),
            h("h4", { class: "omi-section-gap" }, "Tồn kho hiện tại"),
            h(
              "table",
              { class: "data-table" },
              h("thead", null, h("tr", null, ...["Sản phẩm", "Size", "Chi nhánh", "Tồn", "Giá bán", "Thao tác"].map((t) => h("th", null, t)))),
              h("tbody", { id: "hang-co-san-bang" })
            ),
            h("h4", { class: "omi-section-gap" }, "Sổ cái gần nhất"),
            h(
              "table",
              { class: "data-table" },
              h("thead", null, h("tr", null, ...["Thời gian", "Loại", "Mã/Size", "Chi nhánh", "SL", "Ghi chú"].map((t) => h("th", null, t)))),
              h("tbody", { id: "rs-so-cai" })
            )
          )
        )
      );
    }
    load() {
      void this.loadAll();
    }
    async loadAll() {
      const line = el("hang-co-san-trang-thai");
      status(line, "Đang tải…");
      const [stock, stores, book, policy] = await Promise.all([
        this.ctx.gateway.landing("hang.theo-nguon", { nguon: "ready", gioiHan: 2e3 }),
        this.ctx.gateway.landing("hang.kho"),
        this.ctx.gateway.landing("hang.bien-dong", { gioiHan: 40 }),
        this.ctx.gateway.landing("hang.chinh-sach-hang-san", {})
      ]);
      if (policy.ok && policy.than?.chinhSach) {
        el("rs-policy-summary").value = policy.than.chinhSach.tomTat;
        el("rs-policy-cod").checked = policy.than.chinhSach.choCod;
        el("rs-policy-deposit").value = String(policy.than.chinhSach.phanTramCoc);
      }
      if (!stock.ok) {
        status(line, stock.viSao, "bad");
        return;
      }
      this.warehouses = stores.ok ? stores.than?.kho ?? [] : [];
      this.drawWarehouses();
      this.drawStock(stock.than?.mon ?? []);
      this.drawBook(book.ok ? book.than?.bienDong ?? [] : []);
      status(line, stores.ok && book.ok ? "" : stores.viSao || book.viSao, stores.ok && book.ok ? "" : "bad");
    }
    drawWarehouses() {
      const select = el("rs-import-branch");
      const chosen = select.value;
      clear(select);
      for (const w of this.warehouses) select.appendChild(h("option", { value: w.id }, w.id));
      if (this.warehouses.length === 0) select.appendChild(h("option", { value: "" }, "— chưa có kho —"));
      if (chosen !== "") select.value = chosen;
      const body = el("rs-kho");
      clear(body);
      for (const w of this.warehouses) {
        body.appendChild(h("tr", null, h("td", null, h("b", null, w.id)), h("td", { class: "num" }, String(w.pairs)), h("td", { class: "num" }, String(w.sizes)), h("td", null, w.sources.join(", "))));
      }
      if (this.warehouses.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "4", class: "subtle" }, "Chưa có kho nào.")));
    }
    drawStock(items) {
      const rows = [];
      for (const item of items) for (const size2 of item.sizes ?? []) if (str(size2.nguon) === "" || size2.nguon === "ready") rows.push({ item, size: size2 });
      rows.sort((a, b) => a.item.code.localeCompare(b.item.code) || a.size.size.localeCompare(b.size.size, "vi", { numeric: true }) || str(a.size.warehouseId).localeCompare(str(b.size.warehouseId)));
      const pairs = rows.reduce((t, r) => t + Number(r.size.qty || 0), 0);
      el("rs-tom-tat").textContent = `Nguồn sự thật tồn hàng sẵn (tách hẳn kho order). ${rows.length} dòng · ${pairs} sản phẩm · ${this.warehouses.length} kho`;
      const body = el("hang-co-san-bang");
      clear(body);
      for (const { item, size: size2 } of rows) {
        const data = { "data-code": item.code, "data-size": size2.size, "data-branch": str(size2.warehouseId) };
        body.appendChild(h(
          "tr",
          null,
          h("td", null, h("b", null, item.code), h("br"), h("span", { class: "subtle" }, item.name)),
          h("td", null, size2.size),
          h("td", null, str(size2.warehouseId) || "—"),
          h("td", { class: "num" }, h("b", null, String(Number(size2.qty || 0)))),
          h("td", { class: "num" }, money(size2.price)),
          h(
            "td",
            null,
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "rs-adjust", ...data }, "±SL"),
            " ",
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "rs-transfer", ...data }, "Điều kho"),
            " ",
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "rs-price", ...data }, "Đổi giá")
          )
        ));
      }
      if (rows.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "6", class: "subtle" }, "Chưa có hàng sẵn. Dùng phiếu nhập bên trên để bắt đầu.")));
    }
    drawBook(movements) {
      const body = el("rs-so-cai");
      clear(body);
      for (const m of movements) {
        body.appendChild(h(
          "tr",
          null,
          h("td", null, `${day(m.at)} ${clock(m.at)}`),
          h("td", null, MOVEMENT_KIND[m.kind] ?? m.kind),
          h("td", null, `${m.code} ${m.size}`),
          h("td", null, m.warehouseId),
          h("td", { class: "num" }, `${m.quantity > 0 ? "+" : ""}${m.quantity}`),
          h("td", null, m.note || m.reference)
        ));
      }
      if (movements.length === 0) body.appendChild(h("tr", null, h("td", { colspan: "6", class: "subtle" }, "Chưa có bút toán nào.")));
    }
    async importLine() {
      const line = el("rs-import-trang-thai");
      const value = (id) => el(id).value.trim();
      const code = value("rs-import-code");
      const size2 = value("rs-import-size");
      const branch = value("rs-import-branch-new") || el("rs-import-branch").value;
      const qty = Number(value("rs-import-qty") || 0);
      if (code === "" || size2 === "" || branch === "" || !(qty >= 1)) {
        status(line, "Cần mã, size, chi nhánh và số lượng từ 1.", "bad");
        return;
      }
      status(line, "Đang nhập kho…");
      const r = await this.ctx.gateway.landing("hang.phieu-nhap", {
        nhaCungCap: value("rs-import-supplier"),
        ghiChu: value("rs-import-note"),
        dong: [{ ma: code, size: size2, maKho: branch, soLuong: qty, giaVon: Number(value("rs-import-cost") || 0), nguon: "ready" }]
      });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      status(line, `Đã nhập ${qty} x ${code} size ${size2} vào ${branch}.`, "good");
      el("rs-import-code").value = "";
      el("rs-import-size").value = "";
      el("rs-import-qty").value = "1";
      el("rs-import-branch-new").value = "";
      await this.loadAll();
    }
    /** Mở một dòng nhập ngay dưới dòng hàng (thay `prompt()` của Desk). Mở lại dòng khác thì đóng dòng cũ. */
    openRowForm(button, kind) {
      const row = button.closest("tr");
      if (row === null) return;
      for (const old of row.parentElement?.querySelectorAll("tr.omi-row-form") ?? []) old.remove();
      const { code = "", size: size2 = "", branch = "" } = button.dataset;
      const others = this.warehouses.filter((w) => w.id !== branch);
      const fields = kind === "price" ? [h("label", null, "Giá bán mới", h("input", { type: "text", inputmode: "numeric", "data-field": "price", placeholder: "đ/đôi" }))] : kind === "adjust" ? [
        h("label", null, "± số lượng", h("input", { type: "number", "data-field": "qty", value: "1" })),
        h("label", null, "Lý do", h("input", { type: "text", "data-field": "note", placeholder: "Kiểm kê hụt, hàng lỗi…" }))
      ] : [
        h("label", null, "Sang kho", h("select", { "data-field": "to" }, ...others.map((w) => h("option", { value: w.id }, w.id)))),
        h("label", null, "Hoặc gõ mã kho mới", h("input", { type: "text", "data-field": "toNew", placeholder: "kho-moi" })),
        h("label", null, "Số lượng", h("input", { type: "number", min: "1", "data-field": "qty", value: "1" }))
      ];
      const form = h(
        "tr",
        { class: "omi-row-form", "data-kind": kind, "data-code": code, "data-size": size2, "data-branch": branch },
        h(
          "td",
          { colspan: "6" },
          h(
            "div",
            { class: "omi-inline-form" },
            h("strong", null, `${kind === "adjust" ? "Điều chỉnh tồn" : kind === "price" ? "Giá bán mới cho" : "Chuyển"} ${code} size ${size2} tại ${branch}`),
            ...fields,
            h("button", { class: "primary-button compact-button", type: "button", "data-action": "rs-row-save" }, kind === "adjust" ? "Ghi điều chỉnh" : kind === "price" ? "Đổi giá" : "Chuyển kho"),
            h("button", { class: "secondary-button compact-button", type: "button", "data-action": "rs-row-cancel" }, "Huỷ"),
            h("span", { class: "status-line" })
          )
        )
      );
      row.after(form);
      form.querySelector("input")?.focus();
    }
    async saveRowForm(button) {
      const form = button.closest("tr.omi-row-form");
      if (form === null) return;
      const field = (name) => (form.querySelector(`[data-field="${name}"]`)?.value ?? "").trim();
      const line = form.querySelector(".status-line");
      const { kind, code = "", size: size2 = "", branch = "" } = form.dataset;
      const qty = Number(field("qty"));
      let r;
      if (kind === "price") {
        const price = Number(field("price").replace(/[^0-9]/g, ""));
        if (!(price > 0)) {
          if (line) status(line, "Giá bán mới phải lớn hơn 0.", "bad");
          return;
        }
        r = await this.ctx.gateway.landing("hang.doi-gia", { ma: code, size: size2, maKho: branch, nguon: "ready", gia: price });
        if (!r.ok) {
          if (line) status(line, r.viSao, "bad");
          return;
        }
        await this.loadAll();
        status(el("hang-co-san-trang-thai"), `Đã đổi giá bán hàng sẵn ${code} size ${size2}: ${money(price)}.`, "good");
        return;
      }
      if (kind === "adjust") {
        if (!Number.isFinite(qty) || qty === 0) {
          if (line) status(line, "Số lượng điều chỉnh phải khác 0.", "bad");
          return;
        }
        if (field("note") === "") {
          if (line) status(line, "Ghi lý do điều chỉnh.", "bad");
          return;
        }
        r = await this.ctx.gateway.landing("hang.dieu-chinh", { dong: [{ ma: code, size: size2, maKho: branch, soLuong: qty, ghiChu: field("note"), nguon: "ready" }] });
      } else {
        const to = field("toNew") || field("to");
        if (to === "" || !(qty >= 1)) {
          if (line) status(line, "Chọn kho đến và số lượng từ 1.", "bad");
          return;
        }
        r = await this.ctx.gateway.landing("hang.chuyen-kho", { ma: code, size: size2, tuKho: branch, denKho: to, soLuong: qty, tuNguon: "ready", denNguon: "ready" });
      }
      if (!r.ok) {
        if (line) status(line, r.viSao, "bad");
        return;
      }
      await this.loadAll();
      status(el("hang-co-san-trang-thai"), kind === "adjust" ? `Đã điều chỉnh tồn ${code} size ${size2}.` : `Đã chuyển ${qty} ${code} size ${size2}.`, "good");
    }
    async savePolicy() {
      const line = el("rs-policy-trang-thai");
      const r = await this.ctx.gateway.landing("hang.ghi-chinh-sach-hang-san", {
        tomTat: el("rs-policy-summary").value.trim(),
        choCod: el("rs-policy-cod").checked,
        phanTramCoc: Number(el("rs-policy-deposit").value || 0)
      });
      status(line, r.ok ? "Đã lưu chính sách bán hàng sẵn." : r.viSao, r.ok ? "good" : "bad");
    }
  };

  // ../omi/packages/omi-ui/src/views/source-stock.ts
  var SourceStockView = class extends View {
    workspace = "landing";
    build(root) {
      root.append(
        h(
          "div",
          { class: "toolbar" },
          h("button", { class: "secondary-button", id: this.ids.reload, type: "button", onclick: () => void this.loadStock() }, "Tải lại"),
          h("span", { class: "status-line", id: this.ids.line }, "Bấm để tải.")
        ),
        h(
          "section",
          { class: "panel" },
          h(
            "div",
            { class: "panel-header" },
            h("div", null, h("h3", null, this.title, " ", h("span", { class: "count-chip", id: this.ids.count }, "0")), h("p", null, this.note))
          ),
          table(["Mã", "Tên", "Size", "Còn", "Giá bán", "Giá niêm yết", "Kho", "Nguồn dòng"], this.ids.body)
        )
      );
    }
    load() {
      void this.loadStock();
    }
    async loadStock() {
      const line = el(this.ids.line);
      status(line, "Đang tải…");
      const r = await this.ctx.gateway.landing("hang.theo-nguon", { nguon: this.source, gioiHan: 1e3 });
      if (!r.ok) {
        status(line, r.viSao, "bad");
        return;
      }
      const items = r.than?.mon ?? [];
      const body = el(this.ids.body);
      clear(body);
      let lines2 = 0;
      let pairs = 0;
      for (const item of items) {
        for (const size2 of item.sizes ?? []) {
          if (str(size2.nguon) !== "" && str(size2.nguon) !== this.source) continue;
          lines2 += 1;
          pairs += Number(size2.qty ?? 0);
          body.appendChild(tableRow(
            [item.code, item.name, size2.size, size2.qty, money(size2.price), money(size2.listPrice ?? 0), str(size2.warehouse) || str(size2.warehouseId) || "—", str(size2.nguon) || this.source],
            [3, 4, 5]
          ));
        }
      }
      el(this.ids.count).textContent = String(lines2);
      status(line, `${items.length} mã · ${lines2} dòng size · ${pairs} sản phẩm.`, "good");
    }
  };
  var PartnerStockView = class extends SourceStockView {
    id = "kho-doi-tac";
    label = "Kho đối tác";
    title = "Kho đối tác";
    // Sales Desk keeps this one in "Tác vụ chung" — it is stock the shop works with every day,
    // not something about the public website.
    workspace = "common";
    glyph = "KD";
    source = "campaign";
    note = "Hàng của đối tác mà shop được bán hộ, theo từng chiến dịch. Chiến dịch tắt hoặc hết hạn thì dòng hàng tự biến mất ở lần đồng bộ sau.";
    ids = { reload: "nut-kho-doi-tac-tai", line: "kho-doi-tac-trang-thai", body: "kho-doi-tac-bang", count: "kho-doi-tac-so" };
  };

  // ../omi/packages/omi-ui/src/main.ts
  (function boot() {
    const bridge = window.vo;
    if (bridge === void 0 || typeof bridge.goi !== "function") {
      document.body.textContent = "OMI không mở được cầu nối bên trong (preload). Đóng rồi mở lại; nếu vẫn vậy thì cài lại bản OMI.";
      return;
    }
    const gateway = new Gateway(bridge);
    const shell = new AppShell(gateway);
    shell.mount(document.body);
    const ctx = { gateway, shell };
    const common = [
      new DashboardView(ctx),
      new FanpageView(ctx),
      new InboxView(ctx),
      new ChannelsView(ctx),
      new ContentView(ctx),
      new PartnerStockView(ctx),
      new ProductsView(ctx),
      new StockSyncView(ctx),
      new OrdersView(ctx),
      new CustomersView(ctx),
      new AffiliatesView(ctx),
      new IntegrationsView(ctx),
      new HelpView(ctx),
      new SettingsView(ctx)
    ];
    const landing = [
      new LandingOverviewView(ctx),
      ["don", "Danh sách đơn hàng", "OD"],
      ["khach", "Khách hàng", "KH"],
      ["fanpage", "Fanpage", "FP"],
      ["hang", "Sản phẩm landing", "SP"],
      new QuickEditView(ctx),
      new SiteContentView(ctx),
      new PurchasingView(ctx),
      new ReadyStockView(ctx),
      new PartnersView(ctx),
      new ShippingView(ctx),
      ["ket-noi", "Kết nối vận chuyển", "KV"],
      new FinanceView(ctx)
    ];
    for (const view of common) shell.register(view);
    for (const entry of landing) {
      if (Array.isArray(entry)) shell.alias(entry[0], "landing", entry[1], entry[2]);
      else shell.register(entry);
    }
    shell.boot();
  })();
})();
