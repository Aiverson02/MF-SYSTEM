import type { Config } from 'tailwindcss'

/** Cor OKLCH definida por variável CSS (componentes L C H), com suporte a alpha. */
const v = (name: string) => `oklch(var(--c-${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens do sistema (claro/escuro trocam via variáveis em index.css)
        canvas: v('canvas'),
        surface: v('surface'),
        raised: v('raised'),
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        ink: { DEFAULT: v('ink'), muted: v('ink-muted'), faint: v('ink-faint') },
        accent: {
          DEFAULT: v('accent'),
          strong: v('accent-strong'),
          soft: v('accent-soft'),
          ink: v('accent-ink'),
        },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },

        // Aliases de compatibilidade (qualquer classe antiga remanescente
        // cai no token equivalente em vez de virar cor "solta")
        primary: {
          50: v('accent-soft'),
          100: v('accent-soft'),
          200: v('accent-soft'),
          300: v('accent'),
          400: v('accent'),
          500: v('accent'),
          600: v('accent'),
          700: v('accent-strong'),
          800: v('accent-strong'),
          900: v('accent-strong'),
        },
        emerald: { 300: v('ok'), 400: v('ok'), 500: v('ok'), 600: v('ok'), 700: v('ok') },
        amber: {
          100: v('warn-soft'),
          300: v('warn'),
          400: v('warn'),
          500: v('warn'),
          600: v('warn'),
          700: v('warn'),
          800: v('warn'),
          900: v('warn-soft'),
        },
        red: {
          50: v('danger-soft'),
          100: v('danger-soft'),
          200: v('danger'),
          300: v('danger'),
          400: v('danger'),
          500: v('danger'),
          600: v('danger'),
          700: v('danger'),
          900: v('danger'),
        },
        sky: { 300: v('accent'), 700: v('accent'), 800: v('accent') },
        purple: { 100: v('accent-soft'), 300: v('accent'), 800: v('accent-ink'), 900: v('accent-soft') },
        slate: {
          50: v('canvas'),
          100: v('raised'),
          200: v('line'),
          300: v('line'),
          400: v('ink-faint'),
          500: v('ink-muted'),
          600: v('ink-muted'),
          700: v('ink'),
          800: v('line-strong'),
          900: v('ink'),
          950: v('canvas'),
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'Cambria', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
