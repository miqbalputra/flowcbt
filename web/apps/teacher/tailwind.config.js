/** @type {import('tailwindcss').Config} */
module.exports = {
  ...require('../../packages/config/tailwind.preset.cjs'),
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};
