"use client";

import { useEffect, useState } from "react";

export function useIsBelowBreakpoint(breakpoint = 1280) {
  const [isBelowBreakpoint, setIsBelowBreakpoint] = useState(false);

  useEffect(() => {
    const update = () => {
      setIsBelowBreakpoint(window.innerWidth < breakpoint);
    };

    update();
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
    };
  }, [breakpoint]);

  return isBelowBreakpoint;
}
