/** Use case: login (email + password -> session token). */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@lawlink/db";
import { DomainError, type Deps, type Role } from "../types.js";
import { verifyPassword } from "./password.js";
import { issueToken } from "./token.js";

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface LoginResult {
  token: string;
  user: { id: string; name: string; email: string; role: Role };
}

export async function login(deps: Deps, rawInput: unknown): Promise<LoginResult> {
  const { email, password } = LoginInput.parse(rawInput);

  const [user] = await deps.db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Same error whether the email is unknown or the password is wrong.
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    throw new DomainError("FORBIDDEN", "邮箱或密码错误");
  }

  const role = user.role as Role;
  const token = await issueToken(deps.secrets.jwt, { userId: user.id, role });
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role },
  };
}
