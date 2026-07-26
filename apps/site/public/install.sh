#!/bin/sh
# ===========================================================================
# NIGHTCELL 7 installer
#
#   curl -fsSL https://nightcell7.com/install.sh | sh
#
# Installs the desktop client on macOS and Linux. POSIX sh, no bashisms, so it
# works on Alpine and minimal containers as well as the usual distros.
#
# Environment overrides:
#   NIGHTCELL7_VERSION      pin a version instead of taking the latest
#   NIGHTCELL7_INSTALL_DIR  default $HOME/.nightcell7
#   NIGHTCELL7_BIN_DIR      default $HOME/.local/bin
# ===========================================================================
set -eu

REPO="profullstack/nightcell7"
INSTALL_DIR="${NIGHTCELL7_INSTALL_DIR:-$HOME/.nightcell7}"
BIN_DIR="${NIGHTCELL7_BIN_DIR:-$HOME/.local/bin}"

if [ -t 1 ]; then
  RED=$(printf '\033[0;31m'); GRN=$(printf '\033[0;32m')
  YLW=$(printf '\033[1;33m'); DIM=$(printf '\033[2m'); NC=$(printf '\033[0m')
else
  RED=''; GRN=''; YLW=''; DIM=''; NC=''
fi

info()    { printf '%s\n' "${DIM}▸${NC} $1"; }
success() { printf '%s\n' "${GRN}✓${NC} $1"; }
warn()    { printf '%s\n' "${YLW}!${NC} $1" >&2; }
fail()    { printf '%s\n' "${RED}✗${NC} $1" >&2; exit 1; }

banner() {
  printf '%s\n' ""
  printf '%s\n' "  NIGHTCELL 7 — FALSE DAWN"
  printf '%s\n' "  ${DIM}Two operatives. Two countries. One manufactured war.${NC}"
  printf '%s\n' ""
}

need() { command -v "$1" >/dev/null 2>&1; }

fetch() {
  # $1 url, $2 output ('-' for stdout)
  if need curl; then
    if [ "$2" = "-" ]; then curl -fsSL "$1"; else curl -fsSL "$1" -o "$2"; fi
  elif need wget; then
    if [ "$2" = "-" ]; then wget -qO- "$1"; else wget -qO "$2" "$1"; fi
  else
    fail "Neither curl nor wget is available."
  fi
}

detect_platform() {
  case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux)  OS=linux ;;
    *) fail "Unsupported operating system: $(uname -s). Windows users: see https://nightcell7.com/downloads" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)  ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
}

latest_version() {
  if [ -n "${NIGHTCELL7_VERSION:-}" ]; then
    printf '%s' "${NIGHTCELL7_VERSION#v}"
    return
  fi
  v=$(fetch "https://api.github.com/repos/${REPO}/releases/latest" - 2>/dev/null \
      | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/^v//')
  [ -n "$v" ] || fail "Could not determine the latest version. No release published yet? See https://nightcell7.com/downloads"
  printf '%s' "$v"
}

# Verify against the release SHA256SUMS. A pipe-to-shell installer that does
# not check what it downloaded is not worth the convenience.
verify_checksum() {
  file="$1"; name="$2"; version="$3"
  sums=$(fetch "https://github.com/${REPO}/releases/download/v${version}/SHA256SUMS.txt" - 2>/dev/null || true)
  if [ -z "$sums" ]; then
    warn "No SHA256SUMS.txt published for v${version}; skipping integrity check."
    return 0
  fi
  expected=$(printf '%s\n' "$sums" | grep " $name\$" | awk '{print $1}' | head -1)
  if [ -z "$expected" ]; then
    warn "$name is not listed in SHA256SUMS.txt; skipping integrity check."
    return 0
  fi
  if need sha256sum; then actual=$(sha256sum "$file" | awk '{print $1}')
  elif need shasum;   then actual=$(shasum -a 256 "$file" | awk '{print $1}')
  else warn "No sha256 tool available; skipping integrity check."; return 0
  fi
  [ "$expected" = "$actual" ] || fail "Checksum mismatch for $name. Refusing to install."
  success "Checksum verified"
}

install_mac() {
  version="$1"
  name="NIGHTCELL 7-${version}-${ARCH}.dmg"
  url="https://github.com/${REPO}/releases/download/v${version}/$(printf '%s' "$name" | sed 's/ /%20/g')"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  info "Downloading ${name}"
  fetch "$url" "$tmp/app.dmg" || fail "Download failed. Is v${version} published for ${ARCH}?"
  verify_checksum "$tmp/app.dmg" "$name" "$version"

  info "Mounting disk image"
  mount_point=$(hdiutil attach -nobrowse -readonly "$tmp/app.dmg" | grep -o '/Volumes/.*' | head -1)
  [ -n "$mount_point" ] || fail "Could not mount the disk image."

  app=$(find "$mount_point" -maxdepth 1 -name "*.app" | head -1)
  [ -n "$app" ] || { hdiutil detach "$mount_point" >/dev/null 2>&1; fail "No .app inside the disk image."; }

  info "Installing to /Applications"
  rm -rf "/Applications/$(basename "$app")"
  cp -R "$app" /Applications/
  hdiutil detach "$mount_point" >/dev/null 2>&1 || true

  success "Installed to /Applications/$(basename "$app")"
  printf '%s\n' "  Launch it from Spotlight, or: open -a \"$(basename "$app" .app)\""
}

install_linux() {
  version="$1"
  name="NIGHTCELL 7-${version}-${ARCH}.AppImage"
  url="https://github.com/${REPO}/releases/download/v${version}/$(printf '%s' "$name" | sed 's/ /%20/g')"

  mkdir -p "$INSTALL_DIR" "$BIN_DIR"
  target="${INSTALL_DIR}/NIGHTCELL7.AppImage"

  info "Downloading ${name}"
  fetch "$url" "${target}.part" || fail "Download failed. Is v${version} published for ${ARCH}?"
  verify_checksum "${target}.part" "$name" "$version"
  mv -f "${target}.part" "$target"
  chmod +x "$target"

  # AppImages need FUSE. Where it is missing, --appimage-extract-and-run still
  # works, so the launcher falls back instead of failing.
  cat > "${BIN_DIR}/nightcell7" <<LAUNCHER
#!/bin/sh
# Managed by the NIGHTCELL 7 installer. Edits will be overwritten.
APP="${target}"
if [ ! -x "\$APP" ]; then
  echo "NIGHTCELL 7 is not installed. Reinstall: curl -fsSL https://nightcell7.com/install.sh | sh" >&2
  exit 1
fi
if "\$APP" --appimage-version >/dev/null 2>&1; then
  exec "\$APP" "\$@"
else
  exec "\$APP" --appimage-extract-and-run "\$@"
fi
LAUNCHER
  chmod +x "${BIN_DIR}/nightcell7"

  # Desktop entry so it appears in the applications menu.
  apps_dir="$HOME/.local/share/applications"
  mkdir -p "$apps_dir"
  cat > "${apps_dir}/nightcell7.desktop" <<DESKTOP
[Desktop Entry]
Name=NIGHTCELL 7
Comment=Two operatives. Two countries. One manufactured war.
Exec=${BIN_DIR}/nightcell7 %U
Terminal=false
Type=Application
Categories=Game;ActionGame;
DESKTOP
  update-desktop-database "$apps_dir" >/dev/null 2>&1 || true

  success "Installed to ${target}"
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) printf '%s\n' "  Run: nightcell7" ;;
    *) warn "${BIN_DIR} is not on your PATH."
       printf '%s\n' "  Add it:  export PATH=\"${BIN_DIR}:\$PATH\""
       printf '%s\n' "  Or run:  ${BIN_DIR}/nightcell7" ;;
  esac
}

main() {
  banner
  detect_platform
  version=$(latest_version)
  info "Installing NIGHTCELL 7 v${version} for ${OS}-${ARCH}"

  case "$OS" in
    mac)   install_mac "$version" ;;
    linux) install_linux "$version" ;;
  esac

  printf '%s\n' ""
  success "Done."
  printf '%s\n' "  ${DIM}The demo and multiplayer alpha are free. No account needed to play the demo.${NC}"
  printf '%s\n' "  ${DIM}Prefer a package manager? https://nightcell7.com/downloads${NC}"
  printf '%s\n' ""
}

main "$@"
