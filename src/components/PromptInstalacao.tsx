import { useEffect, useRef, useState } from 'react'

/**
 * Popup "Instalar o SIGA".
 *
 * - Aparece apenas quando o navegador suporta instalação (evento
 *   `beforeinstallprompt` — Edge/Chrome) e a app ainda não está instalada.
 * - Desaparece definitivamente quando a pessoa instala (evento
 *   `appinstalled` → localStorage) ou dispensa ("Agora não").
 * - Nunca aparece dentro da app já instalada (display-mode standalone).
 */

const CHAVE_INSTALADO = 'siga_app_instalado'
const CHAVE_DISPENSADO = 'siga_instalizacao_dispensada'

interface EventoInstalacao extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function jaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (localStorage.getItem(CHAVE_INSTALADO) || localStorage.getItem(CHAVE_DISPENSADO)) return true
  } catch {
    /* storage indisponível */
  }
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari
    (navigator as { standalone?: boolean }).standalone === true
  return standalone
}

export default function PromptInstalacao() {
  const [visivel, setVisivel] = useState(false)
  const evento = useRef<EventoInstalacao | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (jaInstalada()) return

    const mostrar = (e: Event) => {
      const ev = e as EventoInstalacao
      if (typeof ev.prompt !== 'function') return // evento sintético/incompleto
      if (jaInstalada()) return // já instalado ou dispensado: não insiste
      evento.current = ev
      // Espera curta antes de mostrar (evita intrusão logo no primeiro segundo).
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null
          setVisivel(true)
        }, 4000)
      }
    }

    const instalado = () => {
      try {
        localStorage.setItem(CHAVE_INSTALADO, '1')
        localStorage.removeItem(CHAVE_DISPENSADO)
      } catch {
        /* ignore */
      }
      if (timer.current !== null) window.clearTimeout(timer.current)
      setVisivel(false)
    }

    window.addEventListener('beforeinstallprompt', mostrar)
    window.addEventListener('appinstalled', instalado)
    return () => {
      window.removeEventListener('beforeinstallprompt', mostrar)
      window.removeEventListener('appinstalled', instalado)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const instalar = async () => {
    const ev = evento.current
    setVisivel(false)
    if (!ev) return
    try {
      await ev.prompt()
      const { outcome } = await ev.userChoice
      if (outcome === 'accepted') {
        try {
          localStorage.setItem(CHAVE_INSTALADO, '1')
        } catch {
          /* ignore */
        }
      } else {
        dispensar()
      }
    } catch {
      /* prompt já expirou: deixa o navegador mostrar a opção de instalar */
    }
    evento.current = null
  }

  const dispensar = () => {
    try {
      localStorage.setItem(CHAVE_DISPENSADO, '1')
    } catch {
      /* ignore */
    }
    setVisivel(false)
  }

  if (!visivel) return null

  return (
    <div
      role="dialog"
      aria-label="Instalar o SIGA neste computador"
      className="fixed bottom-6 left-1/2 z-[110] w-[min(24rem,calc(100vw-3rem))] -translate-x-1/2 rounded-lg border border-line bg-surface p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-surface">
          CF
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">Instalar o SIGA neste computador</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Fica com ícone no menu Iniciar, abre em janela própria e funciona offline com os
            últimos dados guardados.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={instalar} className="btn-primary flex-1 py-2 text-sm">
          Instalar
        </button>
        <button
          type="button"
          onClick={dispensar}
          className="flex-1 rounded-md border border-line px-3 py-2 text-sm text-ink-muted hover:bg-raised"
        >
          Agora não
        </button>
      </div>
    </div>
  )
}
