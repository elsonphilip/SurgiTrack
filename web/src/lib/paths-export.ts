// Re-exports for scripts (keeps scripts independent of the app's server-only modules).
import { LEVELS } from "./scoring";
export * from "./paths";
export const LEVELS_TOL: Record<number, number> = Object.fromEntries(LEVELS.map((l) => [l.level, l.toleranceMm]));
