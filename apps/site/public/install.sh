#!/bin/sh
# ===========================================================================
# NIGHTCELL 7 installer
#
#   curl -fsSL https://nightcell7.com/install.sh | sh
#
# Subcommands (note the `-s --` needed to pass arguments through a pipe):
#   curl -fsSL https://nightcell7.com/install.sh | sh -s -- update
#   curl -fsSL https://nightcell7.com/install.sh | sh -s -- uninstall
#   curl -fsSL https://nightcell7.com/install.sh | sh -s -- version
#
# Once installed, the launcher forwards the same subcommands:
#   nightcell7 update
#   nightcell7 uninstall
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

# Find a release asset by regular expression.
#
# Asset names are decided by the packaging tool, not by us, so the installer
# discovers them from the release rather than reconstructing a filename. That
# removes an entire class of "works until the packager renames something" bugs.
find_asset() {
  version="$1"; pattern="$2"
  api="https://api.github.com/repos/${REPO}/releases/tags/v${version}"
  fetch "$api" - 2>/dev/null \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | cut -d'"' -f4 \
    | grep -iE "$pattern" \
    | head -1
}

install_mac() {
  version="$1"
  case "$ARCH" in
    arm64) pattern='mac-arm64\.dmg$' ;;
    *)     pattern='mac-x64\.dmg$' ;;
  esac

  url=$(find_asset "$version" "$pattern")
  [ -n "$url" ] || fail "No macOS ${ARCH} build in v${version}. See https://nightcell7.com/downloads"
  name=$(basename "$url")

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  info "Downloading ${name}"
  fetch "$url" "$tmp/app.dmg" || fail "Download failed."
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
  warn "This build is unsigned. macOS may refuse the first launch — right-click the app and choose Open."
}

install_linux() {
  version="$1"
  # electron-builder names linux artifacts x86_64/arm64, not x64.
  case "$ARCH" in
    arm64) pattern='linux-(arm64|aarch64)\.AppImage$' ;;
    *)     pattern='linux-(x86_64|x64|amd64)\.AppImage$' ;;
  esac

  url=$(find_asset "$version" "$pattern")
  [ -n "$url" ] || fail "No Linux ${ARCH} AppImage in v${version}. See https://nightcell7.com/downloads"
  name=$(basename "$url")

  mkdir -p "$INSTALL_DIR" "$BIN_DIR"
  target="${INSTALL_DIR}/NIGHTCELL7.AppImage"

  info "Downloading ${name}"
  fetch "$url" "${target}.part" || fail "Download failed."
  verify_checksum "${target}.part" "$name" "$version"
  mv -f "${target}.part" "$target"
  chmod +x "$target"

  # AppImages need FUSE. Where it is missing, --appimage-extract-and-run still
  # works, so the launcher falls back instead of failing.
  cat > "${BIN_DIR}/nightcell7" <<LAUNCHER
#!/bin/sh
# Managed by the NIGHTCELL 7 installer. Edits will be overwritten.
APP="${target}"

# Management subcommands are delegated back to the installer so there is one
# implementation of update and uninstall rather than two that drift.
case "\${1-}" in
  update|upgrade)
    exec sh -c "curl -fsSL https://nightcell7.com/install.sh | sh -s -- update"
    ;;
  uninstall|remove)
    exec sh -c "curl -fsSL https://nightcell7.com/install.sh | sh -s -- uninstall"
    ;;
  login|signin)
    exec sh -c "curl -fsSL https://nightcell7.com/install.sh | sh -s -- login"
    ;;
  version|--version)
    exec sh -c "curl -fsSL https://nightcell7.com/install.sh | sh -s -- version"
    ;;
esac

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

# Records what is installed so `update` can tell you it is already current
# instead of re-downloading a hundred megabytes to no effect.
VERSION_FILE="${INSTALL_DIR}/version"

installed_version() {
  if [ -f "$VERSION_FILE" ]; then
    cat "$VERSION_FILE"
  elif [ -d "/Applications/NIGHTCELL 7.app" ]; then
    # Installed before version tracking, or installed by hand.
    echo "unknown"
  else
    echo ""
  fi
}

record_version() {
  mkdir -p "$INSTALL_DIR"
  printf '%s' "$1" > "$VERSION_FILE"
}

do_install() {
  detect_platform
  version=$(latest_version)
  current=$(installed_version)

  if [ "$1" = "update" ] && [ -n "$current" ] && [ "$current" = "$version" ]; then
    success "Already on the latest version (v${version})."
    return 0
  fi

  if [ -n "$current" ] && [ "$current" != "$version" ]; then
    info "Updating NIGHTCELL 7 v${current} → v${version} (${OS}-${ARCH})"
  else
    info "Installing NIGHTCELL 7 v${version} for ${OS}-${ARCH}"
  fi

  case "$OS" in
    mac)   install_mac "$version" ;;
    linux) install_linux "$version" ;;
  esac
  record_version "$version"

  printf '%s\n' ""
  success "Done."
  printf '%s\n' "  ${DIM}The demo and multiplayer alpha are free. No account needed to play the demo.${NC}"
  printf '%s\n' "  ${DIM}Update later with: nightcell7 update${NC}"
  printf '%s\n' ""
}

do_uninstall() {
  detect_platform
  removed=0

  if [ "$OS" = "mac" ]; then
    for app in "/Applications/NIGHTCELL 7.app" "/Applications/nightcell7.app"; do
      if [ -d "$app" ]; then
        info "Removing $app"
        rm -rf "$app" && removed=1
      fi
    done
  fi

  if [ -d "$INSTALL_DIR" ]; then
    info "Removing $INSTALL_DIR"
    rm -rf "$INSTALL_DIR" && removed=1
  fi

  if [ -f "${BIN_DIR}/nightcell7" ]; then
    info "Removing ${BIN_DIR}/nightcell7"
    rm -f "${BIN_DIR}/nightcell7" && removed=1
  fi

  desktop="$HOME/.local/share/applications/nightcell7.desktop"
  if [ -f "$desktop" ]; then
    info "Removing desktop entry"
    rm -f "$desktop" && removed=1
    update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
  fi

  if [ "$removed" -eq 1 ]; then
    success "NIGHTCELL 7 removed."
    # Saves and settings live in browser/Electron storage, so say where rather
    # than deleting data the user did not ask us to touch.
    printf '%s\n' "  ${DIM}Local saves and settings were left alone.${NC}"
    printf '%s\n' "  ${DIM}macOS: ~/Library/Application Support/NIGHTCELL 7${NC}"
    printf '%s\n' "  ${DIM}Linux: ~/.config/NIGHTCELL 7${NC}"
  else
    warn "NIGHTCELL 7 does not appear to be installed."
  fi
}

# Opens the browser to sign in. Authentication is a browser-session concern —
# the desktop client deliberately has no privileged path to credentials
# (PRD §28.2), so there is nothing to type into a terminal here.
do_login() {
  url="https://nightcell7.com/login?from=cli"
  info "Opening $url"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 &
  else
    warn "Could not open a browser automatically."
    printf '%s\n' "  Sign in at: $url"
    return 0
  fi
  success "Sign in in your browser, then launch the game."
}

do_version() {
  current=$(installed_version)
  if [ -z "$current" ]; then
    printf '%s\n' "NIGHTCELL 7 is not installed."
    return 1
  fi
  printf '%s\n' "installed: v${current}"
  latest=$(latest_version 2>/dev/null || echo "")
  if [ -n "$latest" ]; then
    printf '%s\n' "latest:    v${latest}"
    [ "$latest" != "$current" ] && printf '%s\n' "Run 'nightcell7 update' to upgrade."
  fi
  return 0
}

usage() {
  cat <<USAGE
NIGHTCELL 7 installer

Usage:
  curl -fsSL https://nightcell7.com/install.sh | sh
  curl -fsSL https://nightcell7.com/install.sh | sh -s -- <command>

Commands:
  install            Install the latest version (default)
  update, upgrade    Update to the latest version
  uninstall, remove  Remove the app, launcher and desktop entry
  login              Open the browser to sign in
  version            Show installed and latest versions
  help               Show this message

Environment:
  NIGHTCELL7_VERSION      Install a specific version
  NIGHTCELL7_INSTALL_DIR  Default \$HOME/.nightcell7
  NIGHTCELL7_BIN_DIR      Default \$HOME/.local/bin
USAGE
}

main() {
  case "${1:-install}" in
    install)            banner; do_install install ;;
    update|upgrade)     banner; do_install update ;;
    uninstall|remove)   banner; do_uninstall ;;
    login|signin)       banner; do_login ;;
    version|--version)  do_version ;;
    help|--help|-h)     usage ;;
    *) fail "Unknown command: $1. Try 'help'." ;;
  esac
}

main "$@"
