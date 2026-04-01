/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    // Make sure these globs actually cover your Django templates/partials
    '../../**/templates/**/*.html',
    './src/**/*.{js,ts,jsx,tsx,html}',
  ],

  // Classes that should never be purged
  safelist: [
    // Exact classes you use in badges or dynamic content
    'bg-emerald-600',
    'bg-amber-500',
    'bg-green-600',
    'bg-slate-600',
    'bg-red-600',
    'bg-yellow-500',
    'text-white',
    'text-black',
    'shadow-sm',
    'shadow-lg',
    'rounded-lg',
    'rounded-xl',

    // Optional: future-proof patterns
    {
      pattern:
        /(bg|text|border)-(slate|gray|red|rose|amber|yellow|green|emerald|blue|indigo|violet|purple|fuchsia|teal|cyan)-(100|200|300|400|500|600|700|800|900)/,
    },
    {
      pattern: /shadow-(sm|md|lg)/,
    },
  ],

  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.25rem',
        lg: '1.5rem',
        xl: '2rem',
        '2xl': '2.5rem',
      },
    },
    extend: {
      screens: {
        '3xl': '1920px',
        qhd: '2560px',
        '4k': '3840px',
        '8k': '7680px',
      },
      colors: {
        brand: {
          50: '#ecf8ff',
          100: '#d6efff',
          200: '#a9deff',
          300: '#6fc8ff',
          400: '#38b0ff',
          500: '#0a9aff',
          600: '#0080e0',
          700: '#0065b3',
          800: '#004c80',
          900: '#00345c',
        },
      },
      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
        ],
      },
    },
  },

  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/line-clamp'),
    require('@tailwindcss/aspect-ratio'),
    require('tailwind-scrollbar')({ nocompatible: true }),
  ],
};
