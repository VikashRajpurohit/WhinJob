import { colors, typography } from '@/theme';

/** Shared chrome for every pushed screen, so headers don't drift per route. */
export const stackScreenOptions = {
  headerShadowVisible: false,
  headerTintColor: colors.accent,
  headerStyle: { backgroundColor: colors.background },
  headerTitleStyle: { ...typography.subtitle, color: colors.text },
  contentStyle: { backgroundColor: colors.background },
} as const;
