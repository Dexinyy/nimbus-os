#!/usr/bin/env bash
# Build Nimbus OS: the desktop and the bootable ISO (written to out/).
# Run on Ubuntu 24.04 with root rights:  sudo ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
exec ./os/build-iso.sh "$@"
