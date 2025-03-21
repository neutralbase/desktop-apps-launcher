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
import treeKill from 'tree-kill';

const execAsync = promisify(exec);

// Process tracking for proper termination
interface ProcessInfo {
  pid: number;
  displayName: string;
  startTime: Date;
}

// Map to track running processes by app name
const runningProcesses: Map<string, ProcessInfo> = new Map();

// App configurations for specific applications
interface AppConfig {
  id: string;
  displayName: string;
  execPath?: {
    darwin?: string;  // Custom path for macOS
    win32?: string;   // Custom path for Windows
    linux?: string;   // Custom path for Linux
  };
  startArgs: string[];
  stopArgs: string[];
}

// Helper function to get the platform-specific executable path
function getExecutablePath(appName: string, config?: AppConfig): string {
  const platform = os.platform();
  
  // For development environment, use electron
  if (process.env.NODE_ENV === 'development') {
    return 'electron';
  }
  
  // Check if the app has custom paths defined
  if (config?.execPath) {
    const customPath = config.execPath[platform as 'darwin' | 'win32' | 'linux'];
    if (customPath) {
      return customPath;
    }
  }
  
  // Otherwise use the default patterns based on platform
  switch (platform) {
    case 'darwin': // macOS
      return `/Applications/${appName}.app/Contents/MacOS/${appName}`;
    case 'win32': // Windows
      return `C:\\Program Files\\${appName}\\${appName}.exe`;
    case 'linux':
      return `/usr/local/bin/${appName.toLowerCase()}`;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// More consistent application configurations
const APP_CONFIGS: Record<string, AppConfig> = {
  'desktop-crawler': {
    id: 'desktop-crawler',
    displayName: 'Desktop Crawler',
    execPath: {
      darwin: '/Applications/Desktop Crawler.app/Contents/MacOS/Desktop Crawler',
      win32: 'C:\\Program Files\\Desktop Crawler\\Desktop Crawler.exe',
      linux: '/usr/local/bin/desktop-crawler'
    },
    startArgs: ['--headless', '--firecrawl-headless'],
    stopArgs: ['--headless', '--stop']
  }
  // Add more app configurations here as needed
};

// Silent debug function to avoid any console output
function debug(...args: any[]) {
    // No-op implementation
}

// Helper function for running processes safely
function safeSpawnAsync(command: string, args: string[], useShell = false): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const proc = spawn(command, args, {
        detached: true,
        shell: useShell,
        stdio: 'ignore' // Use a single value that applies to all streams
      });
      
      proc.on('error', (error: Error) => reject(error));
      
      // Allow a short delay to catch any immediate errors
      setTimeout(() => resolve(), 500);
    } catch (error) {
      reject(error);
    }
  });
}

async function listApplications(): Promise<string[]> {
    try {
        const files = await readdir('/Applications');
        return files
            .filter(file => file.endsWith('.app'))
            .sort();
    } catch (error) {
        return [];
    }
}

async function launchApp(appName: string): Promise<boolean> {
    try {
        const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
        const appPath = join('/Applications', fullAppName);
        await safeSpawnAsync('open', [appPath]);
        return true;
    } catch (error) {
        return false;
    }
}

async function openWithApp(appName: string, filePath: string): Promise<boolean> {
    try {
        const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
        const appPath = join('/Applications', fullAppName);
        await safeSpawnAsync('open', ['-a', appPath, filePath]);
        return true;
    } catch (error) {
        return false;
    }
}

// Function to start an app and automatically stop it after a specified timeout
async function startAppWithTimeout(appName: string, timeoutMs: number = 3600000, customArgs?: string[]): Promise<{success: boolean, message: string}> {
  const startResult = await startApp(appName, customArgs);
  if (!startResult.success) {
    return startResult;
  }
  
  // Schedule stop after the specified timeout
  setTimeout(async () => {
    const stopResult = await stopApp(appName);
    debug(`Timeout reached: stopped ${appName}:`, stopResult.message);
  }, timeoutMs);
  
  return {
    success: startResult.success,
    message: `${startResult.message} (with auto-shutdown in ${Math.round(timeoutMs/60000)} minutes)`
  };
}

// Core function for starting applications that uses process tracking
async function startApp(appName: string, customArgs?: string[]): Promise<{success: boolean, message: string}> {
    try {
        // Check if we have a specific configuration for this app
        const appConfig = APP_CONFIGS[appName.toLowerCase()];
        let execPath: string;
        let args: string[];
        let displayName: string;
        
        if (appConfig) {
            // Use the app-specific configuration
            execPath = getExecutablePath(appConfig.displayName, appConfig);
            args = customArgs ? customArgs : appConfig.startArgs;
            displayName = appConfig.displayName;
        } else {
            // Default behavior for other apps
            displayName = appName;
            execPath = getExecutablePath(appName);
            args = customArgs || [];
        }
        
        // For macOS paths with spaces or any path on any platform
        // We'll use sh -c with complete output redirection to prevent any leakage
        const shellCmd = `"${execPath}" ${args.join(' ')} >/dev/null 2>&1 & echo $!`;
        
        // Use the shell to launch the process and get its PID
        const { stdout } = await execAsync(`sh -c '${shellCmd}'`);
        const pid = parseInt(stdout.trim(), 10);
        
        if (pid && !isNaN(pid)) {
            // Store the process info for later use
            runningProcesses.set(appName.toLowerCase(), {
                pid: pid,
                displayName,
                startTime: new Date()
            });
            
            return {
                success: true,
                message: `${displayName} started successfully`
            };
        } else {
            // Fallback if we couldn't get the PID
            const proc = spawn(execPath, args, {
                detached: true,
                stdio: 'ignore'
            });
            
            // Store the process info for later use
            if (proc.pid) {
                runningProcesses.set(appName.toLowerCase(), {
                    pid: proc.pid,
                    displayName,
                    startTime: new Date()
                });
                
                // Detach the process from the parent
                proc.unref();
            }
            
            return new Promise((resolve) => {
                proc.on('error', (error) => {
                    resolve({
                        success: false,
                        message: `Failed to start ${displayName}: ${error.message}`
                    });
                });
                
                setTimeout(() => {
                    resolve({
                        success: true,
                        message: `${displayName} started successfully`
                    });
                }, 500);
            });
        }
    } catch (error: any) {
        return {
            success: false,
            message: `Failed to start application: ${error.message || 'Unknown error'}`
        };
    }
}

// Function to stop applications using tree-kill
async function stopApp(appName: string): Promise<{success: boolean, message: string, stdout?: string, stderr?: string}> {
    // First, check if we have a PID for this application
    const processInfo = runningProcesses.get(appName.toLowerCase());
    
    if (processInfo) {
        // We have a PID, use tree-kill to terminate the entire process tree
        return new Promise((resolve) => {
            treeKill(processInfo.pid, 'SIGTERM', (err) => {
                if (err) {
                    // If tree-kill fails, try using pkill as fallback
                    resolve(stopAppWithPkill(appName, processInfo.displayName));
                } else {
                    // Successfully killed, remove from tracking
                    runningProcesses.delete(appName.toLowerCase());
                    resolve({
                        success: true,
                        message: `${processInfo.displayName} stopped successfully (PID: ${processInfo.pid})`
                    });
                }
            });
        });
    } else {
        // No PID stored, try using pkill
        return stopAppWithPkill(appName);
    }
}

// Helper function to stop an app using pkill
async function stopAppWithPkill(appName: string, displayName?: string): Promise<{success: boolean, message: string, stdout?: string, stderr?: string}> {
    try {
        const appNameWithoutExt = appName.replace(/\.app$/, '');
        const actualDisplayName = displayName || appName;
        
        // For macOS, try using pkill to find and terminate the process
        if (os.platform() === 'darwin') {
            await safeSpawnAsync('sh', ['-c', `pkill -f "${appNameWithoutExt}" >/dev/null 2>&1`], false);
        } else if (os.platform() === 'win32') {
            await safeSpawnAsync('taskkill', ['/F', '/IM', `${appNameWithoutExt}.exe`], false);
        } else {
            await safeSpawnAsync('pkill', ['-f', appNameWithoutExt], false);
        }
        
        // Remove from tracking regardless of pkill result
        runningProcesses.delete(appName.toLowerCase());
        
        return {
            success: true,
            message: `${actualDisplayName} stopped using system terminate command`
        };
    } catch (pkillError: any) {
        // pkill returns exit code 1 if no processes were killed, which is not a real error
        if (pkillError.code === 1) {
            return {
                success: true,
                message: `No running processes found for ${displayName || appName}`,
            };
        }
        
        return {
            success: false,
            message: `Failed to stop application: ${pkillError.message || 'Unknown error'}`,
            stderr: pkillError.stderr || undefined
        };
    }
}

// Function to get a list of apps that have special configurations
function getConfiguredApps(): string[] {
    return Object.values(APP_CONFIGS).map(config => config.displayName);
}

// Function to list currently running processes that we're tracking
function getRunningApps(): {appName: string, pid: number, startTime: string}[] {
    const result: {appName: string, pid: number, startTime: string}[] = [];
    
    runningProcesses.forEach((info, key) => {
        result.push({
            appName: info.displayName,
            pid: info.pid,
            startTime: info.startTime.toISOString()
        });
    });
    
    return result;
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
    appName: z.string(),
    args: z.array(z.string()).optional()
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

// New schema for listing running apps
const ListRunningAppsOutputSchema = z.object({
    apps: z.array(z.object({
        appName: z.string(),
        pid: z.number(),
        startTime: z.string()
    }))
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
                name: "list_running_apps",
                description: "List applications currently running that were started by this tool",
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
        if (!request.params.arguments && 
            request.params.name !== "list_applications" && 
            request.params.name !== "list_configured_apps" &&
            request.params.name !== "list_running_apps") {
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
            case "list_running_apps": {
                const apps = getRunningApps();
                const result = ListRunningAppsOutputSchema.parse({ apps });
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
                // Call startAppWithTimeout to automatically stop Firecrawl after 1 hour
                const result = await startAppWithTimeout('desktop-crawler', 3600000);  // 3600000ms = 1 hour
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
                // Call stopApp with the desktop-crawler ID
                const result = await stopApp('desktop-crawler');
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
  (async () => {
    try {
      const packageName = '@modelcontextprotocol/desktop-apps-launcher-mcp';
      
      // Check if package.json exists in the current directory
      if (!fs.existsSync('package.json')) {
        // Create a basic package.json file
        fs.writeFileSync('package.json', JSON.stringify({
          name: 'desktop-apps-launcher-local',
          version: '1.0.0',
          private: true
        }, null, 2));
      }
      
      // Use spawn instead of exec
      await safeSpawnAsync('npm', ['install', packageName], true);
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  })();
}

async function runServer() {
    // Set up the stdio transport ensuring nothing else writes to stdio
    const transport = new StdioServerTransport();
    
    // Completely redirect all stderr output to prevent any interference
    process.stderr.write = ((): any => {}) as any;
    
    // Only allow JSON-RPC messages on stdout
    process.stdout.write = function (
      this: NodeJS.WriteStream,
      chunk: string | Buffer,
      encoding?: BufferEncoding,
      callback?: (error: Error | null) => void
    ): boolean {
      // Only pass through if it's likely to be a JSON-RPC message
      if (typeof chunk === 'string' && (chunk.trim().startsWith('{') || chunk.trim().startsWith('['))) {
        // Call the original write method using the proper "this" context
        return process.stdout.constructor.prototype.write.apply(this, arguments as any);
      }
      // Call callback if provided but don't write to stdout
      if (callback) {
        callback(null);
      }
      return true; // Indicate success without actually writing
    } as typeof process.stdout.write;
    
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