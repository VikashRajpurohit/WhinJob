import { secureStorage } from '@/lib/secureStorage';
import { DEFAULT_MODELS, findModel, type ModelStage } from './modelCatalog';

/**
 * User-supplied provider credentials and model choices.
 *
 * Credentials live in the Keychain/Keystore via the same chunked SecureStore
 * adapter the auth session uses — never AsyncStorage, never SQLite, never the
 * synced Postgres row. They are per-device and per-user by design: each person
 * pastes their own Bedrock key and pays their own bill.
 *
 * Model choices sit here too. They are not secret, but keeping them beside the
 * credentials avoids a schema migration for three strings that never leave the
 * device anyway.
 */

const KEY = {
  bedrockApiKey: 'settings.bedrockApiKey',
  awsRegion: 'settings.awsRegion',
  apifyToken: 'settings.apifyToken',
  model: (stage: ModelStage) => `settings.model.${stage}`,
} as const;

/** Sent to the Edge Functions per call and never persisted server-side. */
export type ProviderCredentials = {
  bedrockApiKey: string;
  awsRegion: string;
};

export type SettingsValues = {
  bedrockApiKey: string;
  awsRegion: string;
  apifyToken: string;
  models: Record<ModelStage, string>;
};

/** Bedrock's Mantle endpoints only exist in regions that serve these models. */
export const DEFAULT_REGION = 'us-east-1';

const read = async (key: string): Promise<string> => (await secureStorage.getItem(key)) ?? '';

export async function loadSettings(): Promise<SettingsValues> {
  const [bedrockApiKey, awsRegion, apifyToken, parse, score, analyse] = await Promise.all([
    read(KEY.bedrockApiKey),
    read(KEY.awsRegion),
    read(KEY.apifyToken),
    read(KEY.model('parse')),
    read(KEY.model('score')),
    read(KEY.model('analyse')),
  ]);

  // An unrecognised id means the catalog changed under a stored choice — fall
  // back rather than sending a model Bedrock will reject.
  const resolve = (stored: string, stage: ModelStage) =>
    findModel(stored) ? stored : DEFAULT_MODELS[stage];

  return {
    bedrockApiKey,
    awsRegion: awsRegion || DEFAULT_REGION,
    apifyToken,
    models: {
      parse: resolve(parse, 'parse'),
      score: resolve(score, 'score'),
      analyse: resolve(analyse, 'analyse'),
    },
  };
}

export async function saveCredentials(values: {
  bedrockApiKey: string;
  awsRegion: string;
  apifyToken: string;
}): Promise<void> {
  await Promise.all([
    secureStorage.setItem(KEY.bedrockApiKey, values.bedrockApiKey.trim()),
    secureStorage.setItem(KEY.awsRegion, values.awsRegion.trim() || DEFAULT_REGION),
    secureStorage.setItem(KEY.apifyToken, values.apifyToken.trim()),
  ]);
}

export async function saveModelChoice(stage: ModelStage, modelId: string): Promise<void> {
  await secureStorage.setItem(KEY.model(stage), modelId);
}

/**
 * Credentials for one call. Returns null when they are not set yet, so callers
 * can say "add your key in Settings" instead of failing at the provider.
 */
export async function getCredentials(): Promise<ProviderCredentials | null> {
  const { bedrockApiKey, awsRegion } = await loadSettings();
  if (!bedrockApiKey) return null;
  return { bedrockApiKey, awsRegion };
}

export async function getModelForStage(stage: ModelStage): Promise<string> {
  return (await loadSettings()).models[stage];
}

/** Wiped on sign-out — the next account on this device supplies its own keys. */
export async function clearSettings(): Promise<void> {
  await Promise.all([
    secureStorage.removeItem(KEY.bedrockApiKey),
    secureStorage.removeItem(KEY.awsRegion),
    secureStorage.removeItem(KEY.apifyToken),
    secureStorage.removeItem(KEY.model('parse')),
    secureStorage.removeItem(KEY.model('score')),
    secureStorage.removeItem(KEY.model('analyse')),
  ]);
}
