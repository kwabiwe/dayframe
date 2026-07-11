type NavigationThemeInput = {
  accent: string;
  background: string;
  surfaceRaised: string;
  textPrimary: string;
  border: string;
};

export function createNavigationColors(theme: NavigationThemeInput) {
  return {
    primary: theme.accent,
    background: theme.background,
    card: theme.surfaceRaised,
    text: theme.textPrimary,
    border: theme.border,
    notification: theme.accent
  };
}
