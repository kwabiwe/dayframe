import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps
} from "react-native";
import type { MobileTheme } from "@/lib/mobileTheme";

export type KeyboardAccessoryField = {
  id: string;
  ref: RefObject<TextInput | null>;
};

type UseKeyboardAccessoryOptions = {
  nativeID: string;
  fields: KeyboardAccessoryField[];
  theme: MobileTheme;
};

type KeyboardAccessoryInputProps = Pick<TextInputProps, "inputAccessoryViewID" | "onFocus">;

export function useKeyboardAccessory({ nativeID, fields, theme }: UseKeyboardAccessoryOptions) {
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const [accessoriesMounted, setAccessoriesMounted] = useState(false);
  const currentIndex = fields.findIndex((field) => field.id === focusedFieldId);
  const canMovePrevious = currentIndex > 0;
  const canMoveNext = currentIndex >= 0 && currentIndex < fields.length - 1;

  useEffect(() => {
    setAccessoriesMounted(false);
    const mountTimer = setTimeout(() => setAccessoriesMounted(true), 0);

    return () => clearTimeout(mountTimer);
  }, [fields]);

  useEffect(() => {
    if (focusedFieldId && !fields.some((field) => field.id === focusedFieldId)) {
      setFocusedFieldId(null);
    }
  }, [fields, focusedFieldId]);

  const focusAt = useCallback((index: number) => {
    const field = fields[index];
    if (!field) return;

    field.ref.current?.focus();
    setFocusedFieldId(field.id);
  }, [fields]);

  const focusPrevious = useCallback(() => {
    if (currentIndex > 0) focusAt(currentIndex - 1);
  }, [currentIndex, focusAt]);

  const focusNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < fields.length - 1) focusAt(currentIndex + 1);
  }, [currentIndex, fields.length, focusAt]);

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
    setFocusedFieldId(null);
  }, []);

  const getTextInputProps = useCallback((fieldId: string): KeyboardAccessoryInputProps => ({
    inputAccessoryViewID: Platform.OS === "ios" ? accessoryIDForField(nativeID, fieldId) : undefined,
    onFocus: () => setFocusedFieldId(fieldId)
  }), [nativeID]);

  const accessory = Platform.OS === "ios"
    ? accessoriesMounted ? fields.map((field) => (
      <InputAccessoryView key={field.id} nativeID={accessoryIDForField(nativeID, field.id)}>
        <AccessoryToolbar
          canMoveNext={canMoveNext}
          canMovePrevious={canMovePrevious}
          onDone={dismiss}
          onNext={focusNext}
          onPrevious={focusPrevious}
          theme={theme}
        />
      </InputAccessoryView>
    )) : null
    : null;

  return {
    accessory,
    dismiss,
    focusNext,
    focusPrevious,
    getTextInputProps
  };
}

function accessoryIDForField(nativeID: string, fieldID: string) {
  return `${nativeID}-${fieldID}`;
}

function AccessoryToolbar({
  canMoveNext,
  canMovePrevious,
  onDone,
  onNext,
  onPrevious,
  theme
}: {
  canMoveNext: boolean;
  canMovePrevious: boolean;
  onDone: () => void;
  onNext: () => void;
  onPrevious: () => void;
  theme: MobileTheme;
}) {
  return (
    <View
      style={[
        accessoryStyles.toolbar,
        {
          backgroundColor: theme.surface,
          borderTopColor: theme.borderStrong
        }
      ]}
    >
      <View style={accessoryStyles.navigationGroup}>
        <AccessoryButton disabled={!canMovePrevious} label="Previous" onPress={onPrevious} theme={theme} />
        <AccessoryButton disabled={!canMoveNext} label="Next" onPress={onNext} theme={theme} />
      </View>
      <AccessoryButton label="Done" onPress={onDone} theme={theme} variant="primary" />
    </View>
  );
}

function AccessoryButton({
  disabled = false,
  label,
  onPress,
  theme,
  variant = "secondary"
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  theme: MobileTheme;
  variant?: "primary" | "secondary";
}) {
  const primary = variant === "primary";

  return (
    <Pressable
      accessibilityLabel={label === "Done" ? "Dismiss keyboard" : `${label} field`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        accessoryStyles.button,
        {
          backgroundColor: primary ? theme.accent : theme.surfaceInset,
          borderColor: primary ? theme.accent : theme.borderStrong
        },
        pressed && !disabled ? accessoryStyles.buttonPressed : null,
        disabled ? accessoryStyles.buttonDisabled : null
      ]}
    >
      <Text
        style={[
          accessoryStyles.buttonText,
          {
            color: primary
              ? theme.mode === "dark" ? theme.background : "#FFFFFF"
              : disabled ? theme.textSecondary : theme.accent
          }
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const accessoryStyles = StyleSheet.create({
  toolbar: {
    minHeight: 48,
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  navigationGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  button: {
    minHeight: 36,
    minWidth: 76,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonPressed: {
    opacity: 0.84,
    transform: [{ translateY: 1 }]
  },
  buttonDisabled: {
    opacity: 0.45
  },
  buttonText: {
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "800"
  }
});
