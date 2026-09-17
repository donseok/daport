// bwip-js의 package.json "exports"는 "node" 브랜치가 중첩 조건("electron" 아래)이라
// TS의 Bundler 모듈 해석이 기본 조건 집합(import/types)만으로는 타입을 못 찾는다.
// customConditions를 tsconfig마다 맞추는 대신, 실제로 쓰는 표면만 앰비언트로 선언해 우회한다.
// render.ts의 삼중 슬래시 참조로 끌어들이므로 이 패키지를 소비하는 쪽(pdf 등)의 tsconfig 설정과 무관하게 적용된다.
declare module "bwip-js" {
  export interface ToSVGOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: "offleft" | "left" | "center" | "right" | "offright" | "justify";
    textsize?: number;
  }
  const bwipjs: { toSVG(opts: ToSVGOptions): string };
  export default bwipjs;
}
