import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Avatar } from '@/components/Avatar';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { ListRow } from '@/components/ListRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Section } from '@/components/Section';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProfileForm } from '@/features/auth/useProfileForm';
import { useResumes } from '@/features/resume/resumeQueries';
import { colors, radius, shadow, spacing, typography } from '@/theme';

const SAVE_MESSAGE = {
  idle: null,
  saving: null,
  saved: { tone: 'success' as const, text: 'Profile saved.' },
  offline: {
    tone: 'warning' as const,
    text: 'Saved on this device. It will sync when you are back online.',
  },
} as const;

function resumeSummary(count: number, defaultName: string | undefined): string {
  if (count === 0) return 'No resumes yet — a search needs one.';
  const label = count === 1 ? '1 resume' : `${count} resumes`;
  return defaultName ? `${label} · Default: ${defaultName}` : label;
}

export function ProfileScreen() {
  const navigation = useNavigation();
  const { userId, session, signOut } = useAuth();
  const { values, setField, loading, saveState, save } = useProfileForm(userId);
  const { resumes } = useResumes(userId ?? undefined);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const email = session?.user.email ?? '';
  const notice = SAVE_MESSAGE[saveState];

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Profile" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identity}>
            <Avatar name={values.fullName || email} size={56} />
            <View style={styles.identityText}>
              <Text style={styles.identityName} numberOfLines={1}>
                {values.fullName || 'Add your name'}
              </Text>
              <Text style={styles.identityEmail} numberOfLines={1}>
                {email}
              </Text>
            </View>
          </View>

          <Section title="Setup" icon="construct-outline">
            <View style={styles.rows}>
              <ListRow
                icon="document-text-outline"
                tone="accent"
                title="Resumes"
                subtitle={resumeSummary(resumes.length, resumes.find((r) => r.isDefault)?.displayName)}
                onPress={() => navigation.navigate('Resumes')}
              />
              <View style={styles.rowDivider} />
              <ListRow
                icon="key-outline"
                tone="warning"
                title="Keys & models"
                subtitle="Your Bedrock and Apify keys, billed to your own account."
                onPress={() => navigation.navigate('Settings')}
              />
            </View>
          </Section>

          <Section title="About you" icon="person-outline">
            <TextField
              label="Full name"
              value={values.fullName}
              onChangeText={(v) => setField('fullName', v)}
              icon="person-outline"
              autoComplete="name"
            />
            <TextField
              label="Phone"
              value={values.phone}
              onChangeText={(v) => setField('phone', v)}
              icon="call-outline"
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextField
                  label="Experience (months)"
                  value={values.totalExperienceMonths}
                  onChangeText={(v) => setField('totalExperienceMonths', v)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label="Notice (days)"
                  value={values.noticePeriodDays}
                  onChangeText={(v) => setField('noticePeriodDays', v)}
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </Section>

          <Section title="Where you want to work" icon="location-outline">
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.switchTitle}>Open to remote</Text>
                <Text style={styles.hint}>
                  {values.openToRemote && values.preferredLocations.trim() === ''
                    ? 'Anywhere / Remote — no location constraint.'
                    : 'Remote roles are included alongside your locations.'}
                </Text>
              </View>
              <Switch
                value={values.openToRemote}
                onValueChange={(v) => setField('openToRemote', v)}
                trackColor={{ true: colors.accent, false: colors.borderStrong }}
              />
            </View>

            <TextField
              label="Preferred locations"
              value={values.preferredLocations}
              onChangeText={(v) => setField('preferredLocations', v)}
              icon="map-outline"
              hint="Comma separated. Leave blank with remote on for Anywhere / Remote."
              placeholder="Bengaluru, Pune"
              autoCapitalize="words"
            />
          </Section>

          <Section title="Roles & pay" icon="cash-outline">
            <TextField
              label="Preferred roles"
              value={values.preferredRoles}
              onChangeText={(v) => setField('preferredRoles', v)}
              icon="briefcase-outline"
              hint="Comma separated. Used as scoring context alongside your resume."
              placeholder="React Native Developer, Mobile Engineer"
              autoCapitalize="words"
            />
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextField
                  label="Current CTC"
                  value={values.currentCtc}
                  onChangeText={(v) => setField('currentCtc', v)}
                  hint="Optional."
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label="Expected CTC"
                  value={values.expectedCtc}
                  onChangeText={(v) => setField('expectedCtc', v)}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </Section>

          {notice ? <Banner tone={notice.tone} message={notice.text} /> : null}

          <Button
            label="Save profile"
            icon="checkmark"
            onPress={save}
            loading={saveState === 'saving'}
          />

          <Section title="Account" icon="log-out-outline">
            <ListRow
              icon="log-out-outline"
              title="Sign out"
              subtitle={email}
              destructive
              onPress={() => void signOut()}
            />
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  container: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.sm,
  },
  identityText: { flex: 1, gap: 2 },
  identityName: { ...typography.title, color: colors.text },
  identityEmail: { ...typography.caption, color: colors.textMuted },

  rows: { marginTop: -spacing.sm },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: 'row', gap: spacing.md },
  rowItem: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchLabel: { flex: 1, gap: spacing.xs },
  switchTitle: { ...typography.bodyStrong, color: colors.text },
  hint: { ...typography.caption, color: colors.textMuted },
});
