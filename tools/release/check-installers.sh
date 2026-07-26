#!/bin/sh
# Syntax- and behaviour-check both installer scripts.
#
# PowerShell runs on Linux, so install.ps1 is verifiable in CI rather than
# "looks right to me" — which is how it shipped with an unchecked switch
# statement the first time.
#
# Usage: sh tools/release/check-installers.sh
set -eu

ROOT=$(CDPATH='' cd "$(dirname "$0")/../.." && pwd)
SH="$ROOT/apps/site/public/install.sh"
PS1_FILE="$ROOT/apps/site/public/install.ps1"
fails=0

printf '%s\n' "== install.sh =="
if sh -n "$SH"; then printf '  %s\n' "POSIX syntax OK"; else printf '  %s\n' "SYNTAX ERROR"; fails=1; fi

# Bashisms would break on dash/ash, which is what /bin/sh is on many systems.
if command -v checkbashisms >/dev/null 2>&1; then
  if checkbashisms "$SH" >/dev/null 2>&1; then printf '  %s\n' "no bashisms"; else printf '  %s\n' "BASHISMS FOUND"; fails=1; fi
fi

if sh "$SH" help >/dev/null 2>&1; then printf '  %s\n' "help runs"; else printf '  %s\n' "help FAILED"; fails=1; fi

for cmd in install update upgrade uninstall remove login version help; do
  if ! grep -q "$cmd" "$SH"; then printf '  %s\n' "missing subcommand: $cmd"; fails=1; fi
done

printf '%s\n' "== install.ps1 =="
PWSH=$(command -v pwsh || echo /tmp/pwsh/pwsh)
if [ -x "$PWSH" ]; then
  if "$PWSH" -NoProfile -Command "
      \$errors = \$null
      [System.Management.Automation.Language.Parser]::ParseFile('$PS1_FILE', [ref]\$null, [ref]\$errors) | Out-Null
      if (\$errors.Count -gt 0) { \$errors | ForEach-Object { Write-Host \$_.Message }; exit 1 }
    "; then
    printf '  %s\n' "parses OK"
  else
    printf '  %s\n' "SYNTAX ERROR"; fails=1
  fi
else
  printf '  %s\n' "pwsh not installed; skipping (install it to check this)"
fi

[ "$fails" -eq 0 ] && printf '\n%s\n' "installers OK" || printf '\n%s\n' "installer checks FAILED"
exit "$fails"
