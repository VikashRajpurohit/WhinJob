import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, tone as toneMap, typography, type Tone } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DEFAULT_ICON: Record<Tone, IoniconName> = {
  accent: 'information-circle',
  success: 'checkmark-circle',
  warning: 'alert-circle',
  danger: 'close-circle',
  neutral: 'information-circle',
};

type Props = {
  tone: Tone;
  title?: string;
  message?: string;
  icon?: IoniconName;
  children?: React.ReactNode;
};

/** Inline result and error surface — replaces the loose coloured `Text` lines. */
export function Banner({ tone, title, message, icon, children }: Props) {
  const t = toneMap[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Ionicons name={icon ?? DEFAULT_ICON[tone]} size={18} color={t.fg} style={styles.icon} />
      <View style={styles.content}>
        {title ? <Text style={[styles.title, { color: t.fg }]}>{title}</Text> : null}
        {message ? <Text style={[styles.message, { color: t.fg }]}>{message}</Text> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  icon: { marginTop: 1 },
  content: { flex: 1, gap: spacing.xs },
  title: { ...typography.bodyStrong },
  message: { ...typography.caption, lineHeight: 18 },
});
