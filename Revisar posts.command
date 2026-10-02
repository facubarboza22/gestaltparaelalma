#!/bin/zsh
# Doble clic: abre la página para revisar los posts de @gestaltparaelalma.
# Dejá esta ventana abierta mientras revisás; al cerrarla se apaga la página.
cd "$(dirname "$0")"
# The first node that actually runs (Homebrew's latest has broken before).
for NODE in /opt/homebrew/opt/node@20/bin/node /usr/local/bin/node "$(command -v node)"; do
  [ -x "$NODE" ] && "$NODE" --version >/dev/null 2>&1 && break
  NODE=""
done
if [ -z "$NODE" ]; then
  echo "No encontré Node funcionando en esta Mac. Avisale a Facundo."
  read -k1 "?Apretá una tecla para cerrar."
  exit 1
fi
"$NODE" scripts/review.mjs
