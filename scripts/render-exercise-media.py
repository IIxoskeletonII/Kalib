"""Renders the exercise figures in Kalib's own palette (SPEC §20.2).

    python scripts/render-exercise-media.py                 # all of them
    python scripts/render-exercise-media.py --ids 0025,0043 # a few, to look at

Why re-render rather than ship what the library publishes. Its clips are drawn on a near-white
ground with the worked muscle in red — correct for the light pages they were made for, and the
loudest thing on the screen in a dark app. A white panel behind a figure carries no information,
and the design system refuses decoration that carries none. Inverting is not an option either:
it would turn the muscle highlight some unrelated colour.

The source is CC0 and ships its renderer, whose entire palette is module-level constants, so the
honest fix is to render the art in the app's colours: the figure in `ink-2` on `surface`, the
worked muscle in `accent`, bands in `accent-2`.

The upstream repo is cloned into .cache/ on first run (gitignored, like the media it produces).
Needs Python with Pillow, which is all the upstream renderer depends on.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = ROOT / ".cache" / "oef"
OUT = ROOT / "public" / "exercises"

# src/index.css, dark theme. The figure reads as light-on-dark, so near/far reverses: upstream
# draws the far limb *lighter* to make it recede on white, and here it has to be darker.
PALETTE = {
    "BG": (22, 24, 29),  # surface   #16181D — the clip and its card are one surface
    "FLOOR": (42, 46, 55),  # surface-3 #2A2E37
    # Deliberately below ink-2: at full text brightness the figure becomes the loudest thing on
    # the screen, which is the fault we are fixing rather than a different version of it.
    "BODY": (166, 173, 184),
    "BODY_FAR": (92, 99, 112),
    "MUSCLE": (94, 234, 212),  # accent    #5EEAD4 — what this movement trains
    "MUSCLE_FAR": (46, 126, 116),
    "IRON": (74, 81, 94),
    "STEEL": (143, 149, 160),  # muted     #8F95A0
    "PAD": (54, 59, 70),
    "FRAME": (84, 90, 102),
    "BAND": (56, 189, 248),  # accent-2  #38BDF8
}


def _import_render():
    if not (UPSTREAM / "render.py").exists():
        sys.exit(
            f"missing {UPSTREAM}\n"
            "  git clone --depth 1 https://github.com/AbanoubAmir/open-exercise-figures "
            ".cache/oef"
        )
    sys.path.insert(0, str(UPSTREAM))
    import render  # noqa: PLC0415

    return render


def _apply_palette():
    """Runs in every worker: on Windows a pool spawns fresh interpreters, so a palette set in
    the parent would never reach them and half the library would come out white."""
    render = _import_render()
    for name, value in PALETTE.items():
        if not hasattr(render, name):
            sys.exit(f"upstream renderer has no {name}; its palette has changed")
        setattr(render, name, value)
    return render


def _render_one(args):
    external_id, target, out = args
    render = _apply_palette()
    fig = render.load(UPSTREAM / "figures" / f"{external_id}.json")
    fig["muscles"] = [target]
    render.save(render.render(fig), Path(out) / f"{external_id}.webp")
    return external_id


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="comma-separated external ids, for a quick look")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    ensure_upstream()
    render = _apply_palette()  # fails fast in the parent if the upstream palette moved
    del render

    # Upstream's list, narrowed to what we actually ship: our catalogue drops five camera-angle
    # duplicates, and rendering art nothing references would just be bytes on the deploy. The
    # muscle to highlight has to come from upstream, whose `target` is what render.py's map is
    # keyed by — ours is normalised (core/muscles.ts) and would not resolve.
    rows = json.loads((UPSTREAM / "exercises.json").read_text(encoding="utf-8"))
    catalogue = ROOT / "public" / "data" / "exercises.json"
    if catalogue.exists():
        ours = {
            e["media"]
            for e in json.loads(catalogue.read_text(encoding="utf-8"))["exercises"]
            if e.get("media")
        }
        rows = [r for r in rows if r["id"] in ours]
    if args.ids:
        wanted = set(args.ids.split(","))
        rows = [r for r in rows if r["id"] in wanted]

    args.out.mkdir(parents=True, exist_ok=True)
    jobs = [
        (r["id"], r["target"], str(args.out))
        for r in rows
        if (UPSTREAM / "figures" / f"{r['id']}.json").exists()
    ]
    print(f"rendering {len(jobs)} figures into {args.out}")

    done = 0
    with Pool() as pool:
        for _ in pool.imap_unordered(_render_one, jobs, chunksize=8):
            done += 1
            if done % 100 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)}")

    total = sum(p.stat().st_size for p in args.out.glob("*.webp"))
    files = len(list(args.out.glob("*.webp")))
    print(f"{files} files, {total / 1048576:.1f} MB, {total / max(files, 1) / 1024:.0f} KB mean")


if __name__ == "__main__":
    main()
