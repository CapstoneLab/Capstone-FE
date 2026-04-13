const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Shell: '#89e051',
  Dockerfile: '#384d54',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Dart: '#00B4AB',
  Lua: '#000080',
  'Objective-C': '#438eff',
  Perl: '#0298c3',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Scala: '#c22d40',
  R: '#198CE7',
  MATLAB: '#e16737',
  Jupyter: '#DA5B0B',
  TeX: '#3D6117',
}

const FALLBACK_COLOR = '#6B7280'

export function getLanguageColor(language: string | null | undefined): string {
  if (!language) return FALLBACK_COLOR
  return LANGUAGE_COLORS[language] ?? FALLBACK_COLOR
}
