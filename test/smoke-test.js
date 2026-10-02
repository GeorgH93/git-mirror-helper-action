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

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RUNNER = path.join(__dirname, "runner.js");
const PWN = path.join(os.tmpdir(), `gmr-pwn-${process.pid}`);

let failures = 0;

function assert(cond, msg) {
	if (cond) {
		console.log(`  ✅ ${msg}`);
	} else {
		failures++;
		console.error(`  ❌ ${msg}`);
	}
}

function baseEnv() {
	const env = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (/^(INPUT_|STATE_|GITHUB_|MOCK_|PWN_|FETCH_)/.test(k)) continue;
		env[k] = v;
	}
	delete env.XDG_CONFIG_HOME;
	return env;
}

function runRunner(mode, envOverrides) {
	return spawnSync(process.execPath, [RUNNER, mode], {
		env: { ...baseEnv(), ...envOverrides },
		encoding: "utf8",
		timeout: 20000,
	});
}

function git(envOverrides, ...args) {
	const r = spawnSync("git", args, { env: { ...baseEnv(), ...envOverrides }, encoding: "utf8" });
	return (r.stdout || "").trim();
}

function readStateEnv(stateFile) {
	const env = {};
	if (fs.existsSync(stateFile)) {
		for (const line of fs.readFileSync(stateFile, "utf8").split("\n")) {
			const idx = line.indexOf("=");
			if (idx > 0) env[`STATE_${line.slice(0, idx)}`] = line.slice(idx + 1);
		}
	}
	return env;
}

function readRequests(requestsFile) {
	if (!fs.existsSync(requestsFile)) return [];
	return fs.readFileSync(requestsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function tempHome(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `gmr-${label}-`));
}

function scenarioIncludeMode() {
	console.log("▶ Scenario A: include mode (default) end-to-end + cleanup");
	const home = tempHome("a");
	const outputFile = path.join(home, "nested", "sub", "mirrors.ini");
	const stateFile = path.join(home, "state");
	const githubOutput = path.join(home, "out");
	const requestsFile = path.join(home, "requests.log");
	const envA = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_USE_INCLUDE: "true",
		INPUT_OUTPUT_FILE: outputFile,
		GITHUB_STATE: stateFile,
		GITHUB_OUTPUT: githubOutput,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	const r = runRunner("main", envA);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);

	const content = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
	assert(content.includes('[url "https://git.example.com/my-org/repo1"]'), "repo1 rewrite written");
	assert(content.includes("insteadOf = https://github.com/my-org/repo1"), "repo1 insteadOf value written");
	assert(content.includes("insteadOf = https://github.com/my-org/repo2"), "repo2 (from page 2) rewrite written");
	assert(!content.includes("evil\""), "URL with quote character skipped");
	assert(git(envA, "config", "--global", "--get-all", "include.path") === outputFile, "include.path set exactly once to the output file (nested dirs created)");
	assert(fs.existsSync(githubOutput) && fs.readFileSync(githubOutput, "utf8") === `git-mirror-list-file=${outputFile}\n`, "action output written");

	const requests = readRequests(requestsFile);
	assert(requests.length === 3, `pagination stops after empty page (3 requests, got ${requests.length})`);
	assert(requests.every((q) => q.authorization === "token tok"), "API token sent as Authorization header");
	assert(requests.every((q) => q.url.includes("/api/v1/orgs/testorg/repos") && q.url.includes("limit=50")), "API path and page size correct");
	assert(!fs.existsSync(PWN), "no shell command execution via API-provided URL");

	const stateEnv = readStateEnv(stateFile);
	assert(stateEnv.STATE_created_file === "true", "state: created_file recorded");
	assert(stateEnv.STATE_added_include === "true", "state: added_include recorded");

	const post = runRunner("post", { ...envA, ...stateEnv });
	assert(post.status === 0, `cleanup exits 0 (got ${post.status}${post.status !== 0 ? `: ${(post.stderr || "").slice(0, 300)}` : ""})`);
	assert(git(envA, "config", "--global", "--get-all", "include.path") === "", "include.path removed");
	assert(!fs.existsSync(outputFile), "mirror list file deleted (it was created by the action)");
	assert(!fs.existsSync(PWN), "still no pwn after cleanup");
}

function scenarioDirectMode() {
	console.log("▶ Scenario B: direct global-config mode preserves pre-existing rewrites");
	const home = tempHome("b");
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envB = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_USE_INCLUDE: "false",
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	git(envB, "config", "--global", "--add", "url.https://mirror.pre/.insteadOf", "https://original.pre/");

	const r = runRunner("main", envB);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);

	const list = git(envB, "config", "--global", "--list");
	assert(list.includes("repo1"), "repo1 section added to global config");
	assert(list.includes("evil-shell"), "URL with shell metachars added verbatim (not executed)");
	assert(!list.includes("evil\""), "URL with quote character skipped");
	assert(list.toLowerCase().includes("mirror.pre"), "pre-existing rewrite untouched by main");
	assert(!fs.existsSync(PWN), "no shell execution in direct mode");

	const stateEnv = readStateEnv(stateFile);
	const sections = JSON.parse(stateEnv.STATE_added_sections || "[]");
	assert(sections.length === 3, `exactly 3 sections recorded in state (got ${sections.length}: ${JSON.stringify(sections)})`);
	assert(sections.every((s) => s.startsWith("url.")), "recorded sections are url.* sections");

	const post = runRunner("post", { ...envB, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	const list2 = git(envB, "config", "--global", "--list");
	assert(!list2.toLowerCase().includes("my-org"), "action-added sections removed");
	assert(list2.toLowerCase().includes("mirror.pre"), "pre-existing rewrite survives cleanup");
}

function scenarioPreExistingFile() {
	console.log("▶ Scenario E: pre-existing output file and include.path are preserved");
	const home = tempHome("e");
	const outputFile = path.join(home, "mirrors.ini");
	fs.writeFileSync(outputFile, '[url "https://mirror.example.com/pre"]\n\tinsteadOf = https://pre.example.com/\n');
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envE = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	git(envE, "config", "--global", "--add", "include.path", outputFile);

	const r = runRunner("main", envE);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);

	const content = fs.readFileSync(outputFile, "utf8");
	assert(content.includes("pre.example.com") && content.includes("repo1"), "pre-existing content kept, new rewrites appended");
	assert(git(envE, "config", "--global", "--get-all", "include.path") === outputFile, "no duplicate include.path added");

	const stateEnv = readStateEnv(stateFile);
	assert(!("STATE_created_file" in stateEnv), "no created_file ownership recorded");
	assert(!("STATE_added_include" in stateEnv), "no added_include ownership recorded");

	const post = runRunner("post", { ...envE, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	assert(fs.existsSync(outputFile), "pre-existing file NOT deleted by cleanup");
	assert(git(envE, "config", "--global", "--get-all", "include.path") === outputFile, "pre-existing include.path NOT removed by cleanup");
}

function scenarioBadServer() {
	console.log("▶ Scenario C: unreachable server fails with fatal error");
	const home = tempHome("c");
	const r = runRunner("main", {
		HOME: home,
		INPUT_SERVER: "http://127.0.0.1:9",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		FETCH_MODE: "fail",
	});
	assert(r.status === 1, `main exits 1 (got ${r.status})`);
	assert((r.stderr || "").includes("Fatal error"), "fatal error message printed");
}

function scenarioMissingInputs() {
	console.log("▶ Scenario D: missing required inputs");
	const home = tempHome("d");
	const r = runRunner("main", {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
	});
	assert(r.status === 1, `main exits 1 (got ${r.status})`);
	assert((r.stderr || "").includes("Missing required inputs"), "missing inputs message printed");
}

function scenarioSiblingIncludePath() {
	console.log("▶ Scenario F: similar-looking include.path sibling survives cleanup (regex over-removal regression)");
	const home = tempHome("f");
	const outputFile = path.join(home, "a.ini");
	const siblingFile = path.join(home, "aXini");
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envF = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	git(envF, "config", "--global", "--add", "include.path", siblingFile);
	fs.writeFileSync(siblingFile, "");

	const r = runRunner("main", envF);
	assert(r.status === 0, `main exits 0 (got ${r.status})`);
	assert(git(envF, "config", "--global", "--get-all", "include.path").split("\n").sort().join("\n") === [siblingFile, outputFile].sort().join("\n"), "our include.path added alongside sibling");

	const stateEnv = readStateEnv(stateFile);
	const post = runRunner("post", { ...envF, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	assert(git(envF, "config", "--global", "--get-all", "include.path") === siblingFile, "only our exact include.path removed; sibling survives");
	assert(!fs.existsSync(outputFile), "our output file deleted");
	assert(fs.existsSync(siblingFile), "sibling file untouched");
}

function scenarioInjectionViaOutputFile() {
	console.log("▶ Scenario G: shell metachars in output_file are not executed");
	const home = tempHome("g");
	const outputFile = path.join(home, `pwn"; $(touch ${PWN}); "`);
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envG = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	const r = runRunner("main", envG);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);
	assert(!fs.existsSync(PWN), "command substitution in output_file not executed");
	assert(git(envG, "config", "--global", "--get-all", "include.path") === outputFile, "output_file with metachars stored literally");
}

function scenarioSkipExisting() {
	console.log("▶ Scenario H: if_file_exists=skip touches nothing but the action output");
	const home = tempHome("h");
	const outputFile = path.join(home, "mirrors.ini");
	const original = '[url "https://mirror.example.com/pre"]\n\tinsteadOf = https://pre.example.com/\n';
	fs.writeFileSync(outputFile, original);
	const stateFile = path.join(home, "state");
	const githubOutput = path.join(home, "out");
	const requestsFile = path.join(home, "requests.log");
	const envH = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		INPUT_IF_FILE_EXISTS: "skip",
		GITHUB_STATE: stateFile,
		GITHUB_OUTPUT: githubOutput,
		MOCK_REQUESTS_FILE: requestsFile,
	};

	const r = runRunner("main", envH);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);
	assert(fs.readFileSync(outputFile, "utf8") === original, "existing file content untouched");
	assert(git(envH, "config", "--global", "--get-all", "include.path") === "", "include.path not added");
	assert(readRequests(requestsFile).length === 0, "no API requests made");
	assert(fs.existsSync(githubOutput) && fs.readFileSync(githubOutput, "utf8") === `git-mirror-list-file=${outputFile}\n`, "action output written");

	const stateEnv = readStateEnv(stateFile);
	assert(!("STATE_created_file" in stateEnv) && !("STATE_added_include" in stateEnv), "no ownership state recorded");

	const post = runRunner("post", { ...envH, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	assert(fs.readFileSync(outputFile, "utf8") === original, "file still untouched after cleanup");
}

function scenarioFailExisting() {
	console.log("▶ Scenario I: if_file_exists=fail exits 1 without side effects");
	const home = tempHome("i");
	const outputFile = path.join(home, "mirrors.ini");
	const original = '[url "https://mirror.example.com/pre"]\n\tinsteadOf = https://pre.example.com/\n';
	fs.writeFileSync(outputFile, original);
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envI = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		INPUT_IF_FILE_EXISTS: "fail",
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
	};

	const r = runRunner("main", envI);
	assert(r.status === 1, `main exits 1 (got ${r.status})`);
	assert((r.stderr || "").includes("already exists"), "error mentions the existing file");
	assert(fs.readFileSync(outputFile, "utf8") === original, "file content untouched");
	assert(git(envI, "config", "--global", "--get-all", "include.path") === "", "include.path not added");
	assert(readRequests(requestsFile).length === 0, "no API requests made");

	const stateEnv = readStateEnv(stateFile);
	assert(!("STATE_created_file" in stateEnv) && !("STATE_added_include" in stateEnv) && !("STATE_backup_file" in stateEnv), "no state recorded");
}

function scenarioOverwriteKeep() {
	console.log("▶ Scenario J: if_file_exists=overwrite_keep_on_cleanup replaces content, file survives cleanup");
	const home = tempHome("j");
	const outputFile = path.join(home, "mirrors.ini");
	fs.writeFileSync(outputFile, '[url "https://mirror.example.com/pre"]\n\tinsteadOf = https://pre.example.com/\n');
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envJ = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		INPUT_IF_FILE_EXISTS: "overwrite_keep_on_cleanup",
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	const r = runRunner("main", envJ);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);
	assert(!fs.existsSync(PWN), "no shell command execution via API-provided URL");
	const content = fs.readFileSync(outputFile, "utf8");
	assert(!content.includes("pre.example.com"), "old content gone");
	assert(content.includes('[url "https://git.example.com/my-org/repo1"]'), "fresh rewrite written");
	assert(!fs.existsSync(`${outputFile}.gmr-bak`), "no backup file created");

	const stateEnv = readStateEnv(stateFile);
	assert(stateEnv.STATE_added_include === "true", "include.path ownership recorded");
	assert(!("STATE_created_file" in stateEnv) && !("STATE_overwrote_file" in stateEnv) && !("STATE_backup_file" in stateEnv), "no file-ownership state recorded");

	const post = runRunner("post", { ...envJ, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	assert(git(envJ, "config", "--global", "--get-all", "include.path") === "", "include.path removed");
	assert(fs.existsSync(outputFile) && fs.readFileSync(outputFile, "utf8").includes("repo1"), "file kept with action rewrites");
}

function scenarioOverwriteRestore() {
	console.log("▶ Scenario K: if_file_exists=overwrite_restore_on_cleanup restores the original file");
	const home = tempHome("k");
	const outputFile = path.join(home, "mirrors.ini");
	const original = '[url "https://mirror.example.com/pre"]\n\tinsteadOf = https://pre.example.com/\n';
	fs.writeFileSync(outputFile, original);
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envK = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		INPUT_IF_FILE_EXISTS: "overwrite_restore_on_cleanup",
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	const r = runRunner("main", envK);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);
	const backupPath = `${outputFile}.gmr-bak`;
	assert(fs.existsSync(backupPath) && fs.readFileSync(backupPath, "utf8") === original, "backup holds the original content");
	assert(!fs.readFileSync(outputFile, "utf8").includes("pre.example.com"), "file rewritten with fresh rewrites only");

	const stateEnv = readStateEnv(stateFile);
	assert(stateEnv.STATE_backup_file === backupPath, "backup path recorded in state");

	const post = runRunner("post", { ...envK, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	assert(fs.readFileSync(outputFile, "utf8") === original, "original content restored");
	assert(!fs.existsSync(backupPath), "backup consumed");
	assert(git(envK, "config", "--global", "--get-all", "include.path") === "", "include.path removed");
}

function scenarioOverwriteDelete() {
	console.log("▶ Scenario L: if_file_exists=overwrite_delete_on_cleanup removes the overwritten file");
	const home = tempHome("l");
	const outputFile = path.join(home, "mirrors.ini");
	fs.writeFileSync(outputFile, '[url "https://mirror.example.com/pre"]\n\tinsteadOf = https://pre.example.com/\n');
	const stateFile = path.join(home, "state");
	const requestsFile = path.join(home, "requests.log");
	const envL = {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_API_TOKEN: "tok",
		INPUT_OUTPUT_FILE: outputFile,
		INPUT_IF_FILE_EXISTS: "overwrite_delete_on_cleanup",
		GITHUB_STATE: stateFile,
		MOCK_REQUESTS_FILE: requestsFile,
		PWN_FILE: PWN,
	};

	const r = runRunner("main", envL);
	assert(r.status === 0, `main exits 0 (got ${r.status}${r.status !== 0 ? `: ${(r.stderr || "").slice(0, 300)}` : ""})`);
	const content = fs.readFileSync(outputFile, "utf8");
	assert(!content.includes("pre.example.com") && content.includes("repo1"), "file contains only fresh rewrites");

	const stateEnv = readStateEnv(stateFile);
	assert(stateEnv.STATE_overwrote_file === "true", "overwrote_file recorded in state");
	assert(!("STATE_created_file" in stateEnv), "created_file not set for a pre-existing file");

	const post = runRunner("post", { ...envL, ...stateEnv });
	assert(post.status === 0, "cleanup exits 0");
	assert(!fs.existsSync(outputFile), "overwritten file deleted");
	assert(git(envL, "config", "--global", "--get-all", "include.path") === "", "include.path removed");
}

function scenarioInvalidValue() {
	console.log("▶ Scenario M: invalid if_file_exists value fails listing the valid options");
	const home = tempHome("m");
	const r = runRunner("main", {
		HOME: home,
		INPUT_SERVER: "https://git.example.com",
		INPUT_ORG: "testorg",
		INPUT_IF_FILE_EXISTS: "overwrite",
	});
	assert(r.status === 1, `main exits 1 (got ${r.status})`);
	assert((r.stderr || "").includes("Invalid value for if_file_exists"), "invalid-value message printed");
	for (const value of ["skip", "fail", "append", "overwrite_keep_on_cleanup", "overwrite_restore_on_cleanup", "overwrite_delete_on_cleanup"]) {
		assert((r.stderr || "").includes(value), `message lists "${value}"`);
	}
}

scenarioIncludeMode();
scenarioDirectMode();
scenarioPreExistingFile();
scenarioSiblingIncludePath();
scenarioInjectionViaOutputFile();
scenarioSkipExisting();
scenarioFailExisting();
scenarioOverwriteKeep();
scenarioOverwriteRestore();
scenarioOverwriteDelete();
scenarioInvalidValue();
scenarioBadServer();
scenarioMissingInputs();

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed ❌`);
	process.exit(1);
}
console.log("\nAll smoke tests passed ✅");
