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
      let executable;
      switch (platform) {
        case 'darwin': // macOS
          executable = '/Applications/Desktop Crawler.app/Contents/MacOS/Desktop Crawler';
          break;
        case 'win32': // Windows
          executable = 'C:\\Program Files\\Desktop Crawler\\Desktop Crawler.exe';
          break;
        case 'linux':
          executable = '/usr/local/bin/desktop-crawler';
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
      return `"${executable}" --stop`;
    }
  }
};

// Helper functions
async function listApplications(): Promise<string[]> {
    try {
        const files = await readdir('/Applications');
        return files
            .filter(file => file.endsWith('.app'))
            .sort();
    } catch (error) {
        console.error('Error listing applications:', error);
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
        console.error('Error launching application:', error);
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
        console.error('Error opening file with application:', error);
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
            console.log(`Starting ${appConfig.displayName} with configured settings`);
            
            const execPath = appConfig.executablePath ? appConfig.executablePath('') : '';
            const startArgs = appConfig.startArgs ? appConfig.startArgs(args) : (args || []);
            
            console.log(`Command: ${execPath} ${startArgs.join(' ')}`);
            
            const process = spawn(execPath, startArgs, {
                detached: true,
                stdio: 'ignore'
            });
            
            process.unref();
            
            return {
                success: true,
                message: `${appConfig.displayName} started successfully with configured settings`
            };
        } else {
            // Default behavior for other apps
            const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
            const appPath = join('/Applications', fullAppName);
            
            // Get the executable name (usually the app name without .app)
            const executableName = fullAppName.replace(/\.app$/, '');
            const executablePath = join(appPath, 'Contents/MacOS', executableName);
            
            console.log(`Starting application: ${executablePath} ${args ? args.join(' ') : ''}`);
            
            // Spawn the process
            const process = spawn(executablePath, args || [], {
                detached: true, // Allow the process to run independently of its parent
                stdio: 'ignore' // Don't pipe stdin/stdout/stderr to prevent blocking
            });
            
            // Unref the child process to allow the parent to exit independently
            process.unref();
            
            return {
                success: true,
                message: `Application ${appName} started successfully${args ? ' with arguments: ' + args.join(' ') : ''}`
            };
        }
    } catch (error) {
        console.error('Error starting application:', error);
        return {
            success: false,
            message: `Failed to start application: ${error}`
        };
    }
}

async function stopApp(appName: string): Promise<{success: boolean, message: string, stdout?: string, stderr?: string}> {
    try {
        // Check if we have a specific configuration for this app
        const appConfig = APP_CONFIGS[appName.toLowerCase()];
        
        if (appConfig && appConfig.stopCommand) {
            // Use the app-specific stop command
            console.log(`Stopping ${appConfig.displayName} with configured command`);
            
            const stopCommand = appConfig.stopCommand('');
            console.log(`Command: ${stopCommand}`);
            
            const { stdout, stderr } = await execAsync(stopCommand);
            
            return {
                success: true,
                message: `${appConfig.displayName} stopped successfully using configured command`,
                stdout: stdout || undefined,
                stderr: stderr || undefined
            };
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
        
        console.error('Error stopping application:', error);
        return {
            success: false,
            message: `Failed to stop application: ${error.message}`,
            stderr: error.stderr || undefined
        };
    }
}

// Function to get a list of apps that have special configurations
function getConfiguredApps(): string[] {
    return Object.values(APP_CONFIGS).map(config => config.displayName);
}

const server = new Server({
    name: "mac-launcher",
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
                return { toolResult: ListApplicationsOutputSchema.parse({ applications: apps }) };
            }
            case "launch_app": {
                const args = LaunchAppInputSchema.parse(request.params.arguments);
                const success = await launchApp(args.appName);
                return {
                    toolResult: LaunchAppOutputSchema.parse({
                        success,
                        message: success ? 'Application launched successfully' : 'Failed to launch application'
                    })
                };
            }
            case "open_with_app": {
                const args = OpenWithAppInputSchema.parse(request.params.arguments);
                const success = await openWithApp(args.appName, args.filePath);
                return {
                    toolResult: OpenWithAppOutputSchema.parse({
                        success,
                        message: success ? 'File opened successfully' : 'Failed to open file with application'
                    })
                };
            }
            case "start_app": {
                const args = StartAppInputSchema.parse(request.params.arguments);
                const result = await startApp(args.appName, args.args);
                return {
                    toolResult: StartAppOutputSchema.parse(result)
                };
            }
            case "stop_app": {
                const args = StopAppInputSchema.parse(request.params.arguments);
                const result = await stopApp(args.appName);
                return {
                    toolResult: StopAppOutputSchema.parse(result)
                };
            }
            case "list_configured_apps": {
                const apps = getConfiguredApps();
                return { 
                    toolResult: ListConfiguredAppsOutputSchema.parse({ apps }) 
                };
            }
            case "start_firecrawl": {
                const startArgs = ['--headless', '--firecrawl-headless'];
                const result = await startApp('firecrawl', startArgs);
                return {
                    toolResult: StartAppOutputSchema.parse(result)
                };
            }
            case "stop_firecrawl": {
                const result = await stopApp('firecrawl');
                return {
                    toolResult: StopAppOutputSchema.parse(result)
                };
            }
            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new Error("Invalid arguments");
        }
        throw error;
    }
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Mac Launcher MCP Server running on stdio");
}

runServer().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});