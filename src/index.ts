#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as os from 'os';
import * as fs from 'fs';

const execAsync = promisify(exec);

// App configurations for specific applications
interface AppConfig {
  name: string;
  displayName: string;
  path?: string;
  executablePath?: (appPath: string) => string;
  startArgs?: (customArgs?: string[]) => string[];
  stopCommand?: (appPath: string) => string;
}

const APP_CONFIGS: Record<string, AppConfig> = {
  'firecrawl': {
    name: 'firecrawl',
    displayName: 'Firecrawl',
    executablePath: () => {
      const platform = os.platform();
      if (process.env.NODE_ENV === 'development') {
        return 'electron';
      }
      switch (platform) {
        case 'darwin': // macOS
          return '/Applications/Desktop Crawler.app/Contents/MacOS/Desktop Crawler';
        case 'win32': // Windows
          return 'C:\\Program Files\\Desktop Crawler\\Desktop Crawler.exe';
        case 'linux':
          return '/usr/local/bin/desktop-crawler';
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
    },
    startArgs: (customArgs?: string[]) => {
      const args = ['--headless', '--firecrawl-headless'];
      if (customArgs && customArgs.length > 0) {
        args.push(...customArgs);
      }
      return args;
    },
    stopCommand: () => {
      const platform = os.platform();
      switch (platform) {
        case 'darwin': // macOS
          // Use the path without escaping spaces since we'll quote it properly
          return '/Applications/Desktop Crawler.app/Contents/MacOS/Desktop Crawler --stop';
        case 'win32': // Windows
          return '"C:\\Program Files\\Desktop Crawler\\Desktop Crawler.exe" --stop';
        case 'linux':
          return '/usr/local/bin/desktop-crawler --stop';
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
    }
  }
};

// Update console logging to use stderr for all debug output
function debug(...args: any[]) {
    // No-op implementation - do not log to stderr or stdout
    // This prevents interference with JSON-RPC communication
}

async function listApplications(): Promise<string[]> {
    try {
        const files = await readdir('/Applications');
        return files
            .filter(file => file.endsWith('.app'))
            .sort();
    } catch (error) {
        // debug('Error listing applications:', error);
        return [];
    }
}

async function launchApp(appName: string): Promise<boolean> {
    try {
        const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
        const appPath = join('/Applications', fullAppName);
        await execAsync(`open "${appPath}"`);
        return true;
    } catch (error) {
        // debug('Error launching application:', error);
        return false;
    }
}

async function openWithApp(appName: string, filePath: string): Promise<boolean> {
    try {
        const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
        const appPath = join('/Applications', fullAppName);
        await execAsync(`open -a "${appPath}" "${filePath}"`);
        return true;
    } catch (error) {
        // debug('Error opening file with application:', error);
        return false;
    }
}

// Helper functions for starting and stopping applications
async function startApp(appName: string, args?: string[]): Promise<{success: boolean, message: string}> {
    try {
        // Check if we have a specific configuration for this app
        const appConfig = APP_CONFIGS[appName.toLowerCase()];
        
        if (appConfig) {
            // Use the app-specific configuration
            
            const execPath = appConfig.executablePath ? appConfig.executablePath('') : '';
            const startArgs = appConfig.startArgs ? appConfig.startArgs(args) : (args || []);
            
            if (execPath.includes(' ') && os.platform() === 'darwin') {
                // For macOS with spaces in path, use exec instead of spawn
                const cmdWithArgs = `"${execPath}" ${startArgs.join(' ')}`;
                
                try {
                    // Use execSync instead to avoid TypeScript issues with execAsync
                    const { exec } = require('child_process');
                    exec(cmdWithArgs, { 
                        detached: true,
                        stdio: 'ignore' 
                    });
                    return {
                        success: true,
                        message: `${appConfig.displayName} started successfully with configured settings`
                    };
                } catch (execError) {
                    return {
                        success: false,
                        message: `Failed to start ${appConfig.displayName}: ${execError instanceof Error ? execError.message : 'Unknown error'}`
                    };
                }
            } else {
                // Use spawn for other cases
                const process = spawn(execPath, startArgs, {
                    detached: true, // Allow the process to run independently of its parent
                    stdio: 'ignore' // Don't pipe stdin/stdout/stderr to prevent blocking
                });
                
                process.unref();
                
                // Wait briefly to check for immediate failures
                return new Promise((resolve) => {
                    process.on('error', (error) => {
                        resolve({
                            success: false,
                            message: `Failed to start ${appConfig.displayName}: ${error.message}`
                        });
                    });
                    
                    // Short delay to check for immediate failures
                    setTimeout(() => {
                        resolve({
                            success: true,
                            message: `${appConfig.displayName} started successfully with configured settings`
                        });
                    }, 500);
                });
            }
        } else {
            // Default behavior for other apps
            const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
            const appPath = join('/Applications', fullAppName);
            
            // Get the executable name (usually the app name without .app)
            const executableName = fullAppName.replace(/\.app$/, '');
            const executablePath = join(appPath, 'Contents/MacOS', executableName);
            
            if (executablePath.includes(' ')) {
                // For paths with spaces, use exec instead of spawn
                const cmdWithArgs = `"${executablePath}" ${args ? args.join(' ') : ''}`;
                
                try {
                    // Use exec instead to avoid TypeScript issues with execAsync
                    const { exec } = require('child_process');
                    exec(cmdWithArgs, { 
                        detached: true,
                        stdio: 'ignore' 
                    });
                    return {
                        success: true,
                        message: `Application ${appName} started successfully${args ? ' with arguments: ' + args.join(' ') : ''}`
                    };
                } catch (execError) {
                    return {
                        success: false,
                        message: `Failed to start ${appName}: ${execError instanceof Error ? execError.message : 'Unknown error'}`
                    };
                }
            } else {
                // Spawn the process
                const process = spawn(executablePath, args || [], {
                    detached: true, // Allow the process to run independently of its parent
                    stdio: 'ignore' // Don't pipe stdin/stdout/stderr to prevent blocking
                });
                
                // Unref the child process to allow the parent to exit independently
                process.unref();
                
                // Wait briefly to check for immediate failures
                return new Promise((resolve) => {
                    process.on('error', (error) => {
                        resolve({
                            success: false,
                            message: `Failed to start ${appName}: ${error.message}`
                        });
                    });
                    
                    // Short delay to check for immediate failures
                    setTimeout(() => {
                        resolve({
                            success: true,
                            message: `Application ${appName} started successfully${args ? ' with arguments: ' + args.join(' ') : ''}`
                        });
                    }, 500);
                });
            }
        }
    } catch (error: any) {
        return {
            success: false,
            message: `Failed to start application: ${error.message || 'Unknown error'}`
        };
    }
}

async function stopApp(appName: string): Promise<{success: boolean, message: string, stdout?: string, stderr?: string}> {
    try {
        // Check if we have a specific configuration for this app
        const appConfig = APP_CONFIGS[appName.toLowerCase()];
        
        if (appConfig && appConfig.stopCommand) {
            // Use the app-specific stop command
            
            const stopCommand = appConfig.stopCommand('');
            
            // For macOS paths with spaces, use quotes on the path
            if (os.platform() === 'darwin' && stopCommand.includes('/Applications/') && stopCommand.includes(' ')) {
                // Extract the path and args
                const parts = stopCommand.split(' --');
                if (parts.length > 1) {
                    const path = parts[0];
                    const args = `--${parts[1]}`;
                    
                    try {
                        const { stdout, stderr } = await execAsync(`"${path}" ${args}`);
                        return {
                            success: true,
                            message: `${appConfig.displayName} stopped successfully using configured command`,
                            stdout: stdout || undefined,
                            stderr: stderr || undefined
                        };
                    } catch (error: any) {
                        return {
                            success: false,
                            message: `Failed to stop ${appConfig.displayName}: ${error.message || 'Unknown error'}`,
                            stderr: error.stderr || undefined
                        };
                    }
                }
            }
            
            // Standard execution for other platforms or formats
            try {
                const { stdout, stderr } = await execAsync(stopCommand);
                return {
                    success: true,
                    message: `${appConfig.displayName} stopped successfully using configured command`,
                    stdout: stdout || undefined,
                    stderr: stderr || undefined
                };
            } catch (error: any) {
                return {
                    success: false,
                    message: `Failed to stop ${appConfig.displayName}: ${error.message || 'Unknown error'}`,
                    stderr: error.stderr || undefined
                };
            }
        } else {
            // Default behavior using pkill
            const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
            const appNameWithoutExt = fullAppName.replace(/\.app$/, '');
            
            // Use pkill to kill the process by name
            const { stdout, stderr } = await execAsync(`pkill -f "${appNameWithoutExt}"`);
            
            return {
                success: true,
                message: `Application ${appName} stopped successfully`,
                stdout: stdout || undefined,
                stderr: stderr || undefined
            };
        }
    } catch (error: any) {
        // pkill returns exit code 1 if no processes were killed, which throws an error in execAsync
        // If the error is that no processes matched, we'll consider this a "success" with a warning
        if (error.code === 1) {
            return {
                success: true,
                message: `No running processes found for ${appName}`,
            };
        }
        
        return {
            success: false,
            message: `Failed to stop application: ${error.message || 'Unknown error'}`,
            stderr: error.stderr || undefined
        };
    }
}

// Function to get a list of apps that have special configurations
function getConfiguredApps(): string[] {
    return Object.values(APP_CONFIGS).map(config => config.displayName);
}

const server = new Server({
    name: "desktop-launcher",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {}
    }
});

// Define schemas
const ListApplicationsOutputSchema = z.object({
    applications: z.array(z.string())
});

const LaunchAppInputSchema = z.object({
    appName: z.string()
});

const LaunchAppOutputSchema = z.object({
    success: z.boolean(),
    message: z.string()
});

const OpenWithAppInputSchema = z.object({
    appName: z.string(),
    filePath: z.string()
});

const OpenWithAppOutputSchema = z.object({
    success: z.boolean(),
    message: z.string()
});

// New schemas for start and stop app
const StartAppInputSchema = z.object({
    appName: z.string(),
    args: z.array(z.string()).optional()
});

const StartAppOutputSchema = z.object({
    success: z.boolean(),
    message: z.string()
});

const StopAppInputSchema = z.object({
    appName: z.string()
});

const StopAppOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    stdout: z.string().optional(),
    stderr: z.string().optional()
});

// New schema for listing configured apps
const ListConfiguredAppsOutputSchema = z.object({
    apps: z.array(z.string())
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "list_applications",
                description: "List all applications installed in the /Applications folder",
                inputSchema: zodToJsonSchema(z.object({}))
            },
            {
                name: "launch_app",
                description: "Launch a Mac application by name",
                inputSchema: zodToJsonSchema(LaunchAppInputSchema)
            },
            {
                name: "open_with_app",
                description: "Open a file or folder with a specific application",
                inputSchema: zodToJsonSchema(OpenWithAppInputSchema)
            },
            {
                name: "start_app",
                description: "Start a Mac application by directly executing its binary with optional arguments",
                inputSchema: zodToJsonSchema(StartAppInputSchema)
            },
            {
                name: "stop_app",
                description: "Stop a running Mac application",
                inputSchema: zodToJsonSchema(StopAppInputSchema)
            },
            {
                name: "list_configured_apps",
                description: "List applications with specific configurations",
                inputSchema: zodToJsonSchema(z.object({}))
            },
            {
                name: "start_firecrawl",
                description: "Start Firecrawl services in headless mode",
                inputSchema: zodToJsonSchema(z.object({}))
            },
            {
                name: "stop_firecrawl",
                description: "Stop running Firecrawl services",
                inputSchema: zodToJsonSchema(z.object({}))
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        if (!request.params.arguments && request.params.name !== "list_applications" && 
            request.params.name !== "list_configured_apps") {
            throw new Error("Arguments are required");
        }

        switch (request.params.name) {
            case "list_applications": {
                const apps = await listApplications();
                const result = ListApplicationsOutputSchema.parse({ applications: apps });
                return { 
                    toolResult: result,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result)
                        }
                    ]
                };
            }
            case "launch_app": {
                const args = LaunchAppInputSchema.parse(request.params.arguments);
                const success = await launchApp(args.appName);
                const result = LaunchAppOutputSchema.parse({
                    success,
                    message: success ? 'Application launched successfully' : 'Failed to launch application'
                });
                return {
                    toolResult: result,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result)
                        }
                    ]
                };
            }
            case "open_with_app": {
                const args = OpenWithAppInputSchema.parse(request.params.arguments);
                const success = await openWithApp(args.appName, args.filePath);
                const result = OpenWithAppOutputSchema.parse({
                    success,
                    message: success ? 'File opened successfully' : 'Failed to open file with application'
                });
                return {
                    toolResult: result,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result)
                        }
                    ]
                };
            }
            case "start_app": {
                const args = StartAppInputSchema.parse(request.params.arguments);
                const result = await startApp(args.appName, args.args);
                const parsedResult = StartAppOutputSchema.parse(result);
                return {
                    toolResult: parsedResult,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(parsedResult)
                        }
                    ]
                };
            }
            case "stop_app": {
                const args = StopAppInputSchema.parse(request.params.arguments);
                const result = await stopApp(args.appName);
                const parsedResult = StopAppOutputSchema.parse(result);
                return {
                    toolResult: parsedResult,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(parsedResult)
                        }
                    ]
                };
            }
            case "list_configured_apps": {
                const apps = getConfiguredApps();
                const result = ListConfiguredAppsOutputSchema.parse({ apps });
                return { 
                    toolResult: result,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result)
                        }
                    ]
                };
            }
            case "start_firecrawl": {
                const startArgs = ['--headless', '--firecrawl-headless'];
                const result = await startApp('firecrawl', startArgs);
                const parsedResult = StartAppOutputSchema.parse(result);
                return {
                    toolResult: parsedResult,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(parsedResult)
                        }
                    ]
                };
            }
            case "stop_firecrawl": {
                const result = await stopApp('firecrawl');
                const parsedResult = StopAppOutputSchema.parse(result);
                return {
                    toolResult: parsedResult,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(parsedResult)
                        }
                    ]
                };
            }
            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Invalid arguments: ${error.message}`
                    }
                ]
            };
        }
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            ]
        };
    }
});

// Install command handler for local installation
if (process.argv[2] === 'install') {
  try {
    const packageName = '@modelcontextprotocol/desktop-apps-launcher-mcp';
    // No debug/console output
    
    // Check if package.json exists in the current directory
    if (!fs.existsSync('package.json')) {
      // Create a basic package.json file
      fs.writeFileSync('package.json', JSON.stringify({
        name: 'desktop-apps-launcher-local',
        version: '1.0.0',
        private: true
      }, null, 2));
    }
    
    execAsync(`npm install ${packageName}`).then(() => {
      process.exit(0);
    }).catch(() => {
      process.exit(1);
    });
  } catch (error) {
    process.exit(1);
  }
}

async function runServer() {
    const transport = new StdioServerTransport();
    
    await server.connect(transport);
    
    // Keep the process alive and handle interruption gracefully
    process.stdin.resume();
    
    process.on('SIGINT', () => {
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        process.exit(0);
    });
}

runServer().catch(() => {
    // Silent error handling to avoid interfering with JSON-RPC
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});