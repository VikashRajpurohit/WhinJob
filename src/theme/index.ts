/**
 * One accent colour, one spacing scale. Every surface uses these tokens —
 * no ad-hoc hex values or magic numbers in component styles.
 */

/**
 * Raw ramps. Screens never reach in here — they use the semantic `colors` and
 * `tone` maps below, so a palette change lands everywhere at once.
 */
const palette = {
  white: '#FFFFFF',

  slate50: '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate900: '#0F172A',

  blue50: '#EFF6FF',
  blue100: '#DBEAFE',
  blue200: '#BFDBFE',
  blue600: '#2563EB',
  blue700: '#1D4ED8',

  green50: '#ECFDF5',
  green200: '#A7F3D0',
  green600: '#059669',
  green700: '#047857',

  amber50: '#FFFBEB',
  amber200: '#FDE68A',
  amber600: '#D97706',
  amber700: '#B45309',

  red50: '#FEF2F2',
  red200: '#FECACA',
  red600: '#DC2626',
  red700: '#B91C1C',
} as const;

export const colors = {
  accent: palette.blue600,
  accentStrong: palette.blue700,
  accentMuted: palette.blue50,
  accentBorder: palette.blue200,

  /** Page ground. Cards sit on `surfaceSunken` so they read as raised objects. */
  background: palette.white,
  surface: palette.slate50,
  surfaceSunken: palette.slate100,

  border: palette.slate200,
  borderStrong: palette.slate300,

  text: palette.slate900,
  textMuted: palette.slate500,
  textSubtle: palette.slate400,
  textStrong: palette.slate700,
  textInverse: palette.white,

  danger: palette.red600,
  warning: palette.amber600,
  success: palette.green600,

  /** Scrims for sticky bars sitting over scrolling content. */
  shadowColor: palette.slate900,
} as const;

/**
 * Tinted trios for every status surface — chips, badges, banners, bands.
 * A tinted `bg` + readable `fg` reads calmer than a saturated block and keeps
 * the match band from out-shouting the job title (FR-6.4).
 */
export const tone = {
  accent: { bg: palette.blue50, border: palette.blue200, fg: palette.blue700, solid: palette.blue600 },
  success: { bg: palette.green50, border: palette.green200, fg: palette.green700, solid: palette.green600 },
  warning: { bg: palette.amber50, border: palette.amber200, fg: palette.amber700, solid: palette.amber600 },
  danger: { bg: palette.red50, border: palette.red200, fg: palette.red700, solid: palette.red600 },
  neutral: { bg: palette.slate100, border: palette.slate200, fg: palette.slate600, solid: palette.slate500 },
} as const;

export type Tone = keyof typeof tone;

/** 4pt scale. Use these names, not raw numbers. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  micro: 11,
  caption: 12,
  body: 14,
  subtitle: 16,
  title: 20,
  heading: 26,
  display: 32,
} as const;

/** Named text styles so screens don't restate size/weight pairs. */
export const typography = {
  display: { fontSize: fontSize.display, fontWeight: '700', lineHeight: 38, letterSpacing: -0.6 },
  heading: { fontSize: fontSize.heading, fontWeight: '700', lineHeight: 32, letterSpacing: -0.4 },
  title: { fontSize: fontSize.title, fontWeight: '600', lineHeight: 26, letterSpacing: -0.2 },
  subtitle: { fontSize: fontSize.subtitle, fontWeight: '600', lineHeight: 22, letterSpacing: -0.1 },
  body: { fontSize: fontSize.body, fontWeight: '400', lineHeight: 20 },
  bodyStrong: { fontSize: fontSize.body, fontWeight: '600', lineHeight: 20 },
  caption: { fontSize: fontSize.caption, fontWeight: '400', lineHeight: 16 },
  captionStrong: { fontSize: fontSize.caption, fontWeight: '600', lineHeight: 16 },
  /** All-caps group labels. Tracking opens them up so they read as labels, not text. */
  overline: { fontSize: fontSize.micro, fontWeight: '700', lineHeight: 14, letterSpacing: 0.8 },
} as const;

/**
 * Elevation. iOS reads the shadow triple, Android reads `elevation` — both are
 * set so a card looks the same on either platform.
 */
export const shadow = {
  sm: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;

export type Spacing = keyof typeof spacing;
