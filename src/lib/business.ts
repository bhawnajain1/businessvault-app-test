import { metaDb } from './device';

const CURRENT_BUSINESS_KEY = 'current_business_id';

export class NotOnboardedError extends Error {
  constructor() {
    super('No active business — onboarding required');
    this.name = 'NotOnboardedError';
  }
}

export async function currentBusinessId(): Promise<string> {
  const row = await metaDb().settings.get(CURRENT_BUSINESS_KEY);
  if (!row || !row.value) throw new NotOnboardedError();
  return row.value;
}

export async function setCurrentBusinessId(id: string): Promise<void> {
  if (!id || id.trim().length === 0) {
    throw new Error('business id cannot be empty');
  }
  await metaDb().settings.put({
    key: CURRENT_BUSINESS_KEY,
    value: id,
    updatedAt: new Date().toISOString(),
  });
}
