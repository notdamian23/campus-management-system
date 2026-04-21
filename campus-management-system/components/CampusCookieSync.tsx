"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import {
  canAccessStudentPortal,
  clearCampusCookies,
  setCampusCookies,
  type CampusProfileDoc,
} from "@/lib/campus-auth";
import { auth, db } from "@/lib/firebase";
import { normalizeCampusRole } from "@/lib/campus-role";

export default function CampusCookieSync() {
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      unsubscribeProfile = null;

      if (!user) {
        clearCampusCookies();
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "profiles", user.uid),
        (profileSnap) => {
          if (!profileSnap.exists()) {
            clearCampusCookies();
            return;
          }

          const profile = profileSnap.data() as CampusProfileDoc;
          setCampusCookies({
            role: normalizeCampusRole(profile.role) || "",
            mustChangePassword: profile.mustChangePassword === true,
            emailVerificationPending:
              profile.emailVerificationPending === true,
            canAccessStudentPortal: canAccessStudentPortal(profile),
          });
        },
        () => {
          // Keep the last known cookie state on transient listener failures.
        },
      );
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  return null;
}
