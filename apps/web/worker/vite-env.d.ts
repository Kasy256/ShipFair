// Public build values Vite inlines into the Worker too (only VITE_* names reach any bundle).
interface ImportMetaEnv {
  readonly VITE_MEDIA_HOST?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_REALTIME_HOST?: string;
}
