import { createElement } from "react";
import { renderToStaticMarkup } from "#markup";   // react-server 번들(Next App Route)에서는 markup.react-server.ts로 바뀐다
import type { Report, DataContext } from "@daport/core";
import { layout } from "./layout/layout";
import { PaintPages } from "./paint/Paint";
import { fontFaceCss, pageCss } from "./paint/css";

export type HtmlOptions = { fontBaseUrl: string };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function renderToHtml(report: Report, data: DataContext, opts: HtmlOptions): string {
  const pages = layout(report, data);
  const body = renderToStaticMarkup(createElement(PaintPages, { pages }));
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(report.name || report.id)}</title>` +
    `<style>${fontFaceCss(opts.fontBaseUrl)}\n${pageCss(report.page.width, report.page.height)}</style></head>` +
    `<body>${body}</body></html>`;
}
