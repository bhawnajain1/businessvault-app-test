/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: 'rgb(var(--bv-app) / <alpha-value>)',
        surface: 'rgb(var(--bv-surface) / <alpha-value>)',
        'surface-hover': 'rgb(var(--bv-surface-hover) / <alpha-value>)',
        elevated: 'rgb(var(--bv-elevated) / <alpha-value>)',
        border: 'rgb(var(--bv-border) / <alpha-value>)',
        'border-strong': 'rgb(var(--bv-border-strong) / <alpha-value>)',
        fg: 'rgb(var(--bv-fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--bv-fg-muted) / <alpha-value>)',
        'fg-subtle': 'rgb(var(--bv-fg-subtle) / <alpha-value>)',
        accent: 'rgb(var(--bv-accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--bv-accent-fg) / <alpha-value>)',
        ring: 'rgb(var(--bv-ring) / <alpha-value>)',
        success: 'rgb(var(--bv-success) / <alpha-value>)',
        'success-bg': 'rgb(var(--bv-success-bg) / <alpha-value>)',
        warning: 'rgb(var(--bv-warning) / <alpha-value>)',
        'warning-bg': 'rgb(var(--bv-warning-bg) / <alpha-value>)',
        danger: 'rgb(var(--bv-danger) / <alpha-value>)',
        'danger-bg': 'rgb(var(--bv-danger-bg) / <alpha-value>)',
        info: 'rgb(var(--bv-info) / <alpha-value>)',
        'info-bg': 'rgb(var(--bv-info-bg) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
