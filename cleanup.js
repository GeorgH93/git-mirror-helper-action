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

const USE_INCLUDE = (process.env.INPUT_USE_INCLUDE || "true").toLowerCase() !== "false";
const OUTPUT_FILE = process.env.INPUT_OUTPUT_FILE || path.join(os.homedir(), ".git-mirrors");

function state(name) {
	return process.env[`STATE_${name}`] ?? process.env[`STATE_${name.toUpperCase()}`];
}

const CREATED_FILE = state("created_file") === "true";
const ADDED_INCLUDE = state("added_include") === "true";
const OVERWROTE_FILE = state("overwrote_file") === "true";
const BACKUP_FILE = state("backup_file");
let ADDED_SECTIONS = [];
try {
	const parsed = JSON.parse(state("added_sections") || "[]");
	if (Array.isArray(parsed)) ADDED_SECTIONS = parsed;
} catch {
	ADDED_SECTIONS = [];
}

function runGit(args) {
	return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function getIncludePaths() {
	try {
		return runGit(["config", "--global", "--get-all", "include.path"])
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * `git config --unset-all include.path <value>` interprets <value> as a regex pattern, so a
 * path like `/tmp/a.ini` would also match `/tmp/aXini`. Reading all values and re-adding
 * everything except the exact OUTPUT_FILE string gives an exact-match removal instead.
 */
function removeIncludePathEntry() {
	const values = getIncludePaths();
	const remaining = values.filter((v) => v !== OUTPUT_FILE);
	if (remaining.length === values.length) return false;
	if (values.length > 0) runGit(["config", "--global", "--unset-all", "include.path"]);
	for (const v of remaining) runGit(["config", "--global", "--add", "include.path", v]);
	return true;
}

if (USE_INCLUDE) {
	if (BACKUP_FILE) {
		try {
			if (fs.existsSync(BACKUP_FILE)) {
				fs.renameSync(BACKUP_FILE, OUTPUT_FILE);
				console.log(`🧹 Restored original ${OUTPUT_FILE} from backup`);
			} else {
				console.warn(`⚠️ Backup ${BACKUP_FILE} not found; leaving ${OUTPUT_FILE} in place.`);
			}
		} catch (e) {
			console.error("⚠️ Failed to restore backup:", e.message);
		}
	}
	if (ADDED_INCLUDE) {
		try {
			if (removeIncludePathEntry()) {
				console.log(`🧹 Removed include.path for ${OUTPUT_FILE}`);
			} else {
				console.log("ℹ️ No matching include.path found to remove");
			}
		} catch (e) {
			console.error("⚠️ Failed to remove include.path:", e.message);
		}
	}
	if (CREATED_FILE || OVERWROTE_FILE) {
		try {
			if (fs.existsSync(OUTPUT_FILE)) {
				fs.unlinkSync(OUTPUT_FILE);
				console.log(`🗑️ Deleted ${OUTPUT_FILE}`);
			}
		} catch (err) {
			console.error("⚠️ Failed to delete include file:", err.message);
		}
	} else if (!BACKUP_FILE && fs.existsSync(OUTPUT_FILE)) {
		console.log(`ℹ️ ${OUTPUT_FILE} was not created by this action; leaving it in place.`);
	}
} else {
	if (ADDED_SECTIONS.length === 0) {
		console.log("ℹ️ No url rewrite entries recorded to remove");
	}
	for (const section of ADDED_SECTIONS) {
		try {
			runGit(["config", "--global", "--remove-section", section]);
			console.log(`🧹 Removed git config section: ${section}`);
		} catch (e) {
			console.error(`⚠️ Failed to remove section ${section}:`, e.message);
		}
	}
}
