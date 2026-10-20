import type { Config } from 'tailwindcss';
import containerQueries from '@tailwindcss/container-queries';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zoom: {
          DEFAULT: '#2D8CFF',
          dark: '#1F6FE5',
        },
        ink: {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          500: '#64748B',
          700: '#334155',
          900: '#0F172A',
        },
      },
    },
  },
  plugins: [
    // Enables @container parents and @sm:/@md:/@lg: child variants so layouts
    // adapt to the space their actual parent gives them — which matters for
    // this Zoom Workplace app because the same components render in surfaces
    // of very different widths (Meeting Sidebar vs Team Chat vs browser).
    containerQueries,
  ],
};

export default config;
