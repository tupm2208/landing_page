// order-money-kit.js — BO CONG THUC TIEN DUNG CHUNG (copy Y HET o 3 repo: toprun-sales-desk,
// toprunvn-landing, dasbui-landing). QUY TAC 2026-08-08: truong tien tren don phai chung mot goc —
// moi noi doc "tien da tra / con phai tra / COD" deu phai di qua kit nay, cam tu suy dien tai cho.
// Sua cong thuc = sua file nay o CA 3 repo cung dot; test order-money-kit-sync so tung byte 3 ban.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OrderMoneyKit = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Bo trang thai thanh toan xac nhan da co tien (Desk dung paid/partially_paid/deposit_received,
  // admin landing dung payment_confirmed — "confirmed" bat theo chuoi de khop ca deposit_confirmed cu).
  const PAID_STATUSES = ["paid", "partially_paid", "deposit_received"];
  const FULLY_PAID_STATUSES = ["paid", "fully_paid"];

  function moneyValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function paymentStatusOf(order) {
    return String((order && order.paymentStatus) || "").toLowerCase();
  }

  // Tien khach DA TRA that su. Uu tien paidAmount; paymentAmount chi duoc tinh khi trang thai
  // thanh toan xac nhan co tien; trang thai "paid" khong kem so tien = da tra du tong don.
  function paidAmountForOrder(order) {
    const source = order || {};
    const explicit = moneyValue(source.paidAmount);
    if (explicit > 0) return explicit;
    const status = paymentStatusOf(source);
    const amount = moneyValue(source.paymentAmount);
    if (amount > 0 && (status.indexOf("confirmed") >= 0 || PAID_STATUSES.indexOf(status) >= 0)) return amount;
    if (FULLY_PAID_STATUSES.indexOf(status) >= 0) return moneyValue(source.total);
    return 0;
  }

  // So khach CON PHAI TRA: uu tien truong remainingAmount co san (Sales Desk luon duy tri
  // = tong - tien da tra), kep trong [0, tong]; don thieu truong nay moi tu tinh.
  function remainingAmountForOrder(order) {
    const source = order || {};
    const total = moneyValue(source.total);
    const raw = source.remainingAmount;
    if (raw !== undefined && raw !== null && raw !== "" && Number.isFinite(Number(raw))) {
      return Math.min(moneyValue(raw), total);
    }
    return Math.max(0, total - paidAmountForOrder(source));
  }

  // COD thu ho khi giao = dung so khach con phai tra (da tru coc).
  function codAmountForOrder(order) {
    return remainingAmountForOrder(order);
  }

  // Don da xac nhan tien (coc hoac du) chua — dung cho cac buoc chuyen workflow.
  function orderDepositConfirmed(order) {
    if (paidAmountForOrder(order) > 0) return true;
    const status = paymentStatusOf(order || {});
    return status.indexOf("confirmed") >= 0 || PAID_STATUSES.indexOf(status) >= 0;
  }

  // Gan 2 truong chuan hoa len ban sao cua don (KHONG dot bien du lieu goc) — server dung
  // truoc khi tra don ra API de client chi viec doc field, khong suy dien.
  function annotateOrderMoneyFields(order) {
    if (!order || typeof order !== "object") return order;
    return {
      ...order,
      paidAmount: paidAmountForOrder(order),
      remainingAmount: remainingAmountForOrder(order)
    };
  }

  return { paidAmountForOrder, remainingAmountForOrder, codAmountForOrder, orderDepositConfirmed, annotateOrderMoneyFields };
});
