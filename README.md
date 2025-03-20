# Desktop Apps Launcher MCP Server

A Model Context Protocol (MCP) server for launching and managing Desktop applications.

## Features

- List all applications installed in the `/Applications` folder

- Launch applications by name

- Open files with specific applications

- Start applications with optional command-line arguments

- Stop running applications

## Installation

### Option 1: Using npx (recommended)

Add the following to your Claude Config JSON file:

```json
{
  "mcpServers": {
    "desktop-apps-launcher-mcp": {
      "command": "npx",
      "args": ["--yes", "@neutralbase/desktop-apps-launcher-mcp"]
    }
  }
}
```

The server key (`desktop-apps-launcher-mcp`) must match the binary name in the package.

### Option 2: Global Installation

You can install the package globally:

```bash
npm install -g @neutralbase/desktop-apps-launcher-mcp
```

Then add this to your Claude Config JSON file:

```json
{
  "mcpServers": {
    "desktop-apps-launcher-mcp": {
      "command": "desktop-apps-launcher-mcp",
      "args": []
    }
  }
}
```

## Available Tools

### list_applications

Lists all applications in the `/Applications` folder.

### launch_app

Launches a macOS application using the standard `open` command.

Input:

```json
{
  "appName": "Safari"
}
```

### open_with_app

Opens a file or folder with a specific application.

Input:

```json
{
  "appName": "TextEdit",
  "filePath": "/path/to/document.txt"
}
```

### start_app

Starts an application by directly executing its binary with optional arguments.
This provides more control than the standard `launch_app` tool.

Input:

```json
{
  "appName": "Safari",
  "args": ["--new-window", "https://example.com"]
}
```

### stop_app

Stops a running application.

Input:

```json
{
  "appName": "Safari"
}
```

### list_configured_apps

Lists applications that have special configurations built into the server.

### Special Application Support

#### Firecrawl (Desktop Crawler)

The server includes specialized tools for Desktop Crawler (Firecrawl):

### start_firecrawl

Starts Firecrawl services in headless mode.

Input:

```json
{}
```

This is equivalent to calling `start_app` with:

```json
{
  "appName": "firecrawl",
  "args": ["--headless", "--firecrawl-headless"]
}
```

### stop_firecrawl

Stops running Firecrawl services.

Input:

```json
{}
```

## Troubleshooting

### Setting up Claude Desktop

1. Find your Claude Desktop configuration file:

   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the MCP server configuration (using either installation method above)

3. Make sure you have Node.js installed on your system

   - You can verify this by running `node --version` in your terminal

4. Restart Claude Desktop

### Common Issues

- **Missing hammer icon**: Make sure you've restarted Claude Desktop after configuration
  changes

- **"Client closed" error**: Check Claude's logs for details
  (`~/Library/Logs/Claude/mcp*.log`)

- **Failed tool calls**: Ensure you have the proper permissions for the applications
  you're trying to control

- **Binary not found**: Make sure you're using the correct server key in your
  configuration (must match the binary name)

- **npx errors**: Try installing globally instead (`npm install -g
  @neutralbase/desktop-apps-launcher-mcp`)

## Compatibility

This server is compatible with both MCP protocol v0.x and v1.x, providing backward
compatibility with older clients while supporting newer features.
