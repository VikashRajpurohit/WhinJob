import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, tone as toneMap, typography, type Tone } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  tone?: Tone;
  /** Replaces the chevron — a Switch, a value, a badge. */
  right?: React.ReactNode;
  destructive?: boolean;
};

/**
 * Settings-style row: tinted icon tile, title, optional subtitle, chevron.
 * Replaces the runs of bare blue text links on Profile and Resumes.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  tone = 'neutral',
  right,
  destructive = false,
}: Props) {
  const t = destructive ? toneMap.danger : toneMap[tone];

  const content = (
    <>
      <View style={[styles.iconTile, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={17} color={t.fg} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, destructive ? { color: colors.danger } : null]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={17} color={colors.textSubtle} /> : null)}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  pressed: { opacity: 0.6 },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
});
