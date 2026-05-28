export function maskKey(key: string): string {
  if (!key) {
    return "";
  }
  if (key.length < 8) {
    return "••••";
  }
  const prefix = key.startsWith("sk-") ? "sk-" : key.slice(0, 2);
  return `${prefix}…${key.slice(-4)}`;
}
