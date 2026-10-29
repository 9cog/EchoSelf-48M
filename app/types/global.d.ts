// Define global types for the app
interface AppEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

declare global {
  interface Window {
    ENV: AppEnv;
  }

  // Allow ENV to be set on globalThis for server-side rendering
  /* eslint-disable no-var -- `declare global` requires var */
  // deno-lint-ignore no-var
  var ENV: AppEnv;
  /* eslint-enable no-var */
}

export {};
