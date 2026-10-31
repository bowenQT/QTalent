"""Rebuild synthetic fixtures using only Python's standard library.

No employee data or font files are embedded. PDF text has explicit ToUnicode
mapping; the unembedded STSong CID font is only a standard PDF font reference.
"""
from pathlib import Path
import zipfile
import zlib
import warnings

ROOT = Path(__file__).parent
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def docx(name, body, relationships='', compression=zipfile.ZIP_DEFLATED):
    with zipfile.ZipFile(ROOT / name, 'w', compression=zipfile.ZIP_DEFLATED) as out:
        for filename, content in {
            '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr/></w:body></w:document>',
            'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relationships + '</Relationships>',
        }.items():
            info = zipfile.ZipInfo(filename, (2026, 1, 1, 0, 0, 0))
            info.compress_type = compression
            out.writestr(info, content.encode('utf8'))


docx('chinese-pages.docx', '<w:p><w:r><w:t xml:space="preserve">  第一段演示原文。  </w:t></w:r></w:p><w:p/><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>第二页精确引用。</w:t></w:r></w:p>')
docx('empty.docx', '')
docx('table.docx', '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
docx('external-link.docx', '<w:p><w:hyperlink r:id="rId2"><w:r><w:t>外链显示文字</w:t></w:r></w:hyperlink></w:p>', f'<Relationship Id="rId2" Type="{R}/hyperlink" Target="file:///tmp/not-an-input-source" TargetMode="External"/>')
docx('compressed-large.docx', '<w:p><w:r><w:t>' + ('演示' * 50000) + '</w:t></w:r></w:p>')
docx('stored.docx', '<w:p><w:r><w:t>未压缩演示段。</w:t></w:r></w:p>', compression=zipfile.ZIP_STORED)
docx('inline.docx', '<w:p><w:bookmarkStart w:id="1" w:name="demo"/><w:r><w:t>演示</w:t><w:tab/><w:t>协作</w:t><w:br/><w:t>完成</w:t></w:r></w:p>')
docx('unsupported-content.docx', '<w:altChunk r:id="missing-html-part"/>')
docx('duplicate.docx', '<w:p><w:r><w:t>原始段。</w:t></w:r></w:p>')
with warnings.catch_warnings():
    # Deliberately malformed archive: validate duplicate-member rejection.
    warnings.filterwarnings('ignore', message="Duplicate name: 'word/document.xml'")
    with zipfile.ZipFile(ROOT / 'duplicate.docx', 'a') as out:
        info = zipfile.ZipInfo('word/document.xml', (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(info, f'<w:document xmlns:w="{W}"><w:body/></w:document>')
docx('path-alias.docx', '<w:p><w:r><w:t>原始演示段。</w:t></w:r></w:p>')
with zipfile.ZipFile(ROOT / 'path-alias.docx', 'a') as out:
    info = zipfile.ZipInfo('word/../word/document.xml', (2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    out.writestr(info, f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>另一段。</w:t></w:r></w:p></w:body></w:document>')


def stream(content, extra=''):
    return f'<< /Length {len(content)} {extra} >>\nstream\n'.encode() + content + b'\nendstream'


def pdf(name, pages, image_size=1, action=False, table=False):
    # Reserve catalog and pages. Each page has direct content/resources; no URLs.
    objects = [b'', b'']

    def add(value):
        objects.append(value)
        return len(objects)

    cmap = b'/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end'
    unicode_id = add(stream(cmap))
    descriptor = add(b'<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>')
    descendant = add(f'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor {descriptor} 0 R /DW 1000 >>'.encode())
    font = add(f'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [{descendant} 0 R] /ToUnicode {unicode_id} 0 R >>'.encode())
    dimensions = '' if image_size is None else f'/Width {image_size} /Height {image_size}'
    image = add(stream(zlib.compress(b'\x00'), f'/Type /XObject /Subtype /Image {dimensions} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode'))
    page_ids = []
    for lines in pages:
        if lines == 'image':
            content = b'q 100 0 0 100 40 600 cm /Im1 Do Q'
        else:
            parts = []
            for index, line in enumerate(lines):
                if isinstance(line, tuple):
                    value, matrix = line
                    encoded = value.encode('utf-16-be').hex().upper()
                    parts.append(f'BT /F1 12 Tf {matrix} Tm <{encoded}> Tj ET')
                else:
                    encoded = line.encode('utf-16-be').hex().upper()
                    parts.append(f'BT /F1 12 Tf 40 {730 - index * 30} Td <{encoded}> Tj ET')
            content = '\n'.join(parts).encode()
        if table:
            content = b'/P << /MCID 0 >> BDC\n' + content + b'\nEMC'
        content_id = add(stream(content))
        structure = '/StructParents 0' if table else ''
        page_ids.append(add(f'<< /Type /Page /Parent 2 0 R {structure} /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font} 0 R >> /XObject << /Im1 {image} 0 R >> >> /Contents {content_id} 0 R >>'.encode()))
    extra = b''
    if table:
        tree = add(b'')
        table_id, row_id, cell_id = len(objects) + 1, len(objects) + 2, len(objects) + 3
        add(f'<< /Type /StructElem /S /Table /P {tree} 0 R /K [{row_id} 0 R] >>'.encode())
        add(f'<< /Type /StructElem /S /TR /P {table_id} 0 R /K [{cell_id} 0 R] >>'.encode())
        add(f'<< /Type /StructElem /S /TD /P {row_id} 0 R /Pg {page_ids[0]} 0 R /K 0 >>'.encode())
        parent_tree = add(f'<< /Nums [0 [{cell_id} 0 R]] >>'.encode())
        objects[tree - 1] = f'<< /Type /StructTreeRoot /K [{table_id} 0 R] /ParentTree {parent_tree} 0 R >>'.encode()
        extra = f' /StructTreeRoot {tree} 0 R /MarkInfo << /Marked true >>'.encode()
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R' + extra + (br' /OpenAction << /S /JavaScript /JS (throw Error\(synthetic\)) >>' if action else b'') + b' >>'
    objects[1] = f'<< /Type /Pages /Count {len(page_ids)} /Kids [{" ".join(f"{i} 0 R" for i in page_ids)}] >>'.encode()
    output = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(output))
        output += f'{number} 0 obj\n'.encode() + value + b'\nendobj\n'
    start = len(output)
    output += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    output += b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:])
    output += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    (ROOT / name).write_bytes(output)


pdf('chinese-pages.pdf', [['第一页演示原文。', '同页第二行。'], ['第二页精确引用。']])
pdf('blank-middle.pdf', [['第一页演示原文。'], [], ['第三页精确引用。']])
pdf('empty.pdf', [[]])
pdf('scanned.pdf', ['image'])
pdf('mixed-scanned.pdf', [['第一页演示原文。'], 'image'])
pdf('oversized-image.pdf', [['第一页演示原文。'], 'image'], image_size=10000)
pdf('missing-image-size.pdf', [['第一页演示原文。'], 'image'], image_size=None)
pdf('javascript.pdf', [['正文不会执行脚本。']], action=True)
pdf('tagged-table.pdf', [['已标记的表格内容。']], table=True)
pdf('filtered-text.pdf', [['演示正文一。', ('非水平装饰。', '0.707107 0.707107 -0.707107 0.707107 40 690'), 'www.beisen.com', '北森平台对接说明。', '演示正文二。']])
print('Generated synthetic DOCX/PDF fixtures')
