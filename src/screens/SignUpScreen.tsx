import { useCallback, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Wordmark } from '@/components/Wordmark';
import { useAuth } from '@/features/auth/AuthProvider';
import { MIN_PASSWORD_LENGTH, useAuthForm } from '@/features/auth/useAuthForm';
import { colors, radius, spacing, typography } from '@/theme';

export function SignUpScreen() {
  const navigation = useNavigation();
  const { signUp } = useAuth();
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const submit = useCallback(
    async (email: string, password: string) => {
      const { needsConfirmation } = await signUp(email, password);
      // With confirmation on there is no session yet, so nothing navigates —
      // say so rather than leaving the user on a form that looks like it failed.
      if (needsConfirmation) setAwaitingConfirmation(true);
    },
    [signUp],
  );

  const form = useAuthForm(submit);

  if (awaitingConfirmation) {
    return (
      <View style={styles.centered}>
        <View style={styles.iconRing}>
          <Ionicons name="mail-open-outline" size={30} color={colors.accent} />
        </View>
        <Text style={styles.title}>Check your inbox</Text>
        <Text style={styles.subtitle}>
          We sent a confirmation link to {form.email}. Open it, then sign in.
        </Text>
        <View style={styles.confirmAction}>
          <Button
            label="Back to sign in"
            onPress={() => navigation.navigate('Auth', { screen: 'SignIn' })}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Wordmark />

        <View style={styles.header}>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Email and password — that is all V1 needs.</Text>
        </View>

        <View style={styles.form}>
          <TextField
            label="Email"
            value={form.email}
            onChangeText={form.setEmail}
            error={form.errors.email}
            icon="mail-outline"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <TextField
            label="Password"
            value={form.password}
            onChangeText={form.setPassword}
            error={form.errors.password}
            icon="lock-closed-outline"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={form.onSubmit}
            returnKeyType="go"
          />

          {form.errors.form ? <Banner tone="danger" message={form.errors.form} /> : null}

          <Button label="Create account" onPress={form.onSubmit} loading={form.submitting} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already registered?</Text>
          <Button
            label="Sign in instead"
            variant="ghost"
            onPress={() => navigation.navigate('Auth', { screen: 'SignIn' })}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconRing: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  header: { gap: spacing.xs, alignItems: 'center' },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  confirmAction: { alignSelf: 'stretch', marginTop: spacing.md },
  form: { gap: spacing.lg },
  footer: { gap: spacing.sm, alignItems: 'center' },
  footerText: { ...typography.caption, color: colors.textMuted },
});
