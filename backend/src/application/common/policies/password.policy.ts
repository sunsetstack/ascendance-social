import bcryptjs from "bcryptjs";

const PASSWORD_SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcryptjs.hash(password, await bcryptjs.genSalt(PASSWORD_SALT_ROUNDS));
}

export function verifyPassword(
  candidatePassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcryptjs.compare(candidatePassword, passwordHash);
}
