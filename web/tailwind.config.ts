import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14213d',
        muted: '#6f7b94',
        brand: '#4e6ef2',
        'brand-deep': '#18285f',
        mint: '#72e7d3',
        sun: '#ffd45a',
      },
      boxShadow: {
        soft: '0 18px 55px rgba(24, 40, 95, .12)',
      },
    },
  },
  plugins: [],
}

export default config
