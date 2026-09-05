from pathlib import Path
import sys

import pymupdf


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_pdf_pages.py input.pdf output_dir")
    pdf_path = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    matrix = pymupdf.Matrix(150 / 72, 150 / 72)
    print(f"pages={doc.page_count}")
    for idx, page in enumerate(doc):
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        out = out_dir / f"page-{idx + 1:02d}.png"
        pix.save(out)
        lines = [line.strip() for line in page.get_text("text").splitlines() if line.strip()]
        lead = " | ".join(lines[:5])
        print(f"{idx + 1:02d}: {lead}")


if __name__ == "__main__":
    main()
