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
      }
    },
  },
  plugins: [],
}
