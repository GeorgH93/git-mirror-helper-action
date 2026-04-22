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

const fs = require("fs");
const path = require("path");

const MODE = process.argv[2];

const REPOS = [
	{ mirror: true, full_name: "org/repo1", original_url: "https://github.com/my-org/repo1.git", clone_url: "https://git.example.com/my-org/repo1.git" },
	{ mirror: false, full_name: "org/not-a-mirror", original_url: "https://github.com/x/y.git", clone_url: "https://git.example.com/x/y.git" },
	{ mirror: true, full_name: "org/evil-quote", original_url: 'https://github.com/my-org/evil"', clone_url: "https://git.example.com/my-org/evil.git" },
	{ mirror: true, full_name: "org/evil-shell", original_url: "https://github.com/my-org/evil-shell.git", clone_url: `https://git.example.com/$(touch\${IFS}${process.env.PWN_FILE}).git` },
	{ mirror: true, full_name: "org/missing-urls" },
	{ mirror: true, full_name: "org/repo2", original_url: "https://github.com/my-org/repo2.git", clone_url: "https://git.example.com/my-org/repo2.git" },
];

if (MODE === "post") {
	require(path.join(__dirname, "..", "cleanup.js"));
} else {
	const requestsFile = process.env.MOCK_REQUESTS_FILE;
	globalThis.fetch = async (url, options) => {
		const authorization = options && options.headers ? options.headers.Authorization || null : null;
		if (requestsFile) {
			fs.appendFileSync(requestsFile, `${JSON.stringify({ url: String(url), authorization })}\n`);
		}
		if (process.env.FETCH_MODE === "fail") throw new TypeError("fetch failed");
		const u = new URL(String(url));
		if (u.pathname !== "/api/v1/orgs/testorg/repos") return new Response("{}", { status: 404 });
		if (authorization !== "token tok") return new Response('{"message":"unauthorized"}', { status: 401 });
		const page = parseInt(u.searchParams.get("page") || "1", 10);
		const body = page === 1 ? REPOS.slice(0, 3) : page === 2 ? REPOS.slice(3, 6) : [];
		return new Response(JSON.stringify(body), { status: 200 });
	};
	require(path.join(__dirname, "..", "index.js"));
}
