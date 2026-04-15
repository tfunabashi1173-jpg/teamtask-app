import { execSync } from "node:child_process";
import type { ExpoConfig } from "expo/config";
const packageJson = require("./package.json") as { version: string };

function resolveCommitSha() {
  const envSha =
    process.env.EAS_BUILD_GIT_COMMIT_HASH?.slice(0, 7) ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.GITHUB_SHA?.slice(0, 7);

  if (envSha) {
    return envSha;
  }

  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "devbuild";
  }
}

const config: ExpoConfig = {
  name: "Team Task Mobile",
  slug: "team-task-mobile",
  version: packageJson.version,
  scheme: "teamtaskmobile",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.teamtask.mobile",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: "com.teamtask.mobile",
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-notifications"],
  extra: {
    appCommitSha: resolveCommitSha(),
  },
};

export default config;
