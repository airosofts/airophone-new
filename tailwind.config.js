/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#F7F6F3',
        bg2: '#EFEDE8',
        surface: '#FFFFFF',
        border: '#E3E1DB',
        border2: '#D4D1C9',
        text: '#131210',
        text2: '#5C5A55',
        text3: '#9B9890',
        red: '#D63B1F',
        'red-bg': 'rgba(214,59,31,0.07)',
        'red-dim': 'rgba(214,59,31,0.15)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
