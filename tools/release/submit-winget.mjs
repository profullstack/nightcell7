#!/usr/bin/env node
/**
 * Submit the generated WinGet manifests to microsoft/winget-pkgs.
 *
 * WinGet takes packages by pull request, not by push, so this is a PR bot, and
 * the same flow PairUX has used to get merged (scripts/lib/package-managers/
 * winget.ts in pairux.com): fork winget-pkgs under the token's account, put
 * the three manifests on a branch cut from upstream's master, open a cross-fork
 * PR (or update the one already open for this version), and close any other
 * open PR of ours for this package so reviewers never see two.
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

  // One open PR per package. A PR already open from this version's branch is
  // reused: re-pointing its branch updates it in place. Any other open PR of
  // ours for the package is an older attempt and is closed.
  const search = await gh(
    `/search/issues?q=${encodeURIComponent(
      `repo:${UPSTREAM_OWNER}/${REPO} is:pr is:open author:${login} "${IDENTIFIER}" in:title`,
    )}`,
  );
  let existing = null;
  for (const item of search.items ?? []) {
    const open = await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/pulls/${item.number}`);
    if (open.head.ref === branch && open.head.user.login === login) {
      existing = open;
      continue;
    }
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
  // Branch from UPSTREAM master, not the fork's. A fork's own master can carry
  // commits upstream never took; branching from it drags them into the PR, and
  // the validator rejects a PR that touches more than one application. The
  // first v0.2.0 submission did exactly that: ralyodio/winget-pkgs master held
  // 36 old commits, and PR #439881 arrived with PairUX files in it. A fork
  // shares its network's objects, so a ref at upstream's commit is valid there.
  // The fork's master is never touched.
  const upstream = await gh(`/repos/${UPSTREAM_OWNER}/${REPO}/git/ref/heads/${BASE}`);
  const baseSha = upstream.object.sha;
  const baseCommit = await gh(`/repos/${login}/${REPO}/git/commits/${baseSha}`);

  // Build the one commit first, then move the branch to it in a single step.
  // Resetting an open PR's branch to bare master, even for a moment, leaves it
  // with no changes, and GitHub closes a PR in that state: #439881 was closed
  // exactly that way on its first repair.
  const tree = await gh(`/repos/${login}/${REPO}/git/trees`, {
    method: "POST",
    body: {
      base_tree: baseCommit.tree.sha,
      tree: files.map((name) => ({
        path: `${versionPath}/${name}`,
        mode: "100644",
        type: "blob",
        content: readFileSync(join(dir, name), "utf8"),
      })),
    },
  });
  const commit = await gh(`/repos/${login}/${REPO}/git/commits`, {
    method: "POST",
    body: { message: title, tree: tree.sha, parents: [baseSha] },
  });
  if (await gh(`/repos/${login}/${REPO}/git/ref/heads/${branch}`, { allow404: true })) {
    // Force, not delete-and-recreate: deleting a PR's head branch closes the PR.
    await gh(`/repos/${login}/${REPO}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: true },
    });
  } else {
    await gh(`/repos/${login}/${REPO}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  }

  if (existing) {
    console.log(`updated ${existing.html_url} in place`);
    return;
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
