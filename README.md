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
        uses: GeorgH93/git-mirror-helper-action@v1
        with:
          server: 'https://git.example.com'
          org: 'my-organization'
          api_token: ${{ secrets.GITEA_TOKEN }}
      - name: Checkout
        uses: actions/checkout@v4
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `server` | Base URL of your git server (e.g., `https://git.example.com`) | ✅ Yes | - |
| `org` | Organization name in your git server | ✅ Yes | - |
| `api_token` | API token for authentication (recommended for private repos) | ❌ No | - |
| `use_include` | Write rewrites to a separate include file instead of global config | ❌ No | `true` |

## How It Works

1. **Discovery**: The action connects to your git server and fetches all repositories in the specified organization
2. **Configuration**: It sets up git URL rewrite rules that map GitHub URLs to your git server URLs
3. **Cleanup**: After the workflow completes, the action automatically cleans up the configuration

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

## Configuration Options

### `use_include` Parameter

- **`true` (default)**: Creates a separate git include file for the rewrite rules, keeping your global git config clean
- **`false`**: Writes the rewrite rules directly to the global git configuration

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
