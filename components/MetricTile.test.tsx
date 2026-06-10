// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricTile } from "@/components/MetricTile";

// Smoke test proving the jsdom + React Testing Library tooling works and that
// the shared KPI tile renders its label/value. Components split out in later
// refactors (dashboard #42, live manager #38) can reuse this harness.

afterEach(cleanup);

describe("MetricTile", () => {
  it("renders its label and value", () => {
    render(<MetricTile label="Prize pool" value="€360.00" />);
    expect(screen.getByText("Prize pool")).toBeDefined();
    expect(screen.getByText("€360.00")).toBeDefined();
  });

  it("renders the sub band when showDescription is set", () => {
    render(<MetricTile label="Players" value="7" sub="Active field" showDescription />);
    expect(screen.getByText("Active field")).toBeDefined();
  });
});
