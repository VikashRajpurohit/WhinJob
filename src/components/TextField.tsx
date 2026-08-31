import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = TextInputProps & {
  label: string;
  error?: string | null;
  hint?: string;
  icon?: IoniconName;
};

export function TextField({
  label,
  error,
  hint,
  icon,
  style,
  onFocus,
  onBlur,
  ...inputProps
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>

      <View
        style={[
          styles.field,
          focused ? styles.fieldFocused : null,
          error ? styles.fieldError : null,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={17}
            color={focused ? colors.accent : colors.textSubtle}
            style={styles.icon}
          />
        ) : null}
        <TextInput
          {...inputProps}
          placeholderTextColor={colors.textSubtle}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
      </View>

      {error ? (
        <View style={styles.messageRow}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { ...typography.captionStrong, color: colors.textStrong },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  // A visible focus ring is the only cue that a tap landed on the right field.
  fieldFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  fieldError: { borderColor: colors.danger, backgroundColor: colors.background },
  icon: { marginRight: spacing.sm },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  error: { ...typography.caption, color: colors.danger, flex: 1 },
  hint: { ...typography.caption, color: colors.textMuted },
});
