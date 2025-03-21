#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as os from 'os';
import * as fs from 'fs';
const execAsync = promisify(exec);
// Helper function to get the platform-specific executable path
function getExecutablePath(appName, config) {
    const platform = os.platform();
    // For development environment, use electron
    if (process.env.NODE_ENV === 'development') {
        return 'electron';
    }
    // Check if the app has custom paths defined
    if (config?.execPath) {
        const customPath = config.execPath[platform];
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
const APP_CONFIGS = {
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
    // Add more app configurations here as needed, example below
    //   'my-app': {
    //   id: 'my-app',
    //   displayName: 'My Application',
    //   // Only specify custom paths if the app doesn't follow conventions
    //   execPath: {
    //     darwin: '/Applications/CustomPath/MyApp.app/Contents/MacOS/MyCustomBinary'
    //   },
    //   startArgs: ['--special-flag', '--headless'],
    //   stopArgs: ['--cleanup', '--exit']
};
// Silent debug function to avoid any console output
function debug(...args) {
    // No-op implementation
}
// Helper function for running processes safely
function safeSpawnAsync(command, args, useShell = false) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            detached: true,
            shell: useShell, // set to true if you need shell processing
            stdio: ['ignore', 'ignore', 'ignore']
        });
        proc.on('error', (err) => reject(err));
        // Allow a short delay to catch any immediate errors
        setTimeout(() => resolve(), 500);
    });
}
async function listApplications() {
    try {
        const files = await readdir('/Applications');
        return files
            .filter(file => file.endsWith('.app'))
            .sort();
    }
    catch (error) {
        return [];
    }
}
async function launchApp(appName) {
    try {
        const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
        const appPath = join('/Applications', fullAppName);
        await safeSpawnAsync('open', [appPath]);
        return true;
    }
    catch (error) {
        return false;
    }
}
async function openWithApp(appName, filePath) {
    try {
        const fullAppName = appName.endsWith('.app') ? appName : `${appName}.app`;
        const appPath = join('/Applications', fullAppName);
        await safeSpawnAsync('open', ['-a', appPath, filePath]);
        return true;
    }
    catch (error) {
        return false;
    }
}
// Core function for launching applications with specific arguments
async function launchAppProcess(appName, isStop, customArgs) {
    try {
        // Check if we have a specific configuration for this app
        const appConfig = APP_CONFIGS[appName.toLowerCase()];
        let execPath;
        let args;
        let displayName;
        if (appConfig) {
            // Use the app-specific configuration
            execPath = getExecutablePath(appConfig.displayName, appConfig);
            args = customArgs ? customArgs : (isStop ? appConfig.stopArgs : appConfig.startArgs);
            displayName = appConfig.displayName;
        }
        else {
            // Default behavior for other apps
            displayName = appName;
            execPath = getExecutablePath(appName);
            args = customArgs || (isStop ? ['--quit'] : []);
        }
        if (execPath.includes(' ') && os.platform() === 'darwin') {
            // For macOS paths with spaces
            await safeSpawnAsync(execPath, args, true);
            return {
                success: true,
                message: `${displayName} ${isStop ? 'stopped' : 'started'} successfully`
            };
        }
        else {
            const proc = spawn(execPath, args, {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore']
            });
            if (!isStop) {
                proc.unref(); // Only unref for start operations
            }
            return new Promise((resolve) => {
                proc.on('error', (error) => {
                    resolve({
                        success: false,
                        message: `Failed to ${isStop ? 'stop' : 'start'} ${displayName}: ${error.message}`
                    });
                });
                setTimeout(() => {
                    resolve({
                        success: true,
                        message: `${displayName} ${isStop ? 'stopped' : 'started'} successfully`
                    });
                }, 500);
            });
        }
    }
    catch (error) {
        // For stop operations, try pkill as fallback
        if (isStop) {
            try {
                const appNameNoExt = appName.replace(/\.app$/, '');
                await safeSpawnAsync('pkill', ['-f', appNameNoExt]);
                return {
                    success: true,
                    message: `Application ${appName} stopped using pkill`
                };
            }
            catch (pkillError) {
                // pkill returns exit code 1 if no processes were killed, which is not a real error
                if (pkillError.code === 1) {
                    return {
                        success: true,
                        message: `No running processes found for ${appName}`,
                    };
                }
            }
        }
        return {
            success: false,
            message: `Failed to ${isStop ? 'stop' : 'start'} application: ${error.message || 'Unknown error'}`,
            stderr: error.stderr || undefined
        };
    }
}
// Simplified wrapper for starting applications
async function startApp(appName, customArgs) {
    return launchAppProcess(appName, false, customArgs);
}
// Simplified wrapper for stopping applications
async function stopApp(appName, customArgs) {
    return launchAppProcess(appName, true, customArgs);
}
// Function to get a list of apps that have special configurations
function getConfiguredApps() {
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
                const result = await stopApp(args.appName, args.args);
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
                // Call startApp with the desktop-crawler ID
                const result = await startApp('desktop-crawler');
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
    }
    catch (error) {
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
        }
        catch (error) {
            process.exit(1);
        }
    })();
}
async function runServer() {
    // Set up the stdio transport ensuring nothing else writes to stdio
    const transport = new StdioServerTransport();
    // Redirect any uncaught errors to a null stream to prevent breaking JSON-RPC
    process.stderr.write = (() => { });
    process.stdout.write = function (chunk, encoding, callback) {
        // Only pass through if it's likely to be a JSON-RPC message
        if (typeof chunk === 'string' && (chunk.trim().startsWith('{') || chunk.trim().startsWith('['))) {
            // Call the original write method using the proper "this" context and arguments
            return process.stdout.constructor.prototype.write.apply(this, arguments);
        }
        return true; // Ignore any other writes
    };
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
