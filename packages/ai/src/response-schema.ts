/**
 * Gemini `responseSchema`는 OpenAPI 부분집합만 지원한다(`oneOf`·`$ref`·`anyOf` 없음).
 * 그래서 임의 중첩값(JSON Patch의 value, 생성 요소)은 모두 **JSON 문자열**로 받고
 * 서버(T3 validate.ts)가 파싱한다. type/properties/items/required/enum/description만 쓴다
 */

/** 편집 응답: RFC 6902 JSON Patch 배열 + 설명 */
export const EDIT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    patch: {
      type: "array",
      description: "RFC 6902 JSON Patch 연산 목록",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["add", "remove", "replace", "move", "copy"] },
          path: { type: "string", description: "JSON Pointer 경로, 예: /elements/0/value" },
          value: { type: "string", description: "add·replace·test에 필요. 값의 JSON 문자열 표현, 예: '\"검사 성적서\"', '297', '{\"id\":\"t2\"}'" },
          from: { type: "string", description: "move·copy에 필요한 원본 경로" },
        },
        required: ["op", "path"],
      },
    },
    explanation: { type: "string", description: "무엇을 왜 바꿨는지 한국어 한두 문장" },
  },
  required: ["patch", "explanation"],
};

/** 생성 응답: 요소 전체 목록(각 JSON 문자열) + 설명 */
export const GENERATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      description: "레포트에 들어갈 요소 전체. 각 원소는 요소 객체 하나의 JSON 문자열 표현",
      items: { type: "string" },
    },
    explanation: { type: "string", description: "무엇을 왜 이렇게 구성했는지 한국어 한두 문장" },
  },
  required: ["elements", "explanation"],
};

/** 이관 응답: 요소·파라미터·표 데이터셋(각 JSON 문자열) + 설명 + 경고 */
export const IMPORT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      description: "요소 전체. 각 원소는 요소 객체 하나의 JSON 문자열. 좌표는 0-1000 정규화 정수",
      items: { type: "string" },
    },
    params: {
      type: "array",
      description: '파라미터 선언. 각 원소는 {"name":"lotNo","type":"string"} 꼴의 JSON 문자열',
      items: { type: "string" },
    },
    datasets: {
      type: "array",
      description: '표에 딸린 정적 데이터셋. 각 원소는 {"name":"rows1","rows":[{"col":"값"}]} 꼴의 JSON 문자열',
      items: { type: "string" },
    },
    explanation: { type: "string", description: "무엇을 어떻게 옮겼는지, 컴포넌트 후보는 무엇인지 한국어 한두 문장" },
    warnings: { type: "array", description: "읽지 못한 영역 등 사람이 확인해야 할 점", items: { type: "string" } },
  },
  required: ["elements", "explanation"],
};
