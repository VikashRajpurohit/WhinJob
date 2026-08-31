import { useCallback, useState } from 'react';
import type { Resume } from '@db/schema';
import { ensureLocalCopy } from './resumeCache';
import { renameResume, setDefaultResume, useResumes } from './resumeQueries';
import { deleteResume, parseResume, uploadResume } from './resumeStorage';
import { pushPendingResumes } from './resumeSync';

export type Notice = { tone: 'success' | 'error' | 'info'; text: string };

/** `upload` while picking, otherwise the id of the row being acted on. */
export type BusyKey = 'upload' | (string & {}) | null;

export function useResumeManager(userId: string | null) {
  const { resumes } = useResumes(userId ?? undefined);
  const [busy, setBusy] = useState<BusyKey>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Local write first, then push — an edit survives with no connectivity (FR-9.2). */
  const pushLater = useCallback(async () => {
    if (userId) await pushPendingResumes(userId);
  }, [userId]);

  const upload = useCallback(async () => {
    if (!userId) return;
    setBusy('upload');
    setNotice(null);
    try {
      const result = await uploadResume(userId);
      if (result.status === 'rejected') {
        setNotice({ tone: 'error', text: result.message });
      } else if (result.status === 'uploaded') {
        setNotice(
          result.parse.status === 'parsed'
            ? { tone: 'success', text: 'Resume uploaded and read.' }
            : { tone: 'info', text: `Uploaded. ${result.parse.message}` },
        );
      }
    } finally {
      setBusy(null);
    }
  }, [userId]);

  const parse = useCallback(async (resumeId: string) => {
    setBusy(resumeId);
    setNotice(null);
    try {
      const result = await parseResume(resumeId);
      setNotice(
        result.status === 'parsed'
          ? { tone: 'success', text: 'Resume read successfully.' }
          : { tone: 'error', text: result.message },
      );
    } finally {
      setBusy(null);
    }
  }, []);

  const makeDefault = useCallback(
    async (resumeId: string) => {
      if (!userId) return;
      setBusy(resumeId);
      try {
        await setDefaultResume(userId, resumeId);
        await pushLater();
      } finally {
        setBusy(null);
      }
    },
    [userId, pushLater],
  );

  const rename = useCallback(
    async (resumeId: string, displayName: string) => {
      const trimmed = displayName.trim();
      if (!trimmed) {
        setNotice({ tone: 'error', text: 'A resume needs a name.' });
        return;
      }
      setBusy(resumeId);
      try {
        await renameResume(resumeId, trimmed);
        await pushLater();
      } finally {
        setBusy(null);
      }
    },
    [pushLater],
  );

  const remove = useCallback(
    async (resumeId: string) => {
      if (!userId) return;
      setBusy(resumeId);
      try {
        await deleteResume(userId, resumeId);
        await pushLater();
        setNotice({ tone: 'info', text: 'Resume removed.' });
      } finally {
        setBusy(null);
      }
    },
    [userId, pushLater],
  );

  /** Fetches the file for offline use. Reading it is a Phase 6 concern. */
  const download = useCallback(async (resume: Resume) => {
    setBusy(resume.id);
    setNotice(null);
    try {
      const uri = await ensureLocalCopy(resume);
      setNotice(
        uri
          ? { tone: 'success', text: 'Saved to this device for offline use.' }
          : { tone: 'error', text: 'Could not download the file. Check your connection.' },
      );
    } finally {
      setBusy(null);
    }
  }, []);

  return {
    resumes,
    busy,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    upload,
    parse,
    makeDefault,
    rename,
    remove,
    download,
  };
}
