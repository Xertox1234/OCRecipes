/**
 * The props React attached to a rendered DOM element. The shared
 * react-native mock renders `TextInput` as a plain `<input>`, so RN-only props
 * (`editable`, `onSubmitEditing`, `returnKeyType`, `submitBehavior`) never
 * reach the DOM — read them, or call a handler, through this instead.
 */
export function reactProps(el: Element): Record<string, unknown> {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("No React props on this element");
  return (el as unknown as Record<string, Record<string, unknown>>)[key];
}
