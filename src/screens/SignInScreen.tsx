import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Wordmark } from '@/components/Wordmark';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAuthForm } from '@/features/auth/useAuthForm';
import { colors, spacing, typography } from '@/theme';

export function SignInScreen() {
  const navigation = useNavigation();
  const { signIn } = useAuth();
  const form = useAuthForm(signIn);

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
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to pick up where you left off.</Text>
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
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={form.onSubmit}
            returnKeyType="go"
          />

          {form.errors.form ? <Banner tone="danger" message={form.errors.form} /> : null}

          <Button label="Sign in" onPress={form.onSubmit} loading={form.submitting} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New here?</Text>
          <Button
            label="Create an account"
            variant="ghost"
            onPress={() => navigation.navigate('Auth', { screen: 'SignUp' })}
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
  header: { gap: spacing.xs, alignItems: 'center' },
  title: { ...typography.heading, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  form: { gap: spacing.lg },
  footer: { gap: spacing.sm, alignItems: 'center' },
  footerText: { ...typography.caption, color: colors.textMuted },
});
