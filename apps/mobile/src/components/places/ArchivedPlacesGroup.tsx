import { DIVIDER_INSET_PAST_TILE, InsetDivider } from "../InsetDivider";
import { Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { SettingsPillButton } from "@/components/settings/SettingsBlocks";
import { archivedPlaceRows } from "../../lib/placesPage";
import { ReflowBlockGroup } from "./ReflowBlockGroup";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { mobileTextProps } from "@/lib/mobileTypography";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";

/**
 * Places › Archived (location v3 PR 15b, PRD D19 A10; mirrors the web's Archived section): archived
 * places with "History kept" and a Restore pill, shown only when there are some. The Places screen
 * owns the read and the restore; this group only draws them. The group and its rows enter and leave
 * with the shared presence fades and reflow with `localLayoutTransition`, so a restored row leaves
 * while the rows below close up; a refused restore keeps the row and says why under the group.
 */
export function ArchivedPlacesGroup({
  onRestore,
  places,
  problem,
  reduceMotion,
  restoringId,
  styles,
  theme
}: {
  onRestore: (place: { id: string; name: string }) => void;
  places: readonly { id: string; name: string }[];
  /** Why the last restore didn't happen, shown under the group. */
  problem: string | null;
  reduceMotion: boolean;
  /** The place being restored; every Restore waits for it (one change at a time). */
  restoringId: string | null;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const rows = archivedPlaceRows(places);
  if (rows.length === 0) return null;
  return (
    <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} layout={localLayoutTransition(reduceMotion)}>
      <ReflowBlockGroup foot="Not matched or suggested. Past blocks keep their names." reduceMotion={reduceMotion} theme={theme} title="Archived">
        {rows.map((row, index) => (
          <Reanimated.View
            key={row.id}
            entering={localPresenceEntering(reduceMotion)}
            exiting={localPresenceExiting(reduceMotion)}
            layout={localLayoutTransition(reduceMotion)}
          >
            <View style={styles.placesRow} testID={`places-archived-${row.id}`}>
              <View accessible accessibilityLabel={row.accessibilityLabel} style={styles.placesRowMain}>
                <View style={[styles.placesBlock, styles.placesBlockSuggested]}>
                  <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={18} />
                </View>
                <View style={styles.settingsActivityText}>
                  <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={styles.settingsActivityName}>{row.name}</Text>
                  <Text {...mobileTextProps("metadata")} style={styles.settingsActivityMeta}>{row.subtitle}</Text>
                </View>
              </View>
              <View style={styles.placesRowActions}>
                <SettingsPillButton
                  accessibilityLabel={row.restoreLabel}
                  disabled={restoringId !== null}
                  label="Restore"
                  onPress={() => onRestore(row)}
                  theme={theme}
                />
              </View>
              {index > 0 ? <InsetDivider color={theme.border} edge="top" start={DIVIDER_INSET_PAST_TILE} /> : null}
            </View>
          </Reanimated.View>
        ))}
        {problem ? (
          <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
            <Text {...mobileTextProps("metadata")} style={[styles.placesStatus, { color: theme.dangerText }]} testID="places-archived-problem">
              {problem}
            </Text>
          </Reanimated.View>
        ) : null}
      </ReflowBlockGroup>
    </Reanimated.View>
  );
}
