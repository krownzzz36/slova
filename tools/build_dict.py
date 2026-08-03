#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка словаря для игры «Слова».

Источник: pymorphy3 + pymorphy3-dicts-ru (OpenCorpora) — закрытый список реальных
словоформ. Мы НЕ прогоняем ввод через parse() при валидации (pymorphy угадывает
несуществующие слова: «рррр» -> NOUN «рррра»). Вместо этого перечисляем реальные
леммы и берём только канонические существительные и полные прилагательные.

Частотный тир (для подсказок и «понятности» ребёнку) строим через wordfreq:
лемматизируем частотный список и пересекаем с полным словарём, сохраняя порядок.

Выход — один файл data/dict-data.js (front-coding + template literals), который
инлайнится в приложение. Плюс data/*.txt для verify_dict.py и ручной проверки.

Запуск:
    source .venv/bin/activate
    python3 tools/build_dict.py
"""
import os
import re
import sys
import json
import random

import pymorphy3
from wordfreq import top_n_list

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)

# ------------------------------------------------------------------ нормализация
CYR = re.compile(r"^[а-яё]+(-[а-яё]+)?$")  # только кириллица, один необязательный дефис

def norm(s):
    """Ключ для сравнения: нижний регистр, ё->е, дефисы убраны."""
    return s.lower().replace("ё", "е").replace("-", "")

# ------------------------------------------------------------------ грамм. фильтры
# NOUN — существительные, ADJF — полные прилагательные.
KEEP_POS = {"NOUN", "ADJF"}
# Мусор выбрасываем всегда: организации, торговые марки, аббревиатуры, ошибочные,
# искажённые, разговорные, сленг. Arch (устаревшие) оставляем — «терем».
JUNK_GRAMMEMES = {"Orgn", "Trad", "Abbr", "Erro", "Dist", "Infr", "Slng"}
# Имена собственные и гео — В ОТДЕЛЬНЫЕ ТИРЫ (включаются тумблером в игре).
PROPER_GRAMMEMES = {"Name", "Surn", "Patr"}        # имена, фамилии, отчества
GEO_GRAMMEMES = {"Geox"}                            # города, страны, реки…

# ------------------------------------------------------------------ фильтр мата
# Обсценные корни. Матчим ТОЛЬКО с «якорем»: слово начинается на (приставка + корень).
# Это ловит производные (за-, вы-, на-...), но не рубит невинные «хлеб», «требуха»,
# где корень оказался бы в середине.
BAD_STEMS = [
    "хуй", "хуе", "хуё", "хуя", "хую",
    "пизд", "пизж",
    "ебан", "ебат", "ебал", "ебуч", "ебл", "ёб", "ебн", "ебо", "ебу", "ебё", "ебс", "еба",
    "бляд", "блядь", "блят",
    "муда", "мудо", "мудя",
    "гандон", "гондон",
    "залуп",
    "сцык", "ссык",
    "дроч", "дрочь",
    "педераст", "педрил", "пидор", "пидар", "пидер",
    "шлюх", "шлюш", "блудни",
    "говн", "говён", "дерьм", "срак", "сран",
    "жоп", "задниц",
    "порно", "порн", "эроти", "сексуал", "минет", "мастурб",
    "вагин", "генитал", "совокупл", "фалло", "оргазм",
]
# Корни, которые как substring режут невинные слова (гейзер, страховка, мандарин,
# херувим), — держим ТОЛЬКО как точные слова, не как приставочные основы.
BAD_EXACT_STEMS = ["гей", "хер", "трах", "манда", "мандав", "сри"]
PREFIXES = ["", "за", "на", "по", "вы", "об", "от", "под", "при", "пере", "про",
            "пре", "у", "с", "из", "ис", "до", "раз", "рас", "воз", "вос", "не",
            "о", "недо", "по", "при"]
# Точные слова, которые не хочется в детской игре (если проскочат мимо корней).
BAD_EXACT = {norm(w) for w in ([
    "сука", "блядина", "мразь", "тварь", "ублюдок", "проститутка",
    "минет", "оргазм", "порно", "секс", "сперма", "вагина", "пенис",
    "клитор", "презерватив", "изнасилование", "наркотик", "героин", "кокаин",
    "гей", "хер", "манда", "трах",
] + BAD_EXACT_STEMS)}

def _make_bad_prefixes():
    out = set()
    for st in BAD_STEMS:
        for p in PREFIXES:
            out.add(p + st)
    return tuple(sorted(out))

BAD_PREFIXES = _make_bad_prefixes()

def is_bad(nkey):
    if nkey in BAD_EXACT:
        return True
    return nkey.startswith(BAD_PREFIXES)

# ------------------------------------------------------------------ front-coding
def front_code(sorted_words):
    """['автобус','автобусный','автограф'] -> ['0автобус','7ный','4граф'].
    Длина общего префикса кодируется одним символом base36 (0..35, кап 35)."""
    out = []
    prev = ""
    for w in sorted_words:
        p = 0
        m = min(len(prev), len(w), 35)
        while p < m and prev[p] == w[p]:
            p += 1
        # base36 одним символом
        c = "0123456789abcdefghijklmnopqrstuvwxyz"[p]
        out.append(c + w[p:])
        prev = w
    return "\n".join(out)

# ------------------------------------------------------------------ 1. полный словарь
def build_full():
    print("Перечисляю словарные леммы (сущ. + прил. + имена + гео)…", flush=True)
    morph = pymorphy3.MorphAnalyzer()
    nouns, adjs, names, geo = set(), set(), set(), set()
    seen = 0
    for word, tag, normal, para_id, idx in morph.dictionary.iter_known_words():
        seen += 1
        if seen % 1_000_000 == 0:
            print(f"  …{seen:,} форм", flush=True)
        pos = tag.POS
        if pos not in KEEP_POS:
            continue
        # берём только каноническую строку леммы (её словарную форму)
        if word != normal:
            continue
        if not CYR.match(word):
            continue
        nk = norm(word)
        if len(nk) < 2 or is_bad(nk):
            continue
        gr = tag.grammemes
        if gr & JUNK_GRAMMEMES:
            continue
        if gr & PROPER_GRAMMEMES:
            names.add(nk)
        elif gr & GEO_GRAMMEMES:
            geo.add(nk)
        else:
            (nouns if pos == "NOUN" else adjs).add(nk)

    # прилагательное-омоним не дублируем в существительных
    full = nouns | adjs
    names -= full        # если слово есть и как нарицательное — оно в full
    geo -= full
    print(f"  сущ.: {len(nouns):,} | прил.: {len(adjs):,} | всего нариц.: {len(full):,}")
    print(f"  имена/фамилии: {len(names):,} | города/страны/гео: {len(geo):,}")
    build_full.extra = {"names": names, "geo": geo}
    return full, nouns, adjs, morph

# ------------------------------------------------------------------ 2. частотный тир
def build_freq(full, morph, target=14000):
    print("Строю частотный тир (лемматизация wordfreq)…", flush=True)
    freq_order = []
    seen = set()
    for token in top_n_list("ru", 120000):
        if not CYR.match(token):
            continue
        try:
            p = morph.parse(token)[0]
        except Exception:
            continue
        if p.tag.POS not in KEEP_POS:
            continue
        lemma = p.normal_form
        nk = norm(lemma)
        if nk in full and nk not in seen:
            seen.add(nk)
            freq_order.append(nk)     # ключ (для проверки/подсказок хватает нормализованного)
            if len(freq_order) >= target:
                break
    print(f"  частотный тир: {len(freq_order):,} слов")
    return freq_order

# ------------------------------------------------------------------ 3. другие части речи
def build_other(full, morph, target=9000):
    print("Строю список частотных НЕ сущ./прил. (для «только сущ. и прил.»)…", flush=True)
    other = set()
    for token in top_n_list("ru", 40000):
        if not CYR.match(token):
            continue
        try:
            p = morph.parse(token)[0]
        except Exception:
            continue
        pos = p.tag.POS
        if pos in KEEP_POS or pos is None:
            continue
        nk = norm(token)
        if len(nk) >= 2 and nk not in full and not is_bad(nk):
            other.add(nk)
        lk = norm(p.normal_form)
        if len(lk) >= 2 and lk not in full and not is_bad(lk):
            other.add(lk)
        if len(other) >= target:
            break
    print(f"  других частей речи: {len(other):,}")
    return other

# ------------------------------------------------------------------ 4. покрытие букв
def next_letter(nk, skip="ьъы"):
    for ch in reversed(nk):
        if ch not in skip:
            return ch
    return None

def ensure_letter_coverage(full, freq_order):
    """Каждая буква, на которую можно получить ход, должна иметь слова в подсказках.
    Если в частотном тире буквы нет — добираем самые короткие слова из полного словаря."""
    needed = set()
    for w in full:
        L = next_letter(w)
        if L:
            needed.add(L)
    have = set(w[0] for w in freq_order)
    freq_set = set(freq_order)
    added = 0
    for L in sorted(needed):
        if L in have:
            continue
        cands = sorted([w for w in full if w[0] == L], key=lambda x: (len(x), x))[:5]
        for w in cands:
            if w not in freq_set:
                freq_order.append(w)
                freq_set.add(w)
                added += 1
    if added:
        print(f"  добрано в тир для покрытия букв: {added}")
    return freq_order

# ------------------------------------------------------------------ запись
def main():
    full, nouns, adjs, morph = build_full()
    freq_order = build_freq(full, morph)
    freq_order = ensure_letter_coverage(full, freq_order)
    other = build_other(full, morph)
    other -= full  # на всякий случай

    names = build_full.extra["names"]
    geo = build_full.extra["geo"]
    full_sorted = sorted(full)
    other_sorted = sorted(other)
    names_sorted = sorted(names)
    geo_sorted = sorted(geo)

    # --- текстовые дампы для verify/глаз ---
    def dump(name, arr):
        with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
            f.write("\n".join(arr))
    dump("full.txt", full_sorted); dump("freq.txt", freq_order)
    dump("other.txt", other_sorted); dump("names.txt", names_sorted); dump("geo.txt", geo_sorted)

    # --- JS-данные для приложения ---
    fc_full = front_code(full_sorted)
    fc_other = front_code(other_sorted)
    fc_names = front_code(names_sorted)
    fc_geo = front_code(geo_sorted)
    freq_join = "\n".join(freq_order)          # порядок важен -> без front-coding
    meta = {"nouns": len(nouns), "adjs": len(adjs), "full": len(full),
            "freq": len(freq_order), "other": len(other),
            "names": len(names), "geo": len(geo)}

    js_path = os.path.join(DATA, "dict-data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("/* Автогенерация tools/build_dict.py — не редактировать руками. */\n")
        f.write("window.DICT_META=" + json.dumps(meta, ensure_ascii=False) + ";\n")
        f.write("window.DFULL=`" + fc_full + "`;\n")
        f.write("window.DFREQ=`" + freq_join + "`;\n")
        f.write("window.DOTHER=`" + fc_other + "`;\n")
        f.write("window.DNAMES=`" + fc_names + "`;\n")
        f.write("window.DGEO=`" + fc_geo + "`;\n")

    size = os.path.getsize(js_path)
    print(f"\nГотово. {js_path}  ({size/1024:.0f} КБ, до gzip)")
    print("META:", json.dumps(meta, ensure_ascii=False))

    # мелкий отчёт
    longest = sorted(full, key=len, reverse=True)[:10]
    print("Топ-10 длинных:", ", ".join(longest))
    print("50 случайных:", ", ".join(random.Random(1).sample(full_sorted, 50)))

if __name__ == "__main__":
    main()
