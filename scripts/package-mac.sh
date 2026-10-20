#!/usr/bin/env bash
# Compatible entrypoint for the standalone desktop package.
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/package-desktop-mac.sh" "$@"
