#!/usr/bin/env bash
# Links the original Distant Worlds: Universe Steam install into public/assets/dwu
# (art, sounds and data files are never committed). Override with DWU_DIR=/path.
set -euo pipefail
DWU_DIR="${DWU_DIR:-$HOME/.local/share/Steam/steamapps/common/Distant Worlds Universe}"
cd "$(dirname "$0")/.."
[ -d "$DWU_DIR/images" ] || { echo "DW:U install not found at $DWU_DIR" >&2; exit 1; }
mkdir -p public/assets
ln -sfn "$DWU_DIR" public/assets/dwu
echo "linked $DWU_DIR -> public/assets/dwu"
