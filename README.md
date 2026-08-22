# Git Mirror Helper Action

A GitHub Action that automatically configures git URL rewrite rules for all repositories mirrored by an organization, making it easier to work with mirrors for CI/CD.

## Overview

This action fetches all repositories from a specified organization on your git server and sets up git URL rewrite rules. This allows you to seamlessly work with mirrors without manually configuring each repository's remote URLs.

## Features

- 🔄 Automatically discovers all repositories in an organization
- ⚙️ Sets up git URL rewrite rules for seamless mirror access  
- 🔐 Supports authentication via API tokens
- 📝 Configurable output
- 🧹 Automatic cleanup after workflow completion

## Usage

### Basic Example

```yaml
name: Setup Git Mirrors
on:
  workflow_dispatch:

jobs:
  setup-mirrors:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Git Mirrors
        uses: GeorgH93/git-mirror-helper-action@v2
        with:
          server: 'https://git.example.com'
          org: 'my-organization'
          api_token: ${{ secrets.GITEA_TOKEN }}
      - name: Checkout
        uses: actions/checkout@v4
```

### Archiving the Mirror List

You can use the `git-mirror-list-file` output to archive the generated mirror list file as a workflow artifact:

```yaml
name: Setup Git Mirrors with Archive
on:
  workflow_dispatch:

jobs:
  setup-mirrors:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Git Mirrors
        id: mirrors
        uses: GeorgH93/git-mirror-helper-action@v2
        with:
          server: 'https://git.example.com'
          org: 'my-organization'
          api_token: ${{ secrets.GITEA_TOKEN }}

      - name: Archive mirror list
        uses: actions/upload-artifact@v4
        with:
          name: git-mirror-list
          path: ${{ steps.mirrors.outputs.git-mirror-list-file }}

      - name: Checkout
        uses: actions/checkout@v4
```

### Custom Output File Path

To specify a custom location for the mirror list file:

```yaml
- name: Setup Git Mirrors
  id: mirrors
  uses: GeorgH93/git-mirror-helper-action@v2
  with:
    server: 'https://git.example.com'
    org: 'my-organization'
    output_file: '${{ runner.temp }}/mirrors.ini'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `server` | Base URL of your git server (e.g., `https://git.example.com`) | ✅ Yes | - |
| `org` | Organization name in your git server | ✅ Yes | - |
| `api_token` | API token for authentication (recommended for private repos) | ❌ No | - |
| `use_include` | Write rewrites to a separate include file instead of global config | ❌ No | `true` |
| `output_file` | Custom path for the mirror list file (only used when `use_include` is `true`) | ❌ No | `~/.git-mirrors` |

## Outputs

| Output | Description |
|--------|-------------|
| `git-mirror-list-file` | Path to the mirror list file |

## How It Works

1. **Discovery**: The action connects to your git server and fetches all repositories in the specified organization
2. **Configuration**: It sets up git URL rewrite rules that map GitHub URLs to your git server URLs
3. **Cleanup**: After the workflow completes, the action removes only the configuration entries it added, leaving any pre-existing git configuration untouched

### URL Rewriting

The action creates git URL rewrite rules that transform URLs like:
```
https://github.com/my-org/my-repo.git
```
Into:
```
https://git.example.com/my-org/my-repo.git
```

This allows you to use GitHub URLs in your workflows while actually pulling from your mirror server.

> ⚠️ **Note:** `insteadOf` rewrites apply to **all** git operations, not just clones and fetches. While the rewrites are active, `git push` to the original URLs is also redirected to your mirror server. If you need pushes to reach the original server, remove the rewrites (or the include entry) before pushing, or add [`pushInsteadOf`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-urlltpushInsteadOfgt) rules pointing back to the original URLs.

## Configuration Options

### `use_include` Parameter

- **`true` (default)**: Creates a separate git include file for the rewrite rules, keeping your global git config clean
- **`false`**: Writes the rewrite rules directly to the global git configuration

### Cleanup Behavior

The post step removes **only the configuration this action added** (tracked via the action state between the main and post steps):

- Pre-existing `url.*.insteadOf` entries in your global git config are never touched
- If the configured output file already existed before the action ran, the rewrites are appended to it and the file is **left in place** during cleanup
- Files and include entries created by the action itself are removed automatically

## Authentication

### API Token Setup

For private repositories or to avoid rate limiting, provide an API token:

1. **Gitea/Forgejo**: Generate a token in your server's user settings
2. **GitHub Secrets**: Store the token as a repository secret
3. **Action Input**: Reference the secret in your workflow

```yaml
with:
  api_token: ${{ secrets.GITEA_TOKEN }}
```

### Public Repositories

For public organizations & repositories, the `api_token` parameter is optional, but recommended to avoid potential rate limiting.

## Compatibility

- ✅ **Tested**: Gitea and Forgejo for hosting mirrors
- ⚠️ **Experimental**: Other git servers with compatible APIs
- 🚀 **Runners**: Works on `ubuntu-latest`, `windows-latest`, and `macos-latest`
