import { isTauriEnvironment } from './tauri';
import * as fs from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

const LOG_DIR = 'logs';
const LOG_FILE = `${LOG_DIR}/app.log`;

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }

  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function append(level: 'LOG' | 'ERROR', message: string, error?: unknown): Promise<void> {
  const timestamp = new Date().toISOString();
  const suffix = error === undefined ? '' : ` | ${serializeError(error)}`;
  const line = `[${timestamp}] [${level}] ${message}${suffix}\n`;

  if (level === 'ERROR') {
    console.error(message, error);
  } else {
    console.log(message);
  }

  if (!isTauriEnvironment()) return;

  try {
    await fs.mkdir(LOG_DIR, {
      baseDir: fs.BaseDirectory.AppData,
      recursive: true,
    });

    // append=true avoids repeatedly reading and rewriting the entire log file.
    await fs.writeTextFile(LOG_FILE, line, {
      baseDir: fs.BaseDirectory.AppData,
      append: true,
    });
  } catch (logError) {
    // Logging must never break the application.
    console.error('[FlowDown] Failed to append application log', logError);
  }
}

export const logger = {
  log: (message: string) => append('LOG', message),
  error: (message: string, error?: unknown) => append('ERROR', message, error),

  openLogDirectory: async () => {
    if (!isTauriEnvironment()) return;

    try {
      const appData = await appDataDir();
      const logPath = await join(appData, LOG_DIR);
      await fs.mkdir(LOG_DIR, {
        baseDir: fs.BaseDirectory.AppData,
        recursive: true,
      });

      // Open the actual logs directory. The opener capability explicitly
      // scopes this path under $APPDATA; using openPath here makes Windows
      // Explorer open the directory itself rather than revealing its parent.
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(logPath);
    } catch (error) {
      console.error('[FlowDown] Failed to open log directory', error);
    }
  },
};
