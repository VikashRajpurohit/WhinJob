import { useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { FlatList, StyleSheet, View } from 'react-native';
import { EmptyState } from '@/components/EmptyState';
import { JobCard } from '@/components/JobCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { SkeletonCard } from '@/components/Skeleton';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBookmarkedJobs, useJobCards } from '@/features/dashboard/jobQueries';
import { useResumes } from '@/features/resume/resumeQueries';
import { colors, spacing } from '@/theme';

type Tab = 'all' | 'saved';

export function DashboardScreen() {
  const navigation = useNavigation();
  const { userId } = useAuth();
  const uid = userId ?? undefined;
  const { resumes } = useResumes(uid);
  const [tab, setTab] = useState<Tab>('all');

  const defaultResume = useMemo(
    () => resumes.find((r) => r.isDefault) ?? resumes[0],
    [resumes],
  );

  const all = useJobCards(uid, defaultResume?.id);
  const saved = useBookmarkedJobs(uid, defaultResume?.id);
  const cards = tab === 'all' ? all.cards : saved.cards;
  const loading = tab === 'all' ? all.loading : saved.loading;

  // The empty state is a claim about the data — don't make it before the first
  // local read has come back.
  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Jobs" />
        <View style={styles.skeletons}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Jobs"
        subtitle={
          defaultResume
            ? `Scored against ${defaultResume.displayName}`
            : 'Add a resume to start scoring'
        }
        action={{ label: 'Add job', icon: 'add-circle-outline', onPress: () => navigation.navigate('AddJob') }}
      />

      <View style={styles.controls}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All', count: all.cards.length },
            { value: 'saved', label: 'Saved', count: saved.cards.length },
          ]}
        />
      </View>

      <FlatList
        data={cards}
        keyExtractor={(item) => item.job.id}
        renderItem={({ item }) => (
          <JobCard
            card={item}
            onPress={() => navigation.navigate('JobDetail', { jobId: item.job.id })}
          />
        )}
        contentContainerStyle={[styles.list, cards.length === 0 ? styles.listEmpty : null]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        // Virtualization tuned for 500+ rows (§9).
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          tab === 'all' ? (
            <EmptyState
              icon="briefcase-outline"
              title="No jobs yet"
              body="Run a search, or add a job by hand to start tracking it."
              actionLabel="Run a search"
              onAction={() => navigation.navigate('Main', { screen: 'Search' })}
            />
          ) : (
            <EmptyState
              icon="bookmark-outline"
              title="Nothing saved yet"
              body="Bookmark a job from its detail screen and it will appear here."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  controls: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  skeletons: { padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: spacing.md },
});
