# Nutrition Camera App - Design Guidelines

## 1. Brand Identity

**Purpose**: Empower users to make informed nutrition choices by instantly scanning food packaging and tracking daily intake.

**Visual Direction**: **Clinical-meets-friendly** - Think health app that feels professional and trustworthy but approachable. Clean, spacious layouts with confidence-inspiring precision, softened by warm accent colors and friendly micro-interactions.

**Memorable Element**: The **instant scan feedback** - when users scan a barcode or label, a satisfying green pulse animation confirms successful capture, followed by nutrition data sliding up smoothly. This tactile feedback makes scanning feel magical and immediate.

## 2. Navigation Architecture

**Root Navigation**: Tab Bar (3 tabs)

- **Scan** (Center tab with camera icon) - Core action
- **History** (Left tab)
- **Profile** (Right tab)

**Auth Flow**: Users see onboarding → signup/login screen before accessing main app. Implement session-based authentication with:

- Apple Sign-In (required for iOS)
- Google Sign-In
- Email/Password option

## 3. Screen-by-Screen Specifications

### Onboarding (Stack-Only, shown once)

- **Purpose**: Explain app value in 2-3 slides
- **Layout**: Full-screen with large illustration, headline, subtext, skip button (top-right)
- **Screens**: 1) "Scan Any Food Label" 2) "Track Your Nutrition" 3) "Reach Your Goals"
- **Navigation**: Swipeable carousel with dot indicators, "Get Started" button on final slide

### Login/Signup

- **Purpose**: Authenticate user
- **Layout**:
  - Transparent header with back button (left)
  - Centered logo/app icon
  - SSO buttons (Apple, Google) with system-standard styling
  - "Or" divider
  - Email/password fields (if using custom auth)
  - Submit button below form
- **Safe Area**: Top inset = insets.top + Spacing.xl, Bottom inset = insets.bottom + Spacing.xl

### Scan (Main Tab - Camera View)

- **Purpose**: Capture barcodes or nutrition labels
- **Layout**:
  - **NO traditional header** - full-screen camera viewfinder
  - Floating UI overlay on camera:
    - Top: Flash toggle (top-left), Close/Switch Camera (top-right)
    - Center: Scanning reticle (outline box showing scan area)
    - Bottom: Large circular shutter button, gallery icon (bottom-left)
  - Scanning reticle has animated corners that pulse when detecting barcode
- **Components**:
  - expo-camera full-screen background
  - expo-barcode-scanner for barcode detection
  - Floating action button (shutter) with shadow
  - Toast message for scan success/failure
- **Safe Area**: Top overlay = insets.top + Spacing.md, Bottom overlay = insets.bottom + Spacing.xl

### Nutrition Detail (Modal, appears after successful scan)

- **Purpose**: Display extracted nutrition information
- **Layout**:
  - Native modal presentation (slides up from bottom)
  - Header: Product name (bold), serving size (subtitle), close button (top-right)
  - Scrollable content:
    - Product thumbnail image (if available from API)
    - Macro cards (Calories as hero card, then Protein/Carbs/Fat in grid)
    - Expandable "Full Nutrition Facts" accordion
    - "Add to Today" button (primary, full-width)
    - "Edit Details" button (secondary, full-width)
- **Safe Area**: Bottom inset = insets.bottom + Spacing.xl

### History Tab

- **Purpose**: View all previously scanned items
- **Layout**:
  - Transparent header with "History" title, filter icon (right)
  - Scrollable list of scanned items grouped by date
  - Each list item: Product name, thumbnail, calories, timestamp
  - Pull-to-refresh
- **Empty State**: Illustration of empty plate with "No scans yet" message
- **Safe Area**: Top inset = headerHeight + Spacing.xl, Bottom inset = tabBarHeight + Spacing.xl

### Daily Summary (Sub-screen from History, push navigation)

- **Purpose**: Show nutrition totals for selected day
- **Layout**:
  - Default navigation header with back button, date selector (title)
  - Scrollable content:
    - Circular progress chart (calories consumed vs goal)
    - Macro breakdown bar chart (Protein/Carbs/Fat percentages)
    - List of items consumed that day
- **Safe Area**: Top inset = Spacing.xl, Bottom inset = tabBarHeight + Spacing.xl

### Profile Tab

- **Purpose**: User settings and account management
- **Layout**:
  - Transparent header with "Profile" title
  - Scrollable content:
    - Avatar (large, centered, tappable)
    - Display name (editable)
    - Settings sections:
      - Nutrition Goals (daily calorie target, macro ratios)
      - Preferences (units - metric/imperial, theme)
      - Account (Log out, Delete account under nested Settings submenu)
- **Safe Area**: Top inset = headerHeight + Spacing.xl, Bottom inset = tabBarHeight + Spacing.xl

## 4. Color Palette

- **Primary**: `#008A38` (WCAG-compliant green - success, health, freshness)
- **Primary Dark**: `#006B2B` (For pressed states)
- **Background**: `#FAFAFA` (Off-white, reduces eye strain)
- **Surface**: `#FFFFFF` (Cards, modals)
- **Surface Elevated**: `#FFFFFF` with shadow
- **Text Primary**: `#1A1A1A` (Near-black)
- **Text Secondary**: `#757575` (Gray for supporting text)
- **Border**: `#E0E0E0` (Subtle dividers)
- **Error**: `#D32F2F` (Failed scans, validation)
- **Warning**: `#F57C00` (Missing nutrition data)
- **Calorie Accent**: `#C94E1A` (WCAG-compliant warm orange for calorie displays)

## 5. Typography

**Font**: **Inter** (Google Font - highly legible, modern, professional)

**Type Scale**:

- Display (Product names): Inter Bold, 24px
- Heading (Section titles): Inter SemiBold, 18px
- Body (Descriptions, lists): Inter Regular, 16px
- Caption (Timestamps, metadata): Inter Regular, 14px
- Label (Input labels, buttons): Inter Medium, 14px

**Macro Values**: Use **Tabular Nums** variant for nutrition numbers (calories, grams) to ensure alignment

## 6. Visual Design Principles

- **Camera Shutter Button**: Large (72px diameter), green fill, white camera icon, subtle shadow (shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.10, shadowRadius: 2)
- **Macro Cards**: White background, 8px border-radius, 1px border (#E0E0E0), no shadow. Each macro has colored accent bar on left edge (Protein: #008A38, Carbs: #C94E1A, Fat: #8C6800)
- **Scan Success Animation**: Green pulse ring expanding from scan reticle center, lasting 300ms
- **List Items**: Subtle press state (95% scale, 100ms duration)
- **All icons**: Feather icon set from @expo/vector-icons

## 7. Assets to Generate

**Required**:

- `icon.png` - App icon showing camera viewfinder with nutrition label inside (512x512px)
- `splash-icon.png` - Simplified icon for splash screen (400x400px)
- `empty-history.png` - Illustration of empty plate on table, soft shadows, matches color palette. **WHERE USED**: History tab empty state
- `onboarding-scan.png` - Hand holding phone scanning food label, friendly illustration style. **WHERE USED**: Onboarding slide 1
- `onboarding-track.png` - Phone UI showing nutrition summary with checkmarks. **WHERE USED**: Onboarding slide 2
- `onboarding-goals.png` - Trophy or target with healthy food icons around it. **WHERE USED**: Onboarding slide 3
- `default-avatar.png` - Simple user silhouette in circle, green accent. **WHERE USED**: Profile tab before user uploads photo

**Illustration Style**: Flat, friendly, 2D with subtle gradients. Use app color palette (green primary, orange accents). Avoid overly complex details - prioritize clarity at small sizes.
