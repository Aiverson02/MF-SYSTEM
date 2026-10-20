import { supabase } from './supabase'
import type { CobrancaAluno, Pagamento, PosConclusao } from '../types/database'
import { ITEM_POS_LABELS, METODO_LABELS, mesLabel } from '../types/database'
import { NOME_INSTITUICAO_DEFAULT } from '../hooks/useInstituicao'

/** Configuração da instituição gravada em config_instituicao (com fallback). */
async function configInstituicao(): Promise<{
  nome: string
  telefone: string | null
  email: string | null
  endereco: string | null
  logo_url: string | null
}> {
  const { data } = await supabase
    .from('config_instituicao')
    .select('nome, telefone, email, endereco, logo_url')
    .eq('id', 1)
    .maybeSingle()
  return {
    nome: data?.nome || NOME_INSTITUICAO_DEFAULT,
    telefone: data?.telefone ?? null,
    email: data?.email ?? null,
    endereco: data?.endereco ?? null,
    logo_url: data?.logo_url ?? null,
  }
}

const fmtMzn = (v: number) =>
  new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', maximumFractionDigits: 2 }).format(v)

/**
 * Escape de HTML para interpolação segura no documento do recibo.
 * O recibo é escrito via document.write na mesma origem da app: sem escape,
 * um nome de aluno malicioso submetido no formulário público (stored XSS)
 * executaria JavaScript com acesso à sessão da secretaria.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Nº de recibo estável derivado de um id e de uma data (YYYY-MM-DD ou YYYY-MM-01): REC-YYYYMM-XXXXXX */
function numeroReciboDe(id: string, data: string): string {
  const mes = data.slice(0, 7).replace('-', '')
  const seq = id.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `REC-${mes}-${seq}`
}

/** Nº de recibo de uma mensalidade: REC-YYYYMM-XXXXXX */
export function numeroRecibo(p: Pagamento): string {
  return numeroReciboDe(p.id, p.mes_referencia)
}

/** Forma normalizada de qualquer recibo — mensalidades e pós-conclusão partilham o layout. */
interface DadosRecibo {
  numero: string
  subtitulo: string
  nomeAluno: string
  numeroEstudante: string
  turma: string
  /** Estado mostrado no topo do recibo («Pago» / «Não pago»). */
  estadoTopo: string
  pago: boolean
  /** Linhas da tabela «Detalhe do pagamento». */
  linhas: [string, string][]
  valor: number
  observacoes: string | null
}

/**
 * Recibo imprimível: abre uma janela dedicada com o layout do recibo
 * (sem dependências externas — o utilizador grava/imprime como PDF via
 * "Guardar como PDF" do navegador) e invoca window.print() após carregar.
 */
async function emitirRecibo(d: DadosRecibo, nomeInst?: string) {
  const cfg = await configInstituicao()
  const nome = nomeInst ?? cfg.nome
  const iniciais = nome
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || 'CF'
  const { numero, nomeAluno, numeroEstudante, turma, pago } = d

  const linh = (label: string, valor: string) =>
    `<tr><td class="l">${esc(label)}</td><td class="v">${esc(valor)}</td></tr>`
  const detalhe = d.linhas.map(([l, v]) => linh(l, v)).join('\n      ')

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<title>Recibo ${esc(numero)} — ${esc(nomeAluno)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .folha { max-width: 640px; margin: 0 auto; }
  header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #1a1a1a; padding-bottom: 12px;
  }
  .marca { display: flex; gap: 12px; align-items: center; }
  .logotipo {
    width: 44px; height: 44px; background: #1a1a1a; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: bold; border-radius: 6px; letter-spacing: 0.5px;
  }
  h1 { font-size: 18px; margin: 0; font-weight: 700; }
  .sub { font-size: 11px; color: #555; margin-top: 2px; text-transform: uppercase; letter-spacing: 1.2px; }
  .titulo { text-align: right; }
  .titulo .recibo-num { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #555; }
  .titulo .num { font-family: 'Courier New', monospace; font-size: 16px; font-weight: 700; margin-top: 2px; }
  .estado {
    display: inline-block; margin-top: 6px; padding: 3px 10px;
    font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
    border: 1.5px solid #1a7f37; color: #1a7f37; border-radius: 4px;
  }
  .estado.anulado { border-color: #b42318; color: #b42318; }
  h2 { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #555;
       font-weight: 600; margin: 22px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
  table.dados { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.dados td { padding: 6px 0; vertical-align: top; }
  table.dados td.l { color: #555; width: 42%; }
  table.dados td.v { font-weight: 600; }
  .destaque {
    margin-top: 20px; border: 2px solid #1a1a1a; border-radius: 8px;
    display: flex; justify-content: space-between; align-items: center; padding: 14px 18px;
  }
  .destaque .rotulo { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #555; }
  .destaque .valor { font-size: 26px; font-weight: 700; margin-top: 2px; }
  .destaque .valor-pago { font-family: 'Courier New', monospace; text-align: right; font-size: 13px; color: #1a7f37; font-weight: 700; }
  .obs { margin-top: 14px; font-size: 12px; color: #444; font-style: italic; }
  footer {
    margin-top: 34px; display: flex; justify-content: space-between; gap: 40px;
    font-size: 11px; color: #555;
  }
  footer .rubrica { flex: 1; border-top: 1px solid #999; padding-top: 5px; text-align: center; }
  .rodape-fino { margin-top: 26px; font-size: 10px; color: #999; text-align: center; letter-spacing: 0.4px; }
  .contactos { margin-top: 8px; font-size: 11px; color: #555; text-align: center; }
  @media print { .sem-impressao { display: none; } }
  .sem-impressao {
    max-width: 640px; margin: 18px auto 0; text-align: center;
    font-family: system-ui, sans-serif;
  }
  .sem-impressao button {
    font: 14px system-ui, sans-serif; padding: 9px 22px; cursor: pointer;
    background: #1a1a1a; color: #fff; border: 0; border-radius: 6px; margin: 0 4px;
  }
  .sem-impressao button.sec { background: #eee; color: #1a1a1a; }
</style>
</head>
<body>
  <div class="folha">
    <header>
      <div class="marca">
        ${
          cfg.logo_url && /^https?:\/\//i.test(cfg.logo_url)
            ? `<img src="${esc(cfg.logo_url)}" alt="logo" style="width:44px;height:44px;object-fit:contain;border-radius:6px;border:1px solid #ddd;" />`
            : `<div class="logotipo">${esc(iniciais)}</div>`
        }
        <div>
          <h1>${esc(nome)}</h1>
          <p class="sub">${esc(d.subtitulo)}</p>
        </div>
      </div>
      <div class="titulo">
        <p class="recibo-num">Recibo nº</p>
        <p class="num">${esc(numero)}</p>
        <span class="estado${pago ? '' : ' anulado'}">${esc(d.estadoTopo)}</span>
      </div>
    </header>

    <h2>Dados do aluno</h2>
    <table class="dados">
      ${linh('Nome', nomeAluno)}
      ${linh('Nº de estudante', numeroEstudante)}
      ${turma ? linh('Turma', turma) : ''}
    </table>

    <h2>Detalhe do pagamento</h2>
    <table class="dados">
      ${detalhe}
    </table>

    <div class="destaque">
      <div>
        <p class="rotulo">Valor</p>
        <p class="valor">${fmtMzn(d.valor)}</p>
      </div>
      ${pago ? '<div class="valor-pago">PAGO<br/>✓</div>' : ''}
    </div>

    ${d.observacoes ? `<p class="obs">Obs.: ${esc(d.observacoes)}</p>` : ''}

    <footer>
      <div class="rubrica">Emitido por (secretaria)</div>
      <div class="rubrica">Recibo do aluno</div>
    </footer>
    <p class="contactos">${esc(
      [cfg.telefone, cfg.email, cfg.endereco].filter(Boolean).map((s) => String(s)).join(' · ') || nome
    )}</p>
    <p class="rodape-fino">
      Documento emitido electronicamente pelo sistema SIGA em ${new Date().toLocaleDateString('pt-PT')}.
      Guarde este recibo como comprovativo de pagamento.
    </p>
  </div>
  <div class="sem-impressao">
    <button id="btn-imprimir">Imprimir / Guardar PDF</button>
    <button id="btn-fechar" class="sec">Fechar</button>
    <p style="margin-top:10px;font-size:11px;color:#999;">Pré-visualização — feche esta janela depois de imprimir.</p>
  </div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=780,height=900')
  if (!w) {
    // Popup bloqueado: fallback para aba actual via blob
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.location.assign(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  w.document.write(html)
  w.document.close()
  // Botões ligados pelo opener (sem handlers inline — compatível com CSP
  // script-src 'self'; o documento do popup herda a CSP da app)
  w.document.getElementById('btn-imprimir')?.addEventListener('click', () => w.print())
  w.document.getElementById('btn-fechar')?.addEventListener('click', () => w.close())
  // Pequeno atraso para o layout assentar antes de invocar o diálogo
  w.focus()
  setTimeout(() => w.print(), 350)
}

/** Recibo de uma mensalidade. */
export async function imprimirRecibo(p: Pagamento, nomeInst?: string) {
  const a = p.alunos_matriculados
  const pago = p.estado === 'pago'

  const linhas: [string, string][] = [['Referência', mesLabel(p.mes_referencia)]]
  if (pago && p.data_pagamento) linhas.push(['Data do pagamento', p.data_pagamento])
  if (pago && p.metodo) linhas.push(['Método', METODO_LABELS[p.metodo]])
  if (pago && p.referencia) linhas.push(['Nº de recibo / transação', p.referencia])
  linhas.push(['Estado', pago ? 'Pago' : p.estado === 'isento' ? 'Isento' : 'Pendente'])

  await emitirRecibo(
    {
      numero: numeroRecibo(p),
      subtitulo: 'Recibo de mensalidade',
      nomeAluno: a?.inscricoes?.nome_completo ?? '—',
      numeroEstudante: a?.numero_estudante ?? '—',
      turma: a?.turmas?.nome_turma ?? '',
      estadoTopo: pago ? 'Pago' : 'Não pago',
      pago,
      linhas,
      valor: Number(p.valor),
      observacoes: p.observacoes,
    },
    nomeInst,
  )
}

/** Recibo de um pagamento de pós-conclusão (certificado ou faixa de graduação). */
export async function imprimirReciboPos(i: PosConclusao, nomeInst?: string) {
  const a = i.alunos_matriculados

  const linhas: [string, string][] = [
    ['Item', ITEM_POS_LABELS[i.item]],
    ['Origem', 'Pós-conclusão (certificado / faixa)'],
  ]
  if (i.data_pagamento) linhas.push(['Data do pagamento', i.data_pagamento])
  linhas.push(['Estado', i.pago ? 'Pago' : 'Pendente'])

  await emitirRecibo(
    {
      numero: numeroReciboDe(i.id, i.data_pagamento ?? i.criado_em),
      subtitulo: 'Recibo de pós-conclusão',
      nomeAluno: a?.inscricoes?.nome_completo ?? '—',
      numeroEstudante: a?.numero_estudante ?? '—',
      turma: a?.turmas?.nome_turma ?? '',
      estadoTopo: i.pago ? 'Pago' : 'Não pago',
      pago: i.pago,
      linhas,
      valor: Number(i.valor),
      observacoes: null,
    },
    nomeInst,
  )
}

/** Recibo de uma cobrança avulsa (testes, material, exame — catálogo 026). */
export async function imprimirReciboCobranca(c: CobrancaAluno, nomeInst?: string) {
  const a = c.alunos_matriculados
  const pago = c.estado === 'pago'

  const linhas: [string, string][] = [['Cobrança', c.cobrancas?.nome ?? '—']]
  if (c.cobrancas?.descricao) linhas.push(['Descrição', c.cobrancas.descricao])
  if (pago && c.data_pagamento) linhas.push(['Data do pagamento', c.data_pagamento])
  if (pago && c.metodo) linhas.push(['Método', METODO_LABELS[c.metodo]])
  if (pago && c.referencia) linhas.push(['Nº de recibo / transação', c.referencia])
  linhas.push(['Estado', pago ? 'Pago' : c.estado === 'isento' ? 'Isento' : 'Pendente'])

  await emitirRecibo(
    {
      numero: numeroReciboDe(c.id, c.data_pagamento ?? c.created_at),
      subtitulo: 'Recibo de cobrança',
      nomeAluno: a?.inscricoes?.nome_completo ?? '—',
      numeroEstudante: a?.numero_estudante ?? '—',
      turma: a?.turmas?.nome_turma ?? '',
      estadoTopo: pago ? 'Pago' : 'Não pago',
      pago,
      linhas,
      valor: Number(c.valor),
      observacoes: c.observacoes,
    },
    nomeInst,
  )
}