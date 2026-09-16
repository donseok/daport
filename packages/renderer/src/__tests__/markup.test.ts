import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "#markup";
import { renderToStaticMarkup as renderInReactServer } from "../markup.react-server";

describe("static markup entry points", () => {
  it("the react-server variant renders the same markup as the default one", () => {
    const el = createElement("div", { "data-x": 1 }, "hi");
    expect(renderToStaticMarkup(el)).toBe('<div data-x="1">hi</div>');
    expect(renderInReactServer(el)).toBe(renderToStaticMarkup(el));
  });
});
