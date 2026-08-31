import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, tone as toneMap, typography, type Tone } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  tone?: Tone;
  icon?: IoniconName;
  /** Solid reads as a status stamp; tinted (default) sits quietly beside text. */
  variant?: 'tinted' | 'solid' | 'outline';
};

export function Badge({ label, tone = 'neutral', icon, variant = 'tinted' }: Props) {
  const t = toneMap[tone];
  const fg = variant === 'solid' ? '#FFFFFF' : t.fg;

  const background =
    variant === 'solid' ? t.solid : variant === 'outline' ? 'transparent' : t.bg;

  return (
    <View style={[styles.badge, { backgroundColor: background, borderColor: t.border }]}>
      {icon ? <Ionicons name={icon} size={11} color={fg} /> : null}
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  label: { ...typography.overline },
});
