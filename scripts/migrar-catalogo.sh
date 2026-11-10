#!/usr/bin/env bash
# Copia explícita del catálogo de proyectos anterior. No toca cuentas existentes.
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo 'Uso: ./scripts/migrar-catalogo.sh "/carpeta-anterior/workspace/launcher.vsui.json"' >&2
  exit 2
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'Este script prepara la migración para Linux/CachyOS.' >&2
  exit 2
fi
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/com.virgoland.vslauncher"
mkdir -p "$BASE"
if [[ -f "$BASE/launcher.vsui.json" ]]; then
  cp -a "$BASE/launcher.vsui.json" "$BASE/launcher.vsui.json.backup.$(date +%s)"
fi
cp -- "$1" "$BASE/launcher.vsui.json"
echo "Catálogo copiado a $BASE/launcher.vsui.json"
echo 'Si el launcher estaba abierto, cerralo y volvelo a abrir.'
