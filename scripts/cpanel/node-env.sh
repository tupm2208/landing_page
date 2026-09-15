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
    local name candidate
    name="$(basename "$root")"
    local found=()
    # Vòng lặp chứ không `ls glob...`: một mẫu không khớp làm `ls` trả 2, và dưới `set -e -o pipefail`
    # script thoát câm ngay tại đây (đã gặp trên cPanel 15/09/2026).
    for candidate in "$HOME/nodevenv/$rel"/*/bin/activate "$HOME/nodevenv"/*/"$name"/*/bin/activate "$HOME/nodevenv/$name"/*/bin/activate; do
      [ -f "$candidate" ] && found+=("$candidate")
    done
    if [ "${#found[@]}" -gt 0 ]; then activate="$(printf '%s\n' "${found[@]}" | sort -V | tail -n 1)"; fi
  fi
  if [ -z "$activate" ] || [ ! -f "$activate" ]; then
    echo "LỖI: không thấy môi trường Node trong $HOME/nodevenv/ — vào Setup Node.js App tạo app với Application root = ${root#"$HOME"/} trước." >&2
    return 1
  fi
  echo "[node] $activate"
  # Script activate của CloudLinux không viết cho `set -e`: tạm tắt errexit, pipefail và trap ERR khi nạp,
  # xong trả lại như cũ. Đọc `$-` ngay tại shell này — `$(set +o)` chạy trong shell con, nơi bash đã
  # bỏ errexit, nên sẽ "trả lại" thành tắt.
  local had_errexit=0 had_pipefail=0 saved_err_trap
  case $- in *e*) had_errexit=1 ;; esac
  shopt -qo pipefail && had_pipefail=1
  saved_err_trap="$(trap -p ERR)"
  trap - ERR
  set +e +o pipefail
  # shellcheck disable=SC1090
  source "$activate"
  [ "$had_pipefail" = 1 ] && set -o pipefail
  [ -n "$saved_err_trap" ] && eval "$saved_err_trap"
  [ "$had_errexit" = 1 ] && set -e
  return 0
}
