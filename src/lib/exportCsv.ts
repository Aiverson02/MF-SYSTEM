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

/** Base de nome de ficheiro sem acentos nem caracteres estranhos ao SO. */
export function nomeFicheiro(base: string): string {
  const limpo = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return limpo || 'pauta'
}

/** Uma linha da pauta (turma + item) pronta para exportar. */
export interface PautaLinha {
  numero: string
  nome: string
  nota: string
  data: string
  observacoes: string
}

/**
 * Exporta uma pauta (turma + item) para CSV com BOM UTF-8: nº, aluno, nota,
 * data e observações. Usado pelo formador (portal) e pela secretaria (Pautas).
 */
export function exportPautaCsv(titulo: string, linhas: PautaLinha[]) {
  exportToCsv<PautaLinha>(
    nomeFicheiro(titulo),
    [
      { header: 'Nº', value: (l) => l.numero },
      { header: 'Aluno', value: (l) => l.nome },
      { header: 'Nota', value: (l) => l.nota },
      { header: 'Data', value: (l) => l.data },
      { header: 'Observações', value: (l) => l.observacoes },
    ],
    linhas,
  )
}
