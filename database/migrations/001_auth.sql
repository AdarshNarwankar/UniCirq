-- Better Auth 1.7.6 core + database rate-limit storage. Dedicated PostgreSQL database.
CREATE TABLE "user" (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 "emailVerified" boolean NOT NULL DEFAULT false, image text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "session" (
 id uuid PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 "ipAddress" text, "userAgent" text, "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON "session"("userId");
CREATE TABLE account (
 id uuid PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
 "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text,
 "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("providerId","accountId")
);
CREATE INDEX account_user_idx ON account("userId");
CREATE TABLE verification (
 id uuid PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification(identifier);
CREATE TABLE "rateLimit" (id uuid PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
REVOKE ALL ON "user", "session", account, verification, "rateLimit" FROM PUBLIC;
