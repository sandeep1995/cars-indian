/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        bg0: '#05060a',
        bg1: '#070a12',
        text: 'rgba(250, 251, 255, 0.96)',
        muted: 'rgba(250, 251, 255, 0.72)',
        muted2: 'rgba(250, 251, 255, 0.58)',
        surface: 'rgba(255, 255, 255, 0.05)',
        surface2: 'rgba(255, 255, 255, 0.07)',
        border: 'rgba(255, 255, 255, 0.12)',
        border2: 'rgba(255, 255, 255, 0.18)',
        gold: '#d6b25e',
        gold2: '#f1d48a',
        gold3: '#a97c2b',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'Apple Color Emoji',
          'Segoe UI Emoji',
        ],
        serif: [
          'ui-serif',
          'Iowan Old Style',
          'Palatino',
          'Palatino Linotype',
          'Book Antiqua',
          'Georgia',
          'serif',
        ],
      },
      boxShadow: {
        custom: '0 26px 70px rgba(0, 0, 0, 0.55)',
        'custom-sm': '0 14px 34px rgba(0, 0, 0, 0.35)',
      },
      borderRadius: {
        custom: '18px',
        'custom-sm': '14px',
      },
    },
  },
};
