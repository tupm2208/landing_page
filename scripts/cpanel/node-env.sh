# Nạp môi trường Node của app ("Setup Node.js App" trên cPanel/CloudLinux) cho script chạy từ Cron hoặc
# .cpanel.yml — hai nơi đó không có Terminal nên PATH không có node/npm.
#   source scripts/cpanel/node-env.sh && cpanel_node_env "$ROOT"
# Tìm ~/nodevenv/<Application root>/<phiên bản>/bin/activate, lấy phiên bản cao nhất.
# Đặt NODEVENV_ACTIVATE=/đường/tới/bin/activate để chỉ định tay.

cpanel_node_env() {
  local root="$1"
  local activate="${NODEVENV_ACTIVATE:-}"
  if [ -z "$activate" ]; then
    local rel="${root#"$HOME"/}"
    local name
    name="$(basename "$root")"
    activate="$(ls -d "$HOME/nodevenv/$rel"/*/bin/activate "$HOME/nodevenv"/*/"$name"/*/bin/activate "$HOME/nodevenv/$name"/*/bin/activate 2>/dev/null | sort -V | tail -n 1)"
  fi
  if [ -z "$activate" ] || [ ! -f "$activate" ]; then
    echo "LỖI: không thấy môi trường Node trong $HOME/nodevenv/ — vào Setup Node.js App tạo app với Application root = ${root#"$HOME"/} trước." >&2
    return 1
  fi
  echo "[node] $activate"
  # shellcheck disable=SC1090
  source "$activate"
}
