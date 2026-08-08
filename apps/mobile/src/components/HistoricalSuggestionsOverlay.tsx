import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import {
  paletteColorFor,
  type RecentActivitySuggestion
} from "@dayframe/shared";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION } from "@/lib/motion";
import {
  resolveHistoricalSuggestionsOverlayHeight,
  type HistoricalSuggestionsOverlayGeometry
} from "@/lib/timeEntrySheetGeometry";
import {
  createHistoricalSuggestionsOverlayContinuityState,
  recordHistoricalSuggestionsOverlayContinuity,
  resolveHistoricalSuggestionsOverlayMotionAction
} from "@/lib/historicalSuggestionsOverlayContinuity";

export type HistoricalSuggestionsOverlayRenderState = {
  containerVisible: boolean;
  contentHeight: number;
  contentKey: string;
  contentMeasured: boolean;
  headerHeight: number;
  presentationId: number;
  renderedHeight: number;
  suggestionCount: number;
  updatePending: boolean;
  updateVisibilityDropCount: number;
};

export function HistoricalSuggestionsOverlay({
  disabled,
  contentKey,
  geometry,
  onAnimationFinished,
  onRenderStateChange,
  onSelect,
  onStaleCallback,
  presentationId,
  reduceMotion,
  styles,
  suggestions,
  theme,
  visible
}: {
  disabled: boolean;
  contentKey: string;
  geometry: HistoricalSuggestionsOverlayGeometry | null;
  onAnimationFinished: (presentationId: number, direction: "open" | "close") => void;
  onRenderStateChange: (state: HistoricalSuggestionsOverlayRenderState) => void;
  onSelect: (suggestion: RecentActivitySuggestion) => void;
  onStaleCallback?: () => void;
  presentationId: number;
  reduceMotion: boolean;
  styles: MobileStyles;
  suggestions: RecentActivitySuggestion[];
  theme: MobileTheme;
  visible: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const [contentMeasurement, setContentMeasurement] = useState({
    contentHeight: 0,
    contentKey,
    headerHeight: 0,
    presentationId
  });
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const onAnimationFinishedRef = useRef(onAnimationFinished);
  const onRenderStateChangeRef = useRef(onRenderStateChange);
  const onStaleCallbackRef = useRef(onStaleCallback);
  const activePresentationIdRef = useRef(presentationId);
  const activeContentKeyRef = useRef(contentKey);
  const continuityRef = useRef(createHistoricalSuggestionsOverlayContinuityState());
  onAnimationFinishedRef.current = onAnimationFinished;
  onRenderStateChangeRef.current = onRenderStateChange;
  onStaleCallbackRef.current = onStaleCallback;
  activePresentationIdRef.current = presentationId;
  activeContentKeyRef.current = contentKey;

  const renderable = Boolean(geometry && geometry.maxHeight > 0);
  const measuredForPresentation = contentMeasurement.presentationId === presentationId;
  const measuredForCurrentContent = measuredForPresentation &&
    contentMeasurement.contentKey === contentKey;
  const contentMeasured = Boolean(
    measuredForCurrentContent &&
    contentMeasurement.headerHeight > 0 &&
    contentMeasurement.contentHeight > 0
  );
  const retainedContentMeasured = Boolean(
    measuredForPresentation &&
    contentMeasurement.headerHeight > 0 &&
    contentMeasurement.contentHeight > 0
  );
  const currentRenderedHeight = resolveHistoricalSuggestionsOverlayHeight({
    contentHeight: contentMeasured ? contentMeasurement.contentHeight : 0,
    headerHeight: contentMeasured ? contentMeasurement.headerHeight : 0,
    maxHeight: geometry?.maxHeight ?? 0
  });
  const retainedRenderedHeight = resolveHistoricalSuggestionsOverlayHeight({
    contentHeight: retainedContentMeasured ? contentMeasurement.contentHeight : 0,
    headerHeight: retainedContentMeasured ? contentMeasurement.headerHeight : 0,
    maxHeight: geometry?.maxHeight ?? 0
  });
  const renderedHeight = contentMeasured
    ? currentRenderedHeight
    : retainedRenderedHeight;
  const paintableContent = renderedHeight > 0 && (contentMeasured || retainedContentMeasured);
  const containerVisible = Boolean(
    visible && renderable && paintableContent && surfaceVisible
  );
  const motionAction = resolveHistoricalSuggestionsOverlayMotionAction({
    contentMeasured,
    currentRenderedHeight,
    mounted,
    paintableContent,
    reduceMotion,
    renderable,
    surfaceVisible,
    visible
  });

  useLayoutEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    setSurfaceVisible(false);
    setContentMeasurement((current) => ({
      contentHeight: 0,
      contentKey,
      headerHeight: current.presentationId === presentationId ? current.headerHeight : 0,
      presentationId
    }));
  }, [presentationId, progress]);

  useEffect(() => {
    const nextContinuity = recordHistoricalSuggestionsOverlayContinuity(
      continuityRef.current,
      {
        containerVisible,
        contentKey,
        contentMeasured,
        presentationId,
        renderedHeight,
        targetVisible: visible
      }
    );
    continuityRef.current = nextContinuity;
    onRenderStateChangeRef.current({
      containerVisible,
      contentHeight: contentMeasured ? contentMeasurement.contentHeight : 0,
      contentKey,
      contentMeasured,
      headerHeight: contentMeasured ? contentMeasurement.headerHeight : 0,
      presentationId,
      renderedHeight,
      suggestionCount: suggestions.length,
      updatePending: nextContinuity.pendingContentKey === contentKey,
      updateVisibilityDropCount: nextContinuity.updateVisibilityDropCount
    });
  }, [
    containerVisible,
    contentMeasurement.contentHeight,
    contentMeasurement.headerHeight,
    contentKey,
    contentMeasured,
    presentationId,
    renderedHeight,
    suggestions.length,
    visible
  ]);

  useEffect(() => {
    const animationPresentationId = presentationId;
    const animationContentKey = contentKey;
    progress.stopAnimation();
    if (motionAction === "mount") {
      setMounted(true);
      return undefined;
    }
    if (motionAction === "hold_visible_update") {
      progress.setValue(1);
      return undefined;
    }
    if (motionAction === "await_measurement" || motionAction === "stay_hidden") {
      progress.setValue(0);
      setSurfaceVisible(false);
      return undefined;
    }
    if (motionAction === "show_immediately" || motionAction === "hide_immediately") {
      const showing = motionAction === "show_immediately";
      progress.setValue(showing ? 1 : 0);
      setSurfaceVisible(showing);
      if (!showing) setMounted(false);
      onAnimationFinishedRef.current(animationPresentationId, showing ? "open" : "close");
      return undefined;
    }
    const opening = motionAction === "animate_open";
    const animation = Animated.timing(progress, {
      toValue: opening ? 1 : 0,
      duration: opening ? MOBILE_MOTION.layout : MOBILE_MOTION.control,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start(({ finished }) => {
      if (!finished) return;
      if (
        activePresentationIdRef.current !== animationPresentationId ||
        activeContentKeyRef.current !== animationContentKey
      ) {
        onStaleCallbackRef.current?.();
        return;
      }
      progress.setValue(opening ? 1 : 0);
      setSurfaceVisible(opening);
      if (!opening) setMounted(false);
      onAnimationFinishedRef.current(animationPresentationId, opening ? "open" : "close");
    });
    return () => animation.stop();
  }, [
    contentKey,
    motionAction,
    presentationId,
    progress,
    visible
  ]);

  if (!mounted || !geometry || geometry.maxHeight <= 0) return null;

  // Keep an invisible max-height measurement host until both intrinsic pieces
  // report for the current content generation. Only the resolved, bounded
  // height is ever exposed visually or to accessibility.
  const layoutHeight = paintableContent ? renderedHeight : geometry.maxHeight;

  return (
    <Animated.View
      accessibilityLabel="Historical Suggestions"
      accessibilityLiveRegion="polite"
      accessibilityElementsHidden={!containerVisible}
      importantForAccessibility={containerVisible ? "auto" : "no-hide-descendants"}
      pointerEvents={containerVisible ? "auto" : "none"}
      style={[
        styles.historicalSuggestionsOverlay,
        geometry,
        {
          height: layoutHeight,
          opacity: paintableContent ? progress : 0,
          transform: [{
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: reduceMotion ? [0, 0] : [-6, 0]
            })
          }]
        }
      ]}
      testID="historical-suggestions-overlay"
    >
      <View style={styles.historicalSuggestionsSurface}>
        <Text
          key={`historical-suggestions-header-${presentationId}`}
          onLayout={(event) => {
            const measurementPresentationId = presentationId;
            const headerHeight = event.nativeEvent.layout.height;
            if (activePresentationIdRef.current !== measurementPresentationId) {
              onStaleCallbackRef.current?.();
              return;
            }
            setContentMeasurement((current) => ({
              ...current,
              headerHeight,
              presentationId: measurementPresentationId
            }));
          }}
          style={styles.taskSuggestionsTitle}
        >
          SUGGESTIONS
        </Text>
        <ScrollView
          accessibilityLabel="Historical Suggestions results"
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={styles.historicalSuggestionsList}
          testID="historical-suggestions-list"
        >
          <View
            key={`historical-suggestions-content-${contentKey}`}
            onLayout={(event) => {
              const measurementPresentationId = presentationId;
              const measurementContentKey = contentKey;
              const contentHeight = event.nativeEvent.layout.height;
              if (
                activePresentationIdRef.current !== measurementPresentationId
              ) {
                onStaleCallbackRef.current?.();
                return;
              }
              if (activeContentKeyRef.current !== measurementContentKey) return;
              setContentMeasurement((current) => ({
                ...current,
                contentHeight,
                contentKey: measurementContentKey,
                presentationId: measurementPresentationId
              }));
            }}
          >
            {suggestions.map((suggestion, index) => (
              <HistoricalSuggestionRow
                key={suggestion.key}
                disabled={disabled}
                index={index}
                onPress={() => onSelect(suggestion)}
                styles={styles}
                suggestion={suggestion}
                theme={theme}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

function HistoricalSuggestionRow({
  disabled,
  index,
  onPress,
  styles,
  suggestion,
  theme
}: {
  disabled: boolean;
  index: number;
  onPress: () => void;
  styles: MobileStyles;
  suggestion: RecentActivitySuggestion;
  theme: MobileTheme;
}) {
  const categoryName = suggestion.categoryName;
  const tagLabel = suggestion.tagNames.map((tag) => `#${tag}`).join(" ");
  const color = categoryName
    ? paletteColorFor(suggestion.categoryColor ?? null, categoryName, theme.mode)
    : null;

  return (
    <Pressable
      accessibilityLabel={[
        `Apply ${suggestion.description}`,
        categoryName ? `in ${categoryName}` : null,
        tagLabel ? `with ${tagLabel}` : null
      ].filter(Boolean).join(" ")}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={pressable(
        [
          styles.taskSuggestionRow,
          { backgroundColor: theme.surfaceRaised },
          index > 0 ? styles.taskSuggestionRowDivider : null,
          disabled ? styles.buttonDisabled : null
        ],
        styles.buttonPressed
      )}
      testID={`historical-suggestion-row-${index}`}
    >
      <View style={styles.taskSuggestionTextStack}>
        <Text style={styles.taskSuggestionTitle} numberOfLines={1}>
          {suggestion.description}
        </Text>
        <View style={styles.taskSuggestionMetadataLine}>
          {categoryName && color ? (
            <View style={styles.taskSuggestionMetaRow}>
              <View style={[styles.colorDot, { backgroundColor: color }]} />
              <Text style={styles.taskSuggestionMeta} numberOfLines={1}>{categoryName}</Text>
            </View>
          ) : null}
          {tagLabel ? (
            <Text style={styles.taskSuggestionTags} numberOfLines={1}>{tagLabel}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
