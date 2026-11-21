const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const XLSX = require('../xlsx.full.min.js');
const studio = require('../mam-compliance-excel-studio.js');

test('Mam -> Compliance XLSX opens cleanly in Excel with strict OOXML order and complete cell borders', () => {
  const sampleRows = [
    {
      empId: '00101',
      name: 'RAKESH VERMA\u0007',
      father: 'MAHESH VERMA',
      dob: '',
      doj: '',
      pfNo: 'PF101',
      esiNo: 'ESI101',
      gender: 'MALE',
      department: 'WEAVING',
      designation: 'OPERATOR',
      category: "Card 'No.1'",
      bankName: '',
      ifsc: '',
      accountNo: '',
      basic: 22000,
      gross: 28000,
      monthDays: 31,
      absent: 1,
      paidDays: 30,
      overtimeHours: 2,
      earnBasic: 21290,
      grossEarned: 27097,
      totalGross: 29409,
      manualAmount: 29409,
      diffAmount: 0,
      pfMode: 'CAP_15000',
      esiMode: 'EARN_BASIC',
      pfWage: 15000,
      pfEmployee: 1800,
      pfEmployer: 1950,
      esiWage: 21290,
      esiEmployee: 160,
      esiEmployer: 692,
      advance: 500,
      totalDeduction: 2460,
      netPayable: 26949,
      remarks: 'onroll'
    },
    {
      empId: '00102',
      name: 'SUNITA DEVI',
      father: '',
      pfNo: 'NA',
      esiNo: 'NA',
      gender: 'FEMALE',
      category: 'History',
      basic: 14000,
      gross: 16500,
      monthDays: 31,
      absent: 31,
      paidDays: 0,
      overtimeHours: 0,
      earnBasic: 0,
      grossEarned: 0,
      totalGross: 0,
      manualAmount: 0,
      diffAmount: 0,
      pfEmployee: 0,
      pfEmployer: 0,
      esiEmployee: 0,
      esiEmployer: 0,
      advance: 0,
      totalDeduction: 0,
      netPayable: 0,
      remarks: 'off roll'
    }
  ];

  const wb = studio.buildComplianceWorkbook(XLSX, sampleRows, { month: '2026-10' }, { mamFile: 'OCT_MAM.xlsx' });
  assert.ok(!wb.SheetNames.some(n => n.toLowerCase() === 'history'), 'Reserved sheet name History must be renamed');
  assert.ok(!wb.SheetNames.some(n => n.includes("'")), 'Sheet names must not contain apostrophes');

  const bytes = studio.styleComplianceWorkbookBytes(XLSX, wb);
  const tmpFile = path.join('/tmp', 'atpl_excel_regression_check.xlsx');
  fs.writeFileSync(tmpFile, bytes);

  // Verify XLSX parses back cleanly with styles & formulas
  const reparsed = XLSX.read(bytes, { type: 'array', cellStyles: true });
  assert.ok(reparsed.SheetNames.includes('Main Sheet'));
  assert.ok(reparsed.SheetNames.includes('Master & Designation'));
  assert.equal(reparsed.Sheets['Main Sheet']['A1'].s.fgColor.rgb, '1E3A8A');
  assert.equal(reparsed.Sheets['Main Sheet']['X4'].f, 'SUM(X2:X3)');

  // Verify ZIP integrity, valid XML, strict ECMA-376 worksheet element order, complete bordered cells, and valid styles.xml
  const pyCheck = `
import zipfile, xml.etree.ElementTree as ET, re, sys

CT_WORKSHEET_ORDER = [
  'sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
  'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter',
  'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr',
  'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions',
  'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
  'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing',
  'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls',
  'webPublishItems', 'tableParts', 'extLst'
]
CT_STYLESHEET_ORDER = [
  'numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs',
  'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst'
]

with zipfile.ZipFile(sys.argv[1], 'r') as z:
    bad = z.testzip()
    assert bad is None, f"ZIP CRC error in {bad}"
    styles_xml = z.read('xl/styles.xml').decode('utf-8')
    styles_root = ET.fromstring(styles_xml)
    stags = [el.tag.split('}')[-1] for el in styles_root]
    s_pos = [CT_STYLESHEET_ORDER.index(t) for t in stags]
    assert s_pos == sorted(s_pos), f"Invalid styles.xml child order: {stags}"
    for req in ('fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles'):
        assert req in stags, f"Missing {req} in xl/styles.xml"
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    for xf in styles_root.findall('.//m:cellXfs/m:xf', ns):
        assert xf.attrib.get('xfId') == '0', f"Missing xfId=0 on xf: {xf.attrib}"
    # Verify non-zero borders are crisp (not #CBD5E1 pale gray)
    border_colors = [el.attrib.get('rgb') for el in styles_root.findall('.//m:borders/m:border//m:color', ns)]
    assert 'FF64748B' in border_colors, f"Expected crisp #64748B grid border, got {border_colors}"

    sheet_files = [n for n in z.namelist() if re.match(r'xl/worksheets/sheet\\d+\\.xml$', n)]
    assert len(sheet_files) >= 5
    for sf in sheet_files:
        raw = z.read(sf).decode('utf-8')
        assert '/ s="' not in raw, f"Malformed self-closing tag in {sf}"
        root = ET.fromstring(raw)
        tags = [el.tag.split('}')[-1] for el in root]
        pos = [CT_WORKSHEET_ORDER.index(t) for t in tags]
        assert pos == sorted(pos), f"Out-of-order elements in {sf}: {tags}"
        dim = root.find('m:dimension', ns)
        ref = dim.attrib['ref']
        m = re.match(r'^A1:([A-Z]+)(\\d+)$', ref)
        if m:
            col_s, max_r = m.group(1), int(m.group(2))
            max_c = 0
            for ch in col_s:
                max_c = max_c * 26 + (ord(ch) - 64)
            rows = root.findall('.//m:sheetData/m:row', ns)
            assert len(rows) == max_r, f"{sf}: expected {max_r} rows, got {len(rows)}"
            for row in rows:
                cells = row.findall('m:c', ns)
                assert len(cells) == max_c, f"{sf} row {row.attrib.get('r')}: expected {max_c} cells, got {len(cells)}"
                for c in cells:
                    sid = int(c.attrib.get('s', '-1'))
                    assert 1 <= sid <= 11, f"{sf} cell {c.attrib.get('r')} missing bordered styleId (got {sid})"
print("OOXML_STRICT_OK")
`;
  const pyOut = execFileSync('python3', ['-c', pyCheck, tmpFile], { encoding: 'utf8' });
  assert.ok(pyOut.includes('OOXML_STRICT_OK'));
});
