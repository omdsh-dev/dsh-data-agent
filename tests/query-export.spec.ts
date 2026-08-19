import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  queryResultToCsv,
  queryResultToTsv,
  queryResultToXlsx,
} from '../src/client/query-export.ts'

const data = {
  columns: ['id', '名称', 'note'],
  rows: [
    { id: '001', 名称: '商品,一', note: '=HYPERLINK("https://invalid")' },
    { id: '002', 名称: '第二行', note: null },
  ],
}

describe('query result exports', () => {
  it('writes UTF-8 CSV/TSV with headers, quoting, nulls, and formula-injection protection', () => {
    const csv = queryResultToCsv(data)
    expect(csv.startsWith('\uFEFFid,名称,note\r\n')).toBe(true)
    expect(csv).toContain('001,"商品,一","\'=HYPERLINK(""https://invalid"")"')
    expect(csv).toContain('002,第二行,')

    const tsv = queryResultToTsv(data)
    expect(tsv.split('\r\n')).toHaveLength(3)
    expect(tsv).toContain('001\t商品,一\t"\'=HYPERLINK')
  })

  it('builds a real XLSX archive with a frozen header and inline text values', () => {
    const archive = unzipSync(queryResultToXlsx(data))
    expect(Object.keys(archive).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ])
    const worksheet = strFromU8(archive['xl/worksheets/sheet1.xml']!)
    expect(worksheet).toContain('state="frozen"')
    expect(worksheet).toContain('<autoFilter ref="A1:C3"/>')
    expect(worksheet).toContain('商品,一')
    expect(worksheet).toContain('=HYPERLINK("https://invalid")')
    expect(worksheet).not.toContain('<f>')
  })
})
