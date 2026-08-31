import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radius, tone as toneMap, type Tone } from '@/theme';

type Props = {
  /** 0–1. Clamped, so a caller passing done/total with total 0 can't break it. */
  value: number;
  tone?: Tone;
  height?: number;
};

export function ProgressBar({ value, tone = 'accent', height = 6 }: Props) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const [width] = useState(() => new Animated.Value(clamped));

  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: 280,
      // Width can't run on the native thread; the bar is one view, so it's cheap.
      useNativeDriver: false,
    }).start();
  }, [clamped, width]);

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: toneMap[tone].solid,
          width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
    borderRadius: radius.pill,
  },
});
