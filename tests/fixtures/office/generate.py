"""Pure synthetic OOXML fixtures; stdlib only, no Office automation or formulas run."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).parent
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'

def archive(name, entries):
    with ZipFile(ROOT / name, 'w', ZIP_DEFLATED) as out:
        for path, content in entries.items():
            info = __import__('zipfile').ZipInfo(path, date_time=(2026, 10, 31, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            out.writestr(info, content.encode('utf-8'))

def relations(items):
    return f'<Relationships xmlns="{REL}">' + ''.join(f'<Relationship Id="{rid}" Type="{OFFICE}{kind}" Target="{target}"/>' for rid, kind, target in items) + '</Relationships>'

def shape(text):
    return f'<p:sp><p:nvSpPr><p:cNvPr id="2" name="demo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{escape(text)}</a:t></a:r></a:p></p:txBody></p:sp>'

def slide(text, notes=False):
    tag = 'notes' if notes else 'sld'
    return f'<p:{tag} xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree>{shape(text)}</p:spTree></p:cSld></p:{tag}>'

ppt = {
    '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' + ''.join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in [7, 2]) + ''.join(f'<Override PartName="/ppt/notesSlides/notesSlide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' for i in [3, 8]) + '</Types>',
    '_rels/.rels': relations([('rId1', 'officeDocument', 'ppt/presentation.xml')]),
    'ppt/presentation.xml': f'<p:presentation xmlns:p="{P}" xmlns:r="{OFFICE[:-1]}"><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': relations([('rId7', 'slide', 'slides/slide7.xml'), ('rId2', 'slide', 'slides/slide2.xml')]),
    'ppt/slides/slide7.xml': slide('演示第一页：团队甲共同完成交付。'),
    'ppt/slides/slide2.xml': slide('演示第二页：共同成果保留团队归属。'),
    'ppt/slides/slide99.xml': slide('演示：已删除幻灯，不应被读取。'),
    'ppt/slides/_rels/slide7.xml.rels': relations([('rIdNotes', 'notesSlide', '../notesSlides/notesSlide3.xml')]),
    'ppt/slides/_rels/slide2.xml.rels': relations([('rIdNotes', 'notesSlide', '../notesSlides/notesSlide8.xml')]),
    'ppt/notesSlides/notesSlide3.xml': slide('演示第一页备注：没有个人身份映射。', True),
    'ppt/notesSlides/notesSlide8.xml': slide('演示第二页备注：不复制为个人分。', True),
}
archive('ordered-slides.pptx', ppt)

def inline(ref, text):
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>'

def cell(ref, value, kind='n', formula=None):
    f = '' if formula is None else f'<f>{escape(formula)}</f>'
    v = '' if value is None else f'<v>{escape(str(value))}</v>'
    return f'<c r="{ref}" t="{kind}">{f}{v}</c>'

def sheet(rows, merges=''):
    return f'<worksheet xmlns="{S}"><sheetData>' + ''.join(f'<row r="{n}">{cells}</row>' for n, cells in rows) + '</sheetData>' + merges + '</worksheet>'

xlsx = {
    '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': relations([('rId1', 'officeDocument', 'xl/workbook.xml')]),
    'xl/workbook.xml': f'<workbook xmlns="{S}" xmlns:r="{OFFICE[:-1]}"><sheets><sheet name="演示个人记录" sheetId="5" r:id="rId5"/><sheet name="演示团队结果" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': relations([('rId5', 'worksheet', 'worksheets/sheet5.xml'), ('rId2', 'worksheet', 'worksheets/sheet2.xml')]),
    'xl/worksheets/sheet5.xml': sheet([
        (1, inline('A1', '演示姓名') + inline('B1', '原文') + inline('D1', '公式缓存')),
        (2, inline('A2', '演示甲') + inline('B2', '演示：原量表记录，身份未核对') + cell('C2', 3) + cell('D2', 42, formula='1+1') + cell('F2', 0, formula='3-3')),
        (3, cell('D3', None, formula='SUM(C2:C9)') + cell('F3', 0, 'b', formula='1=2')),
        (4, cell('D4', '#DIV/0!', 'e', formula='1/0') + cell('F4', 0) + cell('H4', 0, 'b')),
        (6, inline('AA6', '演示：远列定位')),
    ]),
    'xl/worksheets/sheet2.xml': sheet([
        (1, inline('A1', '演示小组') + inline('B1', '团队原始结果')),
        (2, inline('A2', '演示团队甲') + cell('B2', 4)),
        (3, inline('A3', '演示团队甲成员，不能继承团队结果')),
    ], '<mergeCells count="1"><mergeCell ref="B2:B3"/></mergeCells>'),
}
archive('cached-values.xlsx', xlsx)
archive('unsupported.zip', {'unrelated.xml': '<demo>unsupported</demo>'})
(ROOT / 'truncated.pptx').write_bytes((ROOT / 'ordered-slides.pptx').read_bytes()[:90])
typed = dict(xlsx)
typed['xl/_rels/workbook.xml.rels'] = relations([('rId5', 'worksheet', 'worksheets/sheet5.xml'), ('rId2', 'worksheet', 'worksheets/sheet2.xml'), ('rIdStrings', 'sharedStrings', 'sharedStrings.xml')])
typed['xl/sharedStrings.xml'] = f'<sst xmlns="{S}" count="2" uniqueCount="2"><si><t></t></si><si><r><t>演示</t></r><r><t>富文本</t></r></si></sst>'
typed['xl/worksheets/sheet5.xml'] = sheet([
    (8, cell('A8', 0, 's') + cell('B8', 1, 's') + cell('C8', '', 'str', '""') + cell('D8', '=2+2', 'str') + cell('E8', '2026-10-31T12:30:00Z', 'd') + '<c r="F8"><f t="shared" si="0" ref="F8:F9">A8</f><v>1</v></c>' + cell('G8', '9007199254740993') + inline('H8', '')),
    (9, '<c r="F9"><f t="shared" si="0"/><v>2</v></c><c r="Z9" s="1"/>'),
])
archive('cache-types.xlsx', typed)
print('Generated five pure synthetic fixtures')
