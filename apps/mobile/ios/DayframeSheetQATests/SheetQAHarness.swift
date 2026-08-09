import Foundation
import XCTest

typealias SheetQAJSON = [String: Any]

enum SheetQAIdentifiers {
  static let root = "sheet-qa-root"
  static let harnessState = "sheet-qa-harness-state"
  static let sheetState = "sheet-qa-state"
  static let sheet = "time-entry-sheet"
  static let sheetHandle = "time-entry-sheet-handle"
  static let sheetForm = "time-entry-sheet-form"
  static let elapsed = "time-entry-sheet-elapsed"
  static let hero = "time-entry-sheet-hero"
  static let description = "time-entry-description"
  static let categoryClear = "time-entry-category-clear"
  static let startDate = "time-entry-start-date"
  static let startTime = "time-entry-start-time"
  static let done = "time-entry-sheet-done"
  static let stop = "time-entry-sheet-stop"
  static let delete = "time-entry-sheet-delete"
  static let suggestions = "historical-suggestions-overlay"
  static let suggestionList = "historical-suggestions-list"
  static let undo = "deletion-undo-action"
  static let refresh = "sheet-qa-refresh"
  static let canonical = "sheet-qa-canonical"
  static let secondDelete = "sheet-qa-second-delete"
  static let newTimer = "sheet-qa-new-timer"
}

enum SheetQAFlow: String, CaseIterable {
  case smoke
  case blank
  case existingBlank = "existing-blank"
  case existing
  case completed
  case add
  case review
  case journeys
  case keyboard
  case tags
  case swipe
  case gestures
  case failures
  case stress
  case deleteUndo = "delete-undo"
  case deleteExpiry = "delete-expiry"
  case deleteCanonical = "delete-canonical"
  case deleteInvalidation = "delete-invalidation"
  case deletion
  case all
}

struct SheetQAConfiguration {
  let flow: SheetQAFlow
  let iterations: Int
  let expectedReduceMotion: Bool
  let runID: String

  static func load(environment: [String: String] = ProcessInfo.processInfo.environment) throws -> Self {
    let rawFlow = expandedValue(environment["DAYFRAME_SHEET_QA_FLOW"]) ?? SheetQAFlow.smoke.rawValue
    guard let flow = SheetQAFlow(rawValue: rawFlow) else {
      throw SheetQAFailure(
        "Unknown flow \"\(rawFlow)\". Expected one of: \(SheetQAFlow.allCases.map(\.rawValue).joined(separator: ", "))."
      )
    }

    let rawIterations = expandedValue(environment["DAYFRAME_SHEET_QA_ITERATIONS"]) ?? "1"
    guard let iterations = Int(rawIterations), (1 ... 100).contains(iterations) else {
      throw SheetQAFailure("DAYFRAME_SHEET_QA_ITERATIONS must be an integer from 1 through 100.")
    }

    let rawReduceMotion = expandedValue(
      environment["DAYFRAME_SHEET_QA_EXPECT_REDUCE_MOTION"]
    )?.lowercased() ?? "0"
    guard ["0", "1", "false", "true", "off", "on"].contains(rawReduceMotion) else {
      throw SheetQAFailure("DAYFRAME_SHEET_QA_EXPECT_REDUCE_MOTION must be 0/1, false/true, or off/on.")
    }
    let expectedReduceMotion = ["1", "true", "on"].contains(rawReduceMotion)
    let runID = expandedValue(environment["DAYFRAME_SHEET_QA_RUN_ID"])
      ?? UUID().uuidString.lowercased()

    return Self(
      flow: flow,
      iterations: iterations,
      expectedReduceMotion: expectedReduceMotion,
      runID: runID
    )
  }

  private static func expandedValue(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
    return trimmed
  }
}

struct SheetQAFailure: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

struct SheetQARect: Equatable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double

  init?(_ value: Any?) {
    guard
      let json = value as? SheetQAJSON,
      let x = SheetQAValue.double(json, "x"),
      let y = SheetQAValue.double(json, "y"),
      let width = SheetQAValue.double(json, "width"),
      let height = SheetQAValue.double(json, "height"),
      x.isFinite,
      y.isFinite,
      width.isFinite,
      height.isFinite,
      width >= 0,
      height >= 0
    else {
      return nil
    }
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }

  func isWithin(_ tolerance: Double, of other: SheetQARect) -> Bool {
    abs(x - other.x) <= tolerance
      && abs(y - other.y) <= tolerance
      && abs(width - other.width) <= tolerance
      && abs(height - other.height) <= tolerance
  }

  var json: SheetQAJSON {
    ["x": x, "y": y, "width": width, "height": height]
  }
}

enum SheetQAValue {
  static func string(_ json: SheetQAJSON, _ key: String) -> String? {
    json[key] as? String
  }

  static func bool(_ json: SheetQAJSON, _ key: String) -> Bool? {
    if let value = json[key] as? Bool { return value }
    if let value = json[key] as? NSNumber { return value.boolValue }
    return nil
  }

  static func int(_ json: SheetQAJSON, _ key: String) -> Int? {
    if let value = json[key] as? Int { return value }
    if let value = json[key] as? NSNumber { return value.intValue }
    return nil
  }

  static func double(_ json: SheetQAJSON, _ key: String) -> Double? {
    if let value = json[key] as? Double { return value }
    if let value = json[key] as? NSNumber { return value.doubleValue }
    return nil
  }

  static func strings(_ json: SheetQAJSON, _ key: String) -> [String]? {
    json[key] as? [String]
  }

  static func isNull(_ json: SheetQAJSON, _ key: String) -> Bool {
    json[key] is NSNull
  }
}

final class SheetQANDJSONReporter {
  private let flow: String
  private let nativeGeometryProvider: () -> SheetQAJSON
  private let reduceMotion: Bool
  private let runID: String
  private let startedAt = Date()

  init(
    configuration: SheetQAConfiguration,
    nativeGeometryProvider: @escaping () -> SheetQAJSON = { [:] }
  ) {
    flow = configuration.flow.rawValue
    self.nativeGeometryProvider = nativeGeometryProvider
    reduceMotion = configuration.expectedReduceMotion
    runID = configuration.runID
  }

  func record(
    _ event: String,
    step: String? = nil,
    iteration: Int? = nil,
    success: Bool? = nil,
    message: String? = nil,
    state: SheetQAJSON? = nil,
    details: SheetQAJSON? = nil
  ) {
    let now = Date()
    var payload: SheetQAJSON = [
      "elapsedMs": Int(now.timeIntervalSince(startedAt) * 1_000),
      "event": event,
      "flow": flow,
      "reduceMotion": reduceMotion,
      "runId": runID,
      "timestamp": ISO8601DateFormatter.sheetQA.string(from: now),
      "timestampMs": Int(now.timeIntervalSince1970 * 1_000)
    ]
    if let step { payload["step"] = step }
    if let iteration { payload["iteration"] = iteration }
    if let success { payload["success"] = success }
    if let message { payload["message"] = message }
    if let state {
      var enrichedState = state
      let nativeGeometry = nativeGeometryProvider()
      for (key, value) in nativeGeometry {
        enrichedState[key] = value
        payload[key] = value
      }
      payload["state"] = enrichedState
      if let baseSheetRect = enrichedState["baseSheetRect"] {
        payload["baseSheetRect"] = baseSheetRect
      }
      if let sheetRect = enrichedState["sheetRect"] {
        payload["sheetRect"] = sheetRect
      }
      if let descriptionRect = enrichedState["descriptionRect"] {
        payload["descriptionRect"] = descriptionRect
      }
      let cumulativeCounterKeys = [
        "duplicateMutationCount",
        "interactiveKeyboardFrameCount",
        "mutationAttemptCount",
        "mutationCompletionRejectedCount",
        "mutationFinishedCount",
        "mutationRejectedCount",
        "mutationStartedCount",
        "overlayUpdateVisibilityDropCount",
        "swipeCancelledCount",
        "swipeStartedCount",
        "staleCallbackCount"
      ]
      var counters: SheetQAJSON = [:]
      for key in cumulativeCounterKeys {
        if let value = SheetQAValue.int(enrichedState, key) {
          payload[key] = value
          counters[key] = value
        }
      }
      if !counters.isEmpty {
        payload["counters"] = counters
      }
      if let lastMutationToken = enrichedState["lastMutationToken"] {
        payload["lastMutationToken"] = lastMutationToken
      }
      if SheetQAValue.bool(enrichedState, "ready") == true,
         SheetQAValue.string(enrichedState, "sheetPhase") == "presented" {
        payload["settled"] = true
      }
    }
    if let details {
      payload["details"] = details
      for key in [
        "committedExit",
        "exitFinished",
        "exitStarted",
        "expectedOverlayExit",
        "expectedTransition",
        "openStarted"
      ] {
        if let value = SheetQAValue.bool(details, key) {
          payload[key] = value
        }
      }
    }

    guard
      JSONSerialization.isValidJSONObject(payload),
      let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    else {
      print("DAYFRAME_SHEET_QA_NDJSON:{\"event\":\"reporter_error\",\"success\":false}")
      return
    }
    print("DAYFRAME_SHEET_QA_NDJSON:\(json)")
  }
}

private extension ISO8601DateFormatter {
  static let sheetQA: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}
