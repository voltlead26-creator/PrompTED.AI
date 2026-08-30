export interface ProtectedNavItem {
  href: string;
  label: string;
  icon: string;
  activePrefixes: readonly string[];
  excludedPrefixes?: readonly string[];
}

export const PROTECTED_NAV_ITEMS: readonly ProtectedNavItem[] = [
  { href: "/home", label: "Home", icon: "home", activePrefixes: ["/home"] },
  {
    href: "/workspace",
    label: "Master Workspace",
    icon: "file-pencil",
    activePrefixes: ["/workspace", "/outcomes"],
  },
  { href: "/library", label: "My Work", icon: "folders", activePrefixes: ["/library"] },
  {
    href: "/plans",
    label: "Checklists / Action Plans",
    icon: "list-check",
    activePrefixes: ["/plans"],
  },
  { href: "/roles", label: "Find a Job", icon: "briefcase", activePrefixes: ["/roles"] },
  {
    href: "/settings/profile",
    label: "Profile",
    icon: "user-circle",
    activePrefixes: ["/settings/profile"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "settings",
    activePrefixes: ["/settings"],
    excludedPrefixes: ["/settings/profile"],
  },
] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedNavItemActive(item: ProtectedNavItem, pathname: string): boolean {
  if (item.excludedPrefixes?.some((prefix) => matchesPrefix(pathname, prefix))) return false;
  return item.activePrefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

export function pageTitleForProtectedPath(pathname: string): string | null {
  if (matchesPrefix(pathname, "/home")) return null;
  if (matchesPrefix(pathname, "/create")) return "Create";
  const match = PROTECTED_NAV_ITEMS.find((item) => isProtectedNavItemActive(item, pathname));
  return match?.label ?? null;
}
