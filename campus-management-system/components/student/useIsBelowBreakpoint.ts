"use client";

import { useIsBelowBreakpointValue } from "@/lib/useIsBelowBreakpoint";

export function useIsBelowBreakpoint(breakpoint = 1024) {
  return useIsBelowBreakpointValue(breakpoint);
}
