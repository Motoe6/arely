export const theme = {
  bg: "#0d1117",
  surface: "#161b22",
  border: "#30363d",
  borderLight: "#21262d",
  text: "#c9d1d9",
  textDim: "#8b949e",
  textBright: "#f0f6fc",
  accent: "#58a6ff",
  green: "#3fb950",
  red: "#f85149",
  yellow: "#d29922",
  purple: "#bc8cff",
  cyan: "#39d2c0",
} as const;

export type Theme = typeof theme;
