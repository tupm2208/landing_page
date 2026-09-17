/**
 * TÁCH KIỆN — một đơn có hàng ở hai kho là hai kiện, hai vận đơn, hai lần thu COD.
 *
 * Không có nút "tách": kiện dẫn xuất từ việc mỗi dòng thuộc kho nào. Bài này giữ hai thứ dễ sai
 * nhất — đơn một kho KHÔNG được tách, và tiền chia giữa các kiện không được tự sinh ra hay mất đi.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parcelId, parentOrderId, parcelsOf, splitIntoParcels, splitMoney, type ParcelLine } from "../dist/modules/don-khach/parcels.js";

const line = (code: string, warehouse: string, price: number, qty = 1): ParcelLine => ({
  maDong: `ORD-1#${code}`, productCode: code, productName: `Giày ${code}`, size: "42",
  qty, price, warehouseId: warehouse, warehouseName: warehouse, partnerId: `partner_${warehouse}`
});

test("mã kiện là `<mã đơn>-01`, và tra ngược về được đơn cha", () => {
  assert.equal(parcelId("MAN-260914-519", 0), "MAN-260914-519-01");
  assert.equal(parcelId("MAN-260914-519", 1), "MAN-260914-519-02");
  assert.equal(parentOrderId("MAN-260914-519-02"), "MAN-260914-519");
  // Desk chỉ nhận dạng tiền tố MAN-; landing sinh cả ORD- nên mã kiện của nó cũng phải tra về được.
  assert.equal(parentOrderId("ORD-1789000000000-01"), "ORD-1789000000000");
  assert.equal(parentOrderId("ORD-1789000000000"), "ORD-1789000000000", "mã đơn thường thì trả chính nó");
});

test("MỘT KHO THÌ KHÔNG TÁCH — đơn đi một kiện như bình thường", () => {
  const mon = [line("A1", "wh_yen", 1000000), line("A2", "wh_yen", 500000)];
  assert.deepEqual(splitIntoParcels({ maDon: "ORD-1", mon, daTra: 0 }), [], "rỗng nghĩa là không tách");
});

test("hai kho là hai kiện, mỗi kiện mang đúng dòng của kho mình", () => {
  const mon = [line("A1", "wh_yen", 1000000), line("A2", "wh_cau_dien", 500000)];
  const kien = splitIntoParcels({ maDon: "ORD-1", mon, daTra: 0 });
  assert.equal(kien.length, 2);
  assert.deepEqual(kien.map((k) => k.maKien), ["ORD-1-01", "ORD-1-02"]);
  assert.deepEqual(kien.map((k) => k.mon.map((m) => m.productCode)), [["A1"], ["A2"]]);
  assert.deepEqual(kien.map((k) => k.maKho), ["wh_yen", "wh_cau_dien"]);
});

test("COD CỦA KIỆN LÀ PHẦN CÒN THIẾU CỦA CHÍNH NÓ — không phải tổng đơn", () => {
  // Nếu mỗi kiện thu COD = tổng đơn thì khách trả tiền hai lần. Đây là lỗi tiền, không phải lỗi hiển thị.
  const mon = [line("A1", "wh_yen", 1000000), line("A2", "wh_cau_dien", 1000000)];
  const kien = splitIntoParcels({ maDon: "ORD-1", mon, daTra: 0 });
  assert.deepEqual(kien.map((k) => k.cod), [1000000, 1000000]);
  assert.equal(kien.reduce((s, k) => s + k.cod, 0), 2000000, "tổng COD bằng đúng giá trị đơn");
});

test("khách trả trước thì chia đều theo giá trị hàng, và tổng KHÔNG đổi", () => {
  const mon = [line("A1", "wh_yen", 1500000), line("A2", "wh_cau_dien", 500000)];
  const kien = splitIntoParcels({ maDon: "ORD-1", mon, daTra: 800000 });
  assert.equal(kien.reduce((s, k) => s + k.daTra, 0), 800000, "tiền không tự mất đi giữa hai kiện");
  assert.equal(kien.reduce((s, k) => s + k.cod, 0), 1200000, "và phần còn thu đúng bằng phần còn thiếu");
  // Kiện lớn gánh phần lớn hơn.
  assert.ok((kien[0]?.daTra ?? 0) > (kien[1]?.daTra ?? 0));
});

test("chia tiền làm tròn bội 10.000 — shipper không có tờ 3.700đ", () => {
  const parts = splitMoney(1000000, [700000, 300000]);
  assert.deepEqual(parts, [700000, 300000]);
  for (const p of parts) assert.equal(p % 10000, 0);
});

test("khi TRÒN và ĐỦ TỔNG đánh nhau thì ĐỦ TỔNG thắng", () => {
  // Trần của mỗi phần là giá trị hàng của nó, nên có lúc không chia tròn được mà vẫn đủ. Chọn số
  // tròn ở đây nghĩa là để tiền tự mất hoặc tự sinh giữa hai kiện — một đồng chênh là một lần đối
  // soát không khớp; một số lẻ trên phiếu thì chỉ xấu.
  const parts = splitMoney(1000000, [333333, 666667]);
  assert.equal(parts.reduce((s, p) => s + p, 0), 1000000, "tổng đúng, đây mới là thứ không được sai");
  assert.ok(parts.some((p) => p % 10000 !== 0), "và chấp nhận một phần lẻ");
});

test("chia tiền không bao giờ làm mất hay tự sinh ra đồng nào", () => {
  for (const [total, weights] of [
    [1, [1, 1]], [10000, [1, 1, 1]], [999999, [5, 3, 2]], [12345678, [1000000, 1, 999999]]
  ] as [number, number[]][]) {
    const parts = splitMoney(total, weights);
    assert.equal(parts.reduce((s, p) => s + p, 0), total, `tổng phải bằng ${total}`);
    for (const p of parts) assert.ok(p >= 0, "không phần nào âm");
  }
  assert.deepEqual(splitMoney(0, [1, 2]), [0, 0], "không có tiền thì không chia gì");
  assert.deepEqual(splitMoney(100000, [0, 0]), [0, 0], "không có hàng thì không gánh tiền");
});

test("một phần không bao giờ gánh nhiều hơn giá trị hàng của nó", () => {
  // Khách trả 2 triệu cho đơn 2 triệu, hàng chia 1.9tr + 100k: kiện nhỏ chỉ gánh 100k.
  const mon = [line("A1", "wh_yen", 1900000), line("A2", "wh_cau_dien", 100000)];
  const kien = splitIntoParcels({ maDon: "ORD-1", mon, daTra: 2000000 });
  assert.ok((kien[1]?.daTra ?? 0) <= 100000, "trả nhiều hơn giá trị hàng là COD âm ở kiện kia");
  assert.deepEqual(kien.map((k) => k.cod), [0, 0], "trả đủ thì không kiện nào còn thu");
});

test("ép một kho: người bán gom tay khi hai kho ở cạnh nhau", () => {
  const mon = [line("A1", "wh_yen", 1000000), line("A2", "wh_cau_dien", 500000)];
  assert.deepEqual(splitIntoParcels({ maDon: "ORD-1", mon, daTra: 0, epMotKho: true }), []);
});

test("dòng chưa chọn kho gom chung một nhóm, không thành mỗi dòng một kiện", () => {
  const chua = { ...line("A1", "", 1000000), partnerId: "", warehouseId: "", warehouseName: "" };
  const chua2 = { ...line("A2", "", 500000), partnerId: "", warehouseId: "", warehouseName: "" };
  assert.deepEqual(splitIntoParcels({ maDon: "ORD-1", mon: [chua, chua2], daTra: 0 }), [], "chưa chọn kho thì chưa biết tách thế nào");
  // Một dòng đã chọn, một dòng chưa: đó THẬT SỰ là hai kiện khác nhau.
  assert.equal(splitIntoParcels({ maDon: "ORD-1", mon: [chua, line("A2", "wh_yen", 500000)], daTra: 0 }).length, 2);
});

test("parcelsOf đọc thẳng từ một đơn", () => {
  const order = {
    id: "ORD-9", paidAmount: 0,
    items: [
      { maDong: "ORD-9#1", productCode: "A1", productName: "A1", size: "42", qty: 1, price: 100000, warehouseId: "wh_yen", warehouseName: "Yến", partnerId: "p1" },
      { maDong: "ORD-9#2", productCode: "A2", productName: "A2", size: "41", qty: 1, price: 100000, warehouseId: "wh_cd", warehouseName: "Cầu Diễn", partnerId: "p2" }
    ]
  };
  assert.equal(parcelsOf(order).length, 2);
  assert.equal(parcelsOf({ ...order, items: [order.items[0]!] }).length, 0, "một dòng thì một kiện, tức là không tách");
});
