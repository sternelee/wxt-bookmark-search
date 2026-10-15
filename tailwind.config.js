import animate from 'tailwindcss-animate'
import plugin from 'tailwindcss/plugin'

/**
 * Design tokens (shadcn "slate" palette, bare HSL channels so they can be
 * composed as `hsl(var(--token) / <alpha>)`).
 *
 * These live here rather than in each entrypoint stylesheet: all five surfaces
 * (popup / options / board / graph / wiki) share one Tailwind build, so
 * defining them once in the `base` layer keeps them from drifting apart.
 */
const lightTokens = {
  '--background': '0 0% 100%',
  '--foreground': '222.2 84% 4.9%',
  '--card': '0 0% 100%',
  '--card-foreground': '222.2 84% 4.9%',
  '--popover': '0 0% 100%',
  '--popover-foreground': '222.2 84% 4.9%',
  '--primary': '221.2 83.2% 53.3%',
  '--primary-foreground': '210 40% 98%',
  '--secondary': '210 40% 96.1%',
  '--secondary-foreground': '222.2 47.4% 11.2%',
  '--muted': '210 40% 96.1%',
  '--muted-foreground': '215.4 16.3% 46.9%',
  '--accent': '210 40% 96.1%',
  '--accent-foreground': '222.2 47.4% 11.2%',
  '--destructive': '0 84.2% 60.2%',
  '--destructive-foreground': '210 40% 98%',
  '--success': '142.1 76.2% 36.3%',
  '--success-foreground': '355.7 100% 97.3%',
  '--warning': '32.1 94.6% 43.7%',
  '--warning-foreground': '355.7 100% 97.3%',
  '--error': '0 72.2% 50.6%',
  '--error-foreground': '0 0% 100%',
  '--border': '214.3 31.8% 91.4%',
  '--input': '214.3 31.8% 91.4%',
  '--ring': '221.2 83.2% 53.3%',
  '--radius': '0.75rem',
}

const darkTokens = {
  '--background': '222.2 84% 4.9%',
  '--foreground': '210 40% 98%',
  '--card': '222.2 84% 4.9%',
  '--card-foreground': '210 40% 98%',
  '--popover': '222.2 84% 4.9%',
  '--popover-foreground': '210 40% 98%',
  '--primary': '217.2 91.2% 59.8%',
  '--primary-foreground': '222.2 47.4% 11.2%',
  '--secondary': '217.2 32.6% 17.5%',
  '--secondary-foreground': '210 40% 98%',
  '--muted': '217.2 32.6% 17.5%',
  '--muted-foreground': '215 20.2% 65.1%',
  '--accent': '217.2 32.6% 17.5%',
  '--accent-foreground': '210 40% 98%',
  '--destructive': '0 62.8% 30.6%',
  '--destructive-foreground': '210 40% 98%',
  '--success': '142.1 70.6% 45.3%',
  '--success-foreground': '144.9 80.4% 10%',
  '--warning': '32.1 94.6% 43.7%',
  '--warning-foreground': '355.7 100% 97.3%',
  '--error': '0 72.2% 55%',
  '--error-foreground': '0 0% 100%',
  '--border': '217.2 32.6% 17.5%',
  '--input': '217.2 32.6% 17.5%',
  '--ring': '224.3 76.3% 48%',
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'media',
  content: [
    './entrypoints/**/*.{html,tsx,ts,jsx,js}',
    './src/**/*.{html,tsx,ts,jsx,js}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        error: {
          DEFAULT: 'hsl(var(--error))',
          foreground: 'hsl(var(--error-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--kb-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--kb-accordion-content-height)' },
          to: { height: '0' },
        },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--kb-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--kb-collapsible-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-out',
        'collapsible-up': 'collapsible-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    animate,
    plugin(({ addBase }) => {
      addBase({
        ':root': { 'color-scheme': 'light dark', ...lightTokens },
        '@media (prefers-color-scheme: dark)': { ':root': darkTokens },
      })
    }),
  ],
}
