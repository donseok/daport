"use client";
import { Component, type ReactNode } from "react";

type State = { error: Error | null };

/**
 * 캔버스·미리보기 본문의 예기치 않은 렌더 오류를 가둔다. 편집기 전체가 언마운트되면 저장 안 한 편집을 잃으므로
 * 이 영역만 오류 메시지로 바꾸고, 스토어는 바깥(Editor)에 있어 그대로 남는다
 */
export class EditorErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="p-4 text-sm text-red-700">
        <p>화면을 그리는 중 오류가 발생했습니다: {error.message}</p>
        <button className="mt-2 text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100" onClick={() => this.setState({ error: null })}>다시 시도</button>
      </div>
    );
  }
}
