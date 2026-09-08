"""Synthetic format-loss reproductions. No user files, network or native app.

Each pair has identical words but different protected font/page properties.
These fixtures expose a lossy extraction boundary; they are not round-trip
acceptance artifacts or claims of Word/PDF editing support.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_STORED

root = Path(__file__).resolve().parent
words = "Format protected document"
ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
types_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
rels_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
office_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def docx(name, font, size, alignment, margin):
    parts = {
        "[Content_Types].xml": (
            f'<Types xmlns="{types_ns}">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>'
        ),
        "_rels/.rels": (
            f'<Relationships xmlns="{rels_ns}">'
            f'<Relationship Id="rId1" Type="{office_ns}/officeDocument" Target="word/document.xml"/>'
            '</Relationships>'
        ),
        "word/document.xml": (
            f'<w:document xmlns:w="{ns}"><w:body><w:p>'
            f'<w:pPr><w:jc w:val="{alignment}"/></w:pPr><w:r><w:rPr>'
            f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>'
            f'<w:sz w:val="{size}"/><w:b/></w:rPr><w:t>{words}</w:t>'
            '</w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            f'<w:pgMar w:top="{margin}" w:right="{margin}" w:bottom="{margin}" w:left="{margin}"/>'
            '</w:sectPr></w:body></w:document>'
        ),
    }
    with ZipFile(root / name, "w", compression=ZIP_STORED) as archive:
        for part, content in parts.items():
            info = ZipInfo(part, date_time=(2026, 9, 6, 12, 0, 0))
            archive.writestr(info, content.encode("utf-8"))


def pdf(name, font, size, x, y, width, height):
    stream = f"BT /F1 {size} Tf {x} {y} Td ({words}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
         "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>").encode("ascii"),
        f"<< /Type /Font /Subtype /Type1 /BaseFont /{font} >>".encode("ascii"),
        f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream",
    ]
    data = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets:
        data.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    data.extend((f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\n"
                 f"startxref\n{xref}\n%%EOF\n").encode("ascii"))
    (root / name).write_bytes(data)


docx("styled-left.docx", "Arial", 24, "left", 1440)
docx("styled-centre.docx", "Times New Roman", 40, "center", 720)
pdf("position-left.pdf", "Helvetica", 12, 50, 750, 595, 842)
pdf("position-centre.pdf", "Times-Bold", 20, 150, 500, 612, 792)
(root / "textedit-style.rtf").write_text(
    r"{\rtf1\ansi\deff0{\fonttbl{\f0 Helvetica;}}\f0\fs24\b Format protected document\b0\par}",
    encoding="ascii",
)
(root / "plain.txt").write_bytes((words + "\n").encode("utf-8"))
(root / "structured.md").write_bytes(b"# Original heading\n\n1. Keep this list.\n2. Keep this order.\n")
