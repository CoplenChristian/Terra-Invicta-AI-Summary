/**
 * src/v2/theme.js
 *
 * Purpose: MUI createTheme mirror of the v2 CSS custom-property vocabulary in
 * public/v2/css/01-tokens-and-base.css. Nothing renders through this yet — it
 * exists so migrated panels can read tokens from one object that is parity-
 * locked to the live :root block.
 */

import { createTheme } from '@mui/material/node/styles/index.js';

/**
 * The 47 independent :root values from 01-tokens-and-base.css.
 * The 16 pure var() aliases are intentionally omitted — they resolve through
 * these entries and must not be duplicated here.
 */
export const initiativeTokens = {
  canvas: '#081011',
  surface: '#101b1d',
  surfaceRaised: '#142224',
  surfaceInset: '#0b1517',
  line: '#263837',
  lineStrong: '#3b504d',
  text: '#e6eeea',
  textSoft: '#b7c5bf',
  textMuted: '#91a29b',
  textDim: '#758a81',
  accent: '#69c5b8',
  accentStrong: '#a3e0d4',
  accentSoft: 'rgba(105, 197, 184, 0.14)',
  success: '#91bd9b',
  warning: '#d4a35e',
  danger: '#d47d76',
  blue: '#8fb2bd',
  purple: '#b39dbd',
  gold: '#d4a35e',
  display: "Georgia, 'Times New Roman', serif",
  sans: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  fsTitle: '26px',
  fsKpi: '19px',
  fsSection: '15px',
  fsRow: '12.5px',
  fsMetric: '11px',
  fsMeta: '10px',
  fsTag: '9px',
  fsMapName: '10.5px',
  fsMapNote: '8px',
  space2xs: '2px',
  spaceXs: '4px',
  spaceSm: '6px',
  spaceMd: '8px',
  spaceLg: '10px',
  spaceXl: '12px',
  space2xl: '16px',
  space3xl: '20px',
  space4xl: '24px',
  initPink: '#c790a8',
  initPinkGlow: 'rgba(199, 144, 168, 0.16)',
  initBlueGlow: 'rgba(143, 178, 189, 0.16)',
  initGoldGlow: 'rgba(212, 163, 94, 0.16)',
  initEmeraldGlow: 'rgba(145, 189, 155, 0.16)',
  initCrimsonGlow: 'rgba(212, 125, 118, 0.16)',
  initPurpleGlow: 'rgba(179, 157, 189, 0.16)',
};

/** Nine named spacing steps — mirrors --space-*; theme.spacing is unused. */
export const initiativeSpace = {
  '2xs': initiativeTokens.space2xs,
  xs: initiativeTokens.spaceXs,
  sm: initiativeTokens.spaceSm,
  md: initiativeTokens.spaceMd,
  lg: initiativeTokens.spaceLg,
  xl: initiativeTokens.spaceXl,
  '2xl': initiativeTokens.space2xl,
  '3xl': initiativeTokens.space3xl,
  '4xl': initiativeTokens.space4xl,
};

/**
 * Seven-hue categorical palette for data colouring (faction / series keys).
 * Alias-backed entries (--init-cyan, --init-blue, …) resolve through intent
 * colours above; only independent glow pairs and init-pink live in tokens.
 */
export const initiativeCategorical = {
  cyan: { main: initiativeTokens.accent, glow: initiativeTokens.accentSoft },
  blue: { main: initiativeTokens.blue, glow: initiativeTokens.initBlueGlow },
  pink: { main: initiativeTokens.initPink, glow: initiativeTokens.initPinkGlow },
  gold: { main: initiativeTokens.gold, glow: initiativeTokens.initGoldGlow },
  emerald: { main: initiativeTokens.success, glow: initiativeTokens.initEmeraldGlow },
  crimson: { main: initiativeTokens.danger, glow: initiativeTokens.initCrimsonGlow },
  purple: { main: initiativeTokens.purple, glow: initiativeTokens.initPurpleGlow },
};

const t = initiativeTokens;

export const initiativeTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: t.accent,
      light: t.accentStrong,
      dark: t.accent,
      contrastText: t.canvas,
    },
    secondary: {
      main: t.lineStrong,
      contrastText: t.text,
    },
    error: {
      // CSS token is --danger; MUI expects error — rename lives here only.
      main: t.danger,
      contrastText: t.text,
    },
    warning: {
      main: t.warning,
      contrastText: t.canvas,
    },
    success: {
      main: t.success,
      contrastText: t.canvas,
    },
    info: {
      main: t.blue,
      contrastText: t.canvas,
    },
    background: {
      default: t.canvas,
      paper: t.surface,
    },
    text: {
      primary: t.text,
      secondary: t.textSoft,
      disabled: t.textMuted,
    },
    divider: t.line,
    initiative: {
      surfaces: {
        raised: t.surfaceRaised,
        inset: t.surfaceInset,
      },
      lineStrong: t.lineStrong,
      textDim: t.textDim,
      accentSoft: t.accentSoft,
      purple: t.purple,
      gold: t.gold,
      categorical: initiativeCategorical,
    },
  },
  typography: {
    fontFamily: t.sans,
    fontSize: 12.5,
    tag: {
      fontFamily: t.sans,
      fontSize: t.fsTag,
      lineHeight: 1.4,
    },
    meta: {
      fontFamily: t.sans,
      fontSize: t.fsMeta,
      lineHeight: 1.45,
    },
    metric: {
      fontFamily: t.sans,
      fontSize: t.fsMetric,
      lineHeight: 1.45,
    },
    row: {
      fontFamily: t.sans,
      fontSize: t.fsRow,
      lineHeight: 1.5,
    },
    section: {
      fontFamily: t.sans,
      fontSize: t.fsSection,
      lineHeight: 1.35,
      fontWeight: 600,
    },
    kpi: {
      fontFamily: t.display,
      fontSize: t.fsKpi,
      lineHeight: 1.2,
      fontWeight: 600,
    },
    title: {
      fontFamily: t.display,
      fontSize: t.fsTitle,
      lineHeight: 1.15,
      fontWeight: 600,
    },
    mapName: {
      fontFamily: t.sans,
      fontSize: t.fsMapName,
      lineHeight: 1.3,
    },
    mapNote: {
      fontFamily: t.sans,
      fontSize: t.fsMapNote,
      lineHeight: 1.25,
    },
    fontFamilyMono: t.mono,
    fontFamilyDisplay: t.display,
  },
  initiative: {
    space: initiativeSpace,
    tokens: initiativeTokens,
    categorical: initiativeCategorical,
  },
});

/**
 * Flat map from CSS custom-property names to the theme's expected computed
 * values. Used by tests/reactThemeParity.test.js — not for runtime rendering.
 */
export const cssParityExpectations = {
  '--canvas': t.canvas,
  '--surface': t.surface,
  '--surface-raised': t.surfaceRaised,
  '--surface-inset': t.surfaceInset,
  '--line': t.line,
  '--line-strong': t.lineStrong,
  '--text': t.text,
  '--text-soft': t.textSoft,
  '--text-muted': t.textMuted,
  '--text-dim': t.textDim,
  '--accent': t.accent,
  '--accent-strong': t.accentStrong,
  '--accent-soft': t.accentSoft,
  '--success': t.success,
  '--warning': t.warning,
  '--danger': t.danger,
  '--blue': t.blue,
  '--purple': t.purple,
  '--gold': t.gold,
  '--display': t.display,
  '--sans': t.sans,
  '--mono': t.mono,
  '--fs-title': t.fsTitle,
  '--fs-kpi': t.fsKpi,
  '--fs-section': t.fsSection,
  '--fs-row': t.fsRow,
  '--fs-metric': t.fsMetric,
  '--fs-meta': t.fsMeta,
  '--fs-tag': t.fsTag,
  '--fs-map-name': t.fsMapName,
  '--fs-map-note': t.fsMapNote,
  '--space-2xs': t.space2xs,
  '--space-xs': t.spaceXs,
  '--space-sm': t.spaceSm,
  '--space-md': t.spaceMd,
  '--space-lg': t.spaceLg,
  '--space-xl': t.spaceXl,
  '--space-2xl': t.space2xl,
  '--space-3xl': t.space3xl,
  '--space-4xl': t.space4xl,
  '--init-pink': t.initPink,
  '--init-pink-glow': t.initPinkGlow,
  '--init-blue-glow': t.initBlueGlow,
  '--init-gold-glow': t.initGoldGlow,
  '--init-emerald-glow': t.initEmeraldGlow,
  '--init-crimson-glow': t.initCrimsonGlow,
  '--init-purple-glow': t.initPurpleGlow,
};

export default initiativeTheme;
