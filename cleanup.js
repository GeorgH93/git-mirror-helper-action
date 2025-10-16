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

const USE_INCLUDE = (process.env.INPUT_USE_INCLUDE || "true").toLowerCase() !== "false";
const OUTPUT_FILE = process.env.INPUT_OUTPUT_FILE || path.join(os.homedir(), ".git-mirrors");

if (USE_INCLUDE) {
	try {
		execSync(`git config --global --unset-all include.path "${OUTPUT_FILE}"`);
		console.log(`🧹 Removed include.path for ${OUTPUT_FILE}`);
	} catch {
		console.log("ℹ️ No include.path found to remove");
	}
	try {
		if (fs.existsSync(OUTPUT_FILE)) {
			fs.unlinkSync(OUTPUT_FILE);
			console.log(`🗑️ Deleted ${OUTPUT_FILE}`);
		}
	} catch (err) {
		console.error("⚠️ Failed to delete include file:", err.message);
	}
} else {
	try {
		const output = execSync("git config --global --list").toString();
		const sections = new Set();
		for (const line of output.split("\n")) {
			const match = line.match(/^(url\..+)\.insteadof=/i);
			if (match) {
				sections.add(match[1]);
			}
		}
		if (sections.size === 0) {
			console.log("ℹ️ No url rewrite entries found to remove");
		}
		for (const section of sections) {
			try {
				execSync(`git config --global --remove-section "${section}"`);
				console.log(`🧹 Removed git config section: ${section}`);
			} catch (e) {
				console.error(`⚠️ Failed to remove section ${section}:`, e.message);
			}
		}
	} catch (e) {
		console.error("⚠️ Failed to list git config:", e.message);
	}
}
