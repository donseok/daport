// 색 값은 렌더러가 인라인 style에 그대로 넣으므로 CSS 선언을 끝내거나 URL을 불러올 수 있는 글자를 막는다.
// 허용: #rgb·#rgba·#rrggbb·#rrggbbaa, 숫자 인자만 가진 rgb()/rgba()/hsl()/hsla(), transparent·currentcolor 같은 이름 색(영문 단어).
// 앞뒤 공백·탭은 허용하지만 줄바꿈은 어디에도 허용하지 않는다
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgba?|hsla?)\((?:[\d.%,/ ]|deg|-(?=[\d.]))*\)$/i;   // '-'는 숫자 앞에만
const NAMED = /^[a-z]+$/i;                                          // transparent, currentcolor 포함

export function isSafeCssColor(value: string): boolean {
  if (typeof value !== "string") return false;
  const v = value.replace(/^[ \t]+|[ \t]+$/g, "");
  return HEX.test(v) || FUNC.test(v) || NAMED.test(v);
}
