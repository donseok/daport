import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Report, DataContext } from "@daport/core";
import { layout } from "./layout/layout";
import { PaintPages } from "./paint/Paint";
import { fontFaceCss, pageCss } from "./paint/css";

export type HtmlOptions = { fontBaseUrl: string };

export function renderToHtml(report: Report, data: DataContext, opts: HtmlOptions): string {
  const pages = layout(report, data);
  const body = renderToStaticMarkup(createElement(PaintPages, { pages }));
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${report.name || report.id}</title>` +
    `<style>${fontFaceCss(opts.fontBaseUrl)}\n${pageCss(report.page.width, report.page.height)}</style></head>` +
    `<body>${body}</body></html>`;
}
