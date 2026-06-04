export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }

  try {
    return JSON.stringify(error);
  } catch (_error) {
    return String(error);
  }
}
