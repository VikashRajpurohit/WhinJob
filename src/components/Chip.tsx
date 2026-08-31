import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, tone as toneMap, typography, type Tone } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IoniconName;
  /** Trailing count, e.g. the tracker's "Applied 4". */
  count?: number;
  tone?: Tone;
  size?: 'sm' | 'md';
};

/**
 * The one selectable chip for the whole app. Search, Tracker, Add job and Job
 * detail all used to carry their own near-identical copy of this.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  count,
  tone = 'accent',
  size = 'md',
}: Props) {
  const t = toneMap[tone];
  const fg = selected ? t.fg : colors.textMuted;

  const body = (
    <>
      {icon ? <Ionicons name={icon} size={size === 'sm' ? 12 : 14} color={fg} /> : null}
      <Text style={[size === 'sm' ? styles.textSm : styles.text, { color: fg }]}>{label}</Text>
      {count !== undefined ? (
        <View style={[styles.count, selected ? { backgroundColor: t.border } : null]}>
          <Text style={[styles.countText, { color: fg }]}>{count}</Text>
        </View>
      ) : null}
    </>
  );

  const shape = [
    styles.chip,
    size === 'sm' ? styles.chipSm : null,
    selected ? { backgroundColor: t.bg, borderColor: t.border } : null,
  ];

  if (!onPress) return <View style={shape}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={4}
      style={({ pressed }) => [...shape, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSm: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
  text: { ...typography.captionStrong },
  textSm: { ...typography.caption, fontWeight: '600' },
  count: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignItems: 'center',
  },
  countText: { ...typography.overline, letterSpacing: 0 },
});
