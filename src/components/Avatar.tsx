import { StyleSheet, Text, View } from 'react-native';
import { radius, typography } from '@/theme';

/** Muted, evenly-spaced hues — the monogram identifies, it never shouts. */
const SWATCHES = [
  { bg: '#EFF6FF', fg: '#1D4ED8' },
  { bg: '#ECFDF5', fg: '#047857' },
  { bg: '#FEF3C7', fg: '#B45309' },
  { bg: '#FCE7F3', fg: '#BE185D' },
  { bg: '#EDE9FE', fg: '#6D28D9' },
  { bg: '#E0F2FE', fg: '#0369A1' },
  { bg: '#FFE4E6', fg: '#BE123C' },
  { bg: '#F1F5F9', fg: '#334155' },
] as const;

/** Stable per company so the same employer keeps its colour across sessions. */
function swatchFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return SWATCHES[Math.abs(hash) % SWATCHES.length]!;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

type Props = {
  name: string | null;
  size?: number;
};

export function Avatar({ name, size = 44 }: Props) {
  const label = name?.trim() ? initials(name) : '—';
  const swatch = swatchFor(name?.trim() || 'unknown');

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 4, backgroundColor: swatch.bg },
      ]}
    >
      <Text style={[styles.text, { color: swatch.fg, fontSize: size * 0.36 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  text: { ...typography.subtitle, letterSpacing: 0 },
});
