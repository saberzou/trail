import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve Tailwind conflicts. Used by every
 * shadcn/ui primitive — keep it here so the `@/lib/utils` alias resolves.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
