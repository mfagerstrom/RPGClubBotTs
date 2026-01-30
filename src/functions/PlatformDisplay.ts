export function formatPlatformDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (name === "PC (Microsoft Windows)") return "PC/Win";
  return name;
}
