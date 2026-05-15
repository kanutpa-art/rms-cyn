/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan all HTML + JS templates so unused classes are tree-shaken
  content: [
    './public/**/*.html',
    './public/**/*.js',
    './src/**/*.js',
    './server.js',
  ],
  theme: {
    extend: {
      colors: {
        // Project brand
        line: '#06C755',
        'line-dark': '#059142',
        // Legacy / wizard accent
        primary: {
          DEFAULT: '#0f4c81',
          dark: '#1e40af',
        },
      },
      fontFamily: {
        sans: ['Prompt', 'Sarabun', 'system-ui', 'sans-serif'],
      },
      // Keep animations the admin uses
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  // Safelist classes that get generated dynamically (badge colors, etc.)
  // so JIT doesn't drop them.
  safelist: [
    'badge-pending', 'badge-paid', 'badge-overdue', 'badge-reviewing',
    {
      pattern: /(bg|text|border)-(red|yellow|green|blue|emerald|amber|purple|line)-(50|100|200|300|500|600|700|800|900)/,
    },
    'opacity-0', 'opacity-100', 'hidden', 'flex',
  ],
  plugins: [],
};
