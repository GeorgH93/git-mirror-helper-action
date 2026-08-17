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

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_URL = process.env.INPUT_SERVER;
const ORG = process.env.INPUT_ORG;
const API_TOKEN = process.env.INPUT_API_TOKEN;
const USE_INCLUDE = (process.env.INPUT_USE_INCLUDE || "true").toLowerCase() !== "false";
const OUTPUT_FILE = process.env.INPUT_OUTPUT_FILE || path.join(os.homedir(), ".git-mirrors");

function stripGitSuffix(url) {
	return url.endsWith(".git") ? url.slice(0, -4) : url;
}

async function fetchRepos() {
	console.log(`🔍 Fetching repos from org: ${ORG} on ${SERVER_URL}`);

	let page = 1;
	let repos = [];

	while (true) {
		let url = `${SERVER_URL}/api/v1/orgs/${ORG}/repos?page=${page}&limit=50`;
		var resp;
		if (!API_TOKEN) {
			resp = await fetch(url);
		} else {
			resp = await fetch(url, { headers: { Authorization: `token ${API_TOKEN}` } });
		}

		if (!resp.ok) {
			console.error("❌ Failed to fetch repos:", resp.status, await resp.text());
			process.exit(1);
		}

		const data = await resp.json();
		if (data.length === 0) break;

		repos = repos.concat(data);
		page++;
	}

	return repos;
}

function addIncludeFile() {
	console.log(`📝 Using include file: ${OUTPUT_FILE}`);
	if (!fs.existsSync(OUTPUT_FILE)) {
		fs.writeFileSync(OUTPUT_FILE, "[include]\n");
	}

	try {
		execSync(`git config --global --add include.path "${OUTPUT_FILE}"`);
	} catch (e) {
		console.error("⚠️ Failed to add include.path:", e.message);
	}
}


function addRewrite(oldUrl, newUrl) {
	if (USE_INCLUDE) {
		const configLine = `\n[url "${newUrl}"]\n\tinsteadOf = ${oldUrl}\n`;
		fs.appendFileSync(OUTPUT_FILE, configLine);
	} else {
		execSync(`git config --global --add url."${newUrl}".insteadOf "${oldUrl}"`);
	}
}

async function main() {
	if (!SERVER_URL || !ORG) {
		console.error("❌ Missing required inputs: server, org");
		process.exit(1);
	}

	if (USE_INCLUDE) addIncludeFile();

	const repos = await fetchRepos();
	for (const repo of repos) {
		if (repo.mirror) {
			console.log(`➡️ Mirror repo found: ${repo.full_name}`);

			const oldUrl = stripGitSuffix(repo.original_url);
			const newUrl = stripGitSuffix(repo.clone_url); // force HTTPS

			console.log(`   Adding rewrite: ${newUrl} insteadOf ${oldUrl}`);

			try {
				addRewrite(oldUrl, newUrl);
			} catch (e) {
				console.error("⚠️ Failed to set git config:", e.message);
			}
		}
	}

	if ((USE_INCLUDE || process.env.INPUT_OUTPUT_FILE) && process.env.GITHUB_OUTPUT) {
		fs.appendFileSync(process.env.GITHUB_OUTPUT, `git-mirror-list-file=${OUTPUT_FILE}\n`);
	}

	console.log("✅ Done.");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
