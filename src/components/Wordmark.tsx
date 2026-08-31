import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '@/theme';

/** App identity for the auth screens, which have no nav header of their own. */
export function Wordmark() {
  return (
    <View style={styles.wrapper}>
      <View style={styles.mark}>
        <Ionicons name="briefcase" size={26} color={colors.textInverse} />
      </View>
      <Text style={styles.name}>Job Hunt Assistant</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.md },
  mark: {
    width: 60,
    height: 60,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  name: { ...typography.captionStrong, color: colors.textMuted, letterSpacing: 0.4 },
});
