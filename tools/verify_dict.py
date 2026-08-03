#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверки качества словаря (ТЗ 4.1.5). Падает с ненулевым кодом при нарушении.
Ключи в data/*.txt уже нормализованы (нижний регистр, ё->е, без дефисов).

    python3 tools/verify_dict.py
"""
import os
import re
import sys
import random
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return [w for w in f.read().split("\n") if w]

full = load("full.txt")
freq = load("freq.txt")
other = load("other.txt")
full_set, freq_set = set(full), set(freq)

SKIP = "ьъы"
def next_letter(w):
    for ch in reversed(w):
        if ch not in SKIP:
            return ch
    return None

errors = []

# 1. только а-я (нормализовано: ё уже как е, дефисов нет)
CH = re.compile(r"^[а-я]+$")
bad_chars = [w for w in full if not CH.match(w)]
if bad_chars:
    errors.append(f"1. Не только а-я: {bad_chars[:10]} … всего {len(bad_chars)}")

# 2. длина >= 2
short = [w for w in full if len(w) < 2]
if short:
    errors.append(f"2. Короче 2: {short[:10]} … всего {len(short)}")

# 3. дубликаты после нормализации
dups = [w for w, c in Counter(full).items() if c > 1]
if dups:
    errors.append(f"3. Дубликаты: {dups[:10]} … всего {len(dups)}")

# 4. буквенное покрытие подсказок: на любую букву, на которую есть ход, есть слово в тире
reachable = set(filter(None, (next_letter(w) for w in full)))
freq_first = set(w[0] for w in freq)
gap = sorted(reachable - freq_first)
if gap:
    errors.append(f"4. Нет подсказок на буквы {gap}, хотя слова на них заканчиваются")

# 5. стоп-лист (грубая перепроверка на явный мат)
STOP = ["хуй", "пизд", "бляд", "ебан", "ебат", "мудак", "гандон", "залуп",
        "говно", "жопа", "педераст", "шлюх", "порно"]
leaked = [w for w in full if any(w.startswith(s) for s in STOP)]
if leaked:
    errors.append(f"5. Просочился мат: {leaked[:20]}")

# 6. частотный тир — подмножество полного словаря
notsub = [w for w in freq if w not in full_set]
if notsub:
    errors.append(f"6. Тир не подмножество словаря: {notsub[:10]} … всего {len(notsub)}")

# ---------------- отчёт ----------------
print("=" * 56)
print(f"Полный словарь: {len(full):,} | тир: {len(freq):,} | другие ч.р.: {len(other):,}")
print(f"Букв, на которые есть ход: {len(reachable)} | покрыто тиром: {len(reachable & freq_first)}")
by_first = Counter(w[0] for w in full)
print("\nСлов на букву (полный словарь):")
for L in sorted(by_first):
    print(f"  {L}: {by_first[L]:>6}", end="")
    if (sorted(by_first).index(L) + 1) % 6 == 0:
        print()
print()
print("\nТоп-15 длинных:", ", ".join(sorted(full, key=len, reverse=True)[:15]))
print("\n50 случайных на глаз:")
print("  " + ", ".join(random.Random(7).sample(full, 50)))

print("\n" + "=" * 56)
if errors:
    print("ПРОВЕРКА НЕ ПРОЙДЕНА:")
    for e in errors:
        print("  ✗ " + e)
    sys.exit(1)
print("Все проверки пройдены ✓")
