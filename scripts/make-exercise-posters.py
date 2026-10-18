"""Still frames for the exercise lists (SPEC §20.2).

    python scripts/make-exercise-posters.py            # all of them
    python scripts/make-exercise-posters.py --ids 0001,0002

The looping clips average 47 KB, which is right for one exercise you have opened and wrong for
thirty you are scrolling past: a search for "bench" would pull well over a megabyte before you
had chosen anything, and on a roaming connection that is a real cost for a list.

So the lists get a still and the clip stays where it was. One frame at 160 px is a few
kilobytes, which is cheap enough to show beside every result, and opening an exercise still
fetches the animation exactly as before.

The frame is the **first** one, which in this library is the start of the movement — the
position the exercise is recognised by, and the same one a book would print. Nothing here
re-renders anything: it reads the clips that render-exercise-media.py already produced, so the
palette is whatever that script decided.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CLIPS = ROOT / "public" / "exercises"
POSTERS = CLIPS / "posters"

#: Twice the largest size a list row draws it at, so it stays sharp on a 2x screen.
EDGE = 160

#: Lossy is wrong here. These are flat-shaded figures on a single ground, where lossless WebP is
#: both smaller and exact; quality is the effort knob, not the fidelity one.
SAVE = {"format": "WEBP", "lossless": True, "quality": 60, "method": 6}


def poster(src: Path, dest: Path) -> int:
    with Image.open(src) as im:
        im.seek(0)
        frame = im.convert("RGBA").resize((EDGE, EDGE), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    frame.save(dest, **SAVE)
    return dest.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="comma-separated basenames, for looking at a few")
    ap.add_argument("--force", action="store_true", help="redo ones that already exist")
    args = ap.parse_args()

    if not CLIPS.is_dir():
        sys.exit(f"no clips at {CLIPS} — run `npm run seed:exercise-media` first")

    wanted = set(args.ids.split(",")) if args.ids else None
    sources = sorted(p for p in CLIPS.glob("*.webp") if wanted is None or p.stem in wanted)
    if not sources:
        sys.exit("no clips matched")

    made = skipped = total = 0
    for src in sources:
        dest = POSTERS / src.name
        if dest.exists() and not args.force:
            skipped += 1
            total += dest.stat().st_size
            continue
        total += poster(src, dest)
        made += 1

    n = made + skipped
    print(
        f"{n} posters ({made} written, {skipped} already there), "
        f"{total / 1e6:.1f} MB, average {total / n / 1024:.1f} KB"
    )


if __name__ == "__main__":
    main()
