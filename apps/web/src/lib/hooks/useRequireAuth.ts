import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";

export const useRequireAuth = () => {
  const router = useRouter();
  const bootstrap = useAuthStore((state) => state.bootstrap);
  useEffect(() => {
    let active = true;
    bootstrap().then((authenticated) => {
      if (active && !authenticated) {
        router.push("/login");
      }
    });
    return () => {
      active = false;
    };
  }, [bootstrap, router]);
};
