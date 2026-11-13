import type { FechoDia, MovimentoFinanceiro } from '../types/database'
import { METODO_LABELS } from '../types/database'
import { configInstituicao, esc } from './recibo'
import {
  fmtMzn,
  fmtMznCurto,
  fmtPct,
  resumirMovimentos,
  resumoCaixa,
  type PontoSerie,
  type ResumoFinanceiro,
} from './financas'

export interface RelatorioFinanceiroArgs {
  /** «Extracto diário de caixa» ou «Resumo mensal de caixa». */
  titulo: string
  /** Período já legível (ex.: «13 de Novembro de 2026»). */
  periodo: string
  movimentos: MovimentoFinanceiro[]
  /** Fecho do dia, quando o relatório é diário e o dia foi fechado. */
  fecho?: FechoDia | null
  /** Série diária, apenas no relatório mensal. */
  serie?: PontoSerie[]
}

const linhaTotais = (rotulo: string, valor: string, classe = '') =>
  `<tr><td class="l">${esc(rotulo)}</td><td class="v ${classe}">${esc(valor)}</td></tr>`

function tabelaResumo(r: ResumoFinanceiro): string {
  return `
    <section class="bloco">
      <h2>Resumo do período</h2>
      <table class="dados">
        ${linhaTotais('Total bruto (entradas)', fmtMzn(r.bruto))}
        ${linhaTotais('Despesas', fmtMzn(r.despesas))}
        ${linhaTotais('Total líquido', fmtMzn(r.liquido), 'forte')}
        ${r.entradas > 0 ? linhaTotais('Ticket médio por entrada', fmtMzn(r.bruto / r.entradas)) : ''}
        ${linhaTotais('Operações', `${r.entradas} entrada(s) · ${r.saidas} saída(s)`)}
      </table>
    </section>`
}

function tabelaCategorias(linhas: ResumoFinanceiro['categorias'], titulo: string): string {
  if (linhas.length === 0) return ''
  const maior = linhas[0]?.parte || 1
  return `
    <section class="bloco">
      <h2>${esc(titulo)}</h2>
      <div class="barras">
        ${linhas
          .map(
            (l) => `<div class="linha-barra">
          <span class="rotulo">${esc(l.label)}</span>
          <span class="trilho"><i style="width:${Math.max((l.parte / maior) * 100, 1).toFixed(1)}%"></i></span>
          <span class="valor">${esc(fmtMzn(l.valor))} <em>${esc(fmtPct(l.parte))}</em></span>
        </div>`,
          )
          .join('\n        ')}
      </div>
    </section>`
}

function tabelaCaixa(movimentos: MovimentoFinanceiro[]): string {
  const caixa = resumoCaixa(movimentos)
  if (caixa.totalEntradas === 0 && caixa.totalSaidas === 0) return ''
  const linha = (g: { label: string; entradas: number; saidas: number; saldo: number }) =>
    `<tr><td>${esc(g.label)}</td><td class="n">${esc(fmtMzn(g.entradas))}</td><td class="n">${esc(
      fmtMzn(g.saidas),
    )}</td><td class="n">${esc(fmtMzn(g.saldo))}</td></tr>`
  return `
    <section class="bloco">
      <h2>Conferência de caixa</h2>
      <table class="grelha">
        <thead><tr><th>Meio</th><th class="n">Entradas</th><th class="n">Saídas</th><th class="n">Saldo</th></tr></thead>
        <tbody>
          ${caixa.grupos.map(linha).join('\n          ')}
          <tr class="total"><td>Total</td><td class="n">${esc(fmtMzn(caixa.totalEntradas))}</td><td class="n">${esc(
            fmtMzn(caixa.totalSaidas),
          )}</td><td class="n">${esc(fmtMzn(caixa.totalEntradas - caixa.totalSaidas))}</td></tr>
        </tbody>
      </table>
      <p class="nota">Dinheiro físico que deve estar em caixa (numerário): <strong>${esc(
        fmtMzn(caixa.saldoFisico),
      )}</strong>.</p>
    </section>`
}

function graficoDiario(serie: PontoSerie[]): string {
  if (serie.length === 0) return ''
  const largura = 700
  const altura = 150
  const esquerda = 44
  const topo = 12
  const base = 20
  const plotW = largura - esquerda - 8
  const plotH = altura - topo - base
  const max = Math.max(...serie.flatMap((p) => [p.bruto, p.despesas]), 1)
  const y = (v: number) => topo + (1 - v / max) * plotH
  const grupo = plotW / serie.length
  const barra = Math.min(8, grupo * 0.3)
  const yZero = y(0)
  const barras = serie
    .map((p, i) => {
      const cx = esquerda + grupo * (i + 0.5)
      return `<rect x="${(cx - barra - 1).toFixed(1)}" y="${y(p.bruto).toFixed(1)}" width="${barra.toFixed(
        1,
      )}" height="${Math.max(yZero - y(p.bruto), 0).toFixed(1)}" fill="#1a1a1a"/><rect x="${(
        cx + 1
      ).toFixed(1)}" y="${y(p.despesas).toFixed(1)}" width="${barra.toFixed(1)}" height="${Math.max(
        yZero - y(p.despesas),
        0,
      ).toFixed(1)}" fill="#c9c9c9"/>`
    })
    .join('')
  const rotulos = serie
    .map((p, i) =>
      i % 2 === 0
        ? `<text x="${(esquerda + grupo * (i + 0.5)).toFixed(1)}" y="${
            altura - 6
          }" text-anchor="middle" font-size="7.5" fill="#777">${p.data.slice(8)}</text>`
        : '',
    )
    .join('')
  return `
    <section class="bloco">
      <h2>Movimento diário</h2>
      <svg viewBox="0 0 ${largura} ${altura}" width="100%" role="img" aria-label="Entradas e despesas por dia">
        <line x1="${esquerda}" x2="${largura - 8}" y1="${yZero.toFixed(1)}" y2="${yZero.toFixed(
          1,
        )}" stroke="#1a1a1a" stroke-width="0.8"/>
        <text x="${esquerda - 6}" y="${(y(max) + 3).toFixed(
          1,
        )}" text-anchor="end" font-size="7.5" fill="#777">${esc(fmtMznCurto(max))}</text>
        <text x="${esquerda - 6}" y="${(yZero + 3).toFixed(
          1,
        )}" text-anchor="end" font-size="7.5" fill="#777">0</text>
        ${barras}
        ${rotulos}
      </svg>
      <p class="nota">Barras escuras: entradas. Barras claras: despesas.</p>
    </section>`
}

function tabelaMeios(linhas: ResumoFinanceiro['meios']): string {
  if (linhas.length === 0) return ''
  return `
    <section class="bloco">
      <h2>Meios de pagamento (entradas)</h2>
      <table class="grelha">
        <thead><tr><th>Meio</th><th class="n">Operações</th><th class="n">Valor</th><th class="n">%</th></tr></thead>
        <tbody>
          ${linhas
            .map(
              (l) =>
                `<tr><td>${esc(l.label)}</td><td class="n">${l.quantidade}</td><td class="n">${esc(
                  fmtMzn(l.valor),
                )}</td><td class="n">${esc(fmtPct(l.parte))}</td></tr>`,
            )
            .join('\n          ')}
        </tbody>
      </table>
    </section>`
}

function tabelaDespesas(movimentos: MovimentoFinanceiro[]): string {
  const despesas = movimentos.filter((m) => m.sentido === 'saida')
  if (despesas.length === 0) return ''
  return `
    <section class="bloco">
      <h2>Despesas</h2>
      <table class="grelha">
        <thead>
          <tr><th>Data</th><th>Descrição</th><th>Fornecedor / referência</th><th>Meio</th><th class="n">Valor</th></tr>
        </thead>
        <tbody>
          ${despesas
            .map(
              (m) =>
                `<tr>
                  <td class="mono">${esc(m.data.split('-').reverse().join('/'))}</td>
                  <td>${esc(m.descricao)}</td>
                  <td>${esc(m.referencia ?? '—')}</td>
                  <td>${esc(m.metodo ? METODO_LABELS[m.metodo] : '—')}</td>
                  <td class="n">${esc(fmtMzn(Number(m.valor)))}</td>
                </tr>`,
            )
            .join('\n          ')}
        </tbody>
      </table>
    </section>`
}

function tabelaMovimentos(movimentos: MovimentoFinanceiro[]): string {
  if (movimentos.length === 0) return ''
  const ordenados = [...movimentos].sort((a, b) => {
    if (a.sentido !== b.sentido) return a.sentido === 'entrada' ? -1 : 1
    return a.descricao.localeCompare(b.descricao)
  })
  return `
    <section class="bloco">
      <h2>Movimentos</h2>
      <table class="grelha">
        <thead>
          <tr><th>Data</th><th>Descrição</th><th>Aluno / curso</th><th>Meio</th><th class="n">Valor</th></tr>
        </thead>
        <tbody>
          ${ordenados
            .map(
              (m) =>
                `<tr>
                  <td class="mono">${esc(m.data.split('-').reverse().join('/'))}</td>
                  <td>${esc(m.descricao)}</td>
                  <td>${esc([m.aluno_nome, m.curso_nome].filter(Boolean).join(' · ') || '—')}</td>
                  <td>${esc(m.metodo ? METODO_LABELS[m.metodo] : '—')}</td>
                  <td class="n ${m.sentido === 'saida' ? 'saida' : ''}">${m.sentido === 'saida' ? '−' : ''}${esc(
                    fmtMzn(Number(m.valor)),
                  )}</td>
                </tr>`,
            )
            .join('\n          ')}
        </tbody>
      </table>
    </section>`
}

function tabelaPorDia(serie: PontoSerie[]): string {
  if (serie.length === 0) return ''
  return `
    <section class="bloco">
      <h2>Movimento por dia</h2>
      <table class="grelha">
        <thead><tr><th>Dia</th><th class="n">Bruto</th><th class="n">Despesas</th><th class="n">Líquido</th></tr></thead>
        <tbody>
          ${serie
            .map(
              (p) =>
                `<tr>
                  <td class="mono">${esc(p.data.split('-').reverse().join('/'))}</td>
                  <td class="n">${esc(fmtMzn(p.bruto))}</td>
                  <td class="n">${esc(fmtMzn(p.despesas))}</td>
                  <td class="n ${p.liquido < 0 ? 'saida' : ''}">${esc(fmtMzn(p.liquido))}</td>
                </tr>`,
            )
            .join('\n          ')}
        </tbody>
      </table>
    </section>`
}

function blocoFecho(fecho: FechoDia | null | undefined): string {
  if (!fecho) {
    return `<p class="aviso">Dia ainda não fechado. O fecho regista os totais do caixa e quem os conferiu.</p>`
  }
  const quando = new Date(fecho.fechado_em).toLocaleString('pt-PT')
  return `<p class="aviso fechado">Dia fechado a ${esc(quando)}. Totais registados no fecho: bruto ${esc(
    fmtMzn(Number(fecho.total_bruto)),
  )}, despesas ${esc(fmtMzn(Number(fecho.total_despesas)))} e líquido ${esc(
    fmtMzn(Number(fecho.total_liquido)),
  )}.${fecho.notas ? ` Notas: ${esc(fecho.notas)}` : ''}</p>`
}

/**
 * Relatório financeiro imprimível (A4). Segue o padrão do recibo: janela
 * dedicada, botão «Imprimir / Guardar PDF» e nenhuma dependência externa.
 */
export async function abrirRelatorioFinanceiro(args: RelatorioFinanceiroArgs) {
  const cfg = await configInstituicao()
  const resumo = resumirMovimentos(args.movimentos)
  const iniciais =
    cfg.nome
      .split(/\s+/)
      .filter((p) => p.length > 2)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join('') || 'CF'

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<title>${esc(args.titulo)} — ${esc(args.periodo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a; margin: 0; font-size: 11px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #1a1a1a; padding-bottom: 10px;
  }
  .marca { display: flex; gap: 10px; align-items: center; }
  .logotipo {
    width: 38px; height: 38px; background: #1a1a1a; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: bold; border-radius: 5px;
  }
  h1 { font-size: 16px; margin: 0; font-weight: 700; }
  .sub { font-size: 9px; color: #555; margin-top: 2px; text-transform: uppercase; letter-spacing: 1.2px; }
  .titulo { text-align: right; }
  .titulo .tipo { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #555; }
  .titulo .periodo { font-size: 13px; font-weight: 700; margin-top: 3px; }
  .titulo .emitido { font-size: 9px; color: #777; margin-top: 3px; font-family: 'Courier New', monospace; }
  h2 {
    font-size: 9.5px; letter-spacing: 1.4px; text-transform: uppercase; color: #555;
    font-weight: 600; margin: 15px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px;
  }
  table { width: 100%; border-collapse: collapse; }
  table.dados td { padding: 4px 0; font-size: 11px; }
  table.dados td.l { color: #555; width: 55%; }
  table.dados td.v { text-align: right; font-weight: 600; }
  table.dados td.forte { font-size: 13px; border-top: 1px solid #1a1a1a; padding-top: 6px; }
  table.grelha th {
    font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.6px;
    text-align: left; color: #666; font-weight: 600;
    border-bottom: 1px solid #1a1a1a; padding: 4px 5px 4px 0;
  }
  table.grelha td { padding: 4px 5px 4px 0; border-bottom: 1px solid #eee; font-size: 10px; vertical-align: top; }
  table.grelha .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.grelha .saida { color: #8a1c12; }
  .mono { font-family: 'Courier New', monospace; font-size: 9.5px; white-space: nowrap; }
  .barras { margin-top: 1px; }
  .linha-barra { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 9.5px; }
  .linha-barra .rotulo { width: 150px; flex-shrink: 0; color: #333; }
  .linha-barra .trilho { flex: 1; height: 6px; background: #eee; border-radius: 2px; overflow: hidden; }
  .linha-barra .trilho i { display: block; height: 100%; background: #1a1a1a; }
  .linha-barra .valor { width: 125px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .linha-barra .valor em { color: #777; font-style: normal; margin-left: 4px; }
  table.grelha tr.total td { font-weight: 700; border-top: 1px solid #1a1a1a; border-bottom: none; }
  .nota { font-size: 9px; color: #555; margin: 5px 0 0; }
  .aviso { font-size: 9.5px; color: #555; border-left: 2px solid #bbb; padding: 5px 8px; margin: 10px 0 0; }
  .aviso.fechado { border-color: #1a7f37; color: #1a5c28; }
  footer {
    margin-top: 26px; display: flex; justify-content: space-between; gap: 38px;
    font-size: 9.5px; color: #555;
  }
  footer .rubrica { flex: 1; border-top: 1px solid #999; padding-top: 5px; text-align: center; }
  .rodape-fino { margin-top: 16px; font-size: 8.5px; color: #999; text-align: center; letter-spacing: 0.3px; }
  .contactos { margin-top: 6px; font-size: 9px; color: #555; text-align: center; }
  .sem-impressao { max-width: 680px; margin: 18px auto 0; text-align: center; font-family: system-ui, sans-serif; }
  .sem-impressao button {
    font: 13px system-ui, sans-serif; padding: 8px 20px; cursor: pointer;
    background: #1a1a1a; color: #fff; border: 0; border-radius: 5px; margin: 0 4px;
  }
  .sem-impressao button.sec { background: #eee; color: #1a1a1a; }
  @media print { .sem-impressao { display: none; } }
</style>
</head>
<body>
  <header>
    <div class="marca">
      ${
        cfg.logo_url && /^https?:\/\//i.test(cfg.logo_url)
          ? `<img src="${esc(cfg.logo_url)}" alt="logo" style="width:38px;height:38px;object-fit:contain;border:1px solid #ddd;border-radius:5px;" />`
          : `<div class="logotipo">${esc(iniciais)}</div>`
      }
      <div>
        <h1>${esc(cfg.nome)}</h1>
        <p class="sub">Gestão financeira</p>
      </div>
    </div>
    <div class="titulo">
      <p class="tipo">${esc(args.titulo)}</p>
      <p class="periodo">${esc(args.periodo)}</p>
      <p class="emitido">Emitido em ${esc(new Date().toLocaleString('pt-PT'))}</p>
    </div>
  </header>

  ${tabelaResumo(resumo)}
  ${tabelaCaixa(args.movimentos)}
  ${tabelaCategorias(resumo.categorias, 'Detalhe das entradas por rubrica')}
  ${args.serie ? graficoDiario(args.serie) : ''}
  ${tabelaMeios(resumo.meios)}
  ${tabelaDespesas(args.movimentos)}
  ${args.serie ? tabelaPorDia(args.serie) : ''}
  ${args.fecho !== undefined ? blocoFecho(args.fecho) : ''}
  ${tabelaMovimentos(args.movimentos)}

  <footer>
    <div class="rubrica">Conferido por (secretaria)</div>
    <div class="rubrica">Visto da direcção</div>
  </footer>
  <p class="contactos">${esc(
    [cfg.telefone, cfg.email, cfg.endereco].filter(Boolean).map((s) => String(s)).join(' · ') || cfg.nome,
  )}</p>
  <p class="rodape-fino">
    Documento emitido electronicamente pelo SIGA · valores em MZN · guarde este extracto para conferência de caixa.
  </p>

  <div class="sem-impressao">
    <button id="btn-imprimir">Imprimir / Guardar PDF</button>
    <button id="btn-fechar" class="sec">Fechar</button>
    <p style="margin-top:10px;font-size:11px;color:#999;">Pré-visualização — feche esta janela depois de imprimir.</p>
  </div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=820,height=940')
  if (!w) {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.location.assign(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  w.document.write(html)
  w.document.close()
  // Handlers ligados pelo opener (a CSP da app não permite script inline).
  w.document.getElementById('btn-imprimir')?.addEventListener('click', () => w.print())
  w.document.getElementById('btn-fechar')?.addEventListener('click', () => w.close())
  w.focus()
  setTimeout(() => w.print(), 350)
}
