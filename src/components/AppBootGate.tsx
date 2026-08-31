import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalMigrations } from '@db/migrate';
import { Wordmark } from '@/components/Wordmark';
import { colors, radius, spacing, tone, typography } from '@/theme';

type Props = {
  children: ReactNode;
};

/**
 * Holds the UI until the local database is migrated. A failure here is fatal —
 * there is no network fallback to read from (hard rule 3).
 */
export function AppBootGate({ children }: Props) {
  const { success, error } = useLocalMigrations();

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorRing}>
          <Ionicons name="warning-outline" size={30} color={colors.danger} />
        </View>
        <Text style={styles.title}>Could not open the local database</Text>
        <Text style={styles.detail}>{error.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View style={styles.container}>
        <Wordmark />
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  spinner: { marginTop: spacing.lg },
  errorRing: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: tone.danger.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
  },
  detail: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
