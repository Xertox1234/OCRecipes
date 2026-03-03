// @vitest-environment jsdom
import React from "react";
import { Text } from "react-native";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { DraggableList } from "../DraggableList";

describe("DraggableList", () => {
  const items = [
    { id: 1, name: "Item A" },
    { id: 2, name: "Item B" },
    { id: 3, name: "Item C" },
  ];

  it("renders all items", () => {
    renderComponent(
      <DraggableList
        items={items}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <Text>{item.name}</Text>}
        onReorder={vi.fn()}
      />,
    );
    expect(screen.getByText("Item A")).toBeDefined();
    expect(screen.getByText("Item B")).toBeDefined();
    expect(screen.getByText("Item C")).toBeDefined();
  });

  it("renders reorder handles for each item", () => {
    renderComponent(
      <DraggableList
        items={items}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <Text>{item.name}</Text>}
        onReorder={vi.fn()}
      />,
    );
    const handles = screen.getAllByLabelText("Reorder handle");
    expect(handles.length).toBe(3);
  });

  it("shows move buttons when handle is tapped", () => {
    renderComponent(
      <DraggableList
        items={items}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <Text>{item.name}</Text>}
        onReorder={vi.fn()}
      />,
    );
    const handles = screen.getAllByLabelText("Reorder handle");
    fireEvent.click(handles[1]); // Tap middle item's handle
    expect(screen.getByLabelText("Move up")).toBeDefined();
    expect(screen.getByLabelText("Move down")).toBeDefined();
  });

  it("calls onReorder when move up is pressed", () => {
    const onReorder = vi.fn();
    renderComponent(
      <DraggableList
        items={items}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <Text>{item.name}</Text>}
        onReorder={onReorder}
      />,
    );
    // Activate the second item
    const handles = screen.getAllByLabelText("Reorder handle");
    fireEvent.click(handles[1]);
    // Press move up
    fireEvent.click(screen.getByLabelText("Move up"));
    expect(onReorder).toHaveBeenCalledWith([
      { id: 2, name: "Item B" },
      { id: 1, name: "Item A" },
      { id: 3, name: "Item C" },
    ]);
  });

  it("calls onReorder when move down is pressed", () => {
    const onReorder = vi.fn();
    renderComponent(
      <DraggableList
        items={items}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <Text>{item.name}</Text>}
        onReorder={onReorder}
      />,
    );
    // Activate the first item
    const handles = screen.getAllByLabelText("Reorder handle");
    fireEvent.click(handles[0]);
    // Press move down
    fireEvent.click(screen.getByLabelText("Move down"));
    expect(onReorder).toHaveBeenCalledWith([
      { id: 2, name: "Item B" },
      { id: 1, name: "Item A" },
      { id: 3, name: "Item C" },
    ]);
  });

  it("renders with single item without move buttons visible", () => {
    renderComponent(
      <DraggableList
        items={[{ id: 1, name: "Only item" }]}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <Text>{item.name}</Text>}
        onReorder={vi.fn()}
      />,
    );
    expect(screen.getByText("Only item")).toBeDefined();
    expect(screen.queryByLabelText("Move up")).toBeNull();
    expect(screen.queryByLabelText("Move down")).toBeNull();
  });
});
