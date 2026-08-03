#!/usr/bin/env bash
# Поднимает версию кеша сразу во всех местах (обход кеша браузера/Телеграма).
# Запускать перед коммитом любой правки кода/разметки:
#   tools/bump-version.sh          # +1 к текущей версии
#   tools/bump-version.sh 12       # выставить конкретную версию
# После — git add -A && git commit && git push (Pages пересоберётся сам).
#
# Места версии: V в src/ui.js, ?v= в index.html, CACHE и ?v= в sw.js.
# Примечание: используется BSD sed (macOS). На Linux замените `sed -i ''` на `sed -i`.
set -euo pipefail
cd "$(dirname "$0")/.."

old="$(grep -oE "var V = '[0-9]+'" src/ui.js | grep -oE '[0-9]+')"
new="${1:-$((old + 1))}"

sed -i '' "s/var V = '${old}'/var V = '${new}'/" src/ui.js
sed -i '' "s/?v=${old}/?v=${new}/g" index.html
sed -i '' "s/slova-v${old}/slova-v${new}/g; s/?v=${old}/?v=${new}/g" sw.js

echo "версия кеша: ${old} -> ${new}"
