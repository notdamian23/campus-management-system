"use client";

import { Button, ButtonProps } from "@heroui/button";

interface CampusButtonProps extends Omit<ButtonProps, "color" | "variant"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export function CampusButton({ variant = "primary", ...props }: CampusButtonProps) {
  const colorMap = {
    primary: "primary" as const,    // Maps to maroon (#7b0000)
    secondary: "secondary" as const, // Maps to yellow (#F6C800)
    ghost: "default" as const,
    danger: "danger" as const,
  };

  return <Button color={colorMap[variant]} variant="solid" {...props} />;
}
