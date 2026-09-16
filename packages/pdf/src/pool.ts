import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch({ headless: true }).then((b) => { browser = b; launching = null; return b; });
  }
  return launching;
}

export async function closePool(): Promise<void> {
  const b = browser; browser = null;
  if (b) await b.close();
}
