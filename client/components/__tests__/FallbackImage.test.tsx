// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { FallbackImage } from "../FallbackImage";

describe("FallbackImage", () => {
  it("renders the image through expo-image with memory-disk caching for a valid uri", () => {
    renderComponent(
      <FallbackImage
        source={{ uri: "https://example.com/photo.jpg" }}
        testID="thumb"
      />,
    );

    const img = screen.getByTestId("thumb");
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://example.com/photo.jpg");
    // expo-image-only attribute — RN's Image has no cachePolicy prop, so this
    // can only be present once FallbackImage renders expo-image's Image with
    // cachePolicy="memory-disk". This is the assertion that pins the
    // migration itself, not just the pre-existing valid-uri render path.
    expect(img.getAttribute("data-cache-policy")).toBe("memory-disk");
  });

  it("shows the fallback icon instead of an image when the source is missing", () => {
    renderComponent(<FallbackImage source={undefined} testID="thumb" />);

    expect(screen.queryByTestId("thumb")).toBeNull();
    expect(screen.getByText("image")).toBeTruthy(); // default fallbackIcon="image"
  });

  it("shows the fallback icon instead of an image when the uri is an empty string", () => {
    renderComponent(<FallbackImage source={{ uri: "" }} testID="thumb" />);

    expect(screen.queryByTestId("thumb")).toBeNull();
    expect(screen.getByText("image")).toBeTruthy();
  });

  it("swaps to the fallback icon after the image fails to load", () => {
    renderComponent(
      <FallbackImage
        source={{ uri: "https://example.com/broken.jpg" }}
        testID="thumb"
      />,
    );

    const img = screen.getByTestId("thumb");
    fireEvent.error(img);

    expect(screen.queryByTestId("thumb")).toBeNull();
    expect(screen.getByText("image")).toBeTruthy();
  });
});
