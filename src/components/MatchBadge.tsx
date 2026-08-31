import { StyleSheet, Text, View } from 'react-native';
import { BAND_LABEL } from '@/lib/format';
import { colors, radius, spacing, tone as toneMap, typography, type Tone } from '@/theme';
import type { MatchBand } from '@db/schema';

export const BAND_TONE: Record<MatchBand, Tone> = {
  strong: 'success',
  good: 'accent',
  stretch: 'warning',
  weak: 'neutral',
};

type Props = {
  band: MatchBand;
  score: number;
  size?: 'sm' | 'lg';
};

/**
 * Band leads, number trails at half the weight (FR-6.4). One component so the
 * card and the detail screen can't drift apart on which reads louder.
 */
export function MatchBadge({ band, score, size = 'sm' }: Props) {
  const t = toneMap[BAND_TONE[band]];

  return (
    <View
      style={[
        styles.badge,
        size === 'lg' ? styles.lg : styles.sm,
        { backgroundColor: t.bg, borderColor: t.border },
      ]}
    >
      <Text style={[size === 'lg' ? styles.labelLg : styles.label, { color: t.fg }]}>
        {BAND_LABEL[band]}
      </Text>
      <Text style={[styles.score, { color: t.fg }]}>{score}</Text>
    </View>
  );
}

/** Stage-1 results land before any score exists (FR-5.3) — say so, don't imply zero. */
export function UnscoredBadge() {
  return (
    <View style={[styles.badge, styles.sm, styles.pending]}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Not scored</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
  },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 62 },
  lg: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minWidth: 96 },
  pending: { backgroundColor: colors.surface, borderColor: colors.border },
  label: { ...typography.overline },
  labelLg: { ...typography.subtitle, letterSpacing: 0 },
  score: { ...typography.caption, opacity: 0.65, fontVariant: ['tabular-nums'] },
});
