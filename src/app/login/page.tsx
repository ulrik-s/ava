"use client";

import { Suspense, useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <p className="text-sm text-gray-500">Laddar...</p>
    </div>
  );
}

function mapOAuthError(oauthError: string | null): string | null {
  switch (oauthError) {
    case "WrongTenant":
      return "Din Microsoft-organisation är inte kopplad till AVA. Kontakta admin.";
    case "NotInvited":
      return "Du är inte inbjuden till AVA. Be din admin skapa ett konto med din e-post först.";
    case "MissingEmail":
    case "MissingClaims":
      return "Microsoft-kontot saknar e-post eller obligatorisk information.";
    case "AccessDenied":
      return "Inloggningen nekades.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthAccountNotLinked":
      return "Microsoft-inloggningen misslyckades. Försök igen.";
    default:
      return null;
  }
}

function useAzureAvailable(): boolean {
  const [azureAvailable, setAzureAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getProviders().then((providers) => {
      if (!cancelled) setAzureAvailable(!!providers?.["azure-ad"]);
    }).catch(() => { /* tyst */ });
    return () => { cancelled = true; };
  }, []);
  return azureAvailable;
}

function OAuthSection({
  callbackUrl,
  oauthErrorMessage,
}: {
  callbackUrl: string;
  oauthErrorMessage: string | null;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Logga in</h2>

      {oauthErrorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{oauthErrorMessage}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => signIn("azure-ad", { callbackUrl })}
        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-800 bg-white hover:bg-gray-50"
      >
        <MicrosoftLogo />
        Logga in med Microsoft
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs text-gray-500">eller med lösenord</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const oauthError = searchParams.get("error");
  const azureAvailable = useAzureAvailable();
  const oauthErrorMessage = mapOAuthError(oauthError);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Felaktig e-postadress eller losenord.");
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">AVA</h1>
          <p className="text-sm text-gray-500 mt-1">Advokat CRM</p>
        </div>

        {azureAvailable && (
          <OAuthSection callbackUrl={callbackUrl} oauthErrorMessage={oauthErrorMessage} />
        )}

        <form
          onSubmit={handleSubmit}
          className={`bg-white rounded-lg border border-gray-200 p-6 space-y-4 ${azureAvailable ? "mt-4" : ""}`}
        >
          {!azureAvailable && <h2 className="text-lg font-semibold text-gray-900">Logga in</h2>}

          {!azureAvailable && oauthErrorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-800">{oauthErrorMessage}</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
              E-postadress
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="namn@byra.se"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
              Losenord
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loggar in..." : azureAvailable ? "Logga in med lösenord" : "Logga in"}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Officiell Microsoft-logotyp (fyra rutor). */
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
