import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

// Sem 0/O/1/l/I (parecidos demais entre si) -- a senha e lida na tela do
// WhatsApp e digitada de volta no celular, entao evitar ambiguidade importa
// mais aqui do que o espaco de busca teorico.
const PASSWORD_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const PASSWORD_LENGTH = 8;

export function generatePassword(): string {
  let password = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += PASSWORD_CHARSET[randomInt(PASSWORD_CHARSET.length)];
  }
  return password;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
