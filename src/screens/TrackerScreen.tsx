import { useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { PressableCard } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SkeletonCard } from '@/components/Skeleton';
import { useAuth } from '@/features/auth/AuthProvider';
import { useApplications, type TrackerRow } from '@/features/tracker/applicationQueries';
import { STATUS_LABEL, STATUS_TONE } from '@/features/tracker/statusLabels';
import { formatDate } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@db/schema';

function Row({ row, onPress }: { row: TrackerRow; onPress: () => void }) {
  const { application, job } = row;

  return (
    <PressableCard onPress={onPress} accessibilityLabel={`${job.title}, ${STATUS_LABEL[application.status]}`}>
      <View style={styles.cardHeader}>
        <Avatar name={job.companyName} size={40} />
        <View style={styles.titleGroup}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {job.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {job.companyName ?? 'Employer not disclosed'}
          </Text>
        </View>
        <Badge label={STATUS_LABEL[application.status]} tone={STATUS_TONE[application.status]} />
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={13} color={colors.textSubtle} />
          <Text style={styles.meta}>
            {application.dateApplied
              ? `Applied ${formatDate(application.dateApplied)}`
              : `Updated ${formatDate(application.updatedAt)}`}
          </Text>
        </View>

        {application.followUpAt ? (
          <View style={styles.metaItem}>
            <Ionicons name="notifications-outline" size={13} color={colors.warning} />
            <Text style={[styles.meta, { color: colors.warning }]}>
              Follow up {formatDate(application.followUpAt)}
            </Text>
          </View>
        ) : null}

        {application.referrerName ? (
          <View style={styles.metaItem}>
            <Ionicons name="person-outline" size={13} color={colors.textSubtle} />
            <Text style={styles.meta} numberOfLines={1}>
              {application.referrerName}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableCard>
  );
}

export function TrackerScreen() {
  const navigation = useNavigation();
  const { userId } = useAuth();
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all');

  const { rows, loading } = useApplications(userId ?? undefined);

  const counts = useMemo(() => {
    const map = new Map<ApplicationStatus, number>();
    for (const row of rows) {
      map.set(row.application.status, (map.get(row.application.status) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.application.status === filter)),
    [rows, filter],
  );

  // Only statuses that exist keep the filter bar honest and short.
  const usedStatuses = APPLICATION_STATUSES.filter((status) => counts.has(status));

  // "Nothing tracked yet" is a claim about the data — wait for the first read.
  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Tracker" />
        <View style={styles.skeletons}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Tracker"
        subtitle={
          rows.length === 0
            ? 'Nothing tracked yet'
            : `${rows.length} ${rows.length === 1 ? 'application' : 'applications'}`
        }
      />

      {rows.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.filterScroll}
        >
          <Chip
            label="All"
            count={rows.length}
            selected={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          {usedStatuses.map((status) => (
            <Chip
              key={status}
              label={STATUS_LABEL[status]}
              count={counts.get(status)}
              tone={STATUS_TONE[status]}
              selected={filter === status}
              onPress={() => setFilter(status)}
            />
          ))}
        </ScrollView>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.application.id}
        renderItem={({ item }) => (
          <Row
            row={item}
            onPress={() => navigation.navigate('JobDetail', { jobId: item.job.id })}
          />
        )}
        contentContainerStyle={[styles.list, visible.length === 0 ? styles.listEmpty : null]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          rows.length === 0 ? (
            <EmptyState
              icon="checkmark-done-circle-outline"
              title="Nothing tracked yet"
              body="Save or apply to a job and it will show up here with its full status history."
              actionLabel="Browse jobs"
              onAction={() => navigation.navigate('Main', { screen: 'Dashboard' })}
            />
          ) : (
            <EmptyState
              icon="filter-outline"
              title="No matches"
              body="Nothing sits at this status right now. Pick another filter to see the rest."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  filterScroll: { flexGrow: 0, backgroundColor: colors.background },
  filterRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  skeletons: { padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: spacing.md },
  cardHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  titleGroup: { flex: 1, gap: 2 },
  cardTitle: { ...typography.subtitle, color: colors.text },
  meta: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
});
