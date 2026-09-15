#!/bin/bash
# Chuyển dữ liệu từ bản landing CŨ trên cùng hosting sang bản này — KHÔNG cần Terminal: đặt một Cron Job.
#
#   bash ~/repositories/landing_page/scripts/cpanel/chuyen-du-lieu.sh thu    chỉ đếm, không ghi gì
#   bash ~/repositories/landing_page/scripts/cpanel/chuyen-du-lieu.sh that   làm thật
#
# Làm thật gồm:
#   1. Nối ảnh cũ (assets/products, assets/thumbnails) bằng symlink — không chép 7,5 GB.
#   2. Nạp đơn còn trong data/orders.json + data/manual-orders.json (đơn đã có trong sổ thì bỏ qua).
#   3. Nạp cộng tác viên từ data/ctv-accounts.json (giữ mật khẩu cũ; thiết bị phải duyệt lại).
#   4. Đẩy danh mục hàng nhà, hàng có sẵn, chiến dịch đối tác, nội dung trang qua API của app
#      (app phải đang chạy; danh mục hàng nhà bị THAY toàn bộ).
# Đơn và tài khoản khách trong MySQL cũ KHÔNG chép ở đây — làm bằng phpMyAdmin (INSERT IGNORE ... SELECT).
#
# Cron gọi mỗi phút nên mỗi chế độ chỉ chạy MỘT lần: lần đầu để lại dấu ~/landing-logs/chuyen-du-lieu-<che-do>.da-chay,
# các lần sau thấy dấu thì thoát. Muốn chạy lại thì xoá tệp dấu. Xong việc thì xoá Cron Job.
# Bản cũ mặc định ở ~/toprunvn-landing; khác thì đặt BAN_CU=/đường/khác trước lệnh.
set -o pipefail

MODE="${1:-}"
case "$MODE" in
  thu|that) ;;
  *) echo "Dùng: chuyen-du-lieu.sh thu|that" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OLD="${BAN_CU:-$HOME/toprunvn-landing}"
LOG_DIR="$HOME/landing-logs"
mkdir -p "$LOG_DIR"
MARK="$LOG_DIR/chuyen-du-lieu-$MODE.da-chay"
[ -e "$MARK" ] && exit 0
date '+%F %T' > "$MARK"
LOG="$LOG_DIR/chuyen-du-lieu-$MODE-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "[chuyen] $(date '+%F %T') chế độ: $MODE $([ "$MODE" = thu ] && echo '(CHỈ ĐẾM, không ghi gì)')"
echo "[chuyen] bản cũ: $OLD"
echo "[chuyen] bản mới: $ROOT"
cd "$ROOT" || exit 1

env_value() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r'; }

problems=0
[ -f .env ] || { echo "LỖI: thiếu $ROOT/.env"; problems=1; }
[ -d "$OLD/data" ] || { echo "LỖI: không thấy $OLD/data"; problems=1; }
[ -f dist/tools/import-orders.js ] || { echo "LỖI: chưa build (thiếu dist/tools) — bấm Deploy HEAD Commit trước"; problems=1; }
MYSQL_URL="$(env_value TOPRUN_MYSQL_URL)"
ADMIN_TOKEN="$(env_value LANDING_ADMIN_TOKEN)"
SITE="$(env_value LANDING_SITE_BASE_URL)"
[ -n "$MYSQL_URL" ] || { echo "LỖI: .env thiếu TOPRUN_MYSQL_URL"; problems=1; }
[ -n "$ADMIN_TOKEN" ] || { echo "LỖI: .env thiếu LANDING_ADMIN_TOKEN"; problems=1; }
[ -n "$SITE" ] || { echo "LỖI: .env thiếu LANDING_SITE_BASE_URL"; problems=1; }
if [ "$problems" -ne 0 ]; then
  echo "[chuyen] DỪNG, chưa làm gì. Sửa xong thì xoá $MARK để Cron chạy lại."
  exit 1
fi

# shellcheck source=node-env.sh
source "$ROOT/scripts/cpanel/node-env.sh"
cpanel_node_env "$ROOT" || { echo "[chuyen] DỪNG, chưa làm gì. Xoá $MARK để chạy lại."; exit 1; }

failed=0

echo
echo "== 1. Ảnh sản phẩm"
ASSETS="$ROOT/modules/gian-hang/goc/assets"
for d in products thumbnails; do
  src="$OLD/assets/$d"
  dst="$ASSETS/$d"
  if [ ! -d "$src" ]; then echo "  $d: bản cũ không có $src — bỏ qua"; failed=$((failed + 1)); continue; fi
  count="$(find "$src" -type f | wc -l)"
  if [ -L "$dst" ]; then echo "  $d: đã nối sẵn -> $(readlink "$dst") ($count tệp)"; continue; fi
  if [ -e "$dst" ] && [ ! -d "$dst" ]; then echo "  $d: $dst là một tệp — không đụng, xem tay"; failed=$((failed + 1)); continue; fi
  if [ -d "$dst" ] && [ -n "$(ls -A "$dst")" ]; then echo "  $d: $dst đã có tệp thật — không đụng, xem tay"; failed=$((failed + 1)); continue; fi
  if [ "$MODE" = thu ]; then echo "  $d: sẽ nối $dst -> $src ($count tệp)"; continue; fi
  [ -d "$dst" ] && rmdir "$dst"
  if ln -s "$src" "$dst"; then echo "  $d: đã nối $dst -> $src ($count tệp)"; else failed=$((failed + 1)); fi
done

export THU_MUC_THAT="$OLD/data" CHE_DO_THAT=1 TOPRUN_MYSQL_URL="$MYSQL_URL" MA_QUAN_TRI="$ADMIN_TOKEN" DIA_CHI="$SITE"
[ "$MODE" = thu ] && export CHI_XEM=1

run_tool() {
  echo
  echo "== $1"
  if node "dist/tools/$2.js"; then echo "  -> OK"; else echo "  -> HỎNG (xem các dòng ngay trên)"; failed=$((failed + 1)); fi
}

run_tool "2. Đơn còn trong JSON" import-orders
run_tool "3. Cộng tác viên" import-collaborators

catalog_bytes="$(stat -c %s "$OLD/data/published-products.json" 2>/dev/null || echo 0)"
if [ "$catalog_bytes" -gt $((16 * 1024 * 1024)) ]; then
  echo
  echo "  CẢNH BÁO: published-products.json nặng $catalog_bytes byte, quá 16 MB — /api/products sẽ từ chối (413)."
fi
run_tool "4. Danh mục hàng + nội dung trang (qua $SITE)" import-catalog

echo
if [ "$failed" -eq 0 ]; then
  echo "[chuyen] XONG $(date '+%F %T')$([ "$MODE" = thu ] && echo ' — chưa ghi gì; số liệu ổn thì đổi Cron sang chế độ that')."
else
  echo "[chuyen] $failed việc HỎNG — xem ở trên. Sửa xong thì xoá $MARK để Cron chạy lại (việc đã xong sẽ được bỏ qua)."
  exit 1
fi
