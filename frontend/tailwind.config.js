/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      // Notch / home-indicator insets. Resolve to 0 in a normal browser (viewport-fit=cover is only
      // meaningful inside the Capacitor shell), so web layout is unchanged.
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      maxHeight: {
        'safe-dvh': 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
      },
      colors: {
        'dt-primary': '#0369A1',
        'dt-secondary': '#0EA5E9',
        'dt-tertiary': '#7DD3FC',
        'dt-neutral': {
          50: '#F8F9FA',
          100: '#F1F3F5',
          200: '#DEE2E6',
          300: '#CED4DA',
          500: '#6C757D',
          700: '#495057',
          900: '#212529',
        },
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-down': 'fadeInDown 0.8s ease-out both',
        'fade-in-up': 'fadeInUp 0.8s ease-out both',
        'fade-in-up-1': 'fadeInUp 0.8s ease-out 0.2s both',
        'fade-in-up-2': 'fadeInUp 0.8s ease-out 0.4s both',
        'fade-in-up-3': 'fadeInUp 0.8s ease-out 0.6s both',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
