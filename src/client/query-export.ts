// Use the explicit browser export. The package root exposes a Node condition
// that imports `module.createRequire`; DSH's client loader intentionally has no
// Node module table entry, so the generic entry cannot be allowed into this
// browser-only bundle.
import { strToU8, zipSync } from 'fflate/browser'

/** One structured result shape accepted by every workbench export. */
export interface QueryExportData {
  columns: readonly string[]
  rows: readonly Readonly<Record<string, string | null>>[]
}

const EXCEL_MAX_COLUMNS = 16_384
const EXCEL_MAX_CELL_CHARS = 32_767
const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/

function cellText(value: string | null | undefined): string {
  return value ?? ''
}

/** Prevent exported text from becoming an executable spreadsheet formula. */
function safeDelimitedText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

function delimitedCell(value: string, delimiter: ',' | '\t'): string {
  const safe = safeDelimitedText(value)
  return safe.includes(delimiter) || /["\r\n]/.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe
}

function delimitedTable(data: QueryExportData, delimiter: ',' | '\t'): string {
  const records = [
    data.columns.map(column => delimitedCell(column, delimiter)).join(delimiter),
    ...data.rows.map(row => data.columns.map(column => delimitedCell(cellText(row[column]), delimiter)).join(delimiter)),
  ]
  return records.join('\r\n')
}

/** UTF-8 CSV with BOM so desktop Excel opens Chinese text correctly. */
export function queryResultToCsv(data: QueryExportData): string {
  return `\uFEFF${delimitedTable(data, ',')}`
}

/** Tabular plain text suitable for spreadsheet clipboard paste. */
export function queryResultToTsv(data: QueryExportData): string {
  return delimitedTable(data, '\t')
}

function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '\uFFFD')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function columnName(index: number): string {
  let value = index + 1
  let output = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    output = String.fromCharCode(65 + remainder) + output
    value = Math.floor((value - 1) / 26)
  }
  return output
}

function inlineStringCell(reference: string, value: string, style?: number): string {
  if (value.length > EXCEL_MAX_CELL_CHARS) {
    throw new Error(`Excel cell ${reference} exceeds ${EXCEL_MAX_CELL_CHARS} characters`)
  }
  const styleAttribute = style === undefined ? '' : ` s="${style}"`
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`
}

function worksheetXml(data: QueryExportData): string {
  if (data.columns.length > EXCEL_MAX_COLUMNS) {
    throw new Error(`Excel supports at most ${EXCEL_MAX_COLUMNS} columns`)
  }
  const rowXml: string[] = []
  if (data.columns.length > 0) {
    rowXml.push(`<row r="1">${data.columns.map((column, index) =>
      inlineStringCell(`${columnName(index)}1`, column, 1),
    ).join('')}</row>`)
  }
  for (let rowIndex = 0; rowIndex < data.rows.length; rowIndex += 1) {
    const excelRow = rowIndex + 2
    const row = data.rows[rowIndex]!
    const cells = data.columns.map((column, columnIndex) => {
      const value = row[column]
      return value === null || value === undefined
        ? ''
        : inlineStringCell(`${columnName(columnIndex)}${excelRow}`, value)
    }).join('')
    rowXml.push(`<row r="${excelRow}">${cells}</row>`)
  }

  const widths = data.columns.map((column, columnIndex) => {
    let width = Array.from(column).length
    const sampleRows = Math.min(data.rows.length, 200)
    for (let index = 0; index < sampleRows; index += 1) {
      width = Math.max(width, Array.from(cellText(data.rows[index]![column])).length)
    }
    return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${Math.min(48, Math.max(10, width + 2))}" customWidth="1"/>`
  }).join('')
  const lastColumn = data.columns.length === 0 ? 'A' : columnName(data.columns.length - 1)
  const lastRow = Math.max(1, data.rows.length + 1)
  const range = `A1:${lastColumn}${lastRow}`
  const autoFilter = data.columns.length === 0 ? '' : `<autoFilter ref="${range}"/>`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${range}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${widths === '' ? '' : `<cols>${widths}</cols>`}
  <sheetData>${rowXml.join('')}</sheetData>
  ${autoFilter}
</worksheet>`
}

/** Build a real XLSX workbook using inline strings, frozen headers, and filters. */
export function queryResultToXlsx(data: QueryExportData): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Query Result" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(data)),
  }
  return zipSync(files, { level: 6 })
}
