import { BusinessVaultDB } from './database';

export const db = new BusinessVaultDB();

export { BusinessVaultDB } from './database';
export { SCHEMA_VERSION, DB_NAME, STORES_V1, STORES_V11 } from './schema';
export * from './types';
