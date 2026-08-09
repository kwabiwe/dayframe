import Foundation
import XCTest

final class DayframeSheetQATests: XCTestCase {
  private var app: XCUIApplication!
  private var configuration: SheetQAConfiguration!
  private var reporter: SheetQANDJSONReporter!
  private var openSequence = 0

  override func setUpWithError() throws {
    continueAfterFailure = false
    configuration = try SheetQAConfiguration.load()
    app = XCUIApplication(bundleIdentifier: "com.layereight.dayframe")
    reporter = SheetQANDJSONReporter(
      configuration: configuration,
      nativeGeometryProvider: { [weak self] in self?.nativeGeometryEvidence() ?? [:] }
    )
    app.launchArguments += [
      "-AppleLanguages", "(en-GB)",
      "-AppleLocale", "en_GB"
    ]
    if let metroPort = ProcessInfo.processInfo.environment["DAYFRAME_SHEET_QA_METRO_PORT"],
       !metroPort.isEmpty,
       !metroPort.hasPrefix("$(") {
      app.launchEnvironment["RCT_METRO_PORT"] = metroPort
      app.launchArguments += ["-RCT_jsLocation", "127.0.0.1:\(metroPort)"]
    }
  }

  override func tearDownWithError() throws {
    app?.terminate()
  }

  func testConfiguredFlow() {
    reporter.record(
      "test_started",
      success: true,
      details: [
        "iterations": configuration.iterations,
        "xcode": ProcessInfo.processInfo.operatingSystemVersionString
      ]
    )

    do {
      app.launch()
      try require(
        app.state == .runningForeground,
        "Dayframe did not reach the foreground after launch."
      )
      try runConfiguredFlow()
      reporter.record("test_finished", success: true)
    } catch {
      reporter.record("test_finished", success: false, message: String(describing: error))
      XCTFail(String(describing: error))
    }
  }

  func testTagReliabilityFlow() {
    reporter.record("test_started", step: "tag_reliability", success: true)
    do {
      app.launch()
      try require(app.state == .runningForeground, "Dayframe did not reach the foreground.")
      try runTagFlow()
      reporter.record("test_finished", step: "tag_reliability", success: true)
    } catch {
      reporter.record(
        "test_finished",
        step: "tag_reliability",
        success: false,
        message: String(describing: error)
      )
      XCTFail(String(describing: error))
    }
  }

  func testRunningDeleteReachabilityFlow() {
    reporter.record("test_started", step: "running_delete_reachability", success: true)
    do {
      app.launch()
      try require(app.state == .runningForeground, "Dayframe did not reach the foreground.")
      _ = try deleteFixture("existing", step: "running_delete_reachability", iteration: nil)
      reporter.record("test_finished", step: "running_delete_reachability", success: true)
    } catch {
      reporter.record(
        "test_finished",
        step: "running_delete_reachability",
        success: false,
        message: String(describing: error)
      )
      XCTFail(String(describing: error))
    }
  }

  private func runConfiguredFlow() throws {
    switch configuration.flow {
    case .smoke:
      try runSmokeFlow()
    case .blank:
      try runBlankFlow()
    case .existingBlank:
      try runExistingBlankFlow()
    case .existing:
      try runExistingFlow()
    case .completed:
      try runCompletedFlow()
    case .add:
      try runAddFlow()
    case .review:
      try runReviewFlow()
    case .journeys:
      try runJourneyFlows()
    case .keyboard:
      try runKeyboardFlow()
    case .tags:
      try repeatFlow("tags", count: configuration.iterations, body: runTagFlow)
    case .swipe:
      try runSwipeFlow()
    case .gestures:
      try runKeyboardFlow()
      try runFocusGenerationHandoffFlow()
      try runSwipeFlow()
    case .failures:
      try runMutationFailureFlows()
    case .stress:
      try runStressFlow()
    case .deleteUndo:
      try repeatFlow("delete_undo", count: configuration.iterations, body: runDeleteUndoFlow)
    case .deleteExpiry:
      try repeatFlow("delete_expiry", count: configuration.iterations, body: runDeleteExpiryFlow)
    case .deleteCanonical:
      try repeatFlow("delete_canonical", count: configuration.iterations, body: runDeleteCanonicalFlow)
    case .deleteInvalidation:
      try repeatFlow("delete_invalidation", count: configuration.iterations, body: runDeleteInvalidationFlow)
    case .deletion:
      try runDeletionFlows()
    case .all:
      try runJourneyFlows()
      try runKeyboardFlow()
      try runTagFlow()
      try runSwipeFlow()
      try runMutationFailureFlows()
      try runStressFlow()
      try runDeletionFlows()
    }
  }

  private func runSmokeFlow() throws {
    let opened = try openHarness(fixture: "blank", count: 1)
    try requireSoftwareKeyboard("blank smoke")
    let sheet = try waitForSheet("blank smoke ready") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try assertPresentedSheet(sheet, harness: opened, reason: "blank_timer_started")
    reporter.record("checkpoint", step: "blank_smoke_ready", success: true, state: sheet)
    try dismissWithDone(step: "blank_smoke_exit")
  }

  private func runJourneyFlows() throws {
    for iteration in 1 ... configuration.iterations {
      reporter.record("iteration_started", step: "journeys", iteration: iteration, success: true)
      try runBlankFlow(iteration: iteration)
      try runExistingBlankFlow(iteration: iteration)
      try runExistingFlow(iteration: iteration)
      try runCompletedFlow(iteration: iteration)
      try runAddFlow(iteration: iteration)
      try runReviewFlow(iteration: iteration)
      reporter.record("iteration_finished", step: "journeys", iteration: iteration, success: true)
    }
  }

  private func runBlankFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "blank", count: 12)
    try requireSoftwareKeyboard("blank Play")
    let initial = try waitForSheet("blank Play focus, keyboard, and Suggestions") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && SheetQAValue.int(state, "focusCommandCount") == 1
        && SheetQAValue.int(state, "inputFocusCount") == 1
    }
    try assertPresentedSheet(initial, harness: harness, reason: "blank_timer_started")
    try require(
      SheetQAValue.int(initial, "overlayMeasuredSuggestionCount") == 12,
      "The long-result blank fixture did not settle all 12 Suggestions.",
      state: initial
    )
    let stop = element(SheetQAIdentifiers.stop)
    let sheetElement = element(SheetQAIdentifiers.sheet)
    try require(
      stop.exists && stop.isHittable,
      "Running Stop was not available while the blank keyboard and Suggestions overlay were visible.",
      state: initial
    )
    try require(
      sheetElement.exists && sheetElement.frame.contains(stop.frame),
      "Running Stop was not geometrically contained by the visible sheet.",
      state: initial
    )
    let elapsed = element(SheetQAIdentifiers.elapsed)
    try require(
      elapsed.exists && !elapsed.frame.isEmpty && sheetElement.frame.intersects(elapsed.frame),
      "Running elapsed marker was not visible inside the blank sheet.",
      state: initial
    )
    let initialSheet = try requiredRect(initial, key: "sheetRect")
    let initialDescription = try requiredRect(initial, key: "descriptionRect")
    reporter.record("checkpoint", step: "blank_play_ready", iteration: iteration, success: true, state: initial)

    let field = element(SheetQAIdentifiers.description)
    try require(field.exists && field.isHittable, "Blank Play Description was not hittable.", state: initial)
    field.typeText("bau")
    let queried = try waitForSheet("Bauhaus query settled") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && SheetQAValue.bool(state, "suggestionsAreVisiblyRenderable") == true
        && SheetQAValue.int(state, "overlayMeasuredSuggestionCount") == 1
    }
    let queriedSheet = try requiredRect(queried, key: "sheetRect")
    let queriedDescription = try requiredRect(queried, key: "descriptionRect")
    try require(
      initialSheet.isWithin(1, of: queriedSheet),
      "Typing a Suggestion query changed the settled live sheet geometry by more than one point.",
      state: queried
    )
    try require(
      initialDescription.isWithin(1, of: queriedDescription),
      "Typing a Suggestion query moved the Description anchor by more than one point.",
      state: queried
    )
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
    let longResults = try waitForSheet("long Suggestions restored") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && SheetQAValue.bool(state, "suggestionsAreVisiblyRenderable") == true
        && SheetQAValue.int(state, "overlayMeasuredSuggestionCount") == 12
    }
    let longResultsSheet = try requiredRect(longResults, key: "sheetRect")
    let longResultsDescription = try requiredRect(longResults, key: "descriptionRect")
    try require(
      initialSheet.isWithin(1, of: longResultsSheet),
      "Restoring the long Suggestions result set changed live sheet geometry by more than one point.",
      state: longResults
    )
    try require(
      initialDescription.isWithin(1, of: longResultsDescription),
      "Restoring the long Suggestions result set moved Description by more than one point.",
      state: longResults
    )
    field.typeText("bau")
    _ = try waitForSheet("Bauhaus query restored for selection") { state in
      SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && SheetQAValue.int(state, "overlayMeasuredSuggestionCount") == 1
        && self.suggestionsAreVisiblyRenderable(state)
    }
    let suggestion = element("historical-suggestion-row-0")
    try waitForElement(suggestion, description: "Bauhaus historical suggestion")
    try require(
      suggestion.label.localizedCaseInsensitiveContains("Bauhaus research"),
      "The top substring suggestion was not Bauhaus research; got \"\(suggestion.label)\"."
    )
    reporter.record(
      "expected_overlay_exit",
      step: "blank_suggestion_selection",
      iteration: iteration,
      success: true,
      state: try sheetState(),
      details: ["expectedOverlayExit": true, "expectedTransition": true]
    )
    suggestion.tap()

    try waitForElementValue(field, equals: "Bauhaus research", description: "applied suggestion Description")
    let applied = try waitForSheet("suggestion application settled") { state in
      SheetQAValue.string(state, "suggestionsPhase") == "closed"
        && SheetQAValue.string(state, "sheetPhase") == "presented"
    }
    let focusCategory = elementWithLabel("Set category to Focus")
    try require(focusCategory.exists && focusCategory.isSelected, "Bauhaus selection did not select Focus.")
    try require(elementWithLabel("Remove tag A24").exists, "Bauhaus selection did not apply tag A24.")
    try require(elementWithLabel("Remove tag Launch").exists, "Bauhaus selection did not apply tag Launch.")
    reporter.record(
      "checkpoint",
      step: "blank_suggestion_applied",
      iteration: iteration,
      success: true,
      state: applied,
      details: [
        "initialSheetRect": initialSheet.json,
        "initialDescriptionRect": initialDescription.json,
        "queriedSheetRect": queriedSheet.json,
        "queriedDescriptionRect": queriedDescription.json,
        "longResultsSheetRect": longResultsSheet.json,
        "longResultsDescriptionRect": longResultsDescription.json
      ]
    )
    try stopRunningTimer(step: "blank_suggestion_stop", iteration: iteration)
  }

  private func runExistingBlankFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "existing-blank", count: 6)
    let initial = try waitForSheet("existing blank initial state") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
        && SheetQAValue.string(state, "suggestionsPhase") == "closed"
    }
    try assertPresentedSheet(initial, harness: harness, reason: "existing_active_timer")
    try require(SheetQAValue.int(initial, "focusCommandCount") == 0, "Existing blank timer auto-focused Description.", state: initial)
    try require(SheetQAValue.int(initial, "inputFocusCount") == 0, "Existing blank timer emitted an input focus event.", state: initial)
    reporter.record("checkpoint", step: "existing_blank_no_autofocus", iteration: iteration, success: true, state: initial)

    try tap(SheetQAIdentifiers.description)
    let focused = try waitForSheet("existing blank explicit focus") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
        && (SheetQAValue.int(state, "inputFocusCount") ?? 0) >= 1
    }
    try assertSuggestionsOverlayVisible(focused, context: "Existing blank explicit focus")
    reporter.record("checkpoint", step: "existing_blank_explicit_focus", iteration: iteration, success: true, state: focused)
    try dismissWithDone(step: "existing_blank_exit", iteration: iteration)
  }

  private func runExistingFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "existing", count: 6)
    let initial = try waitForSheet("described existing timer initial state") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
        && SheetQAValue.string(state, "suggestionsPhase") == "closed"
    }
    try assertPresentedSheet(initial, harness: harness, reason: "existing_active_timer")
    try require(SheetQAValue.int(initial, "focusCommandCount") == 0, "Described existing timer auto-focused Description.", state: initial)
    try require(SheetQAValue.int(initial, "inputFocusCount") == 0, "Described existing timer emitted an input focus event.", state: initial)
    reporter.record("checkpoint", step: "existing_described_no_autofocus", iteration: iteration, success: true, state: initial)

    try tap(SheetQAIdentifiers.description)
    let focused = try waitForSheet("described existing timer explicit focus") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && (SheetQAValue.int(state, "inputFocusCount") ?? 0) >= 1
    }
    let focusedSheet = try requiredRect(focused, key: "sheetRect")
    let focusedDescription = try requiredRect(focused, key: "descriptionRect")
    try replaceDescription(with: "")
    let suggestions = try waitForSheet("described existing timer empty-query Suggestions") { state in
      SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try assertSuggestionsOverlayVisible(suggestions, context: "Existing described explicit focus")
    let suggestionSheet = try requiredRect(suggestions, key: "sheetRect")
    let suggestionDescription = try requiredRect(suggestions, key: "descriptionRect")
    try require(
      focusedSheet.isWithin(1, of: suggestionSheet),
      "Opening Suggestions changed existing-timer live sheet geometry by more than one point.",
      state: suggestions
    )
    try require(
      focusedDescription.isWithin(1, of: suggestionDescription),
      "Opening Suggestions moved existing-timer Description by more than one point.",
      state: suggestions
    )
    reporter.record("checkpoint", step: "existing_described_explicit_focus", iteration: iteration, success: true, state: suggestions)
    try dismissWithDone(step: "existing_exit", iteration: iteration)
  }

  private func runCompletedFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "completed", count: 6)
    let initial = try waitForSheet("completed edit initial state") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
    }
    try assertPresentedSheet(initial, harness: harness, reason: "completed_entry")
    try require(SheetQAValue.int(initial, "focusCommandCount") == 0, "Completed edit auto-focused Description.", state: initial)
    let temporalBefore = try temporalSnapshot()
    try tap(SheetQAIdentifiers.description)
    _ = try waitForSheet("completed edit keyboard") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
    }
    let selected = try selectBauhausSuggestion()
    let temporalAfter = try temporalSnapshot()
    try requireTemporalSnapshot(
      temporalBefore,
      equals: temporalAfter,
      context: "Completed-entry suggestion selection",
      state: selected
    )
    reporter.record(
      "checkpoint",
      step: "completed_suggestion_preserved_time",
      iteration: iteration,
      success: true,
      state: selected,
      details: ["temporalValues": temporalAfter]
    )
    try dismissWithDone(step: "completed_saved", iteration: iteration)
  }

  private func runAddFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "add", count: 6)
    try requireSoftwareKeyboard("Add past time")
    let initial = try waitForSheet("Add past time initial state") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
        && SheetQAValue.int(state, "focusCommandCount") == 1
    }
    try assertPresentedSheet(initial, harness: harness, reason: "add_past_time")
    try tap("historical-suggestions-close")
    _ = try waitForSheet("Add past time Suggestions close") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "closed"
    }
    var timeField = element(SheetQAIdentifiers.startTime)
    try waitForElement(timeField, description: "Add past time start-time field")
    guard let originalTime = elementValue(timeField), !originalTime.isEmpty else {
      throw SheetQAFailure("Add past time did not expose a readable start-time value.")
    }

    try tap(SheetQAIdentifiers.startDate, scrollIn: SheetQAIdentifiers.sheetForm)
    let picker = elementWithLabel("Choose a date")
    try waitForElement(picker, description: "Add past time date picker")
    let previousMonth = elementWithLabel("Previous month")
    try require(previousMonth.exists && previousMonth.isHittable, "Date picker's Previous month action was not hittable.")
    previousMonth.tap()
    let julyFifteenth = try waitForElementMatchingLabel(
      containsAll: ["15", "July", "2026"],
      type: .button,
      description: "15 July 2026 date-picker day"
    )
    julyFifteenth.tap()
    try waitForElementToDisappear(picker, description: "date picker after selecting 15 July")
    timeField = element(SheetQAIdentifiers.startTime)
    try waitForElement(timeField, description: "Add past time start-time field after date selection")
    let preservedTime = elementValue(timeField)
    try require(
      preservedTime == originalTime,
      "Selecting a new Add past time date changed the time from \(originalTime) to \(preservedTime ?? "<nil>")."
    )
    try tap(SheetQAIdentifiers.startTime, scrollIn: SheetQAIdentifiers.sheetForm)
    try replaceFieldValue(timeField, with: "16:30")
    try waitForElementValue(timeField, equals: "16:30", description: "edited Add past time start time")
    try require(
      app.keyboards.firstMatch.exists,
      "Add past time time editing did not present the software keyboard."
    )
    timeField.typeText(XCUIKeyboardKey.return.rawValue)
    _ = try waitForSheet("Add past time keyboard dismissal") { state in
      SheetQAValue.string(state, "keyboardPhase") == "hidden"
    }
    let temporalBeforeSuggestion = try temporalSnapshot()
    try bringDescriptionIntoView()
    let selected = try selectBauhausSuggestion()
    let temporalAfterSuggestion = try temporalSnapshot()
    try requireTemporalSnapshot(
      temporalBeforeSuggestion,
      equals: temporalAfterSuggestion,
      context: "Add past time suggestion selection",
      state: selected
    )
    reporter.record(
      "checkpoint",
      step: "add_date_time_suggestion_preserved",
      iteration: iteration,
      success: true,
      state: selected,
      details: [
        "originalStartTime": originalTime,
        "selectedDate": "2026-07-15",
        "selectedStartTime": "16:30",
        "temporalValues": temporalAfterSuggestion
      ]
    )
    try dismissWithDone(step: "add_created", iteration: iteration)
  }

  private func runReviewFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "review", count: 6)
    let initial = try waitForSheet("Review edit focus and keyboard") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
        && SheetQAValue.int(state, "focusCommandCount") == 1
        && SheetQAValue.int(state, "inputFocusCount") == 1
    }
    try assertPresentedSheet(initial, harness: harness, reason: "review_edit")
    let temporalBefore = try temporalSnapshot()
    let selected = try selectBauhausSuggestion()
    let temporalAfter = try temporalSnapshot()
    try requireTemporalSnapshot(
      temporalBefore,
      equals: temporalAfter,
      context: "Review suggestion selection",
      state: selected
    )
    reporter.record(
      "checkpoint",
      step: "review_suggestion_preserved_time",
      iteration: iteration,
      success: true,
      state: selected,
      details: ["temporalValues": temporalAfter]
    )
    try dismissWithDone(step: "review_saved", iteration: iteration)
  }

  private func runKeyboardFlow(iteration: Int? = nil) throws {
    _ = try openHarness(fixture: "blank", count: 6)
    let opened = try waitForSheet("keyboard drag starting state") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try assertSuggestionsOverlayVisible(opened, context: "Keyboard drag starting state")
    reporter.record(
      "expected_transition_started",
      step: "keyboard_drag_start",
      iteration: iteration,
      success: true,
      state: opened,
      details: ["expectedTransition": true]
    )
    _ = try performKeyboardDragAndReopen(stepPrefix: "keyboard", iteration: iteration)
    try verifyPinnedActionsDuringScrolledSuggestionGeometry(iteration: iteration)
    try performBackgroundForegroundRecovery(iteration: iteration)
    try dismissWithDone(step: "keyboard_flow_exit", iteration: iteration)
  }

  private func runTagFlow(iteration: Int? = nil) throws {
    _ = try openHarness(fixture: "existing-blank", count: 6)
    let initial = try waitForSheet("tag fixture without implicit keyboard") { state in
      SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
    }
    let field = element(SheetQAIdentifiers.description)
    try require(field.exists && field.isHittable, "Tag fixture Description was not hittable.", state: initial)
    field.tap()
    _ = try waitForSheet("tag fixture explicit focus") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.bool(state, "descriptionFocused") == true
    }
    try requireSoftwareKeyboard("typed hashtag")

    field.typeText("#")
    let typed = try waitForSheet("typed hashtag chooser") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.bool(state, "descriptionFocused") == true
        && SheetQAValue.bool(state, "hashtagPanelVisible") == true
        && SheetQAValue.bool(state, "tagSessionActiveHashtag") == true
        && SheetQAValue.isNull(state, "tagFocusRequestId")
    }
    try require(
      elementWithLabel("Existing tag, A24").exists,
      "Typed hashtag did not expose the A24 tag row.",
      state: typed
    )
    try assertContinuousDescriptionKeyboard(
      duration: 0.8,
      context: "typed hashtag chooser",
      state: typed
    )

    field.typeText(XCUIKeyboardKey.delete.rawValue)
    let deleted = try waitForSheet("typed hashtag deletion") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.bool(state, "descriptionFocused") == true
        && SheetQAValue.bool(state, "hashtagPanelVisible") == false
        && SheetQAValue.bool(state, "tagSessionActiveHashtag") == false
        && SheetQAValue.isNull(state, "tagFocusRequestId")
    }
    try assertContinuousDescriptionKeyboard(
      duration: 0.8,
      context: "typed hashtag deletion",
      state: deleted
    )

    let closeSuggestions = elementWithLabel("Close Suggestions")
    if closeSuggestions.waitForExistence(timeout: 2) {
      closeSuggestions.tap()
      _ = try waitForSheet("historical Suggestions closed before Add a tag") { state in
        SheetQAValue.string(state, "suggestionsPhase") == "closed"
          && SheetQAValue.string(state, "keyboardPhase") == "visible"
      }
    }
    let addTag = elementWithLabel("Add a tag")
    try require(addTag.exists && addTag.isHittable, "Add a tag was not hittable.", state: deleted)
    addTag.tap()
    let shortcut = try waitForSheet("Add a tag chooser") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.bool(state, "descriptionFocused") == true
        && SheetQAValue.bool(state, "hashtagPanelVisible") == true
        && SheetQAValue.bool(state, "tagSessionActiveHashtag") == true
        && SheetQAValue.isNull(state, "tagFocusRequestId")
    }
    try assertContinuousDescriptionKeyboard(
      duration: 0.8,
      context: "Add a tag chooser",
      state: shortcut
    )
    reporter.record(
      "checkpoint",
      step: "tag_keyboard_continuity",
      iteration: iteration,
      success: true,
      state: shortcut
    )
    field.typeText(XCUIKeyboardKey.delete.rawValue)
    let shortcutCleared = try waitForSheet("Add a tag hashtag deletion") { state in
      SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.bool(state, "descriptionFocused") == true
        && SheetQAValue.bool(state, "hashtagPanelVisible") == false
        && SheetQAValue.bool(state, "tagSessionActiveHashtag") == false
        && SheetQAValue.isNull(state, "tagFocusRequestId")
    }
    try assertContinuousDescriptionKeyboard(
      duration: 0.8,
      context: "Add a tag hashtag deletion",
      state: shortcutCleared
    )
    try tap(SheetQAIdentifiers.hero)
    _ = try waitForSheet("tag flow explicit focus release") { state in
      SheetQAValue.string(state, "keyboardPhase") == "hidden"
        && SheetQAValue.bool(state, "descriptionFocused") == false
        && SheetQAValue.bool(state, "hashtagPanelVisible") == false
        && SheetQAValue.bool(state, "tagSessionActiveHashtag") == false
    }
    try dismissWithCommittedSwipe(step: "tag_flow_exit", iteration: iteration)
  }

  private func assertContinuousDescriptionKeyboard(
    duration: TimeInterval,
    context: String,
    state initial: SheetQAJSON
  ) throws {
    let deadline = Date().addingTimeInterval(duration)
    var latest = initial
    while Date() < deadline {
      latest = try sheetState()
      try require(
        app.keyboards.firstMatch.exists
          && SheetQAValue.string(latest, "keyboardPhase") == "visible"
          && SheetQAValue.bool(latest, "descriptionFocused") == true,
        "Description keyboard continuity broke during \(context).",
        state: latest
      )
      pollRunLoop()
    }
  }

  private func verifyPinnedActionsDuringScrolledSuggestionGeometry(iteration: Int?) throws {
    let before = try sheetState()
    let presentationID = try requiredInt(before, key: "presentationId")
    reporter.record(
      "expected_transition_started",
      step: "suggestions_anchor_scroll_start",
      iteration: iteration,
      success: true,
      state: before,
      details: ["expectedTransition": true]
    )

    let form = element(SheetQAIdentifiers.sheetForm)
    try require(form.exists && form.isHittable, "Sheet form was not hittable for the pinned-action scroll check.", state: before)
    form.swipeUp(velocity: .slow)
    let constrained = try waitForSheet("Description scrolled above the pinned-action boundary") { state in
      guard
        SheetQAValue.int(state, "presentationId") == presentationID,
        let description = SheetQARect(state["descriptionRect"]),
        let topBoundary = SheetQAValue.double(state, "overlayTopBoundary"),
        let geometry = state["overlayGeometry"] as? SheetQAJSON,
        let maxHeight = SheetQAValue.double(geometry, "maxHeight")
      else {
        return false
      }
      return description.y + description.height + 6 < topBoundary + 0.5
        && maxHeight == 0
        && SheetQAValue.bool(state, "overlayContainerVisible") == false
        && SheetQAValue.bool(state, "obscuredFormAccessibilityHidden") == false
    }
    try require(
      element(SheetQAIdentifiers.done).exists && element(SheetQAIdentifiers.done).isHittable,
      "Scrolling Description above its overlay boundary obscured the pinned Done action.",
      state: constrained
    )
    try require(
      element(SheetQAIdentifiers.stop).exists && element(SheetQAIdentifiers.stop).isHittable,
      "Scrolling Description above its overlay boundary obscured the pinned Stop action.",
      state: constrained
    )
    try require(
      element(SheetQAIdentifiers.startDate).exists,
      "A non-renderable Suggestions overlay left the post-Description form hidden from accessibility.",
      state: constrained
    )
    reporter.record(
      "checkpoint",
      step: "suggestions_hidden_above_pinned_actions",
      iteration: iteration,
      success: true,
      state: constrained
    )

    try bringDescriptionIntoView()
    let description = element(SheetQAIdentifiers.description)
    description.tap()
    let restored = try waitForSheet("Suggestions restored below pinned actions") { state in
      SheetQAValue.int(state, "presentationId") == presentationID
        && SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try assertSuggestionsOverlayVisible(restored, context: "Pinned-action scroll restoration")
    reporter.record(
      "checkpoint",
      step: "suggestions_restored_below_pinned_actions",
      iteration: iteration,
      success: true,
      state: restored
    )
  }

  private func performBackgroundForegroundRecovery(iteration: Int?) throws {
    let before = try sheetState()
    let presentationID = try requiredInt(before, key: "presentationId")
    reporter.record(
      "expected_transition_started",
      step: "background_interruption_start",
      iteration: iteration,
      success: true,
      state: before,
      details: ["expectedTransition": true]
    )
    XCUIDevice.shared.press(.home)
    let backgroundDeadline = Date().addingTimeInterval(5)
    while app.state == .runningForeground && Date() < backgroundDeadline {
      pollRunLoop()
    }
    try require(
      app.state != .runningForeground,
      "Dayframe remained foreground after the Home interruption.",
      state: before
    )
    app.activate()
    try require(
      app.wait(for: .runningForeground, timeout: 10),
      "Dayframe did not return to the foreground after interruption."
    )
    let recovered = try waitForSheet("background and foreground recovery") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.int(state, "presentationId") == presentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
        && SheetQAValue.string(state, "suggestionsPhase") == "closed"
    }
    let harness = try harnessState()
    try require(
      SheetQAValue.bool(harness, "visible") == true
        && SheetQAValue.int(harness, "presentationId") == presentationID,
      "Background recovery dismissed or replaced the current sheet.",
      state: harness
    )
    reporter.record(
      "checkpoint",
      step: "keyboard_background_foreground_recovered",
      iteration: iteration,
      success: true,
      state: recovered
    )
    try tap(SheetQAIdentifiers.description)
    let refocused = try waitForSheet("Description refocus after foreground") { state in
      SheetQAValue.int(state, "presentationId") == presentationID
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try assertSuggestionsOverlayVisible(refocused, context: "Foreground Description refocus")
  }

  private func runFocusGenerationHandoffFlow(iteration: Int? = nil) throws {
    let blankHarness = try openHarness(fixture: "blank", count: 6)
    let blankID = try requiredInt(blankHarness, key: "presentationId")
    let focused = try waitForSheet("focused blank presentation before generation handoff") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && (SheetQAValue.int(state, "inputFocusCount") ?? 0) >= 1
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try assertSuggestionsOverlayVisible(focused, context: "Focused blank generation")

    let existingHarness = try openHarness(fixture: "existing", count: 6)
    let existingID = try requiredInt(existingHarness, key: "presentationId")
    try require(existingID > blankID, "Existing presentation did not advance the focused blank generation.", state: existingHarness)
    let handedOff = try waitForSheet("existing presentation focus reset without unmount") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.int(state, "presentationId") == existingID
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
        && SheetQAValue.string(state, "suggestionsPhase") == "closed"
        && SheetQAValue.int(state, "focusCommandCount") == 0
        && SheetQAValue.int(state, "inputFocusCount") == 0
    }
    reporter.record(
      "checkpoint",
      step: "focus_generation_handoff",
      iteration: iteration,
      success: true,
      state: handedOff,
      details: ["fromPresentationId": blankID, "toPresentationId": existingID, "modalStayedVisible": true]
    )
    try dismissWithDone(step: "focus_generation_handoff_exit", iteration: iteration)
  }

  private func runSwipeFlow(iteration: Int? = nil) throws {
    let harness = try openHarness(fixture: "existing", count: 6)
    let initial = try waitForSheet("partial swipe starting state") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
    }
    let presentationID = try requiredInt(harness, key: "presentationId")
    try performPartialSwipe()
    let cancelled = try waitForSheet("partial swipe cancellation") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.int(state, "presentationId") == presentationID
    }
    let afterCancelHarness = try harnessState()
    try require(SheetQAValue.bool(afterCancelHarness, "visible") == true, "Partial swipe dismissed the harness sheet.", state: afterCancelHarness)
    reporter.record("checkpoint", step: "partial_swipe_cancelled", iteration: iteration, success: true, state: cancelled)

    reporter.record(
      "sheet_exit_started",
      step: "committed_swipe",
      iteration: iteration,
      success: true,
      state: initial,
      details: [
        "expectedOverlayExit": true,
        "expectedTransition": true,
        "exitStarted": true,
        "presentationId": presentationID
      ]
    )
    try performCommittedSwipe()
    let committedHidden = try waitForHarness("committed swipe completion") { state in
      SheetQAValue.bool(state, "visible") == false
        && SheetQAValue.int(state, "presentationId") == presentationID
    }
    reporter.record(
      "sheet_exit_finished",
      step: "committed_swipe",
      iteration: iteration,
      success: true,
      state: committedHidden,
      details: [
        "committedExit": true,
        "exitFinished": true,
        "presentationId": presentationID,
        "trigger": "swipe"
      ]
    )
    let reopenedHarness = try openHarness(fixture: "existing-blank", count: 6)
    let reopenedID = try requiredInt(reopenedHarness, key: "presentationId")
    try require(reopenedID > presentationID, "Rapid reopen did not advance the presentation ID.", state: reopenedHarness)
    let reopened = try waitForSheet("rapid reopen after committed swipe") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.int(state, "presentationId") == reopenedID
        && SheetQAValue.string(state, "keyboardPhase") == "hidden"
    }
    try observeStablePresentation(reopenedID, duration: 0.8)
    reporter.record("checkpoint", step: "committed_swipe_rapid_reopen", iteration: iteration, success: true, state: reopened)
    try dismissWithDone(step: "swipe_flow_exit", iteration: iteration)
  }

  private func runStressFlow() throws {
    for iteration in 1 ... configuration.iterations {
      reporter.record("iteration_started", step: "presentation_keyboard_swipe_stress", iteration: iteration, success: true)
      _ = try openHarness(fixture: "blank", count: 6)
      let stressBlank = try waitForSheet("stress blank ready") { state in
        SheetQAValue.bool(state, "ready") == true
          && SheetQAValue.string(state, "keyboardPhase") == "visible"
          && SheetQAValue.string(state, "suggestionsPhase") == "visible"
          && self.suggestionsAreVisiblyRenderable(state)
      }
      try assertSuggestionsOverlayVisible(stressBlank, context: "Stress blank ready")
      let refocused = try performKeyboardDragAndReopen(stepPrefix: "stress", iteration: iteration)
      let blankID = try requiredInt(refocused, key: "presentationId")
      let swipeStartsBefore = try requiredInt(refocused, key: "swipeStartedCount")
      let swipeCancelsBefore = try requiredInt(refocused, key: "swipeCancelledCount")
      try performPartialSwipe()
      let afterCancel = try waitForSheet("stress partial swipe cancel") { state in
        SheetQAValue.bool(state, "ready") == true
          && SheetQAValue.string(state, "sheetPhase") == "presented"
          && SheetQAValue.string(state, "swipePhase") == "idle"
          && SheetQAValue.int(state, "presentationId") == blankID
          && SheetQAValue.int(state, "swipeStartedCount") == swipeStartsBefore + 1
          && SheetQAValue.int(state, "swipeCancelledCount") == swipeCancelsBefore + 1
          && SheetQAValue.int(state, "lastSwipeStartedPresentationId") == blankID
          && SheetQAValue.int(state, "lastSwipeCancelledPresentationId") == blankID
      }
      try require(
        SheetQAValue.bool(afterCancel, "reduceMotion") == configuration.expectedReduceMotion,
        "Stress iteration observed the wrong Reduce Motion state.",
        state: afterCancel
      )
      try require(
        SheetQAValue.string(afterCancel, "keyboardPhase") == "visible"
          && SheetQAValue.string(afterCancel, "suggestionsPhase") == "visible",
        "Stress swipe cancel did not preserve the refocused blank presentation.",
        state: afterCancel
      )
      reporter.record(
        "checkpoint",
        step: "stress_swipe_cancel_observed",
        iteration: iteration,
        success: true,
        state: afterCancel,
        details: [
          "presentationId": blankID,
          "swipeCancelledCount": swipeCancelsBefore + 1,
          "swipeStartedCount": swipeStartsBefore + 1
        ]
      )
      reporter.record(
        "sheet_exit_started",
        step: "stress_committed_swipe",
        iteration: iteration,
        success: true,
        state: afterCancel,
        details: [
          "expectedOverlayExit": true,
          "expectedTransition": true,
          "exitStarted": true,
          "presentationId": blankID
        ]
      )
      try performCommittedSwipe()
      let stressHidden = try waitForHarness("stress committed swipe completion") { state in
        SheetQAValue.bool(state, "visible") == false
          && SheetQAValue.int(state, "presentationId") == blankID
      }
      reporter.record(
        "sheet_exit_finished",
        step: "stress_committed_swipe",
        iteration: iteration,
        success: true,
        state: stressHidden,
        details: [
          "committedExit": true,
          "exitFinished": true,
          "presentationId": blankID,
          "trigger": "swipe"
        ]
      )
      let reopenedHarness = try openHarness(fixture: "existing-blank", count: 6)
      let reopenedID = try requiredInt(reopenedHarness, key: "presentationId")
      try require(reopenedID > blankID, "Stress rapid reopen reused a stale presentation ID.", state: reopenedHarness)
      let reopened = try waitForSheet("stress rapid reopen ready") { state in
        SheetQAValue.bool(state, "ready") == true
          && SheetQAValue.int(state, "presentationId") == reopenedID
          && SheetQAValue.string(state, "keyboardPhase") == "hidden"
      }
      try observeStablePresentation(reopenedID, duration: 0.35)
      reporter.record("checkpoint", step: "stress_iteration_settled", iteration: iteration, success: true, state: reopened)
      try dismissWithDone(step: "stress_iteration_exit", iteration: iteration)
      reporter.record("iteration_finished", step: "presentation_keyboard_swipe_stress", iteration: iteration, success: true)
    }
  }

  private func runMutationFailureFlows() throws {
    let saveHarness = try openHarness(fixture: "completed", count: 6, failure: "save")
    let savePresentationID = try requiredInt(saveHarness, key: "presentationId")
    let retainedDraft = "Completed draft survives rejection"
    try replaceDescription(with: retainedDraft)
    try tap(SheetQAIdentifiers.done)
    let failedSave = try waitForSheet("completed Save rejection") { state in
      SheetQAValue.int(state, "presentationId") == savePresentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.int(state, "mutationFinishedCount") == 1
        && SheetQAValue.isNull(state, "activeMutationToken")
    }
    let saveAfter = try harnessState()
    try require(
      SheetQAValue.bool(saveAfter, "visible") == true
        && SheetQAValue.int(saveAfter, "presentationId") == savePresentationID
        && SheetQAValue.int(saveAfter, "mutationFailureCount") == 1,
      "Rejected completed Save dismissed or replaced the editor.",
      state: saveAfter
    )
    try waitForElementValue(
      element(SheetQAIdentifiers.description),
      equals: retainedDraft,
      description: "completed Save rejection retained draft"
    )
    reporter.record(
      "checkpoint",
      step: "completed_save_failure_retained_draft",
      success: true,
      state: failedSave,
      details: ["draft": retainedDraft, "presentationId": savePresentationID]
    )
    try dismissWithCommittedSwipe(step: "completed_save_failure_exit")

    let suggestionHarness = try openHarness(
      fixture: "existing",
      count: 6,
      failure: "suggestion"
    )
    let suggestionPresentationID = try requiredInt(suggestionHarness, key: "presentationId")
    let suggestionFinishedBefore = try requiredInt(
      sheetState(),
      key: "mutationFinishedCount"
    )
    try replaceDescription(with: "bau")
    let suggestion = element("historical-suggestion-row-0")
    try waitForElement(suggestion, description: "failing historical suggestion")
    reporter.record(
      "expected_overlay_exit",
      step: "failing_suggestion_selection",
      success: true,
      state: try sheetState(),
      details: ["expectedOverlayExit": true, "expectedTransition": true]
    )
    suggestion.tap()
    let failedSuggestion = try waitForSheet("running Suggestion rejection") { state in
      SheetQAValue.int(state, "presentationId") == suggestionPresentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.int(state, "mutationFinishedCount") == suggestionFinishedBefore + 1
        && SheetQAValue.isNull(state, "activeMutationToken")
    }
    try waitForElementValue(
      element(SheetQAIdentifiers.description),
      equals: "bau",
      description: "running Suggestion rejection rollback"
    )
    let suggestionAfter = try harnessState()
    try require(
      SheetQAValue.bool(suggestionAfter, "visible") == true
        && SheetQAValue.int(suggestionAfter, "presentationId") == suggestionPresentationID
        && SheetQAValue.int(suggestionAfter, "mutationFailureCount") == 1,
      "Rejected running Suggestion dismissed or replaced the editor.",
      state: suggestionAfter
    )
    reporter.record(
      "checkpoint",
      step: "running_suggestion_failure_rolled_back",
      success: true,
      state: failedSuggestion
    )
    try dismissWithDone(step: "running_suggestion_failure_exit")

    let stopHarness = try openHarness(fixture: "existing", count: 6, failure: "stop")
    let stopPresentationID = try requiredInt(stopHarness, key: "presentationId")
    let stopFinishedBefore = try requiredInt(sheetState(), key: "mutationFinishedCount")
    try tap(SheetQAIdentifiers.stop)
    let failedStop = try waitForSheet("running Stop rejection") { state in
      SheetQAValue.int(state, "presentationId") == stopPresentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.int(state, "mutationFinishedCount") == stopFinishedBefore + 1
        && SheetQAValue.isNull(state, "activeMutationToken")
    }
    let stopAfter = try harnessState()
    try require(
      SheetQAValue.bool(stopAfter, "visible") == true
        && SheetQAValue.int(stopAfter, "presentationId") == stopPresentationID
        && SheetQAValue.isNull(stopAfter, "stoppedAt")
        && SheetQAValue.int(stopAfter, "mutationFailureCount") == 1,
      "Rejected running Stop dismissed or stopped the timer.",
      state: stopAfter
    )
    reporter.record(
      "checkpoint",
      step: "running_stop_failure_retained_editor",
      success: true,
      state: failedStop
    )
    try dismissWithDone(step: "running_stop_failure_exit")
  }

  private func runDeletionFlows() throws {
    for iteration in 1 ... configuration.iterations {
      reporter.record("iteration_started", step: "deletion", iteration: iteration, success: true)
      try runDeleteUndoFlow(iteration: iteration)
      try runDeleteExpiryFlow(iteration: iteration)
      try runDeleteCanonicalFlow(iteration: iteration)
      try runDeleteInvalidationFlow(iteration: iteration)
      reporter.record("iteration_finished", step: "deletion", iteration: iteration, success: true)
    }
  }

  private func runDeleteUndoFlow(iteration: Int? = nil) throws {
    let active = try deleteFixture("completed", step: "delete_undo", iteration: iteration)
    try require(SheetQAValue.int(active, "durableMutationCount") == 0, "Deletion committed before its Undo window.", state: active)
    try require(SheetQAValue.int(active, "restoreCount") == 0, "Deletion restored before Undo.", state: active)
    try tap(SheetQAIdentifiers.undo)
    let restored = try waitForHarness("delete then Undo restoration") { state in
      SheetQAValue.isNull(state, "pendingDeletionPhase")
        && SheetQAValue.int(state, "restoreCount") == 1
        && SheetQAValue.string(state, "visibleEntryId") == "fixture-completed"
    }
    try require(SheetQAValue.int(restored, "durableMutationCount") == 0, "Undo restored after a durable deletion mutation.", state: restored)
    try require(SheetQAValue.strings(restored, "pendingEntryIds")?.isEmpty == true, "Undo retained a deletion tombstone.", state: restored)
    reporter.record("checkpoint", step: "delete_undo_restored", iteration: iteration, success: true, state: restored)
  }

  private func runDeleteExpiryFlow(iteration: Int? = nil) throws {
    let active = try deleteFixture("completed", step: "delete_expiry", iteration: iteration)
    try tap(SheetQAIdentifiers.refresh)
    let refreshedPending = try waitForHarness("pending deletion refresh filtering") { state in
      SheetQAValue.int(state, "refreshCount") == 1
        && SheetQAValue.string(state, "pendingDeletionPhase") == "active"
        && SheetQAValue.isNull(state, "visibleEntryId")
    }
    try require(
      SheetQAValue.int(refreshedPending, "pendingDeletionToken") == SheetQAValue.int(active, "pendingDeletionToken"),
      "Refresh replaced the active deletion token.",
      state: refreshedPending
    )
    reporter.record("checkpoint", step: "delete_refresh_did_not_resurrect", iteration: iteration, success: true, state: refreshedPending)

    let expired = try waitForHarness("five-second deletion expiry", timeout: 8) { state in
      SheetQAValue.isNull(state, "pendingDeletionPhase")
        && SheetQAValue.int(state, "durableMutationCount") == 1
        && SheetQAValue.isNull(state, "visibleEntryId")
    }
    try tap(SheetQAIdentifiers.refresh)
    let refreshedExpired = try waitForHarness("post-expiry refresh filtering") { state in
      SheetQAValue.int(state, "refreshCount") == 2
        && SheetQAValue.int(state, "durableMutationCount") == 1
        && SheetQAValue.isNull(state, "visibleEntryId")
        && SheetQAValue.strings(state, "pendingEntryIds")?.isEmpty == true
    }
    try require(SheetQAValue.int(refreshedExpired, "restoreCount") == 0, "Expired deletion restored unexpectedly.", state: refreshedExpired)
    reporter.record(
      "checkpoint",
      step: "delete_expiry_non_resurrection",
      iteration: iteration,
      success: true,
      state: refreshedExpired,
      details: ["expiredState": expired]
    )
  }

  private func runDeleteCanonicalFlow(iteration: Int? = nil) throws {
    let active = try deleteFixture("existing", step: "delete_canonical", iteration: iteration)
    let originalID = try requiredString(active, key: "selectedEntryId")
    try tap(SheetQAIdentifiers.canonical)
    let canonicalPending = try waitForHarness("canonical identity replacement while pending") { state in
      let pendingIDs = SheetQAValue.strings(state, "pendingEntryIds") ?? []
      return SheetQAValue.int(state, "canonicalReplacementCount") == 1
        && pendingIDs.contains(originalID)
        && pendingIDs.contains("\(originalID):canonical")
        && SheetQAValue.isNull(state, "visibleEntryId")
    }
    try require(SheetQAValue.int(canonicalPending, "durableMutationCount") == 0, "Canonical replacement committed deletion early.", state: canonicalPending)
    try tap(SheetQAIdentifiers.undo)
    let restored = try waitForHarness("canonical-ID Undo restoration") { state in
      SheetQAValue.isNull(state, "pendingDeletionPhase")
        && SheetQAValue.int(state, "restoreCount") == 1
        && SheetQAValue.string(state, "selectedEntryId") == "\(originalID):canonical"
        && SheetQAValue.string(state, "visibleEntryId") == "\(originalID):canonical"
    }
    try require(SheetQAValue.isNull(restored, "stoppedAt"), "Canonical Undo did not restore the running entry.", state: restored)
    try require(SheetQAValue.int(restored, "durableMutationCount") == 0, "Canonical Undo followed a durable delete.", state: restored)
    reporter.record("checkpoint", step: "delete_canonical_undo", iteration: iteration, success: true, state: restored)
  }

  private func runDeleteInvalidationFlow(iteration: Int? = nil) throws {
    let first = try deleteFixture("completed", step: "delete_second", iteration: iteration)
    let firstToken = try requiredInt(first, key: "pendingDeletionToken")
    let firstID = try requiredString(first, key: "selectedEntryId")
    try tap(SheetQAIdentifiers.secondDelete)
    let second = try waitForHarness("rapid second deletion") { state in
      guard
        SheetQAValue.int(state, "secondDeletionCount") == 1,
        SheetQAValue.int(state, "durableMutationCount") == 1,
        SheetQAValue.string(state, "pendingDeletionPhase") == "active",
        let secondToken = SheetQAValue.int(state, "pendingDeletionToken")
      else {
        return false
      }
      return secondToken > firstToken
    }
    let secondIDs = SheetQAValue.strings(second, "pendingEntryIds") ?? []
    try require(!secondIDs.contains(firstID), "Second deletion retained the first deletion's tombstone.", state: second)
    try require(secondIDs.count == 1, "Second deletion did not own exactly one fresh tombstone.", state: second)
    reporter.record("checkpoint", step: "second_delete_committed_first", iteration: iteration, success: true, state: second)
    try tap(SheetQAIdentifiers.undo)
    let secondRestored = try waitForHarness("second deletion Undo") { state in
      SheetQAValue.isNull(state, "pendingDeletionPhase")
        && SheetQAValue.int(state, "restoreCount") == 1
        && SheetQAValue.int(state, "durableMutationCount") == 1
    }
    try require(SheetQAValue.string(secondRestored, "visibleEntryId") != firstID, "Undoing the second deletion resurrected the committed first entry.", state: secondRestored)
    reporter.record("checkpoint", step: "second_delete_undo_isolated", iteration: iteration, success: true, state: secondRestored)

    let active = try deleteFixture("existing", step: "delete_new_timer", iteration: iteration)
    let deletedID = try requiredString(active, key: "selectedEntryId")
    try tap(SheetQAIdentifiers.newTimer)
    let newTimer = try waitForHarness("new timer invalidates active-entry Undo") { state in
      SheetQAValue.isNull(state, "pendingDeletionPhase")
        && SheetQAValue.int(state, "durableMutationCount") == 1
        && SheetQAValue.int(state, "newTimerCount") == 1
        && SheetQAValue.string(state, "selectedEntryId") == "qa-new-running-1"
        && SheetQAValue.string(state, "visibleEntryId") == "qa-new-running-1"
    }
    try require(SheetQAValue.string(newTimer, "visibleEntryId") != deletedID, "Starting a new timer resurrected the deleted active timer.", state: newTimer)
    try require(SheetQAValue.isNull(newTimer, "stoppedAt"), "The replacement timer is not running.", state: newTimer)
    try require(!element(SheetQAIdentifiers.undo).exists, "Undo remained available after starting a replacement timer.")
    try tap(SheetQAIdentifiers.refresh)
    let refreshed = try waitForHarness("new timer refresh stability") { state in
      SheetQAValue.int(state, "refreshCount") == 1
        && SheetQAValue.string(state, "visibleEntryId") == "qa-new-running-1"
        && SheetQAValue.isNull(state, "pendingDeletionPhase")
    }
    reporter.record("checkpoint", step: "new_timer_invalidated_delete_undo", iteration: iteration, success: true, state: refreshed)
  }

  private func deleteFixture(
    _ fixture: String,
    step: String,
    iteration: Int?
  ) throws -> SheetQAJSON {
    _ = try openHarness(fixture: fixture, count: 6)
    _ = try waitForSheet("\(step) sheet ready") { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.string(state, "sheetPhase") == "presented"
    }
    try tap(SheetQAIdentifiers.delete, scrollIn: SheetQAIdentifiers.sheetForm)
    let active = try waitForHarness("\(step) active Undo window") { state in
      SheetQAValue.bool(state, "visible") == false
        && SheetQAValue.string(state, "pendingDeletionPhase") == "active"
        && SheetQAValue.isNull(state, "visibleEntryId")
        && (SheetQAValue.strings(state, "pendingEntryIds")?.isEmpty == false)
    }
    try require(element(SheetQAIdentifiers.undo).exists, "Deletion activated without an Undo action.", state: active)
    let activatedAt = try requiredInt(active, key: "activatedAt")
    let expiresAt = try requiredInt(active, key: "expiresAt")
    try require(
      expiresAt - activatedAt == 5_000,
      "The visible Undo interval was not exactly 5,000 ms.",
      state: active
    )
    reporter.record("checkpoint", step: "\(step)_undo_active", iteration: iteration, success: true, state: active)
    return active
  }

  private func repeatFlow(
    _ step: String,
    count: Int,
    body: (Int?) throws -> Void
  ) throws {
    for iteration in 1 ... count {
      reporter.record("iteration_started", step: step, iteration: iteration, success: true)
      try body(iteration)
      reporter.record("iteration_finished", step: step, iteration: iteration, success: true)
    }
  }

  private func requireSoftwareKeyboard(_ context: String) throws {
    let keyboard = app.keyboards.firstMatch
    guard keyboard.waitForExistence(timeout: 8) else {
      throw SheetQAFailure(
        "QA environment misconfiguration during \(context): no software keyboard exists. " +
        "Restart Simulator after setting ConnectHardwareKeyboard=false before attributing this to app focus."
      )
    }
  }

  @discardableResult
  private func openHarness(
    fixture: String,
    count: Int,
    failure: String? = nil
  ) throws -> SheetQAJSON {
    openSequence += 1
    let priorPresentationID = (try? harnessState()).flatMap {
      SheetQAValue.int($0, "presentationId")
    }
    var components = URLComponents()
    components.scheme = "dayframe"
    components.host = "sheet-qa"
    components.queryItems = [
      URLQueryItem(name: "fixture", value: fixture),
      URLQueryItem(name: "count", value: String(count)),
      URLQueryItem(name: "failure", value: failure),
      URLQueryItem(name: "open", value: "1"),
      URLQueryItem(name: "run", value: "\(configuration.runID)-\(openSequence)")
    ]
    guard let url = components.url else {
      throw SheetQAFailure("Could not construct the sheet QA deep link.")
    }
    reporter.record(
      "sheet_open_started",
      success: true,
      details: [
        "fixture": fixture,
        "openStarted": true,
        "priorPresentationId": priorPresentationID ?? -1,
        "url": url.absoluteString
      ]
    )
    XCUIDevice.shared.system.open(url)
    handleSystemOpenConfirmation()

    let harness = try waitForHarness("open \(fixture) fixture", timeout: 35) { state in
      guard
        SheetQAValue.bool(state, "ready") == true,
        SheetQAValue.bool(state, "visible") == true,
        SheetQAValue.bool(state, "reduceMotion") == configuration.expectedReduceMotion,
        SheetQAValue.string(state, "fixture") == fixture,
        let presentationID = SheetQAValue.int(state, "presentationId")
      else {
        return false
      }
      if let failure {
        guard SheetQAValue.string(state, "mutationFailureMode") == failure else { return false }
      } else if !SheetQAValue.isNull(state, "mutationFailureMode") {
        return false
      }
      return priorPresentationID == nil || presentationID > priorPresentationID!
    }
    try require(
      SheetQAValue.bool(harness, "reduceMotion") == configuration.expectedReduceMotion,
      "Harness Reduce Motion was \(String(describing: SheetQAValue.bool(harness, "reduceMotion"))) but expected \(configuration.expectedReduceMotion).",
      state: harness
    )
    let presentationID = try requiredInt(harness, key: "presentationId")
    let presentationReason = try requiredString(harness, key: "presentationReason")
    let expectsSuggestions = suggestionsExpectedOnPresentation(reason: presentationReason)
    let sheet = try waitForSheet("current \(fixture) presentation", timeout: 25) { state in
      SheetQAValue.bool(state, "ready") == true
        && SheetQAValue.int(state, "presentationId") == presentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && self.visualGeometryIsSane(state)
        && (!expectsSuggestions || self.suggestionsAreVisiblyRenderable(state))
    }
    try assertPresentedSheet(
      sheet,
      harness: harness,
      reason: presentationReason
    )
    reporter.record(
      "checkpoint",
      step: "fixture_opened",
      success: true,
      state: sheet,
      details: [
        "failure": failure ?? NSNull(),
        "fixture": fixture,
        "presentationId": presentationID,
        "url": url.absoluteString
      ]
    )
    return harness
  }

  private func handleSystemOpenConfirmation() {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let openButton = springboard.alerts.buttons["Open"].firstMatch
    if openButton.exists && openButton.isHittable {
      openButton.tap()
    }
  }

  private func assertPresentedSheet(
    _ sheet: SheetQAJSON,
    harness: SheetQAJSON,
    reason: String
  ) throws {
    try require(SheetQAValue.bool(sheet, "ready") == true, "Sheet marker was not ready.", state: sheet)
    try require(SheetQAValue.string(sheet, "sheetPhase") == "presented", "Sheet was not presented.", state: sheet)
    try require(SheetQAValue.string(sheet, "reason") == reason, "Sheet reason did not match \(reason).", state: sheet)
    try require(
      SheetQAValue.int(sheet, "presentationId") == SheetQAValue.int(harness, "presentationId"),
      "Sheet and harness presentation IDs diverged.",
      state: sheet
    )
    try require(
      SheetQAValue.bool(sheet, "reduceMotion") == configuration.expectedReduceMotion,
      "Sheet observed the wrong Reduce Motion state.",
      state: sheet
    )
    let base = try requiredRect(sheet, key: "baseSheetRect")
    let liveSheet = try requiredRect(sheet, key: "sheetRect")
    let description = try requiredRect(sheet, key: "descriptionRect")
    try require(base.width > 0 && base.height > 0, "Base sheet geometry was empty.", state: sheet)
    try require(liveSheet.width > 0 && liveSheet.height > 0, "Live sheet geometry was empty.", state: sheet)
    try require(description.width > 0 && description.height > 0, "Description geometry was empty.", state: sheet)
    try require(
      visualGeometryIsSane(sheet),
      "Sheet telemetry geometry was outside the app viewport or Description was not contained by the sheet.",
      state: sheet
    )
    try require(sheet["overlayGeometry"] is SheetQAJSON, "Historical overlay geometry was absent.", state: sheet)
    if suggestionsExpectedOnPresentation(reason: reason) {
      try require(
        SheetQAValue.string(sheet, "suggestionsPhase") == "visible",
        "\(reason) reported ready before Suggestions reached the visible phase.",
        state: sheet
      )
      try assertSuggestionsOverlayVisible(sheet, context: reason)
    } else if SheetQAValue.string(sheet, "suggestionsPhase") == "visible" {
      try assertSuggestionsOverlayVisible(sheet, context: reason)
    }
    try assertGuardrailTelemetry(sheet)
  }

  private func dismissWithDone(step: String, iteration: Int? = nil) throws {
    let before = try sheetState()
    let presentationID = try requiredInt(before, key: "presentationId")
    reporter.record(
      "sheet_exit_started",
      step: step,
      iteration: iteration,
      success: true,
      state: before,
      details: [
        "expectedOverlayExit": true,
        "expectedTransition": true,
        "exitStarted": true,
        "presentationId": presentationID,
        "trigger": "done"
      ]
    )
    try tap(SheetQAIdentifiers.done)
    let hidden = try waitForHarness("\(step) completion") { state in
      SheetQAValue.bool(state, "visible") == false
        && SheetQAValue.int(state, "presentationId") == presentationID
    }
    reporter.record(
      "sheet_exit_finished",
      step: step,
      iteration: iteration,
      success: true,
      state: hidden,
      details: [
        "committedExit": true,
        "exitFinished": true,
        "presentationId": presentationID,
        "trigger": "done"
      ]
    )
    reporter.record("checkpoint", step: step, iteration: iteration, success: true, state: hidden)
  }

  private func dismissWithCommittedSwipe(step: String, iteration: Int? = nil) throws {
    let before = try sheetState()
    let presentationID = try requiredInt(before, key: "presentationId")
    reporter.record(
      "sheet_exit_started",
      step: step,
      iteration: iteration,
      success: true,
      state: before,
      details: [
        "expectedOverlayExit": true,
        "expectedTransition": true,
        "exitStarted": true,
        "presentationId": presentationID,
        "trigger": "swipe"
      ]
    )
    try performCommittedSwipe()
    let hidden = try waitForHarness("\(step) completion") { state in
      SheetQAValue.bool(state, "visible") == false
        && SheetQAValue.int(state, "presentationId") == presentationID
    }
    reporter.record(
      "sheet_exit_finished",
      step: step,
      iteration: iteration,
      success: true,
      state: hidden,
      details: [
        "committedExit": true,
        "exitFinished": true,
        "presentationId": presentationID,
        "trigger": "swipe"
      ]
    )
    reporter.record("checkpoint", step: step, iteration: iteration, success: true, state: hidden)
  }

  private func stopRunningTimer(step: String, iteration: Int? = nil) throws {
    let before = try sheetState()
    let presentationID = try requiredInt(before, key: "presentationId")
    let stop = element(SheetQAIdentifiers.stop)
    try require(stop.exists && stop.isHittable, "Running Stop was not immediately hittable.", state: before)
    reporter.record(
      "sheet_exit_started",
      step: step,
      iteration: iteration,
      success: true,
      state: before,
      details: [
        "expectedOverlayExit": true,
        "expectedTransition": true,
        "exitStarted": true,
        "presentationId": presentationID,
        "trigger": "stop"
      ]
    )
    stop.tap()
    let hidden = try waitForHarness("\(step) completion") { state in
      SheetQAValue.bool(state, "visible") == false
        && SheetQAValue.int(state, "presentationId") == presentationID
        && !SheetQAValue.isNull(state, "stoppedAt")
    }
    reporter.record(
      "sheet_exit_finished",
      step: step,
      iteration: iteration,
      success: true,
      state: hidden,
      details: [
        "committedExit": true,
        "exitFinished": true,
        "presentationId": presentationID,
        "trigger": "stop"
      ]
    )
    reporter.record("checkpoint", step: step, iteration: iteration, success: true, state: hidden)
  }

  private func performPartialSwipe() throws {
    reporter.record(
      "expected_transition_started",
      step: "partial_swipe_start",
      success: true,
      state: try sheetState(),
      details: ["expectedTransition": true]
    )
    let handle = element(SheetQAIdentifiers.sheetHandle)
    try waitForElement(handle, description: "sheet swipe handle")
    try require(handle.isHittable, "Sheet swipe handle was not hittable.")
    let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let end = start.withOffset(CGVector(dx: 0, dy: 30))
    start.press(
      forDuration: 0.1,
      thenDragTo: end,
      withVelocity: .slow,
      thenHoldForDuration: 0
    )
  }

  @discardableResult
  private func performKeyboardDragAndReopen(
    stepPrefix: String,
    iteration: Int?
  ) throws -> SheetQAJSON {
    let beforeHarness = try harnessState()
    let presentationID = try requiredInt(beforeHarness, key: "presentationId")
    let beforeSheet = try sheetState()
    let interactiveFramesBefore = try requiredInt(beforeSheet, key: "interactiveKeyboardFrameCount")
    let inputFocusCountBefore = try requiredInt(beforeSheet, key: "inputFocusCount")
    let form = element(SheetQAIdentifiers.sheetForm)
    try require(form.exists && form.isHittable, "Sheet form was not hittable for interactive keyboard dismissal.")
    let descriptionField = element(SheetQAIdentifiers.description)
    try waitForElement(descriptionField, description: "Description field for interactive keyboard dismissal")
    let descriptionFrame = descriptionField.frame
    // Start on the Description label's ScrollView-owned strip. The floating
    // Suggestions rows intentionally cover the area below the field and would
    // otherwise consume this real native drag before UIScrollView can drive
    // `keyboardDismissMode="interactive"`.
    let appOrigin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let start = appOrigin.withOffset(CGVector(
      dx: descriptionFrame.maxX - 24,
      dy: descriptionFrame.minY - 10
    ))
    let end = start.withOffset(CGVector(dx: 0, dy: 220))
    start.press(
      forDuration: 0.08,
      thenDragTo: end,
      withVelocity: .slow,
      thenHoldForDuration: 0
    )

    var partial = try observeSheet(timeout: 1.5) { state in
      SheetQAValue.int(state, "presentationId") == presentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && (SheetQAValue.int(state, "interactiveKeyboardFrameCount") ?? 0) > interactiveFramesBefore
    }
    var automationMode = "interactive_keyboard_frames"
    if partial == nil {
      // XCUITest does not expose an API for holding two independent fingers or
      // pausing a UIScrollView drag mid-flight. On runtimes where its synthetic
      // coordinate drag produces no keyboard frame notifications, exercise the
      // nearest real Simulator gesture and prove the exact in-flight ordering in
      // the reducer suite instead of fabricating native telemetry.
      form.swipeDown(velocity: .slow)
      partial = try observeSheet(timeout: 2) { state in
        SheetQAValue.int(state, "presentationId") == presentationID
          && SheetQAValue.string(state, "keyboardPhase") == "hidden"
      }
      automationMode = "xcui_full_swipe_down_fallback"
    }
    if partial == nil {
      let keyboardDone = app.keyboards.buttons["Done"].firstMatch
      try require(
        keyboardDone.exists && keyboardDone.isHittable,
        "XCUI keyboard drag and swipe fallback did not dismiss the keyboard, and Done was unavailable."
      )
      keyboardDone.tap()
      partial = try waitForSheet("keyboard dismissal fallback") { state in
        SheetQAValue.int(state, "presentationId") == presentationID
          && SheetQAValue.string(state, "keyboardPhase") == "hidden"
      }
      automationMode = "xcui_drag_plus_done_fallback"
    }
    guard let partial else {
      throw SheetQAFailure("Keyboard dismissal produced neither interactive frames nor a settled hidden state.")
    }
    let stillVisible = try harnessState()
    try require(
      SheetQAValue.bool(stillVisible, "visible") == true
        && SheetQAValue.int(stillVisible, "presentationId") == presentationID,
      "Interactive keyboard dismissal also dismissed or replaced the sheet.",
      state: stillVisible
    )
    reporter.record(
      "checkpoint",
      step: automationMode == "interactive_keyboard_frames"
        ? "\(stepPrefix)_partial_keyboard_dismissal_observed"
        : "\(stepPrefix)_keyboard_dismissal_fallback_observed",
      iteration: iteration,
      success: true,
      state: partial,
      details: [
        "interactiveFramesBefore": interactiveFramesBefore,
        "interactiveFramesAfter": SheetQAValue.int(partial, "interactiveKeyboardFrameCount") ?? 0,
        "automationMode": automationMode,
        "terminalKeyboardPhase": SheetQAValue.string(partial, "keyboardPhase") ?? "unknown"
      ]
    )

    try tap(SheetQAIdentifiers.description)
    let reopened = try waitForSheet("Suggestions after explicit keyboard reopen") { state in
      SheetQAValue.int(state, "presentationId") == presentationID
        && SheetQAValue.string(state, "sheetPhase") == "presented"
        && SheetQAValue.string(state, "keyboardPhase") == "visible"
        && SheetQAValue.string(state, "suggestionsPhase") == "visible"
        && (SheetQAValue.int(state, "inputFocusCount") ?? 0) > inputFocusCountBefore
        && self.suggestionsAreVisiblyRenderable(state)
    }
    try require(
      (SheetQAValue.int(reopened, "inputFocusCount") ?? 0) > inputFocusCountBefore,
      "Description did not emit a new native onFocus after the keyboard drag.",
      state: reopened
    )
    try assertSuggestionsOverlayVisible(reopened, context: "Keyboard Suggestions reopen")
    reporter.record(
      "checkpoint",
      step: "\(stepPrefix)_keyboard_suggestions_reopened",
      iteration: iteration,
      success: true,
      state: reopened
    )
    return reopened
  }

  private func performCommittedSwipe() throws {
    let handle = element(SheetQAIdentifiers.sheetHandle)
    try waitForElement(handle, description: "sheet swipe handle")
    try require(handle.isHittable, "Sheet swipe handle was not hittable.")
    let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let end = start.withOffset(CGVector(dx: 0, dy: 230))
    start.press(
      forDuration: 0.05,
      thenDragTo: end,
      withVelocity: .fast,
      thenHoldForDuration: 0
    )
  }

  private func observeStablePresentation(_ presentationID: Int, duration: TimeInterval) throws {
    let deadline = Date().addingTimeInterval(duration)
    var lastState: SheetQAJSON?
    while Date() < deadline {
      let state = try sheetState()
      lastState = state
      guard
        SheetQAValue.int(state, "presentationId") == presentationID,
        SheetQAValue.string(state, "sheetPhase") == "presented",
        SheetQAValue.bool(state, "ready") == true
      else {
        throw SheetQAFailure("Presentation \(presentationID) became stale during the observation window: \(jsonDescription(state)).")
      }
      pollRunLoop()
    }
    reporter.record("checkpoint", step: "presentation_stable", success: true, state: lastState)
  }

  private func replaceDescription(with replacement: String) throws {
    try bringDescriptionIntoView()
    let field = element(SheetQAIdentifiers.description)
    try waitForElement(field, description: "Description field")
    try require(field.isHittable, "Description field could not be brought into view.")
    field.tap()
    try replaceFieldValue(
      field,
      with: replacement,
      emptyDisplayValues: ["What are you working on?"]
    )
  }

  private func replaceFieldValue(
    _ field: XCUIElement,
    with replacement: String,
    emptyDisplayValues: Set<String> = []
  ) throws {
    // A normal center tap can place the insertion point at the start of a
    // compact five-character time field. Put it at the trailing edge before
    // issuing backspaces so the edit is deterministic.
    field.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
    if let current = elementValue(field),
       !current.isEmpty,
       !emptyDisplayValues.contains(current) {
      // Controlled React Native fields reconcile after every edit. Sending a
      // whole delete run as one synthesized event can race that reconciliation
      // and leave formatted time text partially intact, so delete one
      // character at a time just as a user would.
      for _ in current {
        let previous = elementValue(field)
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        try waitForElementValueToChange(
          field,
          from: previous,
          description: "field deletion reconciliation"
        )
      }
    }
    for character in replacement {
      let previous = elementValue(field)
      field.typeText(String(character))
      try waitForElementValueToChange(
        field,
        from: previous,
        description: "field input reconciliation"
      )
    }
  }

  private func waitForElementValueToChange(
    _ candidate: XCUIElement,
    from previous: String?,
    timeout: TimeInterval = 2,
    description: String
  ) throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if candidate.exists && elementValue(candidate) != previous { return }
      pollRunLoop()
    }
    throw SheetQAFailure(
      "Timed out waiting for \(description); value remained \(previous ?? "<nil>")."
    )
  }

  private func bringDescriptionIntoView() throws {
    let field = element(SheetQAIdentifiers.description)
    try waitForElement(field, description: "Description field")
    let form = element(SheetQAIdentifiers.sheetForm)
    for _ in 0 ..< 8 where !field.isHittable {
      guard form.exists else { break }
      form.swipeDown(velocity: .slow)
    }
    try require(field.isHittable, "Description field remained offscreen after scrolling to the form's top.")
  }

  @discardableResult
  private func selectBauhausSuggestion() throws -> SheetQAJSON {
    try replaceDescription(with: "bau")
    let row = element("historical-suggestion-row-0")
    try waitForElement(row, description: "Bauhaus historical suggestion")
    try require(
      row.label.localizedCaseInsensitiveContains("Bauhaus research"),
      "Historical substring lookup returned \"\(row.label)\" instead of Bauhaus research."
    )
    reporter.record(
      "expected_overlay_exit",
      step: "historical_suggestion_selection",
      success: true,
      state: try sheetState(),
      details: ["expectedOverlayExit": true, "expectedTransition": true]
    )
    row.tap()
    try waitForElementValue(
      element(SheetQAIdentifiers.description),
      equals: "Bauhaus research",
      description: "Bauhaus suggestion application"
    )
    let settled = try waitForSheet("Bauhaus suggestion settled") { state in
      SheetQAValue.string(state, "suggestionsPhase") == "closed"
        && SheetQAValue.string(state, "sheetPhase") == "presented"
    }
    let category = elementWithLabel("Set category to Focus")
    try require(category.exists && category.isSelected, "Bauhaus suggestion did not select the Focus category.", state: settled)
    try require(elementWithLabel("Remove tag A24").exists, "Bauhaus suggestion did not apply tag A24.", state: settled)
    try require(elementWithLabel("Remove tag Launch").exists, "Bauhaus suggestion did not apply tag Launch.", state: settled)
    return settled
  }

  private func temporalSnapshot() throws -> SheetQAJSON {
    var snapshot: SheetQAJSON = [:]
    for (key, identifier) in [
      ("startDate", SheetQAIdentifiers.startDate),
      ("startTime", SheetQAIdentifiers.startTime),
      ("endDate", "time-entry-end-date"),
      ("endTime", "time-entry-end-time")
    ] {
      let candidate = element(identifier)
      guard candidate.exists else { continue }
      snapshot[key] = elementSnapshot(candidate)
    }
    try require(snapshot["startDate"] != nil && snapshot["startTime"] != nil, "Temporal controls were incomplete.")
    return snapshot
  }

  private func elementSnapshot(_ candidate: XCUIElement) -> SheetQAJSON {
    var snapshot: SheetQAJSON = [
      "identifier": candidate.identifier,
      "label": candidate.label
    ]
    if let value = elementValue(candidate) { snapshot["value"] = value }
    let descendantLabels = candidate.descendants(matching: .staticText).allElementsBoundByIndex
      .map(\.label)
      .filter { !$0.isEmpty }
    if !descendantLabels.isEmpty { snapshot["descendantLabels"] = descendantLabels }
    return snapshot
  }

  private func requireTemporalSnapshot(
    _ before: SheetQAJSON,
    equals after: SheetQAJSON,
    context: String,
    state: SheetQAJSON
  ) throws {
    guard
      let beforeData = try? JSONSerialization.data(withJSONObject: before, options: [.sortedKeys]),
      let afterData = try? JSONSerialization.data(withJSONObject: after, options: [.sortedKeys]),
      beforeData == afterData
    else {
      throw SheetQAFailure("\(context) changed temporal values. Before: \(jsonDescription(before)); after: \(jsonDescription(after)); state: \(jsonDescription(state)).")
    }
  }

  private func harnessState() throws -> SheetQAJSON {
    try markerState(SheetQAIdentifiers.harnessState)
  }

  private func sheetState() throws -> SheetQAJSON {
    try markerState(SheetQAIdentifiers.sheetState)
  }

  private func markerState(_ identifier: String) throws -> SheetQAJSON {
    let marker = element(identifier)
    guard marker.exists else {
      throw SheetQAFailure("Marker \(identifier) does not exist.")
    }
    let raw = marker.label.isEmpty ? elementValue(marker) ?? "" : marker.label
    guard
      let data = raw.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data),
      let json = object as? SheetQAJSON
    else {
      throw SheetQAFailure("Marker \(identifier) did not contain JSON: \(raw.prefix(500)).")
    }
    return json
  }

  private func waitForHarness(
    _ description: String,
    timeout: TimeInterval = 12,
    predicate: (SheetQAJSON) -> Bool
  ) throws -> SheetQAJSON {
    try waitForMarker(
      SheetQAIdentifiers.harnessState,
      description: description,
      timeout: timeout,
      predicate: predicate
    )
  }

  private func waitForSheet(
    _ description: String,
    timeout: TimeInterval = 12,
    predicate: (SheetQAJSON) -> Bool
  ) throws -> SheetQAJSON {
    try waitForMarker(
      SheetQAIdentifiers.sheetState,
      description: description,
      timeout: timeout,
      predicate: predicate
    )
  }

  private func observeSheet(
    timeout: TimeInterval,
    predicate: (SheetQAJSON) -> Bool
  ) throws -> SheetQAJSON? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let redbox = element("redbox-error")
      if redbox.exists {
        let label = redbox.label
        let value = elementValue(redbox) ?? ""
        throw SheetQAFailure(
          "React Native RedBox while observing sheet: label=\(label.prefix(1_500)); value=\(value.prefix(1_500))."
        )
      }
      if let state = try? sheetState(), predicate(state) {
        return state
      }
      pollRunLoop()
    }
    return nil
  }

  private func waitForMarker(
    _ identifier: String,
    description: String,
    timeout: TimeInterval,
    predicate: (SheetQAJSON) -> Bool
  ) throws -> SheetQAJSON {
    let deadline = Date().addingTimeInterval(timeout)
    var lastJSON: SheetQAJSON?
    var lastRaw = "<marker absent>"
    while Date() < deadline {
      let redbox = element("redbox-error")
      if redbox.exists {
        let label = redbox.label
        let value = elementValue(redbox) ?? ""
        throw SheetQAFailure(
          "React Native RedBox while waiting for \(description): label=\(label.prefix(1_500)); value=\(value.prefix(1_500))."
        )
      }
      let marker = element(identifier)
      if marker.exists {
        let raw = marker.label.isEmpty ? elementValue(marker) ?? "" : marker.label
        lastRaw = raw
        if
          let data = raw.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data),
          let json = object as? SheetQAJSON
        {
          lastJSON = json
          if predicate(json) { return json }
        }
      }
      pollRunLoop()
    }
    let last = lastJSON.map(jsonDescription) ?? String(lastRaw.prefix(1_000))
    throw SheetQAFailure("Timed out after \(timeout)s waiting for \(description). Last \(identifier): \(last).")
  }

  private func waitForElement(
    _ candidate: XCUIElement,
    timeout: TimeInterval = 8,
    description: String
  ) throws {
    guard candidate.waitForExistence(timeout: timeout) else {
      throw SheetQAFailure("Timed out waiting for \(description).")
    }
  }

  private func waitForElementToDisappear(
    _ candidate: XCUIElement,
    timeout: TimeInterval = 8,
    description: String
  ) throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if !candidate.exists { return }
      pollRunLoop()
    }
    throw SheetQAFailure("Timed out waiting for \(description) to disappear.")
  }

  private func waitForElementValue(
    _ candidate: XCUIElement,
    equals expected: String,
    timeout: TimeInterval = 8,
    description: String
  ) throws {
    let deadline = Date().addingTimeInterval(timeout)
    var lastValue: String?
    while Date() < deadline {
      if candidate.exists {
        lastValue = elementValue(candidate)
        if lastValue == expected { return }
      }
      pollRunLoop()
    }
    throw SheetQAFailure("Timed out waiting for \(description) to equal \"\(expected)\"; last value was \"\(lastValue ?? "<nil>")\".")
  }

  private func waitForElementMatchingLabel(
    containsAll fragments: [String],
    type: XCUIElement.ElementType,
    timeout: TimeInterval = 8,
    description: String
  ) throws -> XCUIElement {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      for candidate in app.descendants(matching: type).allElementsBoundByIndex {
        if fragments.allSatisfy({ candidate.label.localizedCaseInsensitiveContains($0) }) {
          return candidate
        }
      }
      pollRunLoop()
    }
    throw SheetQAFailure("Timed out waiting for \(description).")
  }

  private func tap(_ identifier: String, scrollIn scrollIdentifier: String? = nil) throws {
    let container = scrollIdentifier.map(element)
    for _ in 0 ..< 9 {
      let candidate = element(identifier)
      if candidate.exists && candidate.isHittable {
        candidate.tap()
        return
      }
      if let container, container.exists {
        container.swipeUp(velocity: .slow)
      } else {
        app.swipeUp(velocity: .slow)
      }
    }
    let candidate = element(identifier)
    throw SheetQAFailure(
      "Element \(identifier) was not hittable after scrolling (exists=\(candidate.exists), frame=\(candidate.exists ? NSCoder.string(for: candidate.frame) : "<none>"))."
    )
  }

  private func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier == %@", identifier))
      .firstMatch
  }

  private func elementWithLabel(_ label: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label == %@", label))
      .firstMatch
  }

  private func elementValue(_ candidate: XCUIElement) -> String? {
    if let value = candidate.value as? String { return value }
    if let value = candidate.value { return String(describing: value) }
    return nil
  }

  private func nativeGeometryEvidence() -> SheetQAJSON {
    var evidence: SheetQAJSON = [:]
    let appFrame = app.frame
    if appFrame.origin.x.isFinite,
       appFrame.origin.y.isFinite,
       appFrame.width.isFinite,
       appFrame.height.isFinite,
       appFrame.width > 0,
       appFrame.height > 0 {
      evidence["screenAppRect"] = [
        "height": appFrame.height,
        "width": appFrame.width,
        "x": appFrame.origin.x,
        "y": appFrame.origin.y
      ]
    }
    for (key, identifier) in [
      ("screenSheetRect", SheetQAIdentifiers.sheet),
      ("screenDescriptionRect", SheetQAIdentifiers.description),
      ("screenOverlayRect", SheetQAIdentifiers.suggestions)
    ] {
      let candidate = element(identifier)
      guard candidate.exists else { continue }
      let frame = candidate.frame
      guard
        frame.origin.x.isFinite,
        frame.origin.y.isFinite,
        frame.width.isFinite,
        frame.height.isFinite,
        frame.width > 0,
        frame.height > 0
      else {
        continue
      }
      evidence[key] = [
        "height": frame.height,
        "width": frame.width,
        "x": frame.origin.x,
        "y": frame.origin.y
      ]
    }
    return evidence
  }

  private func suggestionsExpectedOnPresentation(reason: String) -> Bool {
    reason == "blank_timer_started" || reason == "review_edit"
  }

  private func visualGeometryIsSane(_ state: SheetQAJSON) -> Bool {
    guard
      SheetQAValue.string(state, "geometryCoordinateSpace") == "sheet_local",
      let liveSheet = SheetQARect(state["sheetRect"]),
      let description = SheetQARect(state["descriptionRect"]),
      liveSheet.width > 0,
      liveSheet.height > 0,
      description.width > 0,
      description.height > 0
    else {
      return false
    }
    let tolerance = 2.0
    let localOriginIsStable = abs(liveSheet.x) <= tolerance && abs(liveSheet.y) <= tolerance
    let sheetFitsDevice = liveSheet.width <= app.frame.width + tolerance
      && liveSheet.height <= app.frame.height + tolerance
    let descriptionIsInSheet = description.x >= liveSheet.x - tolerance
      && description.y >= liveSheet.y - tolerance
      && description.x + description.width <= liveSheet.x + liveSheet.width + tolerance
      && description.y + description.height <= liveSheet.y + liveSheet.height + tolerance
    return localOriginIsStable && sheetFitsDevice && descriptionIsInSheet
  }

  private func suggestionsAreVisiblyRenderable(_ state: SheetQAJSON) -> Bool {
    guard
      SheetQAValue.string(state, "suggestionsPhase") == "visible",
      SheetQAValue.bool(state, "overlayContentMeasured") == true,
      SheetQAValue.bool(state, "overlayContainerVisible") == true,
      SheetQAValue.bool(state, "overlayContentKeyMatches") == true,
      SheetQAValue.bool(state, "overlayUpdatePending") == false,
      SheetQAValue.bool(state, "obscuredFormAccessibilityHidden") == true,
      let contentHeight = SheetQAValue.double(state, "overlayContentHeight"),
      let headerHeight = SheetQAValue.double(state, "overlayHeaderHeight"),
      let renderedHeight = SheetQAValue.double(state, "overlayRenderedHeight"),
      let suggestionCount = SheetQAValue.int(state, "overlaySuggestionCount"),
      let measuredSuggestionCount = SheetQAValue.int(state, "overlayMeasuredSuggestionCount"),
      let geometry = state["overlayGeometry"] as? SheetQAJSON,
      let width = SheetQAValue.double(geometry, "width"),
      let maxHeight = SheetQAValue.double(geometry, "maxHeight"),
      let left = SheetQAValue.double(geometry, "left"),
      let top = SheetQAValue.double(geometry, "top"),
      let boundary = SheetQAValue.double(state, "overlayBottomBoundary"),
      let sheet = SheetQARect(state["sheetRect"]),
      let description = SheetQARect(state["descriptionRect"])
    else {
      return false
    }
    let tolerance = 2.0
    let anchoredBelowDescription = top >= description.y + description.height - tolerance
    let horizontallyContained = left >= sheet.x - tolerance
      && left + width <= sheet.x + sheet.width + tolerance
    let verticallyBounded = top >= sheet.y - tolerance
      && top + maxHeight <= boundary + tolerance
      && boundary <= sheet.y + sheet.height + tolerance
    return width > 0
      && maxHeight > 0
      && contentHeight > 0
      && headerHeight > 0
      && renderedHeight > 0
      && renderedHeight <= maxHeight + tolerance
      && suggestionCount > 0
      && measuredSuggestionCount == suggestionCount
      && anchoredBelowDescription
      && horizontallyContained
      && verticallyBounded
      && visualGeometryIsSane(state)
  }

  private func assertSuggestionsOverlayVisible(
    _ state: SheetQAJSON,
    context: String
  ) throws {
    try require(
      SheetQAValue.string(state, "suggestionsPhase") == "visible",
      "\(context) did not reach the visible Suggestions phase.",
      state: state
    )
    try require(
      suggestionsAreVisiblyRenderable(state),
      "\(context) had invalid sheet/Description geometry or a non-renderable Suggestions maxHeight.",
      state: state
    )
    try require(
      element(SheetQAIdentifiers.suggestions).exists,
      "\(context) reported visible Suggestions telemetry without a rendered overlay element.",
      state: state
    )
    try require(
      element(SheetQAIdentifiers.description).exists,
      "\(context) hid the focused Description from the accessibility tree.",
      state: state
    )
    try require(
      element(SheetQAIdentifiers.suggestionList).exists,
      "\(context) did not expose the Suggestions results to accessibility.",
      state: state
    )
    try require(
      !element(SheetQAIdentifiers.categoryClear).exists,
      "\(context) exposed an obscured Category control ahead of Suggestions.",
      state: state
    )
    try require(
      element(SheetQAIdentifiers.sheetHandle).exists,
      "\(context) hid the sheet handle while Suggestions were visible.",
      state: state
    )
    try assertGuardrailTelemetry(state)
  }

  private func assertGuardrailTelemetry(_ state: SheetQAJSON) throws {
    let staleCallbacks = try requiredInt(state, key: "staleCallbackCount")
    let duplicateMutations = try requiredInt(state, key: "duplicateMutationCount")
    let attempts = try requiredInt(state, key: "mutationAttemptCount")
    let started = try requiredInt(state, key: "mutationStartedCount")
    let rejected = try requiredInt(state, key: "mutationRejectedCount")
    let finished = try requiredInt(state, key: "mutationFinishedCount")
    let rejectedCompletions = try requiredInt(state, key: "mutationCompletionRejectedCount")
    let overlayVisibilityDrops = try requiredInt(
      state,
      key: "overlayUpdateVisibilityDropCount"
    )
    try require(staleCallbacks == 0, "Stale presentation callback telemetry was nonzero.", state: state)
    try require(duplicateMutations == 0, "Duplicate mutation telemetry was nonzero.", state: state)
    try require(rejectedCompletions == 0, "A stale mutation completion was rejected.", state: state)
    try require(
      overlayVisibilityDrops == 0,
      "A same-presentation Suggestions update dropped the visible overlay container.",
      state: state
    )
    try require(attempts == started + rejected, "Mutation attempt counters were inconsistent.", state: state)
    try require(finished <= started, "More mutations finished than started.", state: state)
  }

  private func requiredRect(_ json: SheetQAJSON, key: String) throws -> SheetQARect {
    guard let rect = SheetQARect(json[key]) else {
      throw SheetQAFailure("State did not contain a valid \(key): \(jsonDescription(json)).")
    }
    return rect
  }

  private func requiredInt(_ json: SheetQAJSON, key: String) throws -> Int {
    guard let value = SheetQAValue.int(json, key) else {
      throw SheetQAFailure("State did not contain integer \(key): \(jsonDescription(json)).")
    }
    return value
  }

  private func requiredString(_ json: SheetQAJSON, key: String) throws -> String {
    guard let value = SheetQAValue.string(json, key) else {
      throw SheetQAFailure("State did not contain string \(key): \(jsonDescription(json)).")
    }
    return value
  }

  private func require(
    _ condition: @autoclosure () -> Bool,
    _ message: String,
    state: SheetQAJSON? = nil
  ) throws {
    guard condition() else {
      reporter.record("invariant_violation", success: false, message: message, state: state)
      throw SheetQAFailure(message)
    }
  }

  private func pollRunLoop() {
    _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
  }

  private func jsonDescription(_ json: SheetQAJSON) -> String {
    guard
      JSONSerialization.isValidJSONObject(json),
      let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]),
      let description = String(data: data, encoding: .utf8)
    else {
      return String(describing: json)
    }
    return description
  }
}
