import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Md } from "../src/client/components/Md";

describe("markdown tables in course text", () => {
  it("renders a pipe table as a real table", () => {
    const html = renderToStaticMarkup(createElement(Md, { text: "| | Single Instruction | Multiple Instructions |\n|---|---|---|\n| Single Data | SISD | MISD |\n| Multiple Data | SIMD | MIMD |" }));
    expect(html).toContain("<table");
    expect(html).toContain("<th scope=\"col\">Single Instruction</th>");
    expect(html).toContain("<td>SIMD</td>");
    expect(html).not.toContain("|---");
  });

  it("leaves a lone pipe line as text", () => {
    expect(renderToStaticMarkup(createElement(Md, { text: "a | b" }))).not.toContain("<table");
  });
});
