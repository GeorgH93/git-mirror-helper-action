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

import { execSync } from "child_process";
import fetch from "node-fetch";

const SERVER_URL = process.env.INPUT_SERVER;
const ORG = process.env.INPUT_ORG;
const API_TOKEN = process.env.INPUT_API_TOKEN;
const USE_INCLUDE = (process.env.INPUT_USE_INCLUDE || "true").toLowerCase() !== "false";

const INCLUDE_FILE = path.join(os.homedir(), ".git-mirrors");

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
	console.log(`📝 Using include file: ${INCLUDE_FILE}`);
	if (!fs.existsSync(INCLUDE_FILE)) {
		fs.writeFileSync(INCLUDE_FILE, "[include]\n");
	}

	// ensure it's included in global gitconfig
	try {
		execSync(`git config --global --add include.path "${INCLUDE_FILE}"`);
	} catch (e) {
		console.error("⚠️ Failed to add include.path:", e.message);
	}
}

function removeIncludeFile() {
	console.log(`🧹 Cleaning up include file: ${INCLUDE_FILE}`);
	try {
		execSync(`git config --global --unset-all include.path "${INCLUDE_FILE}"`);
	} catch {
		console.log("ℹ️ No include.path to remove");
	}
}

function addRewrite(oldUrl, newUrl) {
	if (USE_INCLUDE) {
		// write to include file
		const configLine = `\n[url "${newUrl}"]\n\tinsteadOf = ${oldUrl}\n`;
		fs.appendFileSync(INCLUDE_FILE, configLine);
	} else {
		// write to global config
		execSync(`git config --global url."${newUrl}".insteadOf "${oldUrl}"`);
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

			const oldUrl = stripGitSuffix(repo.clone_url);
			const newUrl = stripGitSuffix(repo.clone_url); // force HTTPS

			console.log(`   Adding rewrite: ${newUrl} insteadOf ${oldUrl}`);

			try {
				addRewrite(oldUrl, newUrl);
			} catch (e) {
				console.error("⚠️ Failed to set git config:", e.message);
			}
		}
	}

	console.log("✅ Done.");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
