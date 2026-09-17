/**
 * "GỢI Ý GOM 1 KHO" — câu hỏi: có kho nào một mình gánh được cả đơn không?
 *
 * Gom một kho là một kiện, một lần đóng, một phí ship. Ba câu trả lời của Sales Desk được giữ
 * nguyên, và bài này giữ chỗ dễ sai nhất: thứ tự ưu tiên kho, và việc "thiếu" phải thắng "tách".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestWarehouse, type StockLine, type WantedLine } from "../dist/modules/don-khach/warehouse-hint.js";

const line = (ma: string, size: string, soLuong = 1): WantedLine => ({ maDong: `ORD-1#${ma}`, ma, size, soLuong });
const at = (warehouseId: string, size: string, quantity: number, rank = 1): StockLine => ({ warehouseId, size, quantity, rank });
const names = new Map([["wh_yen", "Yến"], ["wh_cau_dien", "Cầu Diễn"]]);

test("một kho gánh được cả đơn → gom một kho, và gọi tên kho cho người đọc", () => {
  const stock = new Map([
    ["A1", [at("wh_yen", "42", 3), at("wh_cau_dien", "42", 1)]],
    ["A2", [at("wh_yen", "41", 2)]]
  ]);
  const hint = suggestWarehouse([line("A1", "42"), line("A2", "41")], stock, names);
  assert.equal(hint?.kieu, "mot-kho");
  assert.equal(hint?.mau, "green");
  assert.match(hint?.nhan ?? "", /Gợi ý gom 1 kho: Yến/);
  // KHÔNG hiện mã kho thô — đó là lỗi hiển thị của Desk, không chép sang.
  assert.ok(!/wh_yen/.test(hint?.nhan ?? ""));
});

test("thứ tự ưu tiên kho được tôn trọng: hai kho cùng đủ thì lấy kho ưu tiên hơn", () => {
  const stock = new Map([
    ["A1", [at("wh_cau_dien", "42", 5, 1), at("wh_yen", "42", 5, 9)]]
  ]);
  const hint = suggestWarehouse([line("A1", "42")], stock, names);
  assert.equal(hint?.kieu, "mot-kho");
  assert.match(hint?.nhan ?? "", /Cầu Diễn/, "rank nhỏ hơn thì giao trước");
});

test("không kho nào gánh hết, nhưng món nào cũng có chỗ → tách kho, nói món nào về đâu", () => {
  const stock = new Map([
    ["A1", [at("wh_yen", "42", 1)]],
    ["A2", [at("wh_cau_dien", "41", 1)]]
  ]);
  const hint = suggestWarehouse([line("A1", "42"), line("A2", "41")], stock, names);
  assert.equal(hint?.kieu, "tach-kho");
  assert.equal(hint?.mau, "amber");
  assert.match(hint?.nhan ?? "", /A1 → Yến/);
  assert.match(hint?.nhan ?? "", /A2 → Cầu Diễn/);
});

test("THIẾU THẮNG TÁCH: một món không kho nào đủ thì đó là việc phải xử lý, không phải gợi ý", () => {
  const stock = new Map([
    ["A1", [at("wh_yen", "42", 5)]],
    ["A2", [at("wh_yen", "41", 0), at("wh_cau_dien", "41", 0)]]
  ]);
  const hint = suggestWarehouse([line("A1", "42"), line("A2", "41")], stock, names);
  assert.equal(hint?.kieu, "thieu");
  assert.equal(hint?.mau, "red");
  assert.match(hint?.nhan ?? "", /A2 size 41/);
});

test("số lượng được tính, không chỉ 'có hay không'", () => {
  const stock = new Map([["A1", [at("wh_yen", "42", 1), at("wh_cau_dien", "42", 5)]]]);
  // Cần 3 đôi: kho Yến chỉ có 1, nên phải là Cầu Diễn.
  const hint = suggestWarehouse([line("A1", "42", 3)], stock, names);
  assert.equal(hint?.kieu, "mot-kho");
  assert.match(hint?.nhan ?? "", /Cầu Diễn/);
});

test("chưa có dữ liệu tồn thì KHÔNG đoán bừa — không gợi ý còn hơn gợi ý sai", () => {
  assert.equal(suggestWarehouse([line("A1", "42")], new Map(), names), null);
  assert.equal(suggestWarehouse([], new Map([["A1", [at("wh_yen", "42", 1)]]]), names), null);
  // Dòng không có mã hàng (hàng ngoài danh mục gõ tay) không kéo cả đơn thành "thiếu".
  assert.equal(suggestWarehouse([line("", "42")], new Map([["A1", [at("wh_yen", "42", 1)]]]), names), null);
});

test("kho không có trong bảng tên thì hiện mã của nó, chứ không hiện rỗng", () => {
  const stock = new Map([["A1", [at("wh_la", "42", 2)]]]);
  const hint = suggestWarehouse([line("A1", "42")], stock, names);
  assert.match(hint?.nhan ?? "", /wh_la/, "thà hiện mã còn hơn hiện một khoảng trắng");
});
