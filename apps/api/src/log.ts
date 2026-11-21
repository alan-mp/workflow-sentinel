// One JSON object per log line, so Workers Logs can filter on fields instead of parsing text.

export function logError(message: string, error: unknown, fields: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      level: 'error',
      message,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...fields,
    }),
  );
}

export function logInfo(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', message, ...fields }));
}
