// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { ProfileCard } from "../ProfileCard";

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/lib/query-client", () => ({
  resolveImageUrl: (url: string) => url,
}));

describe("ProfileCard avatar", () => {
  it("renders the remote avatar through expo-image so the sign-out wipe covers it", () => {
    const { container } = renderComponent(
      <ProfileCard
        displayName="Sam"
        username="sam"
        avatarUrl="https://cdn.example.com/avatar.jpg"
        compositeScore={0}
        isUploadingAvatar={false}
        onAvatarPress={vi.fn()}
        onGearPress={vi.fn()}
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/avatar.jpg");
    // data-content-fit is only emitted by the expo-image mock.
    expect(img?.getAttribute("data-content-fit")).toBe("cover");
    expect(screen.getByLabelText("Settings")).toBeTruthy();
  });
});
