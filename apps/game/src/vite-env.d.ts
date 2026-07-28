/// <reference types="vite/client" />

/**
 * The soundtrack glob, produced by the `soundtrack()` plugin in
 * `vite.config.ts`. Entries are `<artist>/<song>.mp3`, relative to
 * `public/audio/music/`.
 */
declare module "virtual:soundtrack" {
  const files: string[];
  export default files;
}
