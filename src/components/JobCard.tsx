import { memo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { PressableCard } from '@/components/Card';
import { MatchBadge, UnscoredBadge } from '@/components/MatchBadge';
import type { JobCard as JobCardData } from '@/features/dashboard/jobQueries';
import { SOURCE_LABEL } from '@/features/search/adapters';
import {
  formatApplicantCount,
  formatPostedDate,
  formatSalary,
  responseOdds,
} from '@/lib/format';
import { colors, radius, spacing, tone, typography } from '@/theme';

const ODDS_LABEL = {
  high: 'Few applicants',
  moderate: 'Some competition',
  low: 'Heavy competition',
} as const;

const ODDS_COLOR = {
  high: colors.success,
  moderate: colors.warning,
  low: colors.textMuted,
} as const;

type Props = {
  card: JobCardData;
  onPress: () => void;
};

/**
 * The band leads and the numeric score is de-emphasised (FR-6.4). An unscored job
 * still renders — Stage-1 results appear before any score exists (FR-5.3).
 */
function JobCardComponent({ card, onPress }: Props) {
  const { job, score } = card;
  const odds = responseOdds(job.applicantCount);
  const flag = job.credibilityFlags[0];

  return (
    <PressableCard onPress={onPress} accessibilityLabel={`${job.title} at ${job.companyName ?? 'undisclosed employer'}`}>
      <View style={styles.header}>
        <Avatar name={job.companyName} />

        <View style={styles.titleGroup}>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
          <Text style={styles.company} numberOfLines={1}>
            {job.companyName ?? 'Employer not disclosed'}
          </Text>
        </View>

        {score ? <MatchBadge band={score.band} score={score.score} /> : <UnscoredBadge />}
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="location-outline" size={13} color={colors.textSubtle} />
          <Text style={styles.meta} numberOfLines={1}>
            {job.location ?? 'Location not stated'}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="cash-outline" size={13} color={colors.textSubtle} />
          <Text style={styles.meta} numberOfLines={1}>
            {formatSalary(job)}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.footer}>
        <View style={styles.sourcePill}>
          <Text style={styles.sourceText}>{SOURCE_LABEL[job.source]}</Text>
        </View>
        <Text style={styles.meta}>{formatPostedDate(job.postedDate)}</Text>
        {odds ? (
          <View style={styles.metaItem}>
            <View style={[styles.dot, { backgroundColor: ODDS_COLOR[odds] }]} />
            <Text style={[styles.meta, { color: ODDS_COLOR[odds] }]} numberOfLines={1}>
              {ODDS_LABEL[odds]} · {formatApplicantCount(job.applicantCount)}
            </Text>
          </View>
        ) : null}
      </View>

      {flag ? (
        <View style={styles.flag}>
          <Ionicons name="warning-outline" size={13} color={tone.warning.fg} />
          <Text style={styles.flagText} numberOfLines={2}>
            {flag.reason}
          </Text>
        </View>
      ) : null}
    </PressableCard>
  );
}

export const JobCard = memo(JobCardComponent);

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  titleGroup: { flex: 1, gap: 3 },
  title: { ...typography.subtitle, color: colors.text },
  company: { ...typography.caption, color: colors.textMuted },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  meta: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  sourcePill: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  sourceText: { ...typography.overline, color: colors.textStrong, letterSpacing: 0.4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  flag: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: tone.warning.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  flagText: { ...typography.caption, color: tone.warning.fg, flex: 1 },
});
