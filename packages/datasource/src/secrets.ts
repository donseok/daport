import type { SecretResolver } from "./types";

const NAME_RE = /^[A-Z0-9_]+$/;

/** `secrets.이름`은 DAPORT_SECRET_<이름> 환경변수에서만 읽는다 */
export function envSecrets(env: Record<string, string | undefined> = process.env): SecretResolver {
  return (name) => (NAME_RE.test(name) ? env[`DAPORT_SECRET_${name}`] : undefined);
}
