export function fontFaceCss(fontBaseUrl: string): string {
  return [
    `@font-face{font-family:'Pretendard';font-weight:400;src:url('${fontBaseUrl}/Pretendard-Regular.otf') format('opentype')}`,
    `@font-face{font-family:'Pretendard';font-weight:700;src:url('${fontBaseUrl}/Pretendard-Bold.otf') format('opentype')}`,
  ].join("\n");
}

export function pageCss(width: number, height: number): string {
  return [
    `@page{size:${width}mm ${height}mm;margin:0}`,
    `html,body{margin:0;padding:0}`,
    `.dp-page{position:relative;width:${width}mm;height:${height}mm;overflow:hidden;background:#fff;page-break-after:always;font-family:'Pretendard',sans-serif;color:#000}`,
    `.dp-page:last-child{page-break-after:auto}`,
    `.dp-el{position:absolute;box-sizing:border-box;margin:0}`,
    `.dp-text{white-space:pre;overflow:hidden}`,
    `.dp-line{overflow:visible}`,
    `.dp-ph{border:0.2mm dashed #999;color:#999;font-size:6pt;display:flex;align-items:center;justify-content:center}`,
    `.dp-err{outline:0.3mm solid #e00;color:#e00}`,
  ].join("\n");
}
