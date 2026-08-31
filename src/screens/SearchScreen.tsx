import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GroupLabel, Section } from '@/components/Section';
import { TextField } from '@/components/TextField';
import { ALL_SOURCES, SOURCE_LABEL } from '@/features/search/adapters';
import { DAILY_SEARCH_CAP } from '@/features/search/searchQueries';
import { useSearchRunner } from '@/features/search/useSearchRunner';
import { colors, radius, spacing, typography } from '@/theme';
import { WORK_MODES, type JobSource, type SearchFilters, type WorkMode } from '@db/schema';

const WINDOWS = [1, 7, 30] as const;
const WINDOW_LABEL: Record<number, string> = {
  1: 'Last 24 hours',
  7: 'Last week',
  30: 'Last month',
};

const WORK_MODE_LABEL: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

export function SearchScreen() {
  const navigation = useNavigation();
  const { stage, remaining, run, cancel, reset } = useSearchRunner();

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);
  const [windowDays, setWindowDays] = useState<number>(7);
  const [sources, setSources] = useState<JobSource[]>([...ALL_SOURCES]);

  const busy = stage.kind === 'crawling' || stage.kind === 'scoring';
  const noAllowance = remaining !== null && remaining <= 0;

  const toggleSource = (source: JobSource) =>
    setSources((current) =>
      current.includes(source) ? current.filter((s) => s !== source) : [...current, source],
    );

  const onRun = () => {
    if (title.trim().length === 0) return;
    const filters: SearchFilters = {
      title: title.trim(),
      location: location.trim() || undefined,
      skills: skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      work_mode: workMode ?? undefined,
      salary_min: salaryMin.trim() ? Number(salaryMin.replace(/[^0-9]/g, '')) : undefined,
      posted_within_days: windowDays,
    };
    void run(filters, sources, windowDays);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Find jobs"
        subtitle={
          remaining !== null
            ? `${remaining} of ${DAILY_SEARCH_CAP} searches left today`
            : undefined
        }
        action={{
          label: 'Add manually',
          icon: 'create-outline',
          onPress: () => navigation.navigate('AddJob'),
        }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section title="The role" icon="search-outline">
          <TextField
            label="Job title"
            value={title}
            onChangeText={setTitle}
            placeholder="Backend Engineer"
            icon="briefcase-outline"
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
            label="Key skills"
            value={skills}
            onChangeText={setSkills}
            placeholder="python, postgres, aws"
            icon="code-slash-outline"
            hint="Comma separated. Used to rank results against the job description."
            autoCapitalize="none"
          />
        </Section>

        <Section title="Filters" icon="options-outline">
          <TextField
            label="Minimum salary"
            value={salaryMin}
            onChangeText={setSalaryMin}
            placeholder="1200000"
            icon="cash-outline"
            keyboardType="number-pad"
            hint="Jobs that do not disclose salary are always kept."
          />

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

          <View style={styles.group}>
            <GroupLabel>Posted within</GroupLabel>
            <View style={styles.chipRow}>
              {WINDOWS.map((days) => (
                <Chip
                  key={days}
                  label={WINDOW_LABEL[days]!}
                  selected={windowDays === days}
                  onPress={() => setWindowDays(days)}
                />
              ))}
            </View>
          </View>
        </Section>

        <Section
          title="Sources"
          icon="layers-outline"
          subtitle={`${sources.length} of ${ALL_SOURCES.length} selected`}
          right={
            <Pressable
              onPress={() => setSources(sources.length === ALL_SOURCES.length ? [] : [...ALL_SOURCES])}
              hitSlop={8}
            >
              <Text style={styles.link}>
                {sources.length === ALL_SOURCES.length ? 'Clear' : 'All'}
              </Text>
            </Pressable>
          }
        >
          <View style={styles.chipRow}>
            {ALL_SOURCES.map((source) => (
              <Chip
                key={source}
                label={SOURCE_LABEL[source]}
                icon={sources.includes(source) ? 'checkmark' : undefined}
                selected={sources.includes(source)}
                onPress={() => toggleSource(source)}
              />
            ))}
          </View>
        </Section>

        {stage.kind === 'crawling' ? (
          <View style={styles.progressCard}>
            <View style={styles.progressHead}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.progressTitle}>{stage.label}</Text>
            </View>
            <Text style={styles.progressHint}>Step 1 of 2 · finding and saving jobs</Text>
          </View>
        ) : null}

        {stage.kind === 'scoring' ? (
          <View style={styles.progressCard}>
            <View style={styles.progressHead}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.progressTitle}>
                Scoring {stage.done} of {stage.total}
              </Text>
            </View>
            <ProgressBar value={stage.total === 0 ? 0 : stage.done / stage.total} />
            <Text style={styles.progressHint}>
              Step 2 of 2 · results are already on the Jobs tab.
            </Text>
          </View>
        ) : null}

        {stage.kind === 'error' ? (
          <Banner tone="danger" title="Search failed" message={stage.message} />
        ) : null}

        {stage.kind === 'done' ? (
          <Banner
            tone="success"
            title={`${stage.jobCount} ${stage.jobCount === 1 ? 'job' : 'jobs'} saved`}
            message={
              stage.scored > 0
                ? `${stage.scored} scored${stage.failed > 0 ? `, ${stage.failed} could not be scored` : ''}.`
                : undefined
            }
          >
            {stage.warnings.map((warning) => (
              <Text key={warning} style={styles.warning}>
                • {warning}
              </Text>
            ))}
            <View style={styles.doneActions}>
              <Button
                label="View results"
                size="sm"
                inline
                icon="arrow-forward"
                onPress={() => navigation.navigate('Main', { screen: 'Dashboard' })}
              />
              <Button label="New search" size="sm" variant="ghost" inline onPress={reset} />
            </View>
          </Banner>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {busy ? (
          <Button label="Cancel search" variant="ghost" icon="close" onPress={cancel} />
        ) : (
          <Button
            label={noAllowance ? 'Daily limit reached' : 'Search'}
            icon="search"
            onPress={onRun}
            disabled={noAllowance || title.trim().length === 0 || sources.length === 0}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  group: { gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  link: { ...typography.captionStrong, color: colors.accent },
  progressCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  progressHint: { ...typography.caption, color: colors.textMuted },
  warning: { ...typography.caption, color: colors.warning, lineHeight: 18 },
  doneActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
