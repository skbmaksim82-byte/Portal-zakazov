#!/usr/bin/env python3
"""
Оптимизация фото для мобильного каталога Kari.

Для каждого оригинала в папках с фото создаёт две облегчённые копии WebP:
  Foto Opt/full/<папка>/<имя файла>.webp   — до 1600 px, для карточки товара и просмотра
  Foto Opt/thumb/<папка>/<имя файла>.webp  — до 400 px, для списка
и пишет манифест photos.json со списком всех фото (замена запроса к GitHub API).

Оригиналы НЕ изменяются (их использует десктопный портал и поиск по фото).
Работает инкрементально: пересжимает только новые/изменённые файлы
(по git-хешу оригинала) и удаляет копии удалённых оригиналов.

Запуск из корня репозитория:  python tools/optimize_photos.py
"""
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageOps

FOLDERS = ['Foto Oborud', 'Foto reklama', 'Foto Svet', 'Foto slabotoch',
           'Foto Uvelir', 'IT oborud', 'Foto Complect', 'Foto Cancel']
EXTS = ('.png', '.jpg', '.jpeg', '.gif', '.webp')
OPT_DIR = 'Foto Opt'
MANIFEST = 'photos.json'
SIZES = {'full': (1600, 80), 'thumb': (400, 72)}   # max сторона, качество WebP

Image.MAX_IMAGE_PIXELS = 250_000_000


def git_blob_sha(path):
    with open(path, 'rb') as f:
        data = f.read()
    h = hashlib.sha1(b'blob %d\0' % len(data))
    h.update(data)
    return h.hexdigest()


def opt_path(kind, orig):
    return os.path.join(OPT_DIR, kind, orig + '.webp')


def convert(orig):
    """Возвращает (orig, ok, сообщение)."""
    try:
        im = Image.open(orig)
        im = ImageOps.exif_transpose(im)
        has_alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
        im = im.convert('RGBA' if has_alpha else 'RGB')
        for kind, (side, q) in SIZES.items():
            out = opt_path(kind, orig)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            c = im.copy()
            c.thumbnail((side, side), Image.LANCZOS)
            tmp = out + '.tmp'
            c.save(tmp, 'WEBP', quality=q, method=5)
            os.replace(tmp, out)
        return orig, True, ''
    except Exception as e:  # битый файл не должен ронять весь прогон
        return orig, False, '%s: %s' % (type(e).__name__, e)


def main():
    old = {}
    if os.path.exists(MANIFEST):
        try:
            for row in json.load(open(MANIFEST, encoding='utf-8')).get('files', []):
                old[row[0]] = row
        except Exception:
            old = {}

    originals = []
    for folder in FOLDERS:
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            p = folder + '/' + name
            if os.path.isfile(p) and name.lower().endswith(EXTS):
                originals.append(p)

    shas = {p: git_blob_sha(p)[:10] for p in originals}
    todo = []
    for p in originals:
        prev = old.get(p)
        fresh = (prev and prev[1] == shas[p] and prev[2] == 1
                 and all(os.path.exists(opt_path(k, p)) for k in SIZES))
        if not fresh:
            todo.append(p)

    print('Оригиналов: %d, к обработке: %d' % (len(originals), len(todo)))
    ok = {p: 1 for p in originals}
    t0 = time.time()
    failed = []
    if todo:
        with ProcessPoolExecutor() as ex:
            for i, (p, good, msg) in enumerate(ex.map(convert, todo, chunksize=4), 1):
                if not good:
                    ok[p] = 0
                    failed.append((p, msg))
                if i % 100 == 0:
                    print('  %d/%d  %.0fs' % (i, len(todo), time.time() - t0))
    for p, msg in failed:
        print('  ОШИБКА', p, msg)

    # удалить копии для удалённых оригиналов
    keep = set(opt_path(k, p) for p in originals for k in SIZES)
    removed = 0
    for kind in SIZES:
        root = os.path.join(OPT_DIR, kind)
        for dp, _, fns in os.walk(root):
            for fn in fns:
                fp = os.path.join(dp, fn)
                if fp not in keep:
                    os.remove(fp)
                    removed += 1
    if removed:
        print('Удалено устаревших копий:', removed)

    manifest = {
        'v': 1,
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'opt': OPT_DIR,
        # [путь оригинала, хеш (для сброса кэша), 1 = есть оптимизированная копия]
        'files': [[p, shas[p], ok[p]] for p in originals],
    }
    with open(MANIFEST + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(MANIFEST + '.tmp', MANIFEST)
    print('Готово за %.0fs, ошибок: %d' % (time.time() - t0, len(failed)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
