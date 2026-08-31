import { useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing } from '@/theme';

type CardProps = {
  children: React.ReactNode;
  /** Flat cards sit on a tinted ground; raised ones sit on white. */
  elevated?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, elevated = true, padded = true, style }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        padded ? styles.padded : null,
        elevated ? shadow.sm : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

type PressableCardProps = CardProps & {
  onPress: () => void;
  accessibilityLabel?: string;
};

/**
 * A card that presses. The scale is driven on the native thread so a list of
 * these still scrolls at 60fps (§9).
 */
export function PressableCard({
  children,
  onPress,
  elevated = true,
  padded = true,
  style,
  accessibilityLabel,
}: PressableCardProps) {
  const [scale] = useState(() => new Animated.Value(1));

  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => animate(0.98)}
        onPressOut={() => animate(1)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[styles.card, padded ? styles.padded : null, elevated ? shadow.sm : null, style]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  padded: { padding: spacing.lg },
});
