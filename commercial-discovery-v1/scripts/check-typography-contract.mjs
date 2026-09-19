import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const layout = read('app/layout.tsx')
const typography = read('app/typography.css')

function requireText(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message)
}

const imports = [
  "import './globals.css'",
  "import './research.css'",
  "import './design-system.css'",
  "import './typography.css'",
]
let lastIndex = -1
for (const item of imports) {
  const index = layout.indexOf(item)
  if (index < 0) throw new Error('Typography contract failed: missing stylesheet import ' + item)
  if (index <= lastIndex) throw new Error('Typography contract failed: typography styles must load after the visual system.')
  lastIndex = index
}

for (const token of [
  '--type-micro:.6875rem',
  '--type-caption:.75rem',
  '--type-secondary:.8125rem',
  '--type-body:.875rem',
  '--type-reading:1rem',
]) {
  requireText(typography, token, 'Typography contract failed: missing semantic token ' + token)
}

requireText(
  typography,
  '.settings-field-row input,.settings-field-row select{font-size:var(--type-body);min-height:42px}',
  'Typography contract failed: Settings form values must use normal product-body sizing.',
)
requireText(
  typography,
  '.report-section>header p{font-size:var(--type-body);line-height:1.65}',
  'Typography contract failed: Report narrative must not fall back to microcopy.',
)
requireText(
  typography,
  '.implementation-brief p{font-size:var(--type-body);line-height:1.65}',
  'Typography contract failed: Blueprint instructions must remain readable.',
)
requireText(
  typography,
  '.processing-stage-list article>div p{font-size:var(--type-secondary);line-height:1.55}',
  'Typography contract failed: Processing-stage explanations must remain readable.',
)
requireText(
  typography,
  'font-size:1rem!important;',
  'Typography contract failed: mobile form controls must stay at 16px to avoid focus zoom and improve touch readability.',
)
requireText(
  typography,
  '.landing-proof span',
  'Typography contract failed: landing microcopy coverage must remain explicit.',
)

console.log('Typography contract checks passed.')
