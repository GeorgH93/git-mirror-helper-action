#!/usr/bin/env node

/**
 * Copyright (C) 2025  GeorgH93
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_URL_RAW = process.env.INPUT_SERVER;
const ORG = process.env.INPUT_ORG;
const API_TOKEN = process.env.INPUT_API_TOKEN;
const USE_INCLUDE = (process.env.INPUT_USE_INCLUDE || "true").toLowerCase() !== "false";
const OUTPUT_FILE = process.env.INPUT_OUTPUT_FILE || path.join(os.homedir(), ".git-mirrors");
const IF_FILE_EXISTS = process.env.INPUT_IF_FILE_EXISTS || "append";
const IF_FILE_EXISTS_VALUES = ["skip", "fail", "append", "overwrite_keep_on_cleanup", "overwrite_restore_on_cleanup", "overwrite_delete_on_cleanup"];

const FETCH_TIMEOUT_MS = 30000;
const PAGE_SIZE = 50;
const MAX_PAGES = 200; // safety cap (200 pages * 50 repos = 10,000 repos)

/** Config sections added by this action (url.<new>.insteadOf), cleaned up in the post step. */
let addedSections = [];
let sectionsStateFlushed = false;

/** Run git with argument arrays only - never interpolate values into a shell string. */
function runGit(args) {
	return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function appendState(name, value) {
	if (process.env.GITHUB_STATE) {
		fs.appendFileSync(process.env.GITHUB_STATE, `${name}=${value}\n`);
	}
}

/** Record added sections so cleanup can remove exactly what we added, even if main fails. */
function flushSectionsState() {
	if (sectionsStateFlushed) return;
	sectionsStateFlushed = true;
	appendState("added_sections", JSON.stringify(addedSections));
}

function stripGitSuffix(url) {
	return url.endsWith(".git") ? url.slice(0, -4) : url;
}

/**
 * Reject URLs that could corrupt git config files or come from malformed API data.
 * Blocks quotes, backslashes, whitespace, comment characters and control characters.
 */
function isSafeUrl(url) {
	return typeof url === "string" && url.length > 0 && !/[\s"'\\#;\x00-\x1f\x7f]/.test(url);
}

/** Normalize the server base URL: trim, strip trailing slashes, default scheme to https, validate. */
function normalizeServer(raw) {
	let s = raw.trim().replace(/\/+$/, "");
	if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
	return new URL(s).toString().replace(/\/+$/, "");
}

function getIncludePaths() {
	try {
		return runGit(["config", "--global", "--get-all", "include.path"])
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	} catch {
		return []; // key not set - git exits non-zero
	}
}

/** Wire the include file into global git config; records ownership only when this action adds the entry. */
function ensureIncludePath() {
	if (!getIncludePaths().includes(OUTPUT_FILE)) {
		runGit(["config", "--global", "--add", "include.path", OUTPUT_FILE]);
		appendState("added_include", "true");
	} else {
		console.log("ℹ️ include.path already points to this file, skipping.");
	}
}

/** Create the include file, recording ownership - only called when it does not exist yet. */
function createIncludeFile() {
	fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
	fs.writeFileSync(OUTPUT_FILE, "");
	appendState("created_file", "true");
}

function addRewrite(oldUrl, newUrl) {
	if (USE_INCLUDE) {
		fs.appendFileSync(OUTPUT_FILE, `\n[url "${newUrl}"]\n\tinsteadOf = ${oldUrl}\n`);
	} else {
		const section = `url.${newUrl}`;
		runGit(["config", "--global", "--add", `${section}.insteadOf`, oldUrl]);
		addedSections.push(section);
	}
}

async function fetchRepos(server) {
	console.log(`🔍 Fetching repos from org: ${ORG} on ${server}`);

	let page = 1;
	let repos = [];
	let done = false;

	while (!done) {
		if (page > MAX_PAGES) {
			throw new Error(`Exceeded maximum of ${MAX_PAGES} pages while fetching repos. Aborting to avoid an infinite loop.`);
		}

		const url = `${server}/api/v1/orgs/${encodeURIComponent(ORG)}/repos?page=${page}&limit=${PAGE_SIZE}`;
		const options = { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
		if (API_TOKEN) options.headers = { Authorization: `token ${API_TOKEN}` };

		const resp = await fetch(url, options);
		if (!resp.ok) {
			throw new Error(`Failed to fetch repos: ${resp.status} ${await resp.text()}`);
		}

		const data = await resp.json();
		if (!Array.isArray(data) || data.length === 0) {
			done = true;
		} else {
			repos = repos.concat(data);
			page++;
		}
	}

	return repos;
}

async function main() {
	if (!SERVER_URL_RAW || !ORG) {
		console.error("❌ Missing required inputs: server, org");
		process.exit(1);
	}

	if (!IF_FILE_EXISTS_VALUES.includes(IF_FILE_EXISTS)) {
		console.error(`❌ Invalid value for if_file_exists: "${IF_FILE_EXISTS}" (valid: ${IF_FILE_EXISTS_VALUES.join(", ")})`);
		process.exit(1);
	}

	let server;
	try {
		server = normalizeServer(SERVER_URL_RAW);
	} catch (e) {
		console.error(`❌ Invalid server URL "${SERVER_URL_RAW}":`, e.message);
		process.exit(1);
	}

	let fileExists = false;
	if (USE_INCLUDE) {
		fileExists = fs.existsSync(OUTPUT_FILE);
		if (fileExists && IF_FILE_EXISTS === "fail") {
			console.error(`❌ ${OUTPUT_FILE} already exists and if_file_exists is set to fail.`);
			process.exit(1);
		}
		if (fileExists && IF_FILE_EXISTS === "skip") {
			console.log(`⏭️ ${OUTPUT_FILE} already exists and if_file_exists is set to skip - nothing to do.`);
			if (process.env.GITHUB_OUTPUT) {
				fs.appendFileSync(process.env.GITHUB_OUTPUT, `git-mirror-list-file=${OUTPUT_FILE}\n`);
			}
			return;
		}
		console.log(`📝 Using include file: ${OUTPUT_FILE}`);
		if (fileExists) {
			ensureIncludePath();
		} else {
			createIncludeFile();
			ensureIncludePath();
		}
	}

	const repos = await fetchRepos(server);

	if (USE_INCLUDE && fileExists && IF_FILE_EXISTS.startsWith("overwrite_")) {
		if (IF_FILE_EXISTS === "overwrite_restore_on_cleanup") {
			const backupPath = `${OUTPUT_FILE}.gmr-bak`;
			fs.copyFileSync(OUTPUT_FILE, backupPath);
			appendState("backup_file", backupPath);
			console.log(`📝 Existing file backed up to ${backupPath}.`);
		}
		if (IF_FILE_EXISTS === "overwrite_delete_on_cleanup") {
			appendState("overwrote_file", "true");
		}
		fs.writeFileSync(OUTPUT_FILE, "");
		console.log(`📝 Overwrote existing file ${OUTPUT_FILE} (${IF_FILE_EXISTS}).`);
	} else if (USE_INCLUDE && fileExists) {
		console.log(`ℹ️ ${OUTPUT_FILE} already exists; appending to it. The file will not be deleted during cleanup.`);
	}

	for (const repo of repos) {
		if (!repo || !repo.mirror) continue;
		if (!isSafeUrl(repo.original_url) || !isSafeUrl(repo.clone_url)) {
			console.warn(`⚠️ Skipping mirror ${repo.full_name || "(unknown)"}: missing or unsafe URL values.`);
			continue;
		}

		const oldUrl = stripGitSuffix(repo.original_url);
		const newUrl = stripGitSuffix(repo.clone_url);

		console.log(`➡️ Adding rewrite for ${repo.full_name}: ${newUrl} insteadOf ${oldUrl}`);

		try {
			addRewrite(oldUrl, newUrl);
		} catch (e) {
			console.error("⚠️ Failed to set git config:", e.message);
		}
	}

	flushSectionsState();

	if (USE_INCLUDE && process.env.GITHUB_OUTPUT) {
		fs.appendFileSync(process.env.GITHUB_OUTPUT, `git-mirror-list-file=${OUTPUT_FILE}\n`);
	}

	console.log("✅ Done.");
}

main().catch((err) => {
	flushSectionsState();
	console.error("Fatal error:", err.message || err);
	process.exit(1);
});
