import * as Crypto from 'expo-crypto';

/**
 * Ids are minted on the device so an offline insert has a stable primary key
 * immediately and the same row can be upserted server-side later (FR-9.4).
 */
export function newId(): string {
  return Crypto.randomUUID();
}
