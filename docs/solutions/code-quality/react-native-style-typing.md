---
title: "Proper Style Typing in React Native Components"
category: code-quality
tags: [typescript, react-native, styling, types]
module: client
symptoms:
  - No autocomplete for style properties
  - Style errors only caught at runtime
  - Type errors when passing style props
created: 2026-02-01
severity: low
---

# Proper Style Typing in React Native Components

## Problem

Component props used `object` or `any` for style properties, losing TypeScript's ability to validate style values and provide autocomplete.

## Symptoms

- No IDE autocomplete when writing styles
- Invalid style properties only caught at runtime
- TypeScript errors when composing styles with `StyleSheet.compose`
- Difficulty refactoring styles safely

## Root Cause

Using generic types for styles bypasses React Native's style type system.

```typescript
// BEFORE (weak typing - no validation)
interface Props {
  style?: object;  // No autocomplete, no validation
  containerStyle?: any;  // Even worse - accepts anything
}

// These invalid styles won't be caught:
<MyComponent style={{ colour: "red" }} />  // Typo not caught
<MyComponent style={{ flex: "1" }} />      // String instead of number
```

## Solution

Use React Native's style types: `StyleProp<ViewStyle>`, `StyleProp<TextStyle>`, etc.

```typescript
// AFTER (proper typing - full validation)
import { StyleProp, ViewStyle, TextStyle } from "react-native";

interface Props {
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

// Now TypeScript catches errors:
<MyComponent style={{ colour: "red" }} />  // Error: 'colour' not in ViewStyle
<MyComponent style={{ flex: "1" }} />      // Error: string not assignable to number
```

## Style Types Reference

| Type           | Use For           | Properties Include                           |
| -------------- | ----------------- | -------------------------------------------- |
| `ViewStyle`    | Container views   | flex, margin, padding, backgroundColor, etc. |
| `TextStyle`    | Text components   | fontSize, fontWeight, color, textAlign, etc. |
| `ImageStyle`   | Image components  | resizeMode, tintColor, overlayColor, etc.    |
| `StyleProp<T>` | Wrapper for props | Accepts T, T[], or falsy values              |

## The StyleProp Wrapper

`StyleProp<T>` is important because it accepts:

- A single style object: `style={{ flex: 1 }}`
- An array of styles: `style={[styles.base, styles.active]}`
- Falsy values for conditional styles: `style={[styles.base, isActive && styles.active]}`

```typescript
// All valid with StyleProp<ViewStyle>
<View style={{ flex: 1 }} />
<View style={[styles.container, styles.padded]} />
<View style={[styles.base, condition && styles.conditional]} />
<View style={undefined} />
```

## Common Patterns

### Composable Component Props

```typescript
interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}

function Card({ children, style, contentStyle, titleStyle }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      <Text style={[styles.title, titleStyle]}>Title</Text>
      <View style={[styles.content, contentStyle]}>
        {children}
      </View>
    </View>
  );
}
```

### Extending Native Components

```typescript
import { Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";

interface ButtonProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
}

function Button({ style, pressedStyle, ...props }: ButtonProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.button,
        style,
        pressed && [styles.pressed, pressedStyle],
      ]}
    />
  );
}
```

## Prevention

1. **Rule**: Always use `StyleProp<ViewStyle|TextStyle|ImageStyle>` for style props
2. **ESLint**: Consider `@typescript-eslint/no-explicit-any` rule
3. **Pattern**: Define component interfaces with explicit style prop types
4. **Review**: Check for `object` or `any` style types during code review

## Related Files

- `client/camera/components/CameraView.tsx` - Fixed style prop typing
- `client/constants/theme.ts` - Theme type definitions

## See Also

- [React Native TypeScript](https://reactnative.dev/docs/typescript)
- [StyleSheet API](https://reactnative.dev/docs/stylesheet)
