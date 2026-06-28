/** Session tokens — JWT (HS256) via jose (Workers-friendly). */
import { SignJWT, jwtVerify } from "jose";
import { DomainError, type AuthContext, type Role } from "../types.js";

const encoder = new TextEncoder();

export async function issueToken(
  secret: string,
  claims: AuthContext,
  expiresIn = "12h",
): Promise<string> {
  return await new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(encoder.encode(secret));
}

export async function verifyToken(
  secret: string,
  token: string,
): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret));
    return { userId: payload.sub as string, role: payload.role as Role };
  } catch {
    throw new DomainError("UNAUTHENTICATED", "登录态无效或已过期");
  }
}
