/**
 * MỌI DỊCH VỤ MÃ GỌI ĐỀU PHẢI ĐƯỢC KHAI.
 *
 * Kernel chỉ nối những dịch vụ module khai trong `requires` / `requiresOptional`. Quên khai thì
 * `ctx.services["x"].y` là `undefined` — và nếu chỗ gọi có `?.` hay một nhánh dự phòng, **cửa đó
 * lặng lẽ trả về rỗng**. Không có lỗi, không có dòng nhật ký nào; tính năng chỉ đơn giản là không
 * chạy, và không bài kiểm tra nào thấy, vì bài cắm module giả cũng thiếu đúng dịch vụ đó.
 *
 * Đúng chuyện đã xảy ra 16/09/2026: `don-khach` gọi `hang-kho.stock` cho "gợi ý gom kho" nhưng
 * không khai. Bốn bộ bài đều xanh; chỉ đến khi chạy thật trên máy chủ và bấm vào một đơn có tồn
 * thật mới thấy nó trả `null`.
 *
 * Bài này quét NGUỒN của mọi module và bắt tay: gọi mà không khai là gãy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_MODULES } from "../dist/index.js";

const MODULES_DIR = path.join(import.meta.dirname, "..", "src", "modules");

/** Mọi tệp nguồn của một module, bỏ `goc/` (bản chép nguyên của trang cũ). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "goc" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** `ctx.services["x"].y(`, `ctx.services["x"]?.y(`, `ctx.services["x"]!.y` → `x.y`. */
function servicesUsedIn(source: string): string[] {
  const out: string[] = [];
  const pattern = /services\[\s*"([^"]+)"\s*\]\s*[!?]?\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) out.push(`${m[1]}.${m[2]}`);
  return out;
}

test("một module gọi dịch vụ nào thì phải KHAI dịch vụ đó — quên khai là tính năng chết lặng", () => {
  const problems: string[] = [];

  for (const manifest of BUILTIN_MODULES) {
    const dir = path.join(MODULES_DIR, manifest.id);
    if (!fs.existsSync(dir)) continue;
    const declared = new Set([...(manifest.requires ?? []), ...(manifest.requiresOptional ?? [])]);

    for (const file of sourceFiles(dir)) {
      const where = path.relative(MODULES_DIR, file).replace(/\\/g, "/");
      for (const used of new Set(servicesUsedIn(fs.readFileSync(file, "utf8")))) {
        // Dịch vụ của CHÍNH nó thì không phải khai.
        if (used.startsWith(`${manifest.id}.`)) continue;
        if (!declared.has(used)) problems.push(`${where}: gọi "${used}" mà "${manifest.id}" không khai trong requires/requiresOptional`);
      }
    }
  }

  assert.deepEqual(problems, [], `Dịch vụ được gọi mà không khai:\n  - ${problems.join("\n  - ")}`);
});

test("mọi dịch vụ được khai đều có người cấp — xin một cái không ai cấp là gãy lúc khởi động", () => {
  const provided = new Set(BUILTIN_MODULES.flatMap((m) => Object.keys(m.provides ?? {})));
  const missing: string[] = [];
  for (const manifest of BUILTIN_MODULES) {
    for (const name of [...(manifest.requires ?? []), ...(manifest.requiresOptional ?? [])]) {
      if (!provided.has(name)) missing.push(`"${manifest.id}" xin "${name}" mà không module nào cấp`);
    }
  }
  assert.deepEqual(missing, []);
});
