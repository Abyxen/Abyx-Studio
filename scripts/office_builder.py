#!/usr/bin/env python3
"""
ABYX Universal Office & Image Builder
Generates .docx, .xlsx, .pptx, and raster images (.png, .jpg, .webp, .ico, .bmp, .gif)
from Markdown, CSV, or structured JSON payloads.
"""

import argparse
import csv
import io
import json
import os
import re
import sys


def build_docx(payload, output_path):
    from docx import Document
    from docx.shared import Pt, RGBColor

    doc = Document()
    title = payload.get("title") or "ABYX Document"
    content = payload.get("content") or ""

    heading = doc.add_heading(title, level=0)
    for run in heading.runs:
        run.font.color.rgb = RGBColor(0x14, 0x18, 0x24)

    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # Markdown table detection
        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\|?[\s:\-|]+\|?$", lines[i + 1].strip()):
            table_rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row_str = lines[i].strip()
                if not re.match(r"^\|?[\s:\-|]+\|?$", row_str):
                    cells = [c.strip() for c in row_str.strip("|").split("|")]
                    table_rows.append(cells)
                i += 1
            if table_rows:
                cols = max(len(r) for r in table_rows)
                table = doc.add_table(rows=len(table_rows), cols=cols)
                table.style = "Table Grid"
                for r_idx, r_data in enumerate(table_rows):
                    for c_idx in range(cols):
                        cell_text = r_data[c_idx] if c_idx < len(r_data) else ""
                        cell = table.cell(r_idx, c_idx)
                        cell.text = cell_text
                        if r_idx == 0:
                            for p in cell.paragraphs:
                                for run in p.runs:
                                    run.bold = True
            continue

        if stripped.startswith("```"):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            p = doc.add_paragraph()
            run = p.add_run("\n".join(code_lines))
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
            continue

        if stripped.startswith("### "):
            doc.add_heading(stripped[4:].strip(), level=3)
        elif stripped.startswith("## "):
            doc.add_heading(stripped[3:].strip(), level=2)
        elif stripped.startswith("# "):
            doc.add_heading(stripped[2:].strip(), level=1)
        elif re.match(r"^[-*+]\s+", stripped):
            doc.add_paragraph(re.sub(r"^[-*+]\s+", "", stripped), style="List Bullet")
        elif re.match(r"^\d+\.\s+", stripped):
            doc.add_paragraph(re.sub(r"^\d+\.\s+", "", stripped), style="List Number")
        else:
            clean = re.sub(r"\*\*(.+?)\*\*", r"\1", stripped)
            doc.add_paragraph(clean)

        i += 1

    doc.save(output_path)


def build_xlsx(payload, output_path):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = (payload.get("title") or "Sheet1")[:31]

    content = (payload.get("content") or "").strip()
    rows = []

    # Try JSON array of objects/arrays first
    if content.startswith("[") or content.startswith("{"):
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and "rows" in parsed:
                parsed = parsed["rows"]
            if isinstance(parsed, list) and parsed:
                if isinstance(parsed[0], dict):
                    headers = list(parsed[0].keys())
                    rows.append(headers)
                    for item in parsed:
                        rows.append([item.get(h, "") for h in headers])
                elif isinstance(parsed[0], list):
                    rows = parsed
        except Exception:
            rows = []

    # Try Markdown table
    if not rows and "|" in content:
        for line in content.splitlines():
            s = line.strip()
            if s.startswith("|") and not re.match(r"^\|?[\s:\-|]+\|?$", s):
                rows.append([c.strip() for c in s.strip("|").split("|")])

    # Fallback to CSV parsing
    if not rows and content:
        reader = csv.reader(io.StringIO(content))
        for r in reader:
            if r:
                rows.append(r)

    if not rows:
        rows = [["Title", "Content"], [payload.get("title") or "ABYX Sheet", content or "Empty"]]

    header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")

    for r_idx, row in enumerate(rows, start=1):
        for c_idx, val in enumerate(row, start=1):
            # Convert numeric strings to numbers unless formula
            cell_val = val
            if isinstance(val, str) and not val.startswith("="):
                try:
                    if "." in val:
                        cell_val = float(val)
                    elif val.isdigit() or (val.startswith("-") and val[1:].isdigit()):
                        cell_val = int(val)
                except Exception:
                    cell_val = val
            cell = ws.cell(row=r_idx, column=c_idx, value=cell_val)
            if r_idx == 1:
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = Alignment(horizontal="center")

    # Auto-fit column widths
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            max_len = max(max_len, len(str(cell.value or "")))
        ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 50)

    ws.freeze_panes = "A2"
    wb.save(output_path)


def build_pptx(payload, output_path):
    from pptx import Presentation
    from pptx.util import Pt

    prs = Presentation()
    title = payload.get("title") or "ABYX Presentation"
    content = payload.get("content") or ""

    # Title Slide
    title_slide = prs.slides.add_slide(prs.slide_layouts[0])
    title_slide.shapes.title.text = title
    if len(title_slide.placeholders) > 1:
        title_slide.placeholders[1].text = f"Generated by {payload.get('author') or 'ABYX AI Studio'}"

    # Split content into slides by --- or ## headings
    raw_sections = re.split(r"\n---+\n|\n(?=## )", content.strip())
    for sec in raw_sections:
        sec = sec.strip()
        if not sec:
            continue
        lines = [l.strip() for l in sec.splitlines() if l.strip()]
        if not lines:
            continue

        slide_title = lines[0].lstrip("#").strip()
        body_lines = lines[1:] if len(lines) > 1 else [slide_title]

        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = slide_title[:80]
        tf = slide.placeholders[1].text_frame
        tf.clear()

        for idx, b in enumerate(body_lines[:10]):
            clean_b = re.sub(r"^[-*+\d.]+\s+", "", b)
            clean_b = re.sub(r"\*\*(.+?)\*\*", r"\1", clean_b)
            p = tf.paragraphs[0] if idx == 0 else tf.add_paragraph()
            p.text = clean_b[:220]
            p.font.size = Pt(16)

    prs.save(output_path)


def build_image(payload, output_path):
    from PIL import Image, ImageDraw, ImageFont

    title = payload.get("title") or "ABYX Graphic"
    content = payload.get("content") or ""
    ext = os.path.splitext(output_path)[1].lower()

    size = (1024, 640) if ext != ".ico" else (256, 256)
    img = Image.new("RGB", size, color=(12, 13, 18))
    draw = ImageDraw.Draw(img)

    # Border & header bar
    draw.rectangle([16, 16, size[0] - 16, size[1] - 16], outline=(45, 51, 69), width=2)
    draw.rectangle([16, 16, size[0] - 16, 76], fill=(22, 26, 38))

    font_title = ImageFont.load_default()
    draw.text((36, 38), title[:64], fill=(240, 242, 248), font=font_title)

    y = 104
    for line in content.splitlines()[:22]:
        draw.text((36, y), line[:110], fill=(195, 202, 220), font=font_title)
        y += 22
        if y > size[1] - 40:
            break

    if ext in (".jpg", ".jpeg"):
        img.save(output_path, format="JPEG", quality=92)
    elif ext == ".ico":
        img.save(output_path, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (32, 32)])
    else:
        img.save(output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", required=True, choices=["docx", "xlsx", "pptx", "image"])
    parser.add_argument("--json", required=True)
    args = parser.parse_args()

    with open(args.json, "r", encoding="utf-8-sig") as f:
        payload = json.load(f)

    output_path = payload["output"]
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    if args.type == "docx":
        build_docx(payload, output_path)
    elif args.type == "xlsx":
        build_xlsx(payload, output_path)
    elif args.type == "pptx":
        build_pptx(payload, output_path)
    elif args.type == "image":
        build_image(payload, output_path)

    print(json.dumps({"ok": True, "output": output_path, "bytes": os.path.getsize(output_path)}))


if __name__ == "__main__":
    main()
