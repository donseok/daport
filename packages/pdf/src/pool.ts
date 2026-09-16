import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch({ headless: true }).then(
      (b) => { browser = b; launching = null; return b; },
      (e) => { launching = null; throw e; },   // 실패한 실행을 붙잡아 두면 프로세스가 재시작될 때까지 PDF가 모두 실패한다
    );
  }
  return launching;
}

export async function closePool(): Promise<void> {
  const b = browser; browser = null;
  if (b) await b.close();
}
