const colours = Object.fromEntries(
  ['background','foreground','card','popover','primary','secondary','muted','accent','destructive','border','input','ring']
    .map(name => [name, 'hsl(var(--' + name + ') / <alpha-value>)'])
)
for (const name of ['card','popover','primary','secondary','muted','accent','destructive']) {
  colours[name + '-foreground'] = 'hsl(var(--' + name + '-foreground) / <alpha-value>)'
}
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: { extend: {
    colors: colours,
    opacity: Object.fromEntries([2, 4, 11, 12, 15, 18, 25, 28, 35, 38, 42, 45, 55, 58, 72, 84, 86, 88, 92, 94, 96].map(percent => [percent, String(percent / 100)])),
    borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    fontFamily: { mono: ['var(--font-mono)'], sans: ['var(--font-body)'], display: ['var(--font-display)'] },
  } },
  plugins: [require('tailwindcss-animate')],
}
