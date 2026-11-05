# InterlinkERP style guide

Every InterlinkERP app follows this guide, so the suite reads as one product. This file is the same in each repo: change it in all of them together. Each repo has a test that fails when its tokens drift from the tables below (`tests/styleGuide.test.ts` in Recruitment, `src/styleGuide.test.ts` in Planning).

## Colour

| Role | Light | Dark |
| :--- | :--- | :--- |
| Page background | `#f6f8fb` | `#121316` |
| Surface (cards, menus, dialogs) | `#ffffff` | `#1a1c23` |
| Text and headings | `#0e1b2c` | `#f8fafc` |
| Secondary text | `#5a6b80` | `#94a3b8` |
| Borders | `#e3e8ef` | `#2e333d` |
| Borders on hover | `#cbd5e1` | `#404756` |
| Quiet fill (tracks, hover) | `#eef2f6` | `#252831` |
| Primary (logo navy) | `#00005f` | `#6e6eaa` |
| Primary on hover | `#00003f` | `#5c5c94` |

Navy is the only accent. Use green, amber and red only for status, and in Planning a role's own colour only to identify that role.

## Type

The font stack is `-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif`. Sentence case everywhere.

| Use | Size | Weight |
| :--- | :--- | :--- |
| Page title | 28px (1.75rem) | 600 |
| Context title (a job, a date range) | 23.2px (1.45rem) | 600 |
| Section heading | 16px | 600 |
| Body | 13.5px | 400 to 500 |
| Secondary text | 12 to 12.5px | 400 to 500 |

## Controls

| Control | Height | Radius | Text |
| :--- | :--- | :--- | :--- |
| Button | 37px | 8px | 14px, 500 |
| Small button (in rows and tables) | 29px | 8px | 12.8px, 500 |
| Text field and select | 40px | 8px | 14px |
| Segmented control option | 29px | 7px, in a 10px track | 12.8px, 500 |

- One filled primary button per view. Everything else is a white button with a border.
- Pills are for navigation, status badges and the profile badge, never for buttons.

## Layout and components

- **Header:** 68px, with 32px between the screen edge and the brand and 32px between the brand and the nav.
- **Brand:** 34px logo, a 1px divider, the app's name at 12px weight 650, and a Demo badge on demos.
- **Nav:** a pill track, with icons, and a navy active item.
- **Profile:** the profile badge at the top right: avatar, name and role.
- **Page header:** the page title, then a one-line description in secondary text.
- **Cards:** 16px radius with a 1px border. Dialogs: 22px radius, up to 580px wide.
- **Status badges:** pills at 12px weight 650.
- **Tables:** headers at 13.6px weight 700 on the page background, with cells padded 12px by 16px.
- **Demos** open in light mode. A saved choice wins over that.
