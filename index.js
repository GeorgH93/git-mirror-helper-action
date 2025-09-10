#!/usr/bin/env node
import { execSync } from "child_process";
import fetch from "node-fetch";

const SERVER_URL = process.env.INPUT_SERVER;
const ORG = process.env.INPUT_ORG;
const API_TOKEN = process.env.INPUT_API_TOKEN;

function stripGitSuffix(url) {
  return url.endsWith(".git") ? url.slice(0, -4) : url;
}

async function main() {
  if (!SERVER_URL || !ORG) {
    console.error("❌ Missing required inputs: server, org");
    process.exit(1);
  }

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

  for (const repo of repos) {
    if (repo.mirror) {
      console.log(`➡️ Mirror repo found: ${repo.full_name}`);

      const oldUrl = stripGitSuffix(repo.clone_url);
      const newUrl = stripGitSuffix(repo.clone_url); // force HTTPS

      console.log(`   Adding rewrite: ${newUrl} insteadOf ${oldUrl}`);

      try {
        execSync(
          `git config --global url."${newUrl}".insteadOf "${oldUrl}"`,
          { stdio: "inherit" }
        );
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
