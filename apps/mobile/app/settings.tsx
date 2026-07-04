import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle
} from "react-native";
import { router } from "expo-router";
import {
  ArrowLeft,
  HeartPulse,
  LogOut,
  MapPin,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X
} from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DAYFRAME_PALETTE,
  paletteColorFor,
  paletteKeyFor,
  type DayframePaletteKey
} from "@dayframe/shared";
import {
  AuthRequiredError,
  archiveCategory,
  createCategory,
  fetchBootstrap,
  logout,
  readQueue,
  syncQueue,
  updateCategory,
  type MobileBootstrap,
  type QueuedEvent
} from "@/lib/api";
import {
  friendlyHealthKitError,
  getHealthImportStatus,
  importHealthKitSleep,
  importHealthKitWorkouts,
  requestHealthKitPermission,
  type HealthImportStatus
} from "@/lib/health";
import { requestLocationAccess, startGeofences } from "@/lib/geofence";
import { useMobileTheme, type MobileTheme, type ThemePreference } from "@/lib/theme";

type Category = MobileBootstrap["categories"][number];

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

export default function SettingsScreen() {
  const { theme, themePreference, setThemePreference } = useMobileTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState<DayframePaletteKey>("lime");
  const [pinNewCategory, setPinNewCategory] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState<DayframePaletteKey>("lime");
  const [locationStatus, setLocationStatus] = useState("Not requested");
  const [healthStatus, setHealthStatus] = useState<HealthImportStatus[]>([]);
  const refreshInFlight = useRef(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!options?.silent) setLoading(true);
    try {
      const [bootstrap, queued] = await Promise.all([fetchBootstrap(), readQueue()]);
      setData(bootstrap);
      setQueue(queued);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!options?.silent) {
        Alert.alert("Dayframe API", error instanceof Error ? error.message : "Unable to load API");
      }
    } finally {
      refreshInFlight.current = false;
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    getHealthImportStatus().then(setHealthStatus).catch(() => {
      setHealthStatus([
        {
          provider: "healthkit",
          kind: "availability",
          status: "error",
          notes: "Unable to check Apple Health status."
        }
      ]);
    });
  }, [load]);

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await createCategory(name, { color: newCategoryColor, isPinned: pinNewCategory });
      setNewCategoryName("");
      setNewCategoryColor("lime");
      setPinNewCategory(true);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to create category.");
    }
  }

  function startEditingCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingName(category.name);
    setEditingColor(paletteKeyFor(category.color, category.name));
  }

  function cancelCategoryEdit() {
    setEditingCategoryId(null);
    setEditingName("");
    setEditingColor("lime");
  }

  async function saveCategory(category: Category) {
    const name = editingName.trim();
    if (!name) return;
    try {
      await updateCategory(category.id, { name, color: editingColor });
      cancelCategoryEdit();
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to update category.");
    }
  }

  async function togglePin(category: Category) {
    try {
      await updateCategory(category.id, { isPinned: !category.isPinned });
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to update category.");
    }
  }

  function confirmArchive(category: Category) {
    Alert.alert("Archive category", `Archive ${category.name}? Existing entries keep their history.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () => {
          void archiveExistingCategory(category);
        }
      }
    ]);
  }

  async function archiveExistingCategory(category: Category) {
    try {
      await archiveCategory(category.id);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to archive category.");
    }
  }

  async function syncAndReload() {
    try {
      const result = await syncQueue();
      setQueue(result.remaining);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Sync", error instanceof Error ? error.message : "Unable to sync queued events.");
    }
  }

  async function enableLocation() {
    try {
      const status = await requestLocationAccess();
      setLocationStatus(status);
      if (status.startsWith("Always allowed") && data) {
        const count = await startGeofences(data.places);
        setLocationStatus(`Always allowed. Monitoring ${count} known places.`);
      }
    } catch (error) {
      Alert.alert("Location", error instanceof Error ? error.message : "Unable to update location access.");
    }
  }

  async function connectAppleHealth() {
    try {
      updateHealthStatus(await requestHealthKitPermission());
      await syncAppleHealth({ silent: true });
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "connect Apple Health"));
    }
  }

  async function syncAppleHealth(options?: { silent?: boolean }) {
    try {
      const sleep = await importHealthKitSleep();
      const workouts = await importHealthKitWorkouts();
      updateHealthStatus(sleep);
      updateHealthStatus(workouts);
      await syncAndReload();
      if (!options?.silent) Alert.alert("Apple Health", "Health data sync finished.");
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "sync Apple Health"));
    }
  }

  function updateHealthStatus(status: HealthImportStatus) {
    setHealthStatus((current) => [
      status,
      ...current.filter((item) => !(item.provider === status.provider && item.kind === status.kind))
    ]);
  }

  async function signOut() {
    await logout();
    router.replace("/");
  }

  const healthAvailability =
    healthStatus.find((item) => item.provider === "healthkit" && item.kind === "availability") ??
    healthStatus.find((item) => item.provider === "healthkit");
  const sleepStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "sleep");
  const workoutStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "workout");

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => load()}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.header}>
          <IconButton
            accessibilityLabel="Back to dashboard"
            icon={<ArrowLeft size={21} color={theme.accent} />}
            onPress={() => router.back()}
            styles={styles}
          />
          <View style={styles.headerTitle}>
            <Text style={styles.screenTitle}>Settings</Text>
            <Text style={styles.muted}>Account, categories, sync and permissions.</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <Text style={styles.statusText}>{data?.user?.name ?? "Dayframe user"}</Text>
          <Text style={styles.muted}>{data?.user?.email ?? "Signed in"}</Text>
          <Text style={styles.muted}>{data?.workspace?.name ?? "Workspace"}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.segmentedControl}>
            {themeOptions.map((option) => {
              const selected = option.value === themePreference;
              return (
                <Pressable
                  key={option.value}
                  style={pressable(
                    [styles.segmentButton, selected ? styles.segmentButtonSelected : null],
                    styles.buttonPressed
                  )}
                  onPress={() => setThemePreference(option.value)}
                >
                  <Text style={[styles.segmentButtonText, selected ? styles.segmentButtonTextSelected : null]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Device sync</Text>
          <View style={styles.syncRow}>
            <View style={styles.syncText}>
              <Text style={styles.statusText}>{queue.length} queued events</Text>
              <Text style={styles.muted}>Direct actions sync first; offline actions wait here.</Text>
            </View>
            <Pressable style={pressable(styles.syncButton, styles.buttonPressed)} onPress={syncAndReload}>
              <RefreshCw size={16} color={theme.accent} />
              <Text style={styles.secondaryButtonText}>Sync now</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <Text style={styles.muted}>Pinned categories appear first on the dashboard.</Text>
          <View style={styles.categoryList}>
            {(data?.categories ?? []).map((category) => {
              const editing = editingCategoryId === category.id;
              return (
                <View key={category.id} style={styles.categoryRow}>
                  <View style={[styles.colorDot, { backgroundColor: paletteColorFor(category.color, category.name) }]} />
                  <View style={styles.categoryBody}>
                    {editing ? (
                      <>
                        <TextInput
                          style={styles.inlineInput}
                          value={editingName}
                          onChangeText={setEditingName}
                          placeholder="Category name"
                          placeholderTextColor={theme.textSecondary}
                        />
                        <ColorPalette
                          selectedColor={editingColor}
                          onSelect={setEditingColor}
                          styles={styles}
                        />
                        <View style={styles.compactButtonRow}>
                          <Pressable
                            style={pressable(styles.secondaryButton, styles.buttonPressed)}
                            onPress={cancelCategoryEdit}
                          >
                            <X size={16} color={theme.accent} />
                            <Text style={styles.secondaryButtonText}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            style={pressable(styles.primaryButton, styles.buttonPressed)}
                            onPress={() => saveCategory(category)}
                          >
                            <Save size={16} color="#FFFFFF" />
                            <Text style={styles.primaryButtonText}>Save</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.categoryName}>{category.name}</Text>
                        <Text style={styles.muted}>{category.isPinned ? "Pinned to dashboard" : "Not pinned"}</Text>
                      </>
                    )}
                  </View>
                  {!editing ? (
                    <View style={styles.categoryActions}>
                      <IconButton
                        accessibilityLabel={`${category.isPinned ? "Unpin" : "Pin"} ${category.name}`}
                        icon={<Pin size={17} color={category.isPinned ? theme.accent : theme.textSecondary} />}
                        onPress={() => togglePin(category)}
                        styles={styles}
                        selected={category.isPinned}
                      />
                      <IconButton
                        accessibilityLabel={`Edit ${category.name}`}
                        icon={<Pencil size={17} color={theme.accent} />}
                        onPress={() => startEditingCategory(category)}
                        styles={styles}
                      />
                      <IconButton
                        accessibilityLabel={`Archive ${category.name}`}
                        icon={<Trash2 size={17} color={theme.danger} />}
                        onPress={() => confirmArchive(category)}
                        styles={styles}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          <TextInput
            style={styles.textInput}
            value={newCategoryName}
            onChangeText={setNewCategoryName}
            onSubmitEditing={addCategory}
            placeholder="New category"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
          />
          <ColorPalette selectedColor={newCategoryColor} onSelect={setNewCategoryColor} styles={styles} />
          <View style={styles.buttonRow}>
            <Pressable
              style={pressable([styles.secondaryButton, pinNewCategory ? styles.toggleSelected : null], styles.buttonPressed)}
              onPress={() => setPinNewCategory((current) => !current)}
            >
              <Pin size={16} color={theme.accent} />
              <Text style={styles.secondaryButtonText}>{pinNewCategory ? "Pinned" : "Pin later"}</Text>
            </Pressable>
            <Pressable style={pressable(styles.primaryButton, styles.buttonPressed)} onPress={addCategory}>
              <Plus size={16} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Create</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.sectionHeadingRow}>
            <MapPin size={18} color={theme.accent} />
            <Text style={styles.sectionTitle}>Location</Text>
          </View>
          <Text style={styles.muted}>
            Enable location so known places can become reviewable activity suggestions.
          </Text>
          <Text style={styles.statusText}>{locationStatus}</Text>
          <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={enableLocation}>
            <Text style={styles.secondaryButtonText}>Enable location</Text>
          </Pressable>
        </View>

        <View style={styles.panel}>
          <View style={styles.sectionHeadingRow}>
            <HeartPulse size={18} color={theme.accent} />
            <Text style={styles.sectionTitle}>Health data</Text>
          </View>
          <Text style={styles.muted}>
            Connect Apple Health to queue sleep and workout summaries as activity events.
          </Text>
          <Text style={styles.statusText}>{healthAvailability?.notes ?? "Apple Health status not checked."}</Text>
          <Text style={styles.muted}>Sleep: {sleepStatus?.notes ?? "Not synced yet."}</Text>
          <Text style={styles.muted}>Workouts: {workoutStatus?.notes ?? "Not synced yet."}</Text>
          <View style={styles.buttonRow}>
            <Pressable style={pressable(styles.primaryButton, styles.buttonPressed)} onPress={connectAppleHealth}>
              <HeartPulse size={16} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Connect Apple Health</Text>
            </Pressable>
            <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => syncAppleHealth()}>
              <RefreshCw size={16} color={theme.accent} />
              <Text style={styles.secondaryButtonText}>Sync now</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={signOut}>
            <LogOut size={16} color={theme.accent} />
            <Text style={styles.secondaryButtonText}>Log out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function IconButton({
  accessibilityLabel,
  icon,
  onPress,
  selected,
  styles
}: {
  accessibilityLabel: string;
  icon: ReactNode;
  onPress: () => void;
  selected?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={pressable([styles.iconButton, selected ? styles.iconButtonSelected : null], styles.buttonPressed)}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
}

function ColorPalette({
  onSelect,
  selectedColor,
  styles
}: {
  onSelect: (color: DayframePaletteKey) => void;
  selectedColor: DayframePaletteKey;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.paletteGrid}>
      {DAYFRAME_PALETTE.map((color) => {
        const selected = color.key === selectedColor;
        return (
          <Pressable
            key={color.key}
            accessibilityRole="button"
            accessibilityLabel={`Use ${color.label}`}
            style={pressable(
              [
                styles.paletteSwatch,
                { backgroundColor: color.hex },
                selected ? styles.paletteSwatchSelected : null
              ],
              styles.buttonPressed
            )}
            onPress={() => onSelect(color.key)}
          />
        );
      })}
    </View>
  );
}

function pressable(baseStyle: ViewStyle | Array<ViewStyle | null>, pressedStyle: ViewStyle) {
  return ({ pressed }: { pressed: boolean }) => [
    ...(Array.isArray(baseStyle) ? baseStyle : [baseStyle]),
    pressed ? pressedStyle : null
  ];
}

const monoFont = "System";

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background
    },
    scrollView: {
      flex: 1
    },
    container: {
      padding: 18,
      paddingBottom: 88,
      gap: 16,
      backgroundColor: theme.background
    },
    header: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: 12
    },
    headerTitle: {
      flex: 1,
      gap: 2
    },
    screenTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 22,
      fontWeight: "800"
    },
    panel: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      gap: 12
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    sectionHeadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    muted: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    statusText: {
      fontSize: 13,
      color: theme.textPrimary,
      fontWeight: "800",
      fontFamily: monoFont
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    textInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    inlineInput: {
      minHeight: 40,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 10,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    segmentedControl: {
      flexDirection: "row",
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
      overflow: "hidden"
    },
    segmentButton: {
      flex: 1,
      alignItems: "center",
      borderRightWidth: 1,
      borderRightColor: theme.border,
      paddingVertical: 9
    },
    segmentButtonSelected: {
      backgroundColor: theme.surfaceInset
    },
    segmentButtonText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontWeight: "700"
    },
    segmentButtonTextSelected: {
      color: theme.accent
    },
    categoryList: {
      gap: 8
    },
    categoryRow: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      padding: 8,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      flexWrap: "wrap"
    },
    categoryBody: {
      minWidth: 0,
      flex: 1,
      gap: 8
    },
    categoryName: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "800"
    },
    colorDot: {
      width: 12,
      height: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 999
    },
    buttonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10
    },
    compactButtonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    categoryActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6
    },
    syncRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 12
    },
    syncText: {
      minWidth: 0,
      flexGrow: 1,
      flexShrink: 1,
      gap: 2
    },
    syncButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      flexShrink: 0
    },
    primaryButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8
    },
    secondaryButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8
    },
    textAction: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 12,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center"
    },
    toggleSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    primaryButtonText: {
      color: theme.mode === "dark" ? theme.background : "#FFFFFF",
      fontWeight: "800",
      fontFamily: monoFont
    },
    secondaryButtonText: {
      color: theme.accent,
      fontWeight: "800",
      fontFamily: monoFont
    },
    iconButton: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surface
    },
    iconButtonSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    paletteGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    paletteSwatch: {
      width: 34,
      height: 30,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 9
    },
    paletteSwatchSelected: {
      borderWidth: 3,
      borderColor: theme.accent
    },
    buttonPressed: {
      opacity: 0.84,
      transform: [{ translateY: 1 }]
    }
  });
}
