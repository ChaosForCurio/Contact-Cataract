/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./views/**/*.ejs"],
  theme: {
    extend: {
      colors: {
        'map-bg': '#121212',
        'sidebar-bg': '#1e1e1e',
        'loyal': '#f5af19',
        'addiction': '#ff4b2b',
      },
    },
  },
  plugins: [],
}
