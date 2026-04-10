"use client";

import { Button, ButtonProps } from "@heroui/button";

interface CampusButtonProps extends Omit<ButtonProps, "color" | "variant"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export function CampusButton({
  variant = "primary",
  className = "",
  ...props
}: CampusButtonProps) {
  const variantStyles = {
    primary:
      "bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-text-on-primary font-semibold shadow-sm hover:shadow-md transition-all focus:ring-2 focus:ring-primary-500/40",
    secondary:
      "bg-primary-100 hover:bg-primary-200 text-primary-600 font-semibold shadow-sm hover:shadow transition-all",
    ghost: "bg-transparent hover:bg-primary-100 text-primary-500 font-medium",
    danger:
      "bg-red-600 hover:bg-red-700 text-white font-semibold shadow-sm hover:shadow-md transition-all",
  };

  return (
    <Button className={`${variantStyles[variant]} ${className}`} {...props} />
  );
}
