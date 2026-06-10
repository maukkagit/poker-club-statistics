// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PlayerCombobox from "@/components/PlayerCombobox";
import LocationCombobox from "@/components/LocationCombobox";

// Smoke tests guarding the shared useComboboxNav extraction: both comboboxes
// render, open on focus, list their options and fire selection.

// jsdom doesn't implement scrollIntoView (used by the keyboard-nav effect).
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const players = [
  { id: "p1", name: "Bob", created_at: "" },
  { id: "p2", name: "Alice", created_at: "" },
];

describe("PlayerCombobox", () => {
  it("opens on focus, lists players alphabetically and selects on click", () => {
    const onSelect = vi.fn();
    render(<PlayerCombobox players={players} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    const options = screen.getAllByRole("option").map(o => o.textContent);
    expect(options).toEqual(["Alice", "Bob"]);
    fireEvent.click(screen.getByText("Alice"));
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("filters by query", () => {
    render(<PlayerCombobox players={players} onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bo" } });
    const options = screen.getAllByRole("option").map(o => o.textContent);
    expect(options).toEqual(["Bob"]);
  });
});

describe("LocationCombobox", () => {
  const locations = [
    { id: "l1", name: "Casino", created_at: "" },
    { id: "l2", name: "Home", created_at: "" },
  ];

  it("opens on focus and selects an existing location", () => {
    const onChange = vi.fn();
    render(<LocationCombobox value={null} locations={locations} onChange={onChange} onCreate={vi.fn()} />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Casino"));
    expect(onChange).toHaveBeenCalledWith("l1");
  });

  it("shows a create row for a novel query", () => {
    render(<LocationCombobox value={null} locations={locations} onChange={vi.fn()} onCreate={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Garage" } });
    expect(screen.getByText("“Garage”")).toBeDefined();
  });
});
