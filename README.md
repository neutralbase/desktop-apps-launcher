# Desktop Apps Launcher MCP Server

A Model Context Protocol (MCP) server for launching and managing Desktop applications.

## Features

- List all applications installed in the `/Applications` folder

- Launch applications by name

- Open files with specific applications

- Start applications with optional command-line arguments

- Stop running applications

## Installation

Add the following to your Claude Config JSON file

```
{
  "mcpServers": {
    "simulator": {
      "command": "npx",
      "args": [
        "y",
        "@neutralbase/desktop-apps-launcher-mcp"
      ]
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
