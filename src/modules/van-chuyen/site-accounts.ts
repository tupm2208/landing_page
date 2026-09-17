/**
 * @file CARRIER ACCOUNTS PER SITE (Đ10, 17/09/2026) — Desk's "Tài khoản vận chuyển đối tác".
 *
 * A shop may sell on a twin site (Desk: toprun.site + dasbui.vn) or ship for a reseller site. Each of
 * those ships with ITS OWN carrier account and sender (the parcel label must say the reseller), while
 * the app keys (SPX App ID / Secret) stay the shop's. Desk wrote `SPX_<SITE>_*` into its `.env`; here
 * the accounts live in one document on the shop's own landing, and the screen never gets a secret back.
 *
 * An order carries its site (`orders.site`, don-khach 009). Creating its shipment folds that site's
 * account over the shop's carrier config — a field the site left empty keeps the shop's value, so a
 * half-filled site cannot blank out a working carrier.
 */

import type { DataStore } from "../../contract";

export const SITE_ACCOUNTS_DOCUMENT = "van-chuyen-tai-khoan-site";

export interface SiteAccount {
  ma: string;
  ten: string;
  spx: { userId: string; userSecret: string; senderName: string; senderPhone: string };
  vtp: { username: string; password: string; senderName: string; senderPhone: string };
  capNhatLuc: string;
}

export interface SiteAccountBook { version: 1; site: SiteAccount[] }

const text = (v: unknown, n = 200): string => String(v ?? "").trim().slice(0, n);

/** Lower-case letter first, then letters/digits, 2–20 long (Desk's rule). */
export function validSiteSlug(value: unknown): string {
  const v = text(value, 40).toLowerCase();
  return /^[a-z][a-z0-9]{1,19}$/.test(v) ? v : "";
}

const emptyAccount = (ma: string, ten: string, at: string): SiteAccount => ({
  ma, ten: ten || ma, capNhatLuc: at,
  spx: { userId: "", userSecret: "", senderName: "", senderPhone: "" },
  vtp: { username: "", password: "", senderName: "", senderPhone: "" }
});

export class SiteAccounts {
  constructor(private readonly store: DataStore) {}

  private doc() { return this.store.document<SiteAccountBook>(SITE_ACCOUNTS_DOCUMENT); }

  async all(): Promise<SiteAccount[]> {
    return (await this.doc().read(null))?.site ?? [];
  }

  async of(site: string): Promise<SiteAccount | null> {
    const slug = validSiteSlug(site);
    return slug ? (await this.all()).find((a) => a.ma === slug) ?? null : null;
  }

  /**
   * Desk's POST /api/shipping/accounts, same field names: add (slug + label), save fields (an empty
   * box = unchanged, so a secret never has to be typed again), or remove.
   */
  async save(body: Record<string, unknown>, at: string): Promise<{ ok: boolean; status: number; message: string; site?: string; savedFields?: number; removed?: boolean }> {
    const slug = validSiteSlug(body["site"]);
    if (!slug) return { ok: false, status: 400, message: "Slug site chỉ gồm chữ thường + số, 2-20 ký tự, bắt đầu bằng chữ cái." };
    let result: { ok: boolean; status: number; message: string; site?: string; savedFields?: number; removed?: boolean } = { ok: true, status: 200, message: "" };
    await this.doc().update((current) => {
      const list = [...(current?.site ?? [])];
      const i = list.findIndex((a) => a.ma === slug);
      const label = text(body["label"] ?? body["ten"], 80);
      if (body["remove"] === true) {
        if (i >= 0) list.splice(i, 1);
        result = { ok: true, status: 200, removed: true, site: slug, message: `Đã gỡ đối tác ${label || slug} khỏi danh sách.` };
        return { version: 1, site: list };
      }
      const account = i >= 0 ? structuredClone(list[i]!) : emptyAccount(slug, label, at);
      if (label) account.ten = label;
      const fields: [keyof SiteAccount["spx"] | keyof SiteAccount["vtp"], "spx" | "vtp", string][] = [
        ["userId", "spx", "spxUserId"], ["userSecret", "spx", "spxSecretKey"], ["senderName", "spx", "spxSenderName"], ["senderPhone", "spx", "spxSenderPhone"],
        ["username", "vtp", "vtpUsername"], ["password", "vtp", "vtpPassword"], ["senderName", "vtp", "vtpSenderName"], ["senderPhone", "vtp", "vtpSenderPhone"]
      ];
      let saved = 0;
      for (const [field, carrier, wire] of fields) {
        const value = text(body[wire], 300);
        if (!value) continue;
        (account[carrier] as Record<string, string>)[field] = value;
        saved += 1;
      }
      account.capNhatLuc = at;
      if (i >= 0) list[i] = account; else list.push(account);
      result = {
        ok: true, status: 200, site: slug, savedFields: saved,
        message: saved ? `Đã lưu tài khoản vận chuyển đối tác ${account.ten} (${saved} trường).` : i >= 0 ? `Không có trường nào để lưu cho đối tác ${account.ten}.` : `Đã thêm đối tác ${account.ten}.`
      };
      return { version: 1, site: list };
    }, { version: 1, site: [] });
    return result;
  }
}

/** What the screen may see: whether each secret is set, never the value. */
export function accountForScreen(a: SiteAccount) {
  const spxMissing = [a.spx.userId ? "" : "SPX User ID", a.spx.userSecret ? "" : "SPX Secret Key"].filter(Boolean);
  return {
    slug: a.ma, label: a.ten, capNhatLuc: a.capNhatLuc,
    status: {
      spx: { configured: spxMissing.length === 0, missing: spxMissing, userId: a.spx.userId, hasSecret: a.spx.userSecret !== "", senderName: a.spx.senderName, senderPhone: a.spx.senderPhone },
      viettelPost: { configured: a.vtp.username !== "" && a.vtp.password !== "", username: a.vtp.username, hasPassword: a.vtp.password !== "", senderName: a.vtp.senderName, senderPhone: a.vtp.senderPhone }
    }
  };
}

/** Carrier config with the site's account folded over it. The same `Config` shape `effectiveConfig` returns. */
export function withSiteAccount<T extends object>(original: T, account: SiteAccount | null, carrier: string): T {
  if (!account) return original;
  const config = original as unknown as { sender?: { name?: string; phone?: string }; spx?: Record<string, unknown>; vtp?: Record<string, unknown> };
  const pick = (value: string, fallback: unknown) => value || String(fallback ?? "");
  const vtpOwn = account.vtp.username !== "" && account.vtp.password !== "";
  const isVtp = carrier === "vtp" || carrier === "viettelpost";
  const senderName = isVtp ? account.vtp.senderName : account.spx.senderName;
  const senderPhone = isVtp ? account.vtp.senderPhone : account.spx.senderPhone;
  return {
    ...original,
    sender: { ...(config.sender ?? {}), name: pick(senderName, config.sender?.name), phone: pick(senderPhone, config.sender?.phone) },
    spx: { ...(config.spx ?? {}), userId: pick(account.spx.userId, config.spx?.["userId"]), userSecret: pick(account.spx.userSecret, config.spx?.["userSecret"]) },
    // A site with its own ViettelPost login must not ride on the shop's token.
    vtp: vtpOwn ? { ...(config.vtp ?? {}), username: account.vtp.username, password: account.vtp.password, token: "" } : config.vtp
  } as unknown as T;
}
