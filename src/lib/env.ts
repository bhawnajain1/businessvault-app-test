interface AppEnv {
  googleClientId: string;
  isDev: boolean;
}

export function loadEnv(): AppEnv {
  const meta = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  return {
    googleClientId: meta.VITE_GOOGLE_CLIENT_ID ?? '',
    isDev: meta.DEV === 'true' || meta.MODE !== 'production',
  };
}

export const env = loadEnv();
