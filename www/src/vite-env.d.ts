/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional override for the room server URL. Normally the host decides —
   * see core/room/config.ts. Useful to point a phone at a laptop's
   * `wrangler dev`.
   */
  readonly VITE_ROOM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
