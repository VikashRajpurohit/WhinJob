import { colors, type Tone } from '@/theme';
import type { ApplicationStatus } from '@db/schema';

/** All 13 statuses in workflow order (FR-7.1). */
export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  referral_requested: 'Referral requested',
  referral_received: 'Referral received',
  applied_through_referral: 'Applied via referral',
  applied_directly: 'Applied directly',
  interview_scheduled: 'Interview scheduled',
  hr_round: 'HR round',
  technical_round: 'Technical round',
  manager_round: 'Manager round',
  offer_received: 'Offer received',
  rejected: 'Rejected',
  accepted: 'Accepted',
};

export const STATUS_COLOR: Record<ApplicationStatus, string> = {
  saved: colors.textMuted,
  applied: colors.accent,
  referral_requested: colors.warning,
  referral_received: colors.warning,
  applied_through_referral: colors.accent,
  applied_directly: colors.accent,
  interview_scheduled: colors.accent,
  hr_round: colors.accent,
  technical_round: colors.accent,
  manager_round: colors.accent,
  offer_received: colors.success,
  rejected: colors.danger,
  accepted: colors.success,
};

/** Tinted equivalents of STATUS_COLOR, for badges and chips. */
export const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  saved: 'neutral',
  applied: 'accent',
  referral_requested: 'warning',
  referral_received: 'warning',
  applied_through_referral: 'accent',
  applied_directly: 'accent',
  interview_scheduled: 'accent',
  hr_round: 'accent',
  technical_round: 'accent',
  manager_round: 'accent',
  offer_received: 'success',
  rejected: 'danger',
  accepted: 'success',
};

/** Shown as quick actions on the job detail screen; the rest live in the tracker. */
export const PRIMARY_STATUSES: ApplicationStatus[] = [
  'saved',
  'applied_directly',
  'referral_requested',
  'interview_scheduled',
];
