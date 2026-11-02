"""Rewrite the two demo workbooks from generator rows, standard library only.

The previous XLSX container (styles, theme, table, rels and content types) is
kept as the template; only ``xl/worksheets/sheet1.xml`` is regenerated. Cells
are inline ``t="str"`` text or numeric UTC dates, never formulas or links.

usage: python3 write-workbooks.py <template-dir> <rows.json> <output-dir>
"""

import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

HEADER_STYLE, ID_STYLE, TEXT_STYLE, DATE_STYLE = "7", "8", "3", "10"
FIXED_TIME = (2026, 11, 2, 0, 0, 0)


def column(index):
    return chr(ord("A") + index)


def excel_serial(iso):
    # Same arithmetic as the JS readers: epoch milliseconds / day + 25569.
    millis = round(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    return repr(millis / 86_400_000 + 25_569)


def cell(address, style, value, is_date):
    if value is None:
        return f'<x:c r="{address}" s="{style}" />'
    if is_date:
        return f'<x:c r="{address}" s="{style}" t="n"><x:v>{excel_serial(value)}</x:v></x:c>'
    if not isinstance(value, str):
        raise ValueError(f"non-text cell {address}")
    return f'<x:c r="{address}" s="{style}" t="str"><x:v>{escape(value)}</x:v></x:c>'


def sheet_data(headers, rows, date_column):
    out = ['<x:row r="1" ht="54" customHeight="1">']
    out += [cell(f"{column(i)}1", HEADER_STYLE, header, False) for i, header in enumerate(headers)]
    out.append("</x:row>")
    for offset, values in enumerate(rows):
        number = offset + 2
        if len(values) != len(headers):
            raise ValueError(f"row {number} width")
        out.append(f'<x:row r="{number}" ht="48" customHeight="1">')
        for i, value in enumerate(values):
            letter = column(i)
            is_date = letter == date_column
            style = DATE_STYLE if is_date else ID_STYLE if letter == "A" else TEXT_STYLE
            out.append(cell(f"{letter}{number}", style, value, is_date))
        out.append("</x:row>")
    return "<x:sheetData>" + "".join(out) + "</x:sheetData>"


def rewrite(template, target, side):
    with zipfile.ZipFile(template) as source:
        members = [(info, source.read(info.filename)) for info in source.infolist()]
    with zipfile.ZipFile(target, "w") as output:
        for info, data in members:
            if info.filename == "xl/worksheets/sheet1.xml":
                text = data.decode("utf-8")
                fresh = sheet_data(side["headers"], side["rows"], side["dateColumn"])
                text, replaced = re.subn(r"<x:sheetData>.*</x:sheetData>", lambda _: fresh, text, flags=re.S)
                if replaced != 1:
                    raise ValueError("template sheetData not found")
                data = text.encode("utf-8")
            entry = zipfile.ZipInfo(info.filename, date_time=FIXED_TIME)
            entry.compress_type = info.compress_type
            entry.external_attr = info.external_attr
            output.writestr(entry, data)


def main():
    template_dir, rows_file, output_dir = (Path(arg) for arg in sys.argv[1:4])
    spec = json.loads(rows_file.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)
    for side in spec.values():
        rewrite(template_dir / side["file"], output_dir / side["file"], side)


if __name__ == "__main__":
    main()
