"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { Button } from "@heroui/button";
import { LogOut } from "lucide-react";
import { auth } from "@/lib/firebase";

function clearCampusCookies() {
  document.cookie = "campus_logged_in=; Path=/; Max-Age=0";
  document.cookie = "campus_role=; Path=/; Max-Age=0";
  document.cookie = "campus_must_change=; Path=/; Max-Age=0";
}

type LogoutButtonProps = {
  className?: string;
};

export default function LogoutButton({ className }: LogoutButtonProps) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } finally {
      clearCampusCookies();
      router.replace("/login");
    }
  };

  return (
    <Button
      color="danger"
      variant="flat"
      onPress={handleLogout}
      startContent={<LogOut size={16} />}
      className={className}
    >
      Logout
    </Button>
  );
}
