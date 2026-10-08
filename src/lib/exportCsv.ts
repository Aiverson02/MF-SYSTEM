import { format } from './format'

export interface ExportColumn<T> {
  header: string
  value: (row: T) => string
}

/**
 * Exporta linhas para CSV com BOM UTF-8 (compatível com Excel PT).
 */
export function exportToCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const header = columns.map((c) => escape(c.header)).join(';')
  const body = rows
    .map((row) => columns.map((c) => escape(c.value(row))).join(';'))
    .join('\r\n')

  const csv = '\uFEFF' + header + '\r\n' + body
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}_${format.fileDate()}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
