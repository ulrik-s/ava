import { type NextAuthOptions, type Profile } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import AzureADProvider from "next-auth/providers/azure-ad";
import { compare } from "bcryptjs";
import { prisma } from "@/server/db";
import { resolveAzureUser, type AzureProfile } from "./azure-provisioning";

/**
 * Entra ID / O365 OIDC-claims vi läser ut.
 * - `oid` är stabil user-id (ändras aldrig)
 * - `tid` är tenant-id (används för single-tenant-verifiering)
 * - `preferred_username` är oftast UPN (e-post) för vanliga moln-konton
 */
interface AzureIdTokenProfile extends Profile {
  oid?: string;
  tid?: string;
  preferred_username?: string;
}

const AZURE_TENANT_ID = process.env.AZURE_AD_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_AD_CLIENT_SECRET;

const azureConfigured = !!(AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  providers: [
    // Primär: Microsoft / O365. Bara aktiv när ENV är konfigurerad.
    ...(azureConfigured
      ? [
          AzureADProvider({
            clientId: AZURE_CLIENT_ID!,
            clientSecret: AZURE_CLIENT_SECRET!,
            tenantId: AZURE_TENANT_ID!,
            authorization: {
              params: {
                scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
              },
            },
          }),
        ]
      : []),

    // Fallback: användarnamn/lösenord för admin och testkonton.
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    /**
     * Körs för VARJE inloggningsförsök. För AzureAD: validera tenant,
     * kontrollera att användaren är inbjuden, länka azureOid vid första
     * lyckad match. Returnera false/url → nekad inloggning (NextAuth
     * redirectar till /login?error=AccessDenied).
     */
    // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async method 'signIn' has a complexity of 11. Maximum allowed is 8.)
    async signIn({ account, profile, user }) {
      if (account?.provider !== "azure-ad") {
        return true; // credentials-flödet kör sin egen auth i authorize()
      }

      const p = profile as AzureIdTokenProfile | undefined;
      if (!p?.oid || !p?.tid) {
        return "/login?error=MissingClaims";
      }

      const email = p.email || p.preferred_username;
      if (!email) {
        return "/login?error=MissingEmail";
      }

      const azureProfile: AzureProfile = {
        oid: p.oid,
        tid: p.tid,
        email,
        name: p.name ?? email,
      };

      const result = await resolveAzureUser(prisma, azureProfile);
      if (!result.ok) {
        const reasonMap: Record<typeof result.reason, string> = {
          WRONG_TENANT: "WrongTenant",
          NOT_INVITED: "NotInvited",
          MISSING_EMAIL: "MissingEmail",
        };
        return `/login?error=${reasonMap[result.reason]}`;
      }

      // Berika user-objektet som skickas vidare till jwt()-callback.
      // NextAuth's typer tillåter tilläggsfält här via module-augmentation.
      (user as { id: string }).id = result.userId;
      (user as { role: string }).role = result.role;
      (user as { organizationId: string }).organizationId = result.organizationId;
      (user as { email: string }).email = email;
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email as string,
        name: token.name as string,
        role: token.role,
        organizationId: token.organizationId,
      };
      return session;
    },
  },
};
