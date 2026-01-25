import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        orange: {
          500: '#ff6600', // Brighter, more "hacker" orange
          600: '#cc5200',
        }
      },
      fontFamily: {
        pixel: ['var(--font-pixel)', 'monospace'],
      },
      borderRadius: {
        lg: '0',
        xl: '0',
        DEFAULT: '0',
        md: '0',
        sm: '0',
      }
    },
  },
  plugins: [],
};

export default config;
