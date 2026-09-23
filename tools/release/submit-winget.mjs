#!/usr/bin/env node
/**
 * Submit the generated WinGet manifests to microsoft/winget-pkgs.
 *
 * WinGet takes packages by pull request, not by push, so this is a PR bot, and
 * the same flow PairUX has used to get merged (scripts/lib/package-managers/
 * winget.ts in pairux.com): fork winget-pkgs under the token's account, sync
 * the fork, put the three manifests on a branch, open a cross-fork PR, and
 * close any open PR of ours for this package so reviewers never see two.
 *
 * Microsoft's validation pipeline and a human moderator review every PR; the
 * first version of a new package takes longest. Nothing here can make it
 * merge, only make it correct.
 *
 * Token: $PKG_SUBMIT_TOKEN, else $GITHUB_TOKEN, else the local `gh` login. The
 * Actions GITHUB_TOKEN cannot fork another organisation's repository, so CI
 * needs PKG_SUBMIT_TOKEN.
 *
 * Usage:
 *   node tools/release/package-managers.mjs --version 0.2.0 --manager winget
 *   node tools/release/submit-winget.mjs --version 0.2.0 [--dir dist/packaging/winget] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const UPSTREAM_OWNER = "microsoft";
const REPO = "winget-pkgs";
const BASE = "master";
const IDENTIFIER = "Profullstack.Nightcell7";
/** manifests/<first letter, lowercase>/<Publisher>/<Package>/<version>/ */
const PACKAGE_PATH = "manifests/p/Profullstack/Nightcell7";

function parseArgs(argv) {
  const args = { dir: "dist/packaging/winget", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--version") args.version = String(argv[++i]).replace(/^v/, "");
    else if (key === "--dir") args.dir = argv[++i];
    else if (key === "--dry-run") args.dryRun = true;
  }
  if (!args.version) throw new Error("--version is required");
  return args;
}

function token() {
  const fromEnv = process.env.PKG_SUBMIT_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  // Local runs: the gh login, used in place and never written anywhere.
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

const TOKEN = token();

async function gh(path, { method = "GET", body, allow404 = false } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nightcell7-release",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { version, dir, dryRun } = parseArgs(process.argv.slice(2));
  const files = readdirSync(dir).filter((name) => name.endsWith(".yaml"));
  if (files.length !== 3) {
    throw new Error(`expected 3 manifests in ${dir}, found ${files.length}: ${files.join(", ")}`);
  }
  for (const name of files) {
    const text = readFileSync(join(dir, name), "utf8");
    if (!text.includes(`PackageVersion: ${version}`)) {
      throw new Error(`${name} is not for version ${version}`);
    }
  }

  const { login } = await gh("/user");
  const versionPath = `${PACKAGE_PATH}/${version}`;

  if (await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/contents/${versionPath}`, { allow404: true })) {
    console.log(`${IDENTIFIER} ${version} is already in ${UPSTREAM_OWNER}/${REPO}; nothing to do.`);
    return;
  }
  const isNew = !(await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/contents/${PACKAGE_PATH}`, {
    allow404: true,
  }));
  const title = `${isNew ? "New package" : "New version"}: ${IDENTIFIER} version ${version}`;
  const branch = `nightcell7-${version}`;

  console.log(`account:  ${login}`);
  console.log(`PR title: ${title}`);
  console.log(`branch:   ${login}:${branch}`);
  console.log(`files:    ${files.map((f) => `${versionPath}/${f}`).join("\n          ")}`);
  if (dryRun) {
    console.log("dry run: nothing pushed, no PR opened.");
    return;
  }

  // One open PR per package: close ours for older attempts first.
  const search = await gh(
    `/search/issues?q=${encodeURIComponent(
      `repo:${UPSTREAM_OWNER}/${REPO} is:pr is:open author:${login} "${IDENTIFIER}" in:title`,
    )}`,
  );
  for (const item of search.items ?? []) {
    console.log(`closing superseded PR #${item.number}: ${item.title}`);
    await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/pulls/${item.number}`, {
      method: "PATCH",
      body: { state: "closed" },
    });
  }

  // Fork, and wait for it: a new fork answers 404 for a while.
  if (!(await gh(`/repos/${login}/${REPO}`, { allow404: true }))) {
    console.log(`forking ${UPSTREAM_OWNER}/${REPO}...`);
    await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/forks`, { method: "POST", body: {} });
    for (let i = 0; i < 30 && !(await gh(`/repos/${login}/${REPO}`, { allow404: true })); i += 1) {
      await sleep(5000);
    }
  }
  await gh(`/repos/${login}/${REPO}/merge-upstream`, { method: "POST", body: { branch: BASE } });

  const base = await gh(`/repos/${login}/${REPO}/git/ref/heads/${BASE}`);
  if (await gh(`/repos/${login}/${REPO}/git/ref/heads/${branch}`, { allow404: true })) {
    await gh(`/repos/${login}/${REPO}/git/refs/heads/${branch}`, { method: "DELETE" });
  }
  await gh(`/repos/${login}/${REPO}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
  });

  for (const name of files) {
    await gh(`/repos/${login}/${REPO}/contents/${versionPath}/${name}`, {
      method: "PUT",
      body: {
        message: `${title}: ${name}`,
        content: Buffer.from(readFileSync(join(dir, name))).toString("base64"),
        branch,
      },
    });
  }

  const pr = await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/pulls`, {
    method: "POST",
    body: {
      title,
      head: `${login}:${branch}`,
      base: BASE,
      body: [
        `${title}.`,
        "",
        `- Installer: NSIS, per-user, silent install supported, from the v${version} GitHub release.`,
        "- InstallerSha256 matches the release's published SHA256SUMS.txt.",
        "- Homepage: https://nightcell7.com",
        "",
        "Generated by tools/release/package-managers.mjs in profullstack/nightcell7.",
      ].join("\n"),
    },
  });
  console.log(`opened ${pr.html_url}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
