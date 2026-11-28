/// <reference types="vite/client" />

/** Build actual: 'landing' (site público) ou 'sistema' (painel + portal). */
declare const __MODO__: 'landing' | 'sistema'

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Endereço do site público (usado no sistema central). */
  readonly VITE_LANDING_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
