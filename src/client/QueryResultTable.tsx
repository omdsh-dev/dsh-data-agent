import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  queryResultToCsv,
  queryResultToTsv,
  queryResultToXlsx,
  type QueryExportData,
} from './query-export.ts'
import css from './DataAgentWorkbench.module.css'

const RESULT_PAGE_SIZE = 100

export interface StructuredWorkbenchResult {
  kind: 'table'
  columns: string[]
  rows: Record<string, string | null>[]
  elapsedMs: number
  truncated: boolean
  maxRows: number
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.2V9.4M5.3 6.9L8 9.6L10.7 6.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11.3V13H13V11.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="3.5" width="8.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3.8V2.5H10V3.8M4 6H2.5V12H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function resultFilename(extension: 'xlsx' | 'csv'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `query-result-${stamp}.${extension}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard unavailable')
}

export function QueryResultTable({
  result,
  t,
}: {
  result: StructuredWorkbenchResult
  t: TranslateNS<'data-agent'>
}) {
  const [page, setPage] = useState(0)
  const [exportBusy, setExportBusy] = useState<'excel' | 'csv' | 'clipboard' | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const totalPages = Math.max(1, Math.ceil(result.rows.length / RESULT_PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * RESULT_PAGE_SIZE
  const visibleRows = result.rows.slice(pageStart, pageStart + RESULT_PAGE_SIZE)

  const exportResult = async (format: 'excel' | 'csv' | 'clipboard'): Promise<void> => {
    const data: QueryExportData = { columns: result.columns, rows: result.rows }
    setExportBusy(format)
    setFeedback(null)
    try {
      if (format === 'excel') {
        const bytes = queryResultToXlsx(data)
        downloadBlob(
          new Blob([new Uint8Array(bytes).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          resultFilename('xlsx'),
        )
      } else if (format === 'csv') {
        downloadBlob(new Blob([queryResultToCsv(data)], { type: 'text/csv;charset=utf-8' }), resultFilename('csv'))
      } else {
        await copyText(queryResultToTsv(data))
      }
      setFeedback(t(format === 'clipboard' ? 'wb.sql.copy.done' : 'wb.sql.export.done', { rows: result.rows.length }))
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setFeedback(t('wb.sql.export.failed', { detail }))
    } finally {
      setExportBusy(null)
    }
  }

  return (
    <div className={css.sqlResultPanel}>
      <div className={css.sqlResultToolbar}>
        <div className={css.sqlResultMeta} aria-live="polite">
          <span>{t('wb.sql.result.summary', {
            rows: result.rows.length,
            columns: result.columns.length,
            elapsed: result.elapsedMs,
          })}</span>
          {result.truncated && (
            <span className={css.sqlResultLimit}>{t('wb.sql.result.capped', { rows: result.maxRows })}</span>
          )}
          {feedback !== null && <span className={css.sqlFeedback} role="status">{feedback}</span>}
        </div>
        <div className={css.sqlExportActions} aria-label={t('wb.sql.export.actions')}>
          <button
            type="button"
            className={css.sqlExportButton}
            disabled={exportBusy !== null}
            onClick={() => { void exportResult('excel') }}
          >
            <DownloadIcon />
            {exportBusy === 'excel' ? t('wb.sql.exporting') : t('wb.sql.export.excel')}
          </button>
          <button
            type="button"
            className={css.sqlExportButton}
            disabled={exportBusy !== null}
            onClick={() => { void exportResult('csv') }}
          >
            <DownloadIcon />
            {exportBusy === 'csv' ? t('wb.sql.exporting') : t('wb.sql.export.csv')}
          </button>
          <button
            type="button"
            className={css.sqlExportButton}
            disabled={exportBusy !== null}
            onClick={() => { void exportResult('clipboard') }}
          >
            <CopyIcon />
            {exportBusy === 'clipboard' ? t('wb.sql.copying') : t('wb.sql.export.clipboard')}
          </button>
        </div>
      </div>
      <div className={css.sqlTableScroll}>
        <table className={css.sqlResultTable}>
          <caption className={css.visuallyHidden}>{t('wb.sql.result.table')}</caption>
          <thead>
            <tr>{result.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td className={css.sqlTableEmpty} colSpan={Math.max(1, result.columns.length)}>
                  {t('wb.sql.result.noRows')}
                </td>
              </tr>
            ) : visibleRows.map((row, rowIndex) => (
              <tr key={pageStart + rowIndex}>
                {result.columns.map(column => {
                  const value = row[column]
                  return (
                    <td key={column} title={value ?? undefined}>
                      {value === null || value === undefined
                        ? <span className={css.sqlNull}>NULL</span>
                        : value === ''
                          ? <span className={css.sqlEmptyString}>''</span>
                          : value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className={css.sqlPagination}>
          <span>{t('wb.sql.page.summary', { page: safePage + 1, pages: totalPages })}</span>
          <div className={css.sqlPageActions}>
            <button
              type="button"
              className={css.sqlPageButton}
              disabled={safePage === 0}
              onClick={() => setPage(value => Math.max(0, value - 1))}
            >
              {t('wb.sql.page.previous')}
            </button>
            <button
              type="button"
              className={css.sqlPageButton}
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(value => Math.min(totalPages - 1, value + 1))}
            >
              {t('wb.sql.page.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
