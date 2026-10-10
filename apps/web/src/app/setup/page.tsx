"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/useAuthStore";

export default function SetupPage() {
  const router = useRouter();
  const setup = useAuthStore((state) => state.setup);
  const loading = useAuthStore((state) => state.loading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    try {
      await setup(email, password);
      router.replace("/");
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup failed.");
    }
  };

  return (
    <div className="min-h-screen bg-hero-gradient px-6 py-16">
      <div className="mx-auto flex max-w-xl flex-col gap-8 rounded-3xl bg-white/80 p-10 shadow-2xl">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/60">Speech-Machine</p>
          <h1 className="font-display text-3xl font-semibold">Create admin account</h1>
          <p className="text-sm text-ink/70">This one-time setup replaces the old default local credentials.</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            type="email"
            placeholder="admin@example.com"
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
            minLength={6}
          />
          <Input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={6}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create admin"}
          </Button>
        </form>
      </div>
    </div>
  );
}
