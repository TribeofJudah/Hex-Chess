/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Room-server origin for online play (t67), e.g.
   * `https://hex-chess-rooms.<account>.workers.dev`. Only a bare http(s)
   * origin is accepted — see `src/ui/roomConfig.ts`. Unset → same-host.
   */
  readonly VITE_ROOM_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
