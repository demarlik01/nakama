export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(component: string, context?: LogContext): Logger;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(
  component: string,
  defaultContext: LogContext = {},
): Logger {
  const threshold = parseLevel(process.env.LOG_LEVEL ?? 'info');

  const write = (level: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[threshold]) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level,
      component,
      message,
      ...defaultContext,
      ...(context ?? {}),
    };

    // Structured logs keep Slack/API/session traces queryable in production.
    console.log(JSON.stringify(payload));
  };

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
    child: (childComponent, context) =>
      createLogger(`${component}:${childComponent}`, {
        ...defaultContext,
        ...(context ?? {}),
      }),
  };
}

function parseLevel(input: string): LogLevel {
  if (input === 'debug' || input === 'info' || input === 'warn' || input === 'error') {
    return input;
  }
  return 'info';
}
