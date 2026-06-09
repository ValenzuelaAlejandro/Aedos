#!/bin/sh
# install-chrome.sh
# Installs chrome-headless-shell into the puppeteer-cache directory.
# Designed to work correctly even when Render restores cache dirs without
# the large binary (~150 MB) inside — Puppeteer's installer would skip the
# download if the directory already exists, leaving an empty cache.
# This script detects that case and forces a clean reinstall.

set -e

CACHE_DIR="$PWD/puppeteer-cache"
BINARY=$(find "$CACHE_DIR" -maxdepth 5 -name 'chrome-headless-shell' -type f 2>/dev/null | head -1)

if [ -n "$BINARY" ]; then
  echo "[chrome-install] Binary already present at: $BINARY"
  chmod +x "$BINARY" 2>/dev/null || true
  exit 0
fi

echo "[chrome-install] Binary not found. Cleaning stale cache dirs and reinstalling..."

# Remove stale directories so Puppeteer doesn't skip the download
rm -rf "$CACHE_DIR/chrome-headless-shell" 2>/dev/null || true
rm -rf "$CACHE_DIR/chrome" 2>/dev/null || true

PUPPETEER_CACHE_DIR="$CACHE_DIR" npx puppeteer browsers install chrome-headless-shell

# Make all chrome binaries executable
find "$CACHE_DIR" -type f \( -name 'chrome-headless-shell' -o -name 'chrome' \) -exec chmod +x {} + 2>/dev/null || true

INSTALLED=$(find "$CACHE_DIR" -maxdepth 5 -name 'chrome-headless-shell' -type f 2>/dev/null | head -1)
if [ -n "$INSTALLED" ]; then
  echo "[chrome-install] Successfully installed at: $INSTALLED"
else
  echo "[chrome-install] WARNING: Installation completed but binary not found."
fi
