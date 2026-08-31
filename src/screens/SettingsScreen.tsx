import { useCallback, useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Section } from '@/components/Section';
import { TextField } from '@/components/TextField';
import {
  estimateSearchCost,
  estimateStageCost,
  findModel,
  formatUsd,
  MODEL_CATALOG,
  STAGE_HINT,
  STAGE_LABEL,
  type ModelOption,
  type ModelStage,
} from '@/features/settings/modelCatalog';
import {
  loadSettings,
  saveCredentials,
  saveModelChoice,
  type SettingsValues,
} from '@/features/settings/settingsStore';
import { testProvider } from '@/lib/bedrock';
import { colors, radius, spacing, typography } from '@/theme';

const STAGES: ModelStage[] = ['parse', 'score', 'analyse'];

const STAGE_ICON: Record<ModelStage, React.ComponentProps<typeof Ionicons>['name']> = {
  parse: 'document-text-outline',
  score: 'speedometer-outline',
  analyse: 'telescope-outline',
};

/** Scoring is the only stage whose cost scales with a whole search. */
function costLabel(model: ModelOption, stage: ModelStage): string {
  if (stage !== 'score') return `≈ ${formatUsd(estimateStageCost(model, stage))} per call`;
  return `≈ ${formatUsd(estimateSearchCost(model))} per search of 20 jobs`;
}

function ModelPicker({
  stage,
  selectedId,
  onSelect,
}: {
  stage: ModelStage;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Section title={STAGE_LABEL[stage]} icon={STAGE_ICON[stage]} subtitle={STAGE_HINT[stage]}>
      {MODEL_CATALOG.map((model) => {
        const selected = model.id === selectedId;
        return (
          <Pressable
            key={model.id}
            onPress={() => onSelect(model.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.option,
              selected ? styles.optionSelected : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={[styles.radio, selected ? styles.radioSelected : null]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>

            <View style={styles.optionBody}>
              <View style={styles.optionHeader}>
                <Text style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}>
                  {model.label}
                </Text>
                <Text style={styles.optionCost}>{costLabel(model, stage)}</Text>
              </View>
              <Text style={styles.optionNote}>{model.note}</Text>
            </View>
          </Pressable>
        );
      })}
    </Section>
  );
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string };

export function SettingsScreen() {
  const [values, setValues] = useState<SettingsValues | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    let active = true;
    void loadSettings().then((loaded) => {
      if (active) setValues(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const setField = useCallback((key: 'bedrockApiKey' | 'awsRegion' | 'apifyToken', v: string) => {
    setValues((prev) => (prev ? { ...prev, [key]: v } : prev));
    setSaved(false);
  }, []);

  const pickModel = useCallback(async (stage: ModelStage, modelId: string) => {
    setValues((prev) =>
      prev ? { ...prev, models: { ...prev.models, [stage]: modelId } } : prev,
    );
    await saveModelChoice(stage, modelId);
  }, []);

  const save = useCallback(async () => {
    if (!values) return;
    await saveCredentials(values);
    setSaved(true);
  }, [values]);

  const runTest = useCallback(async () => {
    if (!values) return;
    if (!values.bedrockApiKey.trim()) {
      setTest({ kind: 'failed', message: 'Paste your Bedrock API key first.' });
      return;
    }
    setTest({ kind: 'running' });
    // Test what will actually run: the saved region and the scoring model.
    const result = await testProvider(
      { bedrockApiKey: values.bedrockApiKey.trim(), awsRegion: values.awsRegion.trim() || 'us-east-1' },
      values.models.score,
    );
    setTest(result.ok ? { kind: 'ok' } : { kind: 'failed', message: result.message });
  }, [values]);

  if (!values) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Every model shares one credential, so the cheapest and priciest current
  // choices bound the monthly figure without needing a per-stage breakdown.
  const scoreModel = findModel(values.models.score);
  const keysPresent = values.bedrockApiKey.trim().length > 0 && values.apifyToken.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section
          title="Your API keys"
          icon="key-outline"
          right={
            <Badge
              label={keysPresent ? 'Set' : 'Missing'}
              tone={keysPresent ? 'success' : 'warning'}
            />
          }
        >
          <Text style={styles.hint}>
            These stay in this device&apos;s secure keychain and are sent only to run your own
            searches. Every model call is billed to your AWS account, not ours.
          </Text>

          <Banner
            tone="warning"
            message="Use a Bedrock API key from an IAM identity scoped to Bedrock inference only. Do not paste AWS root credentials."
          />

          <TextField
            label="Bedrock API key"
            value={values.bedrockApiKey}
            onChangeText={(v) => setField('bedrockApiKey', v)}
            icon="lock-closed-outline"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            hint="Amazon Bedrock console → API keys."
          />
          <TextField
            label="AWS region"
            value={values.awsRegion}
            onChangeText={(v) => setField('awsRegion', v)}
            icon="globe-outline"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="us-east-1"
            hint="Must be a region where your chosen models are enabled."
          />
          <TextField
            label="Apify token"
            value={values.apifyToken}
            onChangeText={(v) => setField('apifyToken', v)}
            icon="lock-closed-outline"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            hint="Used for job crawling. Not needed until you run a search."
          />

          {saved ? <Banner tone="success" message="Saved to this device." /> : null}
          {test.kind === 'ok' ? (
            <Banner tone="success" message="Connected — the model answered." />
          ) : null}
          {test.kind === 'failed' ? <Banner tone="danger" message={test.message} /> : null}

          <View style={styles.actions}>
            <Button label="Save keys" icon="checkmark" onPress={() => void save()} style={styles.grow} />
            <Button
              label={test.kind === 'running' ? 'Testing…' : 'Test'}
              variant="ghost"
              icon="flash-outline"
              onPress={() => void runTest()}
              loading={test.kind === 'running'}
              inline
            />
          </View>
        </Section>

        {STAGES.map((stage) => (
          <ModelPicker
            key={stage}
            stage={stage}
            selectedId={values.models[stage]}
            onSelect={(id) => void pickModel(stage, id)}
          />
        ))}

        <Section title="About these estimates" icon="information-circle-outline">
          <Text style={styles.hint}>
            Costs are estimates from measured token usage, not a bill. Bedrock has no batch
            discount, so scoring is charged at standard rates.
            {scoreModel
              ? ` At five searches a day, ${scoreModel.label} works out to roughly ${formatUsd(
                  estimateSearchCost(scoreModel) * 5 * 30,
                )} a month.`
              : ''}
          </Text>
          {scoreModel ? (
            <Text style={styles.hint}>
              Price source: {scoreModel.priceSource}. Checked {scoreModel.verifiedOn}.
            </Text>
          ) : null}
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  container: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  grow: { flex: 1 },

  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  pressed: { opacity: 0.7 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  optionBody: { flex: 1, gap: spacing.xs },
  optionHeader: { gap: 2 },
  optionLabel: { ...typography.bodyStrong, color: colors.text },
  optionLabelSelected: { color: colors.accentStrong },
  optionCost: { ...typography.caption, color: colors.textMuted },
  optionNote: { ...typography.caption, color: colors.textMuted, lineHeight: 17 },
});
