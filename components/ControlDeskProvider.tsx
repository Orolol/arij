"use client";
import { usePathname } from "next/navigation";
import { ControlDeskContextProvider, useControlDeskResource } from "@/hooks/useControlDesk";
export function ControlDeskProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const value = useControlDeskResource(pathname === "/" || /^\/projects\/[^/]+$/.test(pathname));
  return <ControlDeskContextProvider value={value}>{children}</ControlDeskContextProvider>;
}
