#!/bin/bash
# Build landing trên cPanel KHÔNG cần Terminal.
# .cpanel.yml gọi script này khi bấm Git Version Control -> Manage -> Pull or Deploy -> "Deploy HEAD Commit".
# Làm: npm install (cả devDependencies — cần typescript) -> npm run build -> báo app khởi động lại.
# Nhật ký: ~/landing-logs/build-<giờ>.log (mở bằng File Manager).
set -eo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$HOME/landing-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "[build] HỎNG ở dòng $LINENO — xem các dòng ngay trên."' ERR

echo "[build] $(date '+%F %T') tại $ROOT"
cd "$ROOT"
# shellcheck source=node-env.sh
source "$ROOT/scripts/cpanel/node-env.sh"
cpanel_node_env "$ROOT"
echo "[build] node $(node -v), npm $(npm -v)"

# Application mode "Production" đặt NODE_ENV=production: npm sẽ bỏ devDependencies và thiếu typescript.
npm install --include=dev --no-audit --no-fund
npm run build
test -f dist/main.js

# Passenger/LiteSpeed khởi động lại app khi tệp này đổi giờ sửa.
mkdir -p tmp
touch tmp/restart.txt
echo "[build] XONG $(date '+%F %T') — app khởi động lại ở lượt truy cập tới (hoặc bấm Restart trong Setup Node.js App)."
