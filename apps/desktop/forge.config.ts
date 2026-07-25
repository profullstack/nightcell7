import type { ForgeConfig } from "@electron-forge/shared-types";

/**
 * Electron Forge packaging (PRD §28.1).
 *
 * P0 targets: Windows x64, macOS arm64, Linux x64 AppImage.
 * Signing and notarization credentials come from the release environment and
 * are never committed (PRD §33.4).
 */
const config: ForgeConfig = {
  packagerConfig: {
    name: "NIGHTCELL 7",
    executableName: "nightcell7",
    appBundleId: "com.nightcell7.game",
    asar: true,
    // Populated by the release workflow only.
    osxSign: process.env.APPLE_SIGNING_IDENTITY ? {} : undefined,
    osxNotarize: process.env.APPLE_ID
      ? {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_PASSWORD ?? "",
          teamId: process.env.APPLE_TEAM_ID ?? "",
        }
      : undefined,
  },
  makers: [
    { name: "@electron-forge/maker-squirrel", platforms: ["win32"], config: {} },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"], config: {} },
    { name: "@electron-forge/maker-deb", platforms: ["linux"], config: {} },
  ],
};

export default config;
