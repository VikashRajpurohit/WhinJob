import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { MatchBadge, BAND_TONE } from '@/components/MatchBadge';
import { ProgressBar } from '@/components/ProgressBar';
import { GroupLabel, Section } from '@/components/Section';
import { useJobDetail } from '@/features/dashboard/useJobDetail';
import { SOURCE_LABEL } from '@/features/search/adapters';
import { PRIMARY_STATUSES, STATUS_LABEL, STATUS_TONE } from '@/features/tracker/statusLabels';
import {
  formatApplicantCount,
  formatDate,
  formatExperience,
  formatPostedDate,
  formatSalary,
} from '@/lib/format';
import { colors, radius, shadow, spacing, tone as toneMap, typography } from '@/theme';
import type { RootStackParamList } from '@/navigation/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DESCRIPTION_PREVIEW_LINES = 10;

function MetaItem({ icon, value }: { icon: IoniconName; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={14} color={colors.textSubtle} />
      <Text style={styles.metaText}>{value}</Text>
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <Text style={styles.muted}>None noted.</Text>;
  return (
    <View style={styles.bullets}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <View style={styles.bulletDot} />
          <Text style={styles.body}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** Skills read faster as chips than as a bullet list — they are labels, not prose. */
function SkillChips({ items, tone }: { items: string[]; tone: 'success' | 'warning' }) {
  if (items.length === 0) return <Text style={styles.muted}>None noted.</Text>;
  return (
    <View style={styles.chipRow}>
      {items.map((item) => (
        <Chip key={item} label={item} tone={tone} selected size="sm" />
      ))}
    </View>
  );
}

export function JobDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'JobDetail'>>();
  const insets = useSafeAreaInsets();
  const detail = useJobDetail(route.params.jobId);
  const { job, score, application, busy, error, pendingWarnings } = detail;
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  // Confirmations, never blocks — the user can always proceed (FR-7.4, FR-7.5).
  useEffect(() => {
    if (!pendingWarnings) return;
    Alert.alert(
      'Before you continue',
      pendingWarnings.warnings.map((w) => w.message).join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel', onPress: detail.dismissWarnings },
        { text: 'Continue', onPress: () => void detail.confirmPendingStatus() },
      ],
    );
  }, [pendingWarnings, detail]);

  if (!job) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.textSubtle} />
        <Text style={styles.muted}>This job is no longer available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Avatar name={job.companyName} size={52} />
            <View style={styles.heroTitles}>
              <Text style={styles.title}>{job.title}</Text>
              <Text style={styles.company}>{job.companyName ?? 'Employer not disclosed'}</Text>
            </View>
          </View>

          <View style={styles.metaGrid}>
            <MetaItem icon="location-outline" value={job.location ?? 'Location not stated'} />
            <MetaItem icon="cash-outline" value={formatSalary(job)} />
            <MetaItem icon="trending-up-outline" value={formatExperience(job)} />
            <MetaItem icon="time-outline" value={`Posted ${formatPostedDate(job.postedDate)}`} />
            <MetaItem icon="people-outline" value={formatApplicantCount(job.applicantCount)} />
            <MetaItem icon="globe-outline" value={SOURCE_LABEL[job.source]} />
          </View>
        </View>

        {job.credibilityFlags.length > 0 ? (
          <Banner
            tone="warning"
            title={job.credibilityFlags.length === 1 ? 'One thing to check' : 'A few things to check'}
          >
            {job.credibilityFlags.map((flag) => (
              <Text key={flag.code} style={styles.flagText}>
                • {flag.reason}
              </Text>
            ))}
          </Banner>
        ) : null}

        {error ? <Banner tone="danger" message={error} /> : null}

        <Section
          title="Status"
          icon="flag-outline"
          right={
            application ? (
              <Badge label={STATUS_LABEL[application.status]} tone={STATUS_TONE[application.status]} />
            ) : (
              <Badge label="Not tracked" tone="neutral" />
            )
          }
          subtitle={
            application?.dateApplied ? `Applied ${formatDate(application.dateApplied)}` : undefined
          }
        >
          <View style={styles.chipRow}>
            {PRIMARY_STATUSES.map((status) => (
              <Chip
                key={status}
                label={STATUS_LABEL[status]}
                selected={application?.status === status}
                onPress={() => void detail.requestStatus(status)}
              />
            ))}
          </View>
        </Section>

        <Section
          title="Match"
          icon="sparkles-outline"
          right={score ? <MatchBadge band={score.band} score={score.score} /> : undefined}
        >
          {score ? (
            <>
              <ProgressBar value={score.score / 100} tone={BAND_TONE[score.band]} height={8} />
              {score.rationale ? <Text style={styles.body}>{score.rationale}</Text> : null}

              <GroupLabel>Matched</GroupLabel>
              <SkillChips items={score.matchedSkills} tone="success" />

              <GroupLabel>Missing</GroupLabel>
              <SkillChips items={score.missingSkills} tone="warning" />

              {score.improvementSuggestions.length > 0 ? (
                <>
                  <GroupLabel>To improve your odds</GroupLabel>
                  <Bullets items={score.improvementSuggestions} />
                </>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>
              Not scored yet. Scoring compares this description against your default resume.
            </Text>
          )}

          <Button
            label={score ? 'Re-score' : 'Score this job'}
            icon="refresh"
            size="sm"
            variant="secondary"
            loading={busy === 'scoring'}
            disabled={busy !== 'none'}
            onPress={() => void detail.rescore()}
          />
        </Section>

        <Section title="Deep analysis" icon="telescope-outline">
          {score?.deepAnalysisJson ? (
            <>
              <Text style={styles.body}>{score.deepAnalysisJson.summary}</Text>

              <GroupLabel>Strengths</GroupLabel>
              <Bullets items={score.deepAnalysisJson.strengths} />

              <GroupLabel>Gaps</GroupLabel>
              <Bullets items={score.deepAnalysisJson.gaps} />

              <GroupLabel>Prepare for</GroupLabel>
              <Bullets items={score.deepAnalysisJson.interview_focus} />

              <GroupLabel>Advice</GroupLabel>
              <Bullets items={score.deepAnalysisJson.application_advice} />
            </>
          ) : (
            <Text style={styles.muted}>
              Runs only when you ask for it, and costs a model call.
            </Text>
          )}

          <Button
            label={score?.deepAnalysisJson ? 'Run again' : 'Analyse this job'}
            icon="telescope"
            size="sm"
            variant="secondary"
            loading={busy === 'analysing'}
            disabled={busy !== 'none'}
            onPress={() => void detail.analyse()}
          />
        </Section>

        <Section title="Description" icon="document-text-outline">
          <Text
            style={styles.body}
            numberOfLines={descriptionExpanded ? undefined : DESCRIPTION_PREVIEW_LINES}
          >
            {job.descriptionFull}
          </Text>
          <Pressable onPress={() => setDescriptionExpanded((v) => !v)} hitSlop={8}>
            <Text style={styles.link}>
              {descriptionExpanded ? 'Show less' : 'Read full description'}
            </Text>
          </Pressable>
        </Section>

        <Pressable
          onPress={() => void detail.toggleHidden()}
          style={({ pressed }) => [styles.hideRow, pressed ? styles.pressed : null]}
        >
          <Ionicons
            name={job.isHidden ? 'eye-outline' : 'eye-off-outline'}
            size={15}
            color={colors.textMuted}
          />
          <Text style={styles.hideText}>
            {job.isHidden ? 'Unhide this job' : 'Hide this job from results'}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Apply stays reachable however far the description runs. */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Apply"
          icon="open-outline"
          onPress={() => void detail.openApply()}
          style={styles.applyButton}
        />
        <Pressable
          onPress={() => void detail.toggleBookmark()}
          accessibilityRole="button"
          accessibilityLabel={job.isBookmarked ? 'Remove bookmark' : 'Save job'}
          accessibilityState={{ selected: job.isBookmarked }}
          style={({ pressed }) => [
            styles.saveButton,
            job.isBookmarked ? styles.saveButtonActive : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons
            name={job.isBookmarked ? 'bookmark' : 'bookmark-outline'}
            size={21}
            color={job.isBookmarked ? colors.accent : colors.textMuted}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },

  hero: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadow.sm,
  },
  heroTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  heroTitles: { flex: 1, gap: spacing.xs },
  title: { ...typography.title, color: colors.text },
  company: { ...typography.body, color: colors.textMuted },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { ...typography.caption, color: colors.textStrong },

  flagText: { ...typography.caption, color: toneMap.warning.fg, lineHeight: 18 },
  body: { ...typography.body, color: colors.text, flex: 1 },
  muted: { ...typography.body, color: colors.textMuted },
  link: { ...typography.captionStrong, color: colors.accent },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  bullets: { gap: spacing.sm },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginTop: 8,
  },

  hideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  pressed: { opacity: 0.6 },
  hideText: { ...typography.caption, color: colors.textMuted },

  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow.lg,
  },
  applyButton: { flex: 1 },
  saveButton: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  saveButtonActive: { backgroundColor: colors.accentMuted, borderColor: colors.accentBorder },
});
