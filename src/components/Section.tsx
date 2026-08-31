import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  title: string;
  subtitle?: string;
  icon?: IoniconName;
  /** A badge, a count, a link — sits opposite the title. */
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Titled card. The grouping unit for Job detail, Profile and Settings. */
export function Section({ title, subtitle, icon, right, children, style }: Props) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.header}>
        {icon ? (
          <View style={styles.iconTile}>
            <Ionicons name={icon} size={15} color={colors.accent} />
          </View>
        ) : null}
        <View style={styles.titleGroup}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** All-caps label for a group of controls that doesn't warrant a whole card. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.groupLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleGroup: { flex: 1, gap: 2 },
  title: { ...typography.subtitle, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  groupLabel: { ...typography.overline, color: colors.textMuted, textTransform: 'uppercase' },
});
