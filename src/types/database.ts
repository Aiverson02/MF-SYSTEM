// Tipos espelham o schema criado em supabase/migrations/001_estrutura_inicial.sql
export type Turno = 'manha' | 'tarde' | 'pos_laboral'

export type EstadoInscricao =
  | 'pendente'
  | 'em_analise'
  | 'aprovado'
  | 'rejeitado'
  | 'com_pendencia'

export type TipoDocumento = 'bi' | 'foto_passe' | 'certificado' | 'comprovativo_pagamento'

export type EstadoAluno = 'ativo' | 'trancado' | 'concluido'

export interface Curso {
  id: string
  nome: string
  codigo: string
  duracao: string | null
  descricao: string | null
  ativo: boolean
  formador_id: string | null
  created_at: string
}

export interface Formador {
  id: string
  nome: string
  especialidade: string | null
  telefone: string | null
  email: string | null
  ativo: boolean
  created_at: string
}

export interface Turma {
  id: string
  curso_id: string
  nome_turma: string
  turno: Turno
  limite_vagas: number
  vagas_preenchidas: number
  ano_lectivo: number
  created_at: string
}

export interface Inscricao {
  id: string
  numero_inscricao: string
  nome_completo: string
  numero_bi: string
  data_nascimento: string
  genero: string | null
  email: string | null
  telefone_whatsapp: string
  curso_id: string
  turno_pretendido: Turno
  estado: EstadoInscricao
  motivo_rejeicao: string | null
  origem: 'online' | 'presencial'
  created_at: string
  // relações opcionais (joins)
  cursos?: { nome: string; codigo: string } | null
}

export interface DocumentoInscricao {
  id: string
  inscricao_id: string
  tipo_documento: TipoDocumento
  url_ficheiro: string
  estado_validacao: boolean
  created_at: string
}

export interface AlunoMatriculado {
  id: string
  inscricao_id: string | null
  numero_estudante: string
  /** BI do aluno — preenchido pela matrícula; usado para o limite de 3 cursos. */
  numero_bi: string | null
  turma_id: string
  data_matricula: string
  estado_aluno: EstadoAluno
  created_at: string
  updated_at: string
  // relações opcionais
  inscricoes?: { nome_completo: string; numero_inscricao: string; numero_bi: string; curso_id: string } | null
  turmas?: { nome_turma: string; turno: Turno; ano_lectivo: number } | null
}

// ---------------------------------------------------------------------------
// Pós-conclusão: certificado + faixa de graduação
// ---------------------------------------------------------------------------

export type ItemPosConclusao = 'certificado' | 'faixa'

export type EstadoItemPos = 'pendente' | 'emitido' | 'entregue'

export interface PosConclusao {
  id: string
  aluno_id: string
  item: ItemPosConclusao
  valor: number
  estado: EstadoItemPos
  pago: boolean
  /** Data em que foi marcado como pago (migração 021) — atribui o valor ao mês. */
  data_pagamento: string | null
  pago_por: string | null
  data_entrega: string | null
  criado_em: string
  updated_at: string
  // relações opcionais
  alunos_matriculados?: {
    numero_estudante: string
    numero_bi: string | null
    inscricoes?: { nome_completo: string } | null
    turmas?: { nome_turma: string } | null
  } | null
}

export const ITEM_POS_LABELS: Record<ItemPosConclusao, string> = {
  certificado: 'Certificado',
  faixa: 'Faixa de Graduação',
}

export const ESTADO_POS_LABELS: Record<EstadoItemPos, string> = {
  pendente: 'Pendente',
  emitido: 'Emitido',
  entregue: 'Entregue',
}

export interface UtilizadorStaff {
  id: string
  email: string
  papel: string
  ultimo_login: string | null
  criado_em: string
}

export const ESTADO_LABELS: Record<EstadoInscricao, string> = {
  pendente: 'Pendente',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  com_pendencia: 'Com Pendência',
}

export const TURNO_LABELS: Record<Turno, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
  pos_laboral: 'Pós-Laboral',
}

export const TIPO_DOC_LABELS: Record<TipoDocumento, string> = {
  bi: 'Bilhete de Identidade',
  foto_passe: 'Foto / Passe',
  certificado: 'Certificado',
  comprovativo_pagamento: 'Comprovativo de Pagamento',
}

export const ESTADO_ALUNO_LABELS: Record<EstadoAluno, string> = {
  ativo: 'Activo',
  trancado: 'Trancado',
  concluido: 'Concluído',
}

// ---------------------------------------------------------------------------
// Pagamentos / mensalidades
// ---------------------------------------------------------------------------

export interface ConfigInstituicao {
  id: number
  nome: string
  telefone: string | null
  email: string | null
  endereco: string | null
  logo_url: string | null
  /**
   * Legado. O código real vive com hash no servidor (financas_seguranca) e não é
   * exposto ao cliente; esta coluna fica sempre null.
   */
  codigo_financas: string | null
  /** Valor do certificado (definido na Configurações). */
  valor_certificado: number
  /** Valor da faixa de graduação (definido na Configurações). */
  valor_faixa: number
  updated_at: string
  updated_by: string | null
}

export type MetodoPagamento = 'numerario' | 'mpesa' | 'emola' | 'transferencia' | 'outro'

export type EstadoPagamento = 'pendente' | 'pago' | 'isento' | 'cancelado'

export interface ConfigPagamento {
  id: string
  curso_id: string
  ano_lectivo: number
  valor_mensalidade: number
  dia_limite: number
  created_at: string
  updated_at: string
}

export interface Pagamento {
  id: string
  aluno_id: string
  mes_referencia: string // 'YYYY-MM-01'
  valor: number
  data_pagamento: string | null
  metodo: MetodoPagamento | null
  referencia: string | null
  estado: EstadoPagamento
  observacoes: string | null
  criado_por: string | null
  created_at: string
  updated_at: string
  // relações opcionais (joins)
  alunos_matriculados?: {
    numero_estudante: string
    inscricoes?: { nome_completo: string } | null
    turmas?: { nome_turma: string; turno: Turno } | null
  } | null
}

export const METODO_LABELS: Record<MetodoPagamento, string> = {
  numerario: 'Numerário',
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  transferencia: 'Transferência',
  outro: 'Outro',
}

export const ESTADO_PAGAMENTO_LABELS: Record<EstadoPagamento, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  isento: 'Isento',
  cancelado: 'Cancelado',
}

/** '2026-09-01' → 'Setembro 2026' */
export function mesLabel(mesReferencia: string): string {
  const [y, m] = mesReferencia.split('-').map(Number)
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ]
  return `${meses[(m ?? 1) - 1]} ${y}`
}

// ---------------------------------------------------------------------------
// Avaliações e notas (migração 015)
// ---------------------------------------------------------------------------

export type TipoAvaliacao = 'avaliacao' | 'exame' | 'recurso'

/** Item de avaliação definido POR CURSO (ex.: "Avaliação 1", "Exame Final"). */
export interface Avaliacao {
  id: string
  curso_id: string
  nome: string
  tipo: TipoAvaliacao
  /** Peso na nota final (Σ nota×peso / Σ peso). */
  peso: number
  /** Escala da nota (0–20 por omissão). */
  nota_maxima: number
  ordem: number
  ativo: boolean
  created_at: string
  updated_at: string
}

/** Nota de um aluno num item de avaliação (1 linha por par aluno/item). */
export interface Nota {
  id: string
  aluno_id: string
  avaliacao_id: string
  nota: number | null
  data_avaliacao: string | null
  /** Formador que leccionou o item — usado pelo portal dos formadores. */
  formador_id: string | null
  observacoes: string | null
  /** Conta que registou a nota (preenchido no servidor). */
  lancado_por: string | null
  lancado_em: string
  created_at: string
  updated_at: string
}

/** Linha da vista `notas_resumo_aluno` — a fórmula vive no servidor. */
export interface NotasResumo {
  aluno_id: string
  itens_lancados: number
  itens_total: number
  media_avaliacoes: number | null
  /** Nota do exame já com o recurso aplicado, quando for melhor. */
  nota_exame: number | null
  nota_final: number | null
  avaliacao_completa: boolean
  aprovado: boolean
  /** Nota crua do exame de recurso (null quando não houve recurso). */
  nota_recurso: number | null
}

// ---------------------------------------------------------------------------
// Portal dos formadores (migração 016)
// ---------------------------------------------------------------------------

export type EstadoPauta = 'aberta' | 'fechada'

/** Pauta = (turma, item). Só o que a secretaria abre pode ser preenchido. */
export interface Pauta {
  id: string
  turma_id: string
  avaliacao_id: string
  /** null = qualquer formador atribuído à turma; preenchido = só aquele. */
  formador_id: string | null
  estado: EstadoPauta
  prazo: string | null
  aberta_em: string
  aberta_por: string | null
  fechada_em: string | null
  fechada_por: string | null
  created_at: string
  updated_at: string
}

/** Linha de `pautas_do_formador()` — o que o formador tem para preencher. */
export interface PautaFormador {
  pauta_id: string
  turma_id: string
  turma: string
  curso: string
  turno: Turno
  ano_lectivo: number
  avaliacao_id: string
  item: string
  tipo: TipoAvaliacao
  peso: number
  nota_maxima: number
  estado: EstadoPauta
  prazo: string | null
  pode_editar: boolean
  notas_lancadas: number
  total_alunos: number
}

/** Linha de `pauta_da_turma()` — o mínimo que o formador vê do aluno. */
export interface PautaAluno {
  aluno_id: string
  numero_estudante: string
  nome_completo: string | null
  nota: number | null
  data_avaliacao: string | null
  observacoes: string | null
}

/** Linha de `resumo_turma()` — nota final por aluno. */
export interface ResumoTurma {
  aluno_id: string
  numero_estudante: string
  nome_completo: string | null
  media_avaliacoes: number | null
  nota_exame: number | null
  nota_recurso: number | null
  nota_final: number | null
  avaliacao_completa: boolean
  aprovado: boolean
}

/** Linha de `listar_formadores_contas()`. */
export interface FormadorConta {
  formador_id: string
  nome: string
  ativo: boolean
  user_id: string | null
  email: string | null
  ultimo_login: string | null
}

/** Linha de `historico_notas_aluno()`. */
export interface HistoricoNota {
  quando: string
  accao: 'insert' | 'update' | 'delete'
  item: string
  nota_anterior: number | null
  nota_nova: number | null
  autor: string
  formador: string
}

export const ESTADO_PAUTA_LABELS: Record<EstadoPauta, string> = {
  aberta: 'Aberta',
  fechada: 'Fechada',
}

export const ACCAO_NOTA_LABELS: Record<HistoricoNota['accao'], string> = {
  insert: 'Lançada',
  update: 'Alterada',
  delete: 'Apagada',
}

export const TIPO_AVALIACAO_LABELS: Record<TipoAvaliacao, string> = {
  avaliacao: 'Avaliação',
  exame: 'Exame',
  recurso: 'Recurso',
}

/**
 * Formata uma nota na escala PT/MZ: 15.5 → "15,50"; vazio → "—".
 *
 * Aceita também texto: o PostgREST pode devolver `numeric` como string
 * (precisão), e a UI não deve rebentar por causa disso.
 */
export function notaLabel(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '—'
}
