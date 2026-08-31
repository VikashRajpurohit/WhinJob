import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/features/auth/AuthProvider';
import { isCached } from '@/features/resume/resumeCache';
import { useResumeManager, type BusyKey, type Notice } from '@/features/resume/useResumeManager';
import { formatDate, formatFileSize } from '@/lib/format';
import { colors, radius, shadow, spacing, typography, type Tone } from '@/theme';
import type { Resume } from '@db/schema';

const NOTICE_TONE: Record<Notice['tone'], Tone> = {
  success: 'success',
  error: 'danger',
  info: 'warning',
};

/** Parsing has three honest states — pretending a failure is "pending" hides it (FR-3). */
function parseStatus(resume: Resume): { label: string; tone: Tone } {
  if (resume.parsedJson) return { label: 'Read by Claude', tone: 'success' };
  if (resume.parseError) return { label: resume.parseError, tone: 'danger' };
  return { label: 'Not read yet', tone: 'neutral' };
}

type RowProps = {
  resume: Resume;
  busy: BusyKey;
  onSetDefault: () => void;
  onParse: () => void;
  onDownload: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
};

function ResumeRow({
  resume,
  busy,
  onSetDefault,
  onParse,
  onDownload,
  onRename,
  onDelete,
}: RowProps) {
  const [draftName, setDraftName] = useState<string | null>(null);
  const status = parseStatus(resume);
  const working = busy === resume.id;
  const cached = isCached(resume);

  const confirmDelete = () => {
    Alert.alert(
      'Remove this resume?',
      `"${resume.displayName}" will no longer be available for new searches.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onDelete },
      ],
    );
  };

  return (
    <Card>
      <View style={styles.cardHeader}>
        <View style={styles.fileTile}>
          <Ionicons name="document-text" size={19} color={colors.accent} />
        </View>

        <View style={styles.cardTitleGroup}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {resume.displayName}
          </Text>
          <Text style={styles.meta}>
            {formatFileSize(resume.fileSize)} · Added {formatDate(resume.createdAt)}
          </Text>
        </View>

        {resume.isDefault ? <Badge label="Default" tone="accent" icon="star" /> : null}
      </View>

      <View style={styles.badgeRow}>
        <Badge label={status.label} tone={status.tone} />
        <Badge
          label={cached ? 'Offline ready' : 'Not downloaded'}
          tone={cached ? 'success' : 'neutral'}
          icon={cached ? 'cloud-done-outline' : 'cloud-offline-outline'}
        />
      </View>

      {draftName !== null ? (
        <View style={styles.renameGroup}>
          <TextField
            label="Resume name"
            value={draftName}
            onChangeText={setDraftName}
            autoFocus
            autoCapitalize="words"
          />
          <View style={styles.actions}>
            <Button
              label="Save"
              size="sm"
              inline
              icon="checkmark"
              onPress={() => {
                onRename(draftName);
                setDraftName(null);
              }}
            />
            <Button
              label="Cancel"
              size="sm"
              variant="ghost"
              inline
              onPress={() => setDraftName(null)}
            />
          </View>
        </View>
      ) : working ? (
        <View style={styles.working}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.meta}>Working…</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          {!resume.isDefault ? (
            <Button
              label="Make default"
              size="sm"
              variant="ghost"
              inline
              icon="star-outline"
              onPress={onSetDefault}
            />
          ) : null}
          <Button
            label={resume.parsedJson ? 'Re-read' : 'Read resume'}
            size="sm"
            variant="secondary"
            inline
            icon="sparkles-outline"
            onPress={onParse}
          />
          {!cached ? (
            <Button
              label="Download"
              size="sm"
              variant="ghost"
              inline
              icon="cloud-download-outline"
              onPress={onDownload}
            />
          ) : null}
          <Button
            label="Rename"
            size="sm"
            variant="ghost"
            inline
            icon="pencil-outline"
            onPress={() => setDraftName(resume.displayName)}
          />
          <Button
            label="Remove"
            size="sm"
            variant="ghost"
            inline
            icon="trash-outline"
            onPress={confirmDelete}
          />
        </View>
      )}
    </Card>
  );
}

export function ResumesScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const { resumes, busy, notice, upload, parse, makeDefault, rename, remove, download } =
    useResumeManager(userId);

  return (
    <View style={styles.screen}>
      <FlatList
        data={resumes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, resumes.length === 0 ? styles.listEmpty : null]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          notice ? (
            <View style={styles.noticeWrap}>
              <Banner tone={NOTICE_TONE[notice.tone]} message={notice.text} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="document-attach-outline"
            title="No resumes yet"
            body="Upload a PDF or Word resume to get started. A search needs one — your default resume is what jobs get scored against."
          />
        }
        renderItem={({ item }) => (
          <ResumeRow
            resume={item}
            busy={busy}
            onSetDefault={() => void makeDefault(item.id)}
            onParse={() => void parse(item.id)}
            onDownload={() => void download(item)}
            onRename={(name) => void rename(item.id, name)}
            onDelete={() => void remove(item.id)}
          />
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Upload a resume"
          icon="cloud-upload-outline"
          onPress={() => void upload()}
          loading={busy === 'upload'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: spacing.md },
  noticeWrap: { marginBottom: spacing.md },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fileTile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleGroup: { flex: 1, gap: 2 },
  cardTitle: { ...typography.subtitle, color: colors.text },
  meta: { ...typography.caption, color: colors.textMuted },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  renameGroup: { gap: spacing.md, marginTop: spacing.sm },

  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    ...shadow.lg,
  },
});
