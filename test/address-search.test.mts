/**
 * TÌM ĐỊA CHỈ TRONG DANH MỤC HÀNH CHÍNH.
 *
 * Hãng vận chuyển TỪ CHỐI đơn có tên tỉnh/xã không khớp danh mục của họ — "Hà nội", "TP Hà Nội",
 * "Hà Nội " là ba chuỗi khác nhau với máy. Bài này giữ hai thứ: gõ kiểu gì cũng ra đúng mục, và
 * hai hệ hành chính (63 tỉnh cũ / 34 tỉnh mới sau sáp nhập 2025) không lẫn vào nhau.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isKnown, scoreOf, searchAddress } from "../dist/modules/van-chuyen/address-search.js";

test("hai hệ hành chính, hai danh mục khác nhau — sáp nhập tỉnh 2025", () => {
  const cu = searchAddress({ scheme: "ba-cap", cap: "tinh", limit: 50 });
  const moi = searchAddress({ scheme: "hai-cap", cap: "tinh", limit: 50 });
  assert.ok(cu.length > moi.length, "63 tỉnh cũ nhiều hơn 34 tỉnh mới");
  assert.ok(cu.every((u) => u.ten !== "" && u.ma !== ""), "mỗi mục có tên người đọc và mã danh mục");
});

test("gõ kiểu gì cũng ra: có dấu, không dấu, có tiền tố hành chính hay không", () => {
  for (const q of ["Hà Nội", "ha noi", "HA NOI", "Thành phố Hà Nội", "hanoi".slice(0, 2)]) {
    const found = searchAddress({ scheme: "ba-cap", cap: "tinh", q });
    assert.ok(found.some((u) => /Hà Nội/i.test(u.ten)), `gõ "${q}" phải ra Hà Nội`);
  }
});

test("trùng khít đứng trước bắt đầu-bằng, bắt đầu-bằng đứng trước chỉ-chứa", () => {
  assert.equal(scoreOf("Hà Nội", "Hà Nội"), 4);
  assert.equal(scoreOf("Hà Nội", "hà"), 3);
  assert.equal(scoreOf("Thành phố Hà Nội", "hà nội"), 4, "tiền tố hành chính bị bỏ trước khi so");
  assert.equal(scoreOf("Hà Nội", "xyz"), 0);
  // Mục trùng khít phải đứng đầu, nếu không người bán bấm nhầm mục đầu tiên.
  const found = searchAddress({ scheme: "ba-cap", cap: "tinh", q: "Hà Nội" });
  assert.match(found[0]?.ten ?? "", /Hà Nội/);
});

test("tìm huyện/xã PHẢI nói cấp trên — không thì trả rỗng, không trả cả nước", () => {
  assert.deepEqual(searchAddress({ scheme: "ba-cap", cap: "huyen", q: "ba dinh" }), [], "thiếu tỉnh thì không đoán");
  assert.deepEqual(searchAddress({ scheme: "ba-cap", cap: "xa", q: "x", tinh: "Hà Nội" }), [], "thiếu huyện thì không đoán");
  const huyen = searchAddress({ scheme: "ba-cap", cap: "huyen", q: "ba đình", tinh: "Hà Nội" });
  assert.ok(huyen.some((u) => /Ba Đình/i.test(u.ten)));
  const xa = searchAddress({ scheme: "ba-cap", cap: "xa", q: "", tinh: "Hà Nội", huyen: "Ba Đình", limit: 50 });
  assert.ok(xa.length > 0, "chọn đủ tỉnh + huyện thì có danh sách xã");
});

test("HỆ HAI CẤP KHÔNG CÓ HUYỆN — trả rỗng thay vì bịa ra một cấp đã bị bỏ", () => {
  assert.deepEqual(searchAddress({ scheme: "hai-cap", cap: "huyen", q: "ba dinh", tinh: "Hà Nội" }), []);
  // …nhưng xã thì tìm thẳng dưới tỉnh.
  const xa = searchAddress({ scheme: "hai-cap", cap: "xa", q: "", tinh: "Hà Nội", limit: 50 });
  assert.ok(xa.length > 0, "hệ hai cấp: xã nằm thẳng dưới tỉnh");
});

test("tỉnh không có trong danh mục thì không ra gì — không đoán bừa", () => {
  assert.deepEqual(searchAddress({ scheme: "ba-cap", cap: "huyen", q: "", tinh: "Tỉnh Không Có Thật" }), []);
});

test("isKnown: tên gõ tay có trong danh mục không — để báo đỏ ô nhập", () => {
  assert.equal(isKnown({ scheme: "ba-cap", cap: "tinh", ten: "Hà Nội" }), true);
  assert.equal(isKnown({ scheme: "ba-cap", cap: "tinh", ten: "Thành phố Hà Nội" }), true, "tiền tố hành chính vẫn là cùng một tỉnh");
  assert.equal(isKnown({ scheme: "ba-cap", cap: "tinh", ten: "ha noi" }), true, "không dấu vẫn nhận");
  assert.equal(isKnown({ scheme: "ba-cap", cap: "tinh", ten: "Hà Nộii" }), false, "gõ thừa một chữ là sai danh mục — hãng sẽ từ chối");
  assert.equal(isKnown({ scheme: "ba-cap", cap: "tinh", ten: "" }), true, "để trống không phải là sai");
});

test("trần kết quả: không bao giờ trả cả danh mục ra màn hình", () => {
  assert.ok(searchAddress({ scheme: "ba-cap", cap: "tinh", q: "" }).length <= 12, "mặc định 12 mục");
  assert.ok(searchAddress({ scheme: "ba-cap", cap: "tinh", q: "", limit: 999 }).length <= 50, "trần cứng 50");
});
