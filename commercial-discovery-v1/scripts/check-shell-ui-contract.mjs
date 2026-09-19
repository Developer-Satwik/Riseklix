import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8')
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) throw new Error('Shell UI contract failed: ' + label)
}

function forbidText(source, needle, label) {
  if (source.includes(needle)) throw new Error('Shell UI contract failed: ' + label)
}

const sidebar = read('components/workspace-sidebar.tsx')
const profileMenu = read('components/profile-menu.tsx')
const projectsPage = read('app/(app)/projects/page.tsx')
const designSystem = read('app/design-system.css')
const globals = read('app/globals.css')

forbidText(sidebar, 'sidebar-workspace-state', 'The retired Beta badge must not return to the workspace sidebar.')
forbidText(sidebar, '>Beta<', 'The workspace sidebar must not present a Beta label.')

requireText(profileMenu, 'Report a bug', 'The profile menu must keep a first-class bug-report action.')
requireText(profileMenu, "encodeURIComponent('Riseklix bug report')", 'Bug reports must open a pre-addressed support email.')
requireText(profileMenu, 'What happened:', 'Bug reports should prompt for the observed problem.')
requireText(profileMenu, 'What did you expect:', 'Bug reports should prompt for the expected behavior.')

requireText(projectsPage, 'project-list-actions', 'Project deletion must remain in a dedicated action rail.')
forbidText(projectsPage, 'project-list-arrow', 'The project row must not crowd the action rail with a second trailing control.')

requireText(
  designSystem,
  'grid-template-columns:minmax(260px,1.15fr) minmax(280px,1.4fr) 110px 44px',
  'Desktop project rows must reserve a dedicated right-side action column.',
)
requireText(
  designSystem,
  'grid-column:1/4',
  'The primary project link must occupy the company, stage and updated columns only.',
)
requireText(
  designSystem,
  'grid-column:4;',
  'Project actions must occupy the isolated fourth column.',
)
forbidText(
  globals,
  'html[data-sidebar-collapsed="true"] .workspace-sidebar nav a.active{\n  background:rgba(158,175,143,.095)!important;',
  'Collapsed active navigation must not render a persistent box behind the Projects icon.',
)
forbidText(
  designSystem,
  '.project-list-row:hover{background:rgba(255,255,255,.018);padding-left',
  'Project-row hover must not shift columns and misalign the action control.',
)
requireText(
  globals,
  'html[data-sidebar-collapsed="true"] .workspace-sidebar nav a:hover,',
  'Collapsed navigation should reveal its background only on hover or keyboard focus.',
)
requireText(
  globals,
  'width:20px;\n  height:20px;',
  'Collapsed navigation icons must stay inside a compact fixed icon box.',
)
requireText(
  globals,
  'max-width:100%;max-height:100%',
  'Collapsed navigation SVGs must remain bounded by their icon container.',
)

console.log('Shell UI contract passed.')
