import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { GroupLabel, Section } from '@/components/Section';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/features/auth/AuthProvider';
import { createCustomJob } from '@/features/dashboard/jobWriter';
import { colors, shadow, spacing } from '@/theme';
import { EMPLOYMENT_TYPES, WORK_MODES, type EmploymentType, type WorkMode } from '@db/schema';

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
};

const WORK_MODE_LABEL: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

const toNumber = (value: string): number | null => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
};

export function AddJobScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();

  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [applyUrl, setApplyUrl] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(null);
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && description.trim().length > 0;

  const onSave = async () => {
    if (!userId || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const job = await createCustomJob(userId, {
        title: title.trim(),
        companyName: company.trim() || null,
        location: location.trim() || null,
        descriptionFull: description.trim(),
        employmentType,
        workMode,
        salaryMin: toNumber(salaryMin),
        salaryMax: toNumber(salaryMax),
        salaryCurrency: salaryMin || salaryMax ? 'INR' : null,
        salaryPeriod: salaryMin || salaryMax ? 'year' : null,
        applyUrl: applyUrl.trim() || null,
        postedDate: Date.now(),
      });
      navigation.navigate('JobDetail', { jobId: job.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this job.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Banner
            tone="accent"
            message="Anything you add here is scored and tracked exactly like a crawled job."
          />

          <Section title="The role" icon="briefcase-outline">
            <TextField
              label="Job title"
              value={title}
              onChangeText={setTitle}
              placeholder="Backend Engineer"
              icon="briefcase-outline"
              autoCapitalize="words"
            />
            <TextField
              label="Company"
              value={company}
              onChangeText={setCompany}
              placeholder="Acme"
              icon="business-outline"
              autoCapitalize="words"
            />
            <TextField
              label="Location"
              value={location}
              onChangeText={setLocation}
              placeholder="Bengaluru"
              icon="location-outline"
              autoCapitalize="words"
            />
            <TextField
              label="Application link"
              value={applyUrl}
              onChangeText={setApplyUrl}
              placeholder="https://"
              icon="link-outline"
              autoCapitalize="none"
              keyboardType="url"
            />
          </Section>

          <Section title="Description" icon="document-text-outline">
            <TextField
              label="Job description"
              value={description}
              onChangeText={setDescription}
              placeholder="Paste the full description here"
              hint="Scoring matches against this text, so paste all of it."
              multiline
              numberOfLines={8}
              style={styles.textArea}
            />
          </Section>

          <Section title="Details" icon="options-outline">
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextField
                  label="Salary from"
                  value={salaryMin}
                  onChangeText={setSalaryMin}
                  placeholder="1200000"
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.rowItem}>
                <TextField
                  label="Salary to"
                  value={salaryMax}
                  onChangeText={setSalaryMax}
                  placeholder="1800000"
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={styles.group}>
              <GroupLabel>Employment type</GroupLabel>
              <View style={styles.chipRow}>
                {EMPLOYMENT_TYPES.map((type) => (
                  <Chip
                    key={type}
                    label={EMPLOYMENT_LABEL[type]}
                    selected={employmentType === type}
                    onPress={() => setEmploymentType(employmentType === type ? null : type)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.group}>
              <GroupLabel>Work mode</GroupLabel>
              <View style={styles.chipRow}>
                {WORK_MODES.map((mode) => (
                  <Chip
                    key={mode}
                    label={WORK_MODE_LABEL[mode]}
                    selected={workMode === mode}
                    onPress={() => setWorkMode(workMode === mode ? null : mode)}
                  />
                ))}
              </View>
            </View>
          </Section>

          {error ? <Banner tone="danger" message={error} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Save job"
          icon="checkmark"
          onPress={() => void onSave()}
          loading={saving}
          disabled={!canSave || saving}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  textArea: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.md },
  rowItem: { flex: 1 },
  group: { gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    ...shadow.lg,
  },
});
