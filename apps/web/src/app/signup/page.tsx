"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/useAuthStore";

export default function SignupPage() {
  const router = useRouter();
  const { signup, loading } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await signup(email, password);
      router.push("/");
    } catch (err) {
      setError("Signup failed. Try another email.");
    }
  };

  return (
    <div className="min-h-screen bg-hero-gradient px-6 py-16">
      <div className="mx-auto flex max-w-xl flex-col gap-8 rounded-3xl bg-white/80 p-10 shadow-2xl">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Speech-Machine</p>
          <h1 className="font-display text-3xl font-semibold">Create your coach</h1>
          <p className="text-sm text-ink/70">Save sessions, see progress, and unlock drills.</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create account"}
          </Button>
        </form>
        <p className="text-sm text-ink/60">
          Already have an account?{" "}
          <Link className="font-semibold text-ink" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
