/**
 * @file The web version of OMI's `window.vo` — the same screens (Sales Desk layout) in a browser tab.
 *
 * Dũng, 17/09/2026: the web admin must create orders, open and edit an order and its customer, and
 * create shipments "chép y nguyên ở Sales Desk". OMI already has those screens (Đ1–Đ3), written
 * against named jobs. So the web does NOT get a second copy of them: this file answers the channels
 * the OMI page calls, and the page bundle is OMI's own `omi-ui/src/main.ts`, untouched.
 *
 * What differs from the Electron shell:
 *   - the caller is the signed-in PERSON (cookie `toprun_admin_session`), not a machine ticket, so
 *     the job table runs with an empty ticket and the browser sends the cookie itself;
 *   - no Node: automation channels, the native "open spreadsheet" dialog and image search are
 *     refused with a sentence; "save table" becomes a CSV download;
 *   - a 401 means the session ended: go back to the login page.
 */

import { taoCongLanding } from "../../omi/packages/omi/src/landing/cong-landing";
import { taoBanDieuHanh } from "../../omi/packages/omi/src/landing/ban-dieu-hanh";
import type { LicenseGon } from "../../omi/packages/omi/src/vo/license";

const ONLY_IN_APP = "Việc này chỉ làm được trong app OMI trên máy tính (bản web không có).";

let license: LicenseGon = {
  shop: "", tenShop: "Quản trị web", nganh: "", manh: [], truc: false, hetHan: "", veHetLuc: "", kiemLuc: "",
  diaChiLanding: location.origin, keyChe: "", tenMay: "Trình duyệt", xeon: ""
};

const cong = taoCongLanding({
  duong: () => location.origin,
  ma: () => "",
  hanMs: 30000,
  goi: async (url, options) => {
    const response = await fetch(url, { ...(options as RequestInit), credentials: "same-origin" });
    if (response.status === 401) location.assign("/admin-login");
    return response;
  }
});
const ban = taoBanDieuHanh(cong, { license: () => license });

/** Shop name and bought pieces, read once from the landing (the web has no Xeon ticket to read them from). */
async function loadLicense(): Promise<void> {
  try {
    const me = await fetch("/api/admin/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)) as { admin?: { name?: string; login?: string } } | null;
    const xeon = await fetch("/api/admin/xeon", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)) as { xeon?: { shop?: string; tenShop?: string; diaChiXeon?: string } | null; toi?: { manh?: string[] } } | null;
    license = {
      ...license,
      shop: String(xeon?.xeon?.shop ?? ""),
      tenShop: String(xeon?.xeon?.tenShop || xeon?.xeon?.shop || "Quản trị web"),
      manh: Array.isArray(xeon?.toi?.manh) ? xeon!.toi!.manh!.map(String) : [],
      xeon: String(xeon?.xeon?.diaChiXeon ?? ""),
      tenMay: `Web · ${String(me?.admin?.name || me?.admin?.login || "")}`
    };
  } catch { /* the screens still open; the header shows the default name */ }
}

function csvDownload(name: string, rows: unknown[][]): { ok: boolean; viSao: string; tenTep: string; soDong: number } {
  const cell = (x: unknown) => {
    const text = String(x ?? "");
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // Excel would run it as a formula
    return /["\r\n,;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const body = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const file = `${String(name || "omi").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80)}-${new Date().toISOString().slice(0, 10)}.csv`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  link.download = file;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  return { ok: true, viSao: "", tenTep: file, soDong: rows.length };
}

const listeners: ((screen: unknown) => void)[] = [];
const working = () => ({ man: "dang-dung", license, canhBao: "" });
const ready = loadLicense();

window.vo = {
  kenh: ["man", "nhat-ky", "kich-hoat", "kiem-lai", "roi-may", "mo-lai", "landing", "cai-dat", "kenh", "tep"],
  khiDoi(listener) { listeners.push(listener); },
  async goi(channel, params) {
    const o = (params ?? {}) as Record<string, unknown>;
    switch (channel) {
      case "man":
      case "kiem-lai":
      case "mo-lai":
        await ready;
        return working();
      case "nhat-ky": return [];
      case "kich-hoat":
      case "roi-may":
        return { ok: false, viSao: "Bản web đăng nhập bằng tài khoản người, không dùng license key.", man: working() };
      case "landing": return ban.lam(o["viec"], o["thamSo"]);
      case "cai-dat": return { ok: false, viSao: ONLY_IN_APP, xeon: license.xeon, tenMay: license.tenMay };
      case "kenh": return { ok: false, viSao: ONLY_IN_APP, kenh: [] };
      case "tep": {
        if (o["viec"] === "luu-bang" && Array.isArray(o["dong"])) return csvDownload(String(o["ten"] ?? ""), o["dong"] as unknown[][]);
        if (o["viec"] === "mo-tim-anh") {
          window.open(`https://www.bing.com/images/search?q=${encodeURIComponent(String(o["tuKhoa"] ?? ""))}`, "_blank", "noopener");
          return { ok: true, viSao: "" };
        }
        return { ok: false, viSao: ONLY_IN_APP };
      }
      default: throw new Error(`Kênh "${String(channel)}" không có trên bản web.`);
    }
  }
};

// ---- after the page is up: web wording, and links from /admin (#don=<id>, #don-moi) ----

const waitFor = async <T>(find: () => T | null | undefined, timeoutMs = 15000): Promise<T | null> => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
};
const buttonByText = (test: (text: string) => boolean) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.offsetParent !== null && test(b.textContent?.trim() ?? ""));

/** The shell speaks of licenses and machine tickets; on the web the person is simply signed in. */
function webWording(): void {
  const fix = () => {
    for (const node of document.querySelectorAll<HTMLElement>("#ban-giay-phep, .status-pill, .topbar-status, span, strong")) {
      if (node.children.length > 0) continue;
      const text = node.textContent ?? "";
      if (text === "Đã có vé") node.textContent = "Đã đăng nhập";
      else if (text.startsWith("License: ")) node.textContent = `Web · ${license.tenShop}`;
    }
  };
  new MutationObserver(fix).observe(document.body, { subtree: true, childList: true, characterData: true });
  fix();
}

async function openFromHash(): Promise<void> {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hash === "") return;
  history.replaceState(null, "", location.pathname);
  if (hash === "don-moi") {
    (await waitFor(() => buttonByText((t) => t === "+ Đơn thủ công")))?.click();
    return;
  }
  const id = hash.startsWith("don=") ? hash.slice(4) : "";
  if (id === "") return;
  const search = await waitFor(() => document.getElementById("don-tim") as HTMLInputElement | null);
  if (!search) return;
  search.value = id;
  // The search box searches inside a tab (as on Desk): ask the server, in parallel, which tab holds
  // the order, then click that one tab.
  const names: [string, string][] = [
    ["workflow_new", "Đơn mới"], ["workflow_stock", "Chờ xác nhận hàng"], ["workflow_payment", "Chờ khách CK"], ["workflow_purchase", "Đang mua"],
    ["workflow_delivery", "Chờ giao"], ["workflow_completed", "Hoàn tất"], ["workflow_attention", "Cần xử lý"], ["cancelled", "Đã hủy"]
  ];
  const hits = await Promise.all(names.map(async ([nhom]) => {
    const r = await ban.lam("don.danh-sach", { nhom, tuKhoa: id, gioiHan: 5 }).catch(() => null) as { than?: { id?: string }[] } | null;
    return Array.isArray(r?.than) && r!.than!.some((o) => o.id === id);
  }));
  const found = names.find((_, i) => hits[i]);
  if (!found) return;
  buttonByText((t) => t.replace(/\d+$/, "").trim() === found[1])?.click();
  const row = await waitFor(() => [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((r) => r.offsetParent !== null && (r.textContent ?? "").includes(id)), 15000);
  if (row) { row.click(); row.scrollIntoView({ block: "center" }); }
}

void ready.then(async () => {
  await waitFor(() => document.getElementById("view-title"));
  webWording();
  await openFromHash();
});
window.addEventListener("hashchange", () => void openFromHash());
