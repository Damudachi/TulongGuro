/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#1E3A8A',     // Primary Brand
          green: '#10B981',    // Action/Success
          amber: '#F59E0B',    // Insight/Highlight
          slate: '#334155',    // Typography
          bg: '#F8FAFC',       // Background
        }
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'shine': {
          '100%': { transform: 'translateX(100%)' },
        },
        'confetti-fall': {
          '0%': { transform: 'translateY(-10px) rotate(0deg)' },
          '100%': { transform: 'translateY(100vh) rotate(720deg)' },
        }
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s ease-out forwards',
        'shine': 'shine 2s infinite linear',
        'confetti-fall': 'confetti-fall linear forwards',
      }
    },
  },
  plugins: [],
}
