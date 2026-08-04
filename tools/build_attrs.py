#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Классификаторы слов — «база», на которой строятся умные подсказки, тематические
режимы, уровни сложности и фильтры.

На каждое слово из data/full.txt (тот же порядок, что DFULL) пакуем 12 бит:
  pos    1 бит  0=сущ, 1=прил
  gender 2 бита 0=нет, 1=муж, 2=жен, 3=сред
  anim   2 бита 0=нет, 1=неживое, 2=живое
  pltm   1 бит  только множественное (ножницы)
  sgtm   1 бит  только единственное (молоко)
  inde   1 бит  несклоняемое (кофе, пальто)
  tier   3 бита уровень частотности 0(очень частое)..5(редкое)
  dim    1 бит  уменьшительно-ласкательное (эвристика по суффиксу)
Код -> 2 символа base64url. Выравнено по сорт. списку full -> window.DATTR.

Тема хранится отдельно (data/themes.js), в приложении строится обратная карта.

Запуск (после build_dict.py):
    python3 tools/build_attrs.py   ->  data/attrs.js
"""
import os
import re
import json
import pymorphy3
from wordfreq import zipf_frequency

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

GEND = {"masc": 1, "femn": 2, "neut": 3}
ANIM = {"inan": 1, "anim": 2}
DIM_SUF = ("чик", "щик", "очк", "ечк", "оньк", "еньк", "ушк", "юшк", "ышк",
           "ёнок", "енок", "онок", "ик", "ок", "ек", "ца")


def tier_of(z):
    if z >= 4.5: return 0
    if z >= 4.0: return 1
    if z >= 3.5: return 2
    if z >= 3.0: return 3
    if z >= 2.2: return 4
    return 5


def is_dim(k):
    if len(k) < 5:
        return False
    return k.endswith(DIM_SUF)


def pick_parse(morph, key):
    """Лучший разбор: сначала сущ., потом прил.; иначе первый."""
    parses = morph.parse(key)
    noun = next((p for p in parses if p.tag.POS == "NOUN"), None)
    if noun:
        return noun
    adj = next((p for p in parses if p.tag.POS == "ADJF"), None)
    return adj or (parses[0] if parses else None)


def main():
    with open(os.path.join(DATA, "full.txt"), encoding="utf-8") as f:
        words = [w for w in f.read().split("\n") if w]
    print(f"Слов: {len(words):,}. Разбираю и классифицирую…", flush=True)

    morph = pymorphy3.MorphAnalyzer()
    out = []
    counts = {"noun": 0, "adj": 0, "anim": 0, "dim": 0, "pltm": 0, "sgtm": 0, "indecl": 0}
    tier_hist = [0] * 6

    for i, k in enumerate(words):
        if i and i % 20000 == 0:
            print(f"  …{i:,}", flush=True)
        p = pick_parse(morph, k)
        t = p.tag if p else None
        pos = 1 if (t and t.POS == "ADJF") else 0
        g = GEND.get(str(t.gender) if t else None, 0)
        a = 0 if pos == 1 else ANIM.get(str(t.animacy) if t else None, 0)
        gr = t.grammemes if t else set()
        pltm = 1 if "Pltm" in gr else 0
        sgtm = 1 if "Sgtm" in gr else 0
        inde = 1 if "Fixd" in gr else 0
        tier = tier_of(zipf_frequency(k, "ru"))
        dim = 1 if is_dim(k) else 0

        code = (pos << 11) | (g << 9) | (a << 7) | (pltm << 6) | (sgtm << 5) | (inde << 4) | (tier << 1) | dim
        out.append(ALPHA[(code >> 6) & 63] + ALPHA[code & 63])

        counts["noun" if pos == 0 else "adj"] += 1
        if a == 2: counts["anim"] += 1
        if dim: counts["dim"] += 1
        if pltm: counts["pltm"] += 1
        if sgtm: counts["sgtm"] += 1
        if inde: counts["indecl"] += 1
        tier_hist[tier] += 1

    dattr = "".join(out)
    meta = {"order": "full", "n": len(words),
            "bits": {"pos": 1, "gender": 2, "anim": 2, "pltm": 1, "sgtm": 1, "indecl": 1, "tier": 3, "dim": 1},
            "counts": counts, "tiers": tier_hist}

    js = os.path.join(DATA, "attrs.js")
    with open(js, "w", encoding="utf-8") as f:
        f.write("/* Автогенерация tools/build_attrs.py — классификаторы слов. */\n")
        f.write("window.DATTR_META=" + json.dumps(meta, ensure_ascii=False) + ";\n")
        f.write("window.DATTR=`" + dattr + "`;\n")

    print(f"\nГотово: {js}  ({os.path.getsize(js) / 1024:.0f} КБ)")
    print("Сущ./прил.:", counts["noun"], "/", counts["adj"],
          "| живых:", counts["anim"], "| уменьш.:", counts["dim"],
          "| только-мн:", counts["pltm"], "| только-ед:", counts["sgtm"], "| несклон.:", counts["indecl"])
    print("Уровни 0..5:", tier_hist)


if __name__ == "__main__":
    main()
