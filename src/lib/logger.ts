export function logInfo(message: string, meta?: unknown) {
  console.log("[INFO]", message, meta ?? "");
}

export function logError(message: string, meta?: unknown) {
  console.error("[ERROR]", message, meta ?? "");
}
