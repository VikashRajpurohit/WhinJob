import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: IoniconName;
  loading?: boolean;
  disabled?: boolean;
  /** Buttons fill their parent by default; inline sits them in a row. */
  inline?: boolean;
  style?: StyleProp<ViewStyle>;
};

const FOREGROUND: Record<Variant, string> = {
  primary: colors.textInverse,
  secondary: colors.accent,
  ghost: colors.textStrong,
  danger: colors.textInverse,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  inline = false,
  style,
}: Props) {
  const isDisabled = disabled || loading;
  const [scale] = useState(() => new Animated.Value(1));
  const fg = FOREGROUND[variant];

  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();

  return (
    <Animated.View style={[inline ? null : styles.block, { transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        onPress={onPress}
        onPressIn={() => !isDisabled && animate(0.97)}
        onPressOut={() => animate(1)}
        disabled={isDisabled}
        style={[
          styles.base,
          size === 'sm' ? styles.sm : styles.md,
          styles[variant],
          variant === 'primary' || variant === 'danger' ? shadow.sm : null,
          isDisabled ? styles.disabled : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 17} color={fg} /> : null}
            <Text style={[size === 'sm' ? styles.labelSm : styles.label, { color: fg }]}>
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch' },
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  md: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 50 },
  sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 38 },
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  ghost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  label: { ...typography.subtitle },
  labelSm: { ...typography.captionStrong },
});
