/**
 * Playwright가 브라우저·컨텍스트·페이지가 죽거나 끊겼을 때 내는 메시지.
 * 이런 오류만 새 컨텍스트(필요하면 새 브라우저)로 다시 하면 풀린다. 시간 초과나 렌더 오류는 다시 해도 같다.
 */
const CRASH = /Target (page|context|browser).*closed|Target crashed|page crashed|Browser has been closed|browser has disconnected/i;

export function isBrowserCrash(e: unknown): boolean {
  return CRASH.test(e instanceof Error ? e.message : String(e));
}
