/** 컴포넌트 id·키 형식. elements.ts와 component.ts가 함께 쓰므로 순환 import를 피하려고 상수만 둔다 */
export const COMPONENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** report.components 키: "<컴포넌트id>@<버전>". 1번 그룹이 id, 2번 그룹이 버전 */
export const COMPONENT_KEY_RE = /^([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/;
