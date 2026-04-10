"use client";

import { Input, InputProps } from "@heroui/input";

export function CampusInput(props: InputProps) {
  return (
    <Input
      variant="bordered"
      classNames={{
        label: "text-text-primary font-medium",
        input: "text-text-primary placeholder:text-text-muted bg-bg-main",
        inputWrapper:
          "border-border-input hover:border-primary-600 focus-within:!border-border-input-focus focus-within:ring-2 focus-within:ring-primary-500/30 bg-bg-main",
      }}
      {...props}
    />
  );
}
