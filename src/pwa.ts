/**
 * Actualização do site publicado (service worker).
 *
 * O Workbox guarda o HTML e os chunks em precache, por isso a primeira visita
 * depois de um deploy podia abrir a versão anterior — o pedido de navegação era
 * satisfeito pelo `index.html` antigo em cache antes de o browser procurar um
 * service worker novo.
 *
 * Aqui o worker é registado cedo, procura-se actualização logo no arranque,
 * quando o separador volta ao primeiro plano e de tempos a tempos. O
 * `skipWaiting` + `clientsClaim` do `vite.config.ts` fazem o novo worker
 * assumir o controlo; quando isso acontece (`controllerchange`), a página
 * recarrega uma vez e passa a mostrar os ficheiros novos.
 */

const INTERVALO_VERIFICACAO_MS = 15 * 60 * 1000

export function registarServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  // Só se recarrega quando já havia um worker a controlar a página: no
  // primeiro registo de sempre não existe versão antiga para substituir.
  const jaControlada = Boolean(navigator.serviceWorker.controller)
  let aRecarregar = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaControlada || aRecarregar) return
    aRecarregar = true
    window.location.reload()
  })

  const registar = async () => {
    try {
      const registo = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

      // O browser só procura actualizações de vez em quando; forçamos agora.
      void registo.update()

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registo.update()
      })
      window.setInterval(() => void registo.update(), INTERVALO_VERIFICACAO_MS)
    } catch {
      /* sem rede ou sem suporte: a página funciona, só não actualiza sozinha */
    }
  }

  void registar()
}
