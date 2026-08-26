#!/usr/bin/env python3
"""Render README and marketplace graphics from genuine right-panel captures."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONT = "/System/Library/Fonts/SFNS.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

BG = (20, 18, 28)
BG_DEEP = (16, 15, 23)
FG = (247, 244, 252)
MUTED = (194, 189, 205)
ACCENT = (199, 112, 255)
ACCENT_SOFT = (47, 36, 61)
BORDER = (68, 62, 78)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size=size)


def background(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        mix = y / max(height - 1, 1)
        color = tuple(round(BG[i] * (1 - mix) + BG_DEEP[i] * mix) for i in range(3))
        draw.line((0, y, width, y), fill=color)
    draw.ellipse((width * .70, -height * .34, width * 1.18, height * .38), fill=(43, 34, 57))
    return image


def rounded_capture(canvas: Image.Image, capture: Image.Image, box: tuple[int, int, int, int], radius: int) -> None:
    x, y, width, height = box
    fitted = capture.resize((width, height), Image.Resampling.LANCZOS)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width, height), radius=radius, fill=255)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_shape = Image.new("L", (width, height), 0)
    ImageDraw.Draw(shadow_shape).rounded_rectangle((0, 0, width, height), radius=radius, fill=190)
    shadow_shape = shadow_shape.filter(ImageFilter.GaussianBlur(max(10, radius)))
    shadow.paste((0, 0, 0, 175), (x, y + max(8, radius // 2)), shadow_shape)
    canvas.paste(shadow, (0, 0), shadow)
    canvas.paste(fitted, (x, y), mask)
    ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + width - 1, y + height - 1), radius=radius, outline=BORDER, width=2)


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, size: int) -> None:
    x, y = xy
    draw.ellipse((x, y + size * .35, x + size * .38, y + size * .73), fill=ACCENT)
    draw.text((x + size * .72, y), text, font=font(size, True), fill=ACCENT)


def pill(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, size: int) -> None:
    x, y, width, height = box
    draw.rounded_rectangle((x, y, x + width, y + height), radius=height // 4, fill=ACCENT_SOFT, outline=BORDER, width=2)
    dot = max(7, size // 3)
    draw.ellipse((x + height * .34, y + (height - dot) / 2, x + height * .34 + dot, y + (height + dot) / 2), fill=ACCENT)
    draw.text((x + height * .70, y + (height - size) / 2 - size * .12), text, font=font(size, True), fill=FG)


def crop_project(source: Image.Image) -> Image.Image:
    return source.crop((819, 24, 1360, 746))


def crop_phase(source: Image.Image) -> Image.Image:
    return source.crop((819, 84, 1360, 501))


def marketplace_project(capture: Image.Image) -> Image.Image:
    image = background((1600, 1000))
    draw = ImageDraw.Draw(image)
    label(draw, (96, 116), "GSD CONTROL TOWER", 27)
    draw.multiline_text((96, 220), "Pick up where\nGSD left off.", font=font(78, True), fill=FG, spacing=6)
    draw.multiline_text(
        (100, 445),
        "Recorded next action, phase progress,\nverification, and agent activity — in one panel.",
        font=font(31), fill=MUTED, spacing=14,
    )
    pill(draw, (100, 682, 510, 76), "Read-only · recorded state", 26)
    draw.text((100, 886), "NEXT ACTION · PHASES · VERIFICATION", font=font(21, True), fill=(154, 147, 168))
    rounded_capture(image, capture, (892, 72, 608, 812), 30)
    return image


def marketplace_phase(capture: Image.Image) -> Image.Image:
    image = background((1600, 1000))
    draw = ImageDraw.Draw(image)
    label(draw, (96, 116), "PHASE EVIDENCE", 27)
    draw.multiline_text((96, 220), "Inspect the work\nbehind each phase.", font=font(67, True), fill=FG, spacing=6)
    draw.multiline_text(
        (100, 430),
        "Expand a phase to see which workflow artifacts\nexist, completed plans, and recorded verification.",
        font=font(31), fill=MUTED, spacing=14,
    )
    pill(draw, (100, 650, 478, 76), "Evidence from .planning", 26)
    draw.text((100, 886), "ARTIFACTS · PLANS · VERIFICATION", font=font(21, True), fill=(154, 147, 168))
    rounded_capture(image, capture, (822, 160, 690, 532), 28)
    return image


def readme_project(capture: Image.Image) -> Image.Image:
    image = background((760, 475))
    draw = ImageDraw.Draw(image)
    label(draw, (48, 54), "CURRENT PROJECT", 13)
    draw.multiline_text((48, 108), "Pick up where\nGSD left off.", font=font(38, True), fill=FG, spacing=2)
    draw.multiline_text(
        (48, 224),
        "Recorded next action,\nphase progress, verification,\nand Muxy agent activity.",
        font=font(17), fill=MUTED, spacing=7,
    )
    pill(draw, (48, 373, 294, 46), "Read-only · recorded state", 14)
    rounded_capture(image, capture, (400, 12, 344, 459), 17)
    return image


def readme_phase(capture: Image.Image) -> Image.Image:
    image = background((760, 475))
    draw = ImageDraw.Draw(image)
    label(draw, (42, 48), "PHASE EVIDENCE", 13)
    draw.multiline_text((42, 91), "Inspect the work\nbehind each phase.", font=font(32, True), fill=FG, spacing=2)
    draw.multiline_text(
        (42, 198),
        "Workflow artifacts, plan counts,\nand recorded verification —\ndirectly from .planning.",
        font=font(16), fill=MUTED, spacing=7,
    )
    pill(draw, (42, 359, 246, 45), "Read-only evidence", 14)
    rounded_capture(image, capture, (316, 60, 424, 327), 17)
    return image


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-capture", type=Path, required=True)
    parser.add_argument("--phase-capture", type=Path, required=True)
    args = parser.parse_args()

    project = crop_project(Image.open(args.project_capture).convert("RGB"))
    phase = crop_phase(Image.open(args.phase_capture).convert("RGB"))
    save(marketplace_project(project), ROOT / "assets/screenshots/screenshot-1.png")
    save(marketplace_phase(phase), ROOT / "assets/screenshots/screenshot-2.png")
    save(readme_project(project), ROOT / "assets/readme/active-project.png")
    save(readme_phase(phase), ROOT / "assets/readme/phase-details.png")


if __name__ == "__main__":
    main()
