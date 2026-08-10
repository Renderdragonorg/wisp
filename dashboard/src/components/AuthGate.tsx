import { useState, type FormEvent, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="min-h-svh bg-background dark grid place-items-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <>{children}</>;
}

function LoginScreen() {
  const { signIn } = useAuthActions();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await signIn("credentials", { name, key });
    } catch {
      setError("Invalid dashboard name or key.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-svh bg-background dark grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-8 h-8 rounded-md bg-foreground flex items-center justify-center">
            <span className="text-background text-sm font-semibold">W</span>
          </div>
          <p className="text-lg font-semibold text-foreground">Wisp Analytics</p>
        </div>

        <p className="text-sm text-muted-foreground text-center mb-6">
          Enter the dashboard credentials configured in Convex.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoComplete="username"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Dashboard name"
            className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Dashboard key"
            className="w-full h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting || !name || !key}
            className="w-full h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
